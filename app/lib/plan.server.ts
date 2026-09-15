import prisma from "../db.server";
import type { Plan, Shop, Subscription } from "@prisma/client";
import { FREE_PLAN_ID, type GatedFeature } from "./plan.constants";

export type ShopWithPlan = Shop & {
  activeSubscription: (Subscription & { plan: Plan }) | null;
};

type ShopAccessInput = Pick<Shop, "id"> & {
  activeSubscription?: (Pick<Subscription, "status" | "cycle"> & { plan?: Plan | null }) | null;
};

/**
 * Resolved billing state of a store. There is no trial: a store is either on
 * an ACTIVE Shopify subscription (its plan applies) or on the Free plan.
 * The app is never blocked.
 */
export interface BillingAccess {
  status: "active" | "free";
  plan: Plan;
  cycle: "MONTHLY" | "ANNUAL" | null;
}

async function loadPlan(id: string): Promise<Plan> {
  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) throw new Error(`Plan "${id}" missing — run migrations`);
  return plan;
}

export async function getBillingAccess(shop: ShopAccessInput): Promise<BillingAccess> {
  if (shop.activeSubscription?.status === "ACTIVE" && shop.activeSubscription.plan) {
    return {
      status: "active",
      plan: shop.activeSubscription.plan,
      cycle: shop.activeSubscription.cycle,
    };
  }
  return { status: "free", plan: await loadPlan(FREE_PLAN_ID), cycle: null };
}

/** Resolve the effective plan for a shop: active subscription, else Free. */
export async function resolvePlan(shop: ShopAccessInput): Promise<Plan> {
  return (await getBillingAccess(shop)).plan;
}

/* ─────────────────────────────────────────────────────────
   Quotas
   QR codes and campaigns are counted oldest-first. Everything beyond the
   plan limit is "over quota": it is paused automatically and cannot be
   (re)activated until the merchant archives / deletes older items or
   upgrades. Creation and duplication are blocked while the quota is full.
   ───────────────────────────────────────────────────────── */

export type QuotaResource = "qrCodes" | "campaigns";

export interface QuotaState {
  limit: number | null;
  used: number;
  /** Ids of the items beyond the limit (newest ones). */
  overQuotaIds: string[];
}

async function countResource(shopId: string, resource: QuotaResource): Promise<number> {
  return resource === "qrCodes"
    ? prisma.qrCode.count({ where: { shopId, archivedAt: null } })
    : prisma.campaign.count({ where: { shopId } });
}

async function overQuotaIds(shopId: string, resource: QuotaResource, limit: number): Promise<string[]> {
  const rows = resource === "qrCodes"
    ? await prisma.qrCode.findMany({
        where: { shopId, archivedAt: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
        skip: limit,
      })
    : await prisma.campaign.findMany({
        where: { shopId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
        skip: limit,
      });
  return rows.map(r => r.id);
}

export async function getQuotaState(shopId: string, resource: QuotaResource, limit: number | null): Promise<QuotaState> {
  const used = await countResource(shopId, resource);
  if (limit == null) return { limit, used, overQuotaIds: [] };
  return { limit, used, overQuotaIds: used > limit ? await overQuotaIds(shopId, resource, limit) : [] };
}

/** Rank-based check for a single item: is it beyond the plan limit? */
export async function isOverQuota(
  resource: QuotaResource,
  item: { id: string; shopId: string; createdAt: Date },
  limit: number | null,
): Promise<boolean> {
  if (limit == null) return false;
  const olderThan = {
    OR: [
      { createdAt: { lt: item.createdAt } },
      { createdAt: item.createdAt, id: { lt: item.id } },
    ],
  };
  const rank = resource === "qrCodes"
    ? await prisma.qrCode.count({ where: { shopId: item.shopId, archivedAt: null, ...olderThan } })
    : await prisma.campaign.count({ where: { shopId: item.shopId, ...olderThan } });
  return rank >= limit;
}

export interface QuotaEnforcement {
  qrCodes: QuotaState;
  campaigns: QuotaState;
}

/**
 * Pause every QR code / campaign beyond the plan limits. Called on each
 * admin page load and after every subscription change, so a downgrade
 * (cancellation, plan switch) takes effect without a cron job.
 */
export async function enforceQuotasForPlan(shopId: string, plan: Plan): Promise<QuotaEnforcement> {
  const [qrCodes, campaigns] = await Promise.all([
    getQuotaState(shopId, "qrCodes", plan.qrCodeLimit),
    getQuotaState(shopId, "campaigns", plan.campaignLimit),
  ]);

  const ops = [];
  if (qrCodes.overQuotaIds.length) {
    ops.push(prisma.qrCode.updateMany({
      where: { id: { in: qrCodes.overQuotaIds }, active: true },
      data: { active: false },
    }));
  }
  if (campaigns.overQuotaIds.length) {
    ops.push(prisma.campaign.updateMany({
      where: { id: { in: campaigns.overQuotaIds }, status: "ACTIVE" },
      data: { status: "PAUSED" },
    }));
  }
  if (ops.length) await prisma.$transaction(ops);

  return { qrCodes, campaigns };
}

export async function enforcePlanQuotas(shop: ShopWithPlan): Promise<QuotaEnforcement> {
  return enforceQuotasForPlan(shop.id, await resolvePlan(shop));
}

export class QuotaExceededError extends Error {
  constructor(
    public resource: QuotaResource,
    public limit: number,
    public planId: string,
    public reason: "full" | "over-quota" = "full",
  ) {
    super(
      reason === "full"
        ? `Your ${planId} plan allows ${limit} ${resource === "qrCodes" ? "QR codes" : "campaigns"}. Archive or delete one, or upgrade to add more.`
        : `This ${resource === "qrCodes" ? "QR code" : "campaign"} is beyond the ${limit} allowed by your ${planId} plan. Archive or delete older items, or upgrade to reactivate it.`,
    );
    this.name = "QuotaExceededError";
  }
}

/** Block creation / duplication once the plan quota is full. */
export async function assertQuota(shop: ShopWithPlan, resource: QuotaResource): Promise<void> {
  const plan = await resolvePlan(shop);
  const limit = resource === "qrCodes" ? plan.qrCodeLimit : plan.campaignLimit;
  if (limit == null) return; // unlimited

  const used = await countResource(shop.id, resource);
  if (used >= limit) throw new QuotaExceededError(resource, limit, plan.id, "full");
}

/** Block (re)activation of an item that sits beyond the plan quota. */
export async function assertWithinQuota(
  shop: ShopWithPlan,
  resource: QuotaResource,
  item: { id: string; createdAt: Date },
): Promise<void> {
  const plan = await resolvePlan(shop);
  const limit = resource === "qrCodes" ? plan.qrCodeLimit : plan.campaignLimit;
  if (limit == null) return;
  if (await isOverQuota(resource, { ...item, shopId: shop.id }, limit)) {
    throw new QuotaExceededError(resource, limit, plan.id, "over-quota");
  }
}

/* ─────────────────────────────────────────────────────────
   Usage snapshot (sidebar widget + plan notices)
   ───────────────────────────────────────────────────────── */

export interface PlanUsage {
  planId: string;
  planName: string;
  status: BillingAccess["status"];
  cycle: "MONTHLY" | "ANNUAL" | null;
  qrUsed: number;
  qrLimit: number | null;
  qrOverQuota: number;
  campaignUsed: number;
  campaignLimit: number | null;
  campaignOverQuota: number;
}

export async function getPlanUsage(shop: ShopWithPlan, quotas?: QuotaEnforcement): Promise<PlanUsage> {
  const access = await getBillingAccess(shop);
  const plan = access.plan;
  const q = quotas ?? {
    qrCodes: await getQuotaState(shop.id, "qrCodes", plan.qrCodeLimit),
    campaigns: await getQuotaState(shop.id, "campaigns", plan.campaignLimit),
  };
  return {
    planId: plan.id,
    planName: plan.name,
    status: access.status,
    cycle: access.cycle,
    qrUsed: q.qrCodes.used,
    qrLimit: plan.qrCodeLimit,
    qrOverQuota: q.qrCodes.overQuotaIds.length,
    campaignUsed: q.campaigns.used,
    campaignLimit: plan.campaignLimit,
    campaignOverQuota: q.campaigns.overQuotaIds.length,
  };
}

/* ─────────────────────────────────────────────────────────
   Entitlements (feature flags + history window)
   ───────────────────────────────────────────────────────── */

export interface PlanEntitlements {
  plan: Plan;
  planId: string;
  planName: string;
  status: BillingAccess["status"];
  historyDays: number | null;
  earliestScanDate: Date | null;
  qrCodeLimit: number | null;
  campaignLimit: number | null;
  attribution: boolean;
  customDesign: boolean;
  detailedAnalytics: boolean;
  exports: boolean;
  prioritySupport: boolean;
}

export async function getPlanEntitlements(shop: ShopAccessInput): Promise<PlanEntitlements> {
  const access = await getBillingAccess(shop);
  const plan = access.plan;
  const earliestScanDate = plan.historyDays == null
    ? null
    : new Date(Date.now() - plan.historyDays * 86400000);

  return {
    plan,
    planId: plan.id,
    planName: plan.name,
    status: access.status,
    historyDays: plan.historyDays,
    earliestScanDate,
    qrCodeLimit: plan.qrCodeLimit,
    campaignLimit: plan.campaignLimit,
    attribution: plan.attribution,
    customDesign: plan.customDesign,
    detailedAnalytics: plan.detailedAnalytics,
    exports: plan.exports,
    prioritySupport: plan.prioritySupport,
  };
}

export function applyHistoryLimit(from: Date, earliestScanDate: Date | null): Date {
  if (!earliestScanDate) return from;
  return from > earliestScanDate ? from : earliestScanDate;
}

export class FeatureLockedError extends Error {
  constructor(
    public feature: GatedFeature,
    public requiredPlan: string,
  ) {
    super(`${FEATURE_LABEL[feature]} requires the ${requiredPlan} plan.`);
    this.name = "FeatureLockedError";
  }
}

const FEATURE_LABEL: Record<GatedFeature, string> = {
  customDesign: "QR customization (logo, colors, shapes)",
  detailedAnalytics: "Detailed analytics",
  exports: "Exports",
  attribution: "Shopify order attribution",
  prioritySupport: "Priority support",
};

/**
 * Guard a feature flag. e.g. `await requireFeature(shop, "exports", "Starter")`.
 */
export async function requireFeature(
  shop: ShopAccessInput,
  feature: GatedFeature,
  requiredPlanLabel: string,
): Promise<void> {
  const plan = await resolvePlan(shop);
  if (!plan[feature]) throw new FeatureLockedError(feature, requiredPlanLabel);
}
