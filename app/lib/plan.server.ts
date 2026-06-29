import prisma from "../db.server";
import type { Plan, Shop, Subscription } from "@prisma/client";
import { INSTALL_TRIAL_DAYS } from "./plan.constants";

export type ShopWithPlan = Shop & {
  activeSubscription: (Subscription & { plan: Plan }) | null;
};

type ShopAccessInput = Pick<Shop, "id" | "installedAt"> & {
  activeSubscription?: (Pick<Subscription, "status" | "cycle" | "trialEndsAt"> & { plan?: Plan | null }) | null;
};

export interface BillingAccess {
  status: "active" | "trial" | "blocked";
  hasAccess: boolean;
  plan: Plan;
  cycle: "MONTHLY" | "ANNUAL" | null;
  trialEndsAt: Date | null;
  daysLeft: number;
}

export function installationTrialEndsAt(shop: Pick<Shop, "installedAt">): Date {
  return new Date(shop.installedAt.getTime() + INSTALL_TRIAL_DAYS * 86400000);
}

export function isInstallationTrialActive(shop: Pick<Shop, "installedAt">, now = new Date()): boolean {
  return installationTrialEndsAt(shop).getTime() > now.getTime();
}

export async function getBillingAccess(shop: ShopAccessInput): Promise<BillingAccess> {
  if (shop.activeSubscription?.status === "ACTIVE" && shop.activeSubscription.plan) {
    return {
      status: "active",
      hasAccess: true,
      plan: shop.activeSubscription.plan,
      cycle: shop.activeSubscription.cycle,
      trialEndsAt: shop.activeSubscription.trialEndsAt,
      daysLeft: 0,
    };
  }

  const trialEndsAt = installationTrialEndsAt(shop);
  const now = new Date();
  if (trialEndsAt.getTime() > now.getTime()) {
    const pro = await prisma.plan.findUnique({ where: { id: "pro" } });
    if (!pro) throw new Error("Pro plan missing — run migrations + seed");
    return {
      status: "trial",
      hasAccess: true,
      plan: pro,
      cycle: null,
      trialEndsAt,
      daysLeft: Math.max(1, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86400000)),
    };
  }

  const starter = await prisma.plan.findUnique({ where: { id: "starter" } });
  if (!starter) throw new Error("Starter plan missing — run migrations + seed");
  return {
    status: "blocked",
    hasAccess: false,
    plan: starter,
    cycle: null,
    trialEndsAt,
    daysLeft: 0,
  };
}

export async function pauseShopPublicSurfaces(shopId: string): Promise<void> {
  await prisma.$transaction([
    prisma.qrCode.updateMany({
      where: { shopId, archivedAt: null, active: true },
      data: { active: false },
    }),
    prisma.campaign.updateMany({
      where: { shopId, status: "ACTIVE" },
      data: { status: "PAUSED" },
    }),
  ]);
}

export async function isShopAccessActive(shop: ShopAccessInput): Promise<boolean> {
  return (await getBillingAccess(shop)).hasAccess;
}

/**
 * Resolve the effective plan for a shop.
 * Active subscription wins. During the installation trial, the shop gets Pro.
 * After trial expiry without an active subscription, Starter is returned for
 * display only; app access is blocked by getBillingAccess.
 */
export async function resolvePlan(shop: ShopWithPlan): Promise<Plan> {
  return (await getBillingAccess(shop)).plan;
}

/** Snapshot used by the sidebar widget (also returned by app loader). */
export interface PlanUsage {
  planId: string;
  planName: string;
  status: string;
  trial: boolean;
  blocked: boolean;
  cycle: "MONTHLY" | "ANNUAL" | null;
  trialEndsAt: Date | null;
  trialDaysLeft: number;
  qrUsed: number;
  qrLimit: number | null;
  campaignUsed: number;
  campaignLimit: number | null;
}

export async function getPlanUsage(shop: ShopWithPlan): Promise<PlanUsage> {
  const access = await getBillingAccess(shop);
  const plan = access.plan;
  const [qrUsed, campaignUsed] = await Promise.all([
    prisma.qrCode.count({ where: { shopId: shop.id, archivedAt: null } }),
    prisma.campaign.count({ where: { shopId: shop.id } }),
  ]);
  return {
    planId: plan.id,
    planName: plan.name,
    status: access.status,
    trial: access.status === "trial",
    blocked: access.status === "blocked",
    cycle: access.cycle,
    trialEndsAt: access.trialEndsAt,
    trialDaysLeft: access.daysLeft,
    qrUsed,
    qrLimit: plan.qrCodeLimit,
    campaignUsed,
    campaignLimit: plan.campaignLimit,
  };
}

export interface PlanEntitlements {
  plan: Plan;
  historyDays: number | null;
  earliestScanDate: Date | null;
  attribution: boolean;
}

export async function getPlanEntitlements(shop: ShopWithPlan): Promise<PlanEntitlements> {
  const plan = await resolvePlan(shop);
  const earliestScanDate = plan.historyDays == null
    ? null
    : new Date(Date.now() - plan.historyDays * 86400000);

  return {
    plan,
    historyDays: plan.historyDays,
    earliestScanDate,
    attribution: plan.attribution,
  };
}

export function applyHistoryLimit(from: Date, earliestScanDate: Date | null): Date {
  if (!earliestScanDate) return from;
  return from > earliestScanDate ? from : earliestScanDate;
}

export class QuotaExceededError extends Error {
  constructor(
    public resource: "qrCodes" | "campaigns",
    public limit: number,
    public planId: string,
  ) {
    super(`Plan ${planId} allows ${limit} ${resource}.`);
    this.name = "QuotaExceededError";
  }
}

export async function assertQuota(
  shop: ShopWithPlan,
  resource: "qrCodes" | "campaigns",
): Promise<void> {
  const plan = await resolvePlan(shop);
  const limit = resource === "qrCodes" ? plan.qrCodeLimit : plan.campaignLimit;
  if (limit == null) return; // unlimited

  const used = resource === "qrCodes"
    ? await prisma.qrCode.count({ where: { shopId: shop.id, archivedAt: null } })
    : await prisma.campaign.count({ where: { shopId: shop.id } });

  if (used >= limit) {
    throw new QuotaExceededError(resource, limit, plan.id);
  }
}

export class FeatureLockedError extends Error {
  constructor(
    public feature: keyof Plan,
    public requiredPlan: string,
  ) {
    super(`Feature ${String(feature)} requires plan ${requiredPlan}`);
    this.name = "FeatureLockedError";
  }
}

/**
 * Guard a feature flag. e.g. `await requireFeature(shop, 'integrations', 'growth')`.
 */
export async function requireFeature(
  shop: ShopWithPlan,
  feature: "attribution" | "integrations" | "multiStore" | "api" | "customDomain",
  fallbackPlan: string,
): Promise<void> {
  const plan = await resolvePlan(shop);
  if (!plan[feature]) throw new FeatureLockedError(feature, fallbackPlan);
}
