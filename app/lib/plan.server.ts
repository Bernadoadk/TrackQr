import prisma from "../db.server";
import type { Plan, Shop, Subscription } from "@prisma/client";

export type ShopWithPlan = Shop & {
  activeSubscription: (Subscription & { plan: Plan }) | null;
};

/**
 * Resolve the effective plan for a shop.
 * Falls back to Starter (in trial) when no active subscription exists.
 */
export async function resolvePlan(shop: ShopWithPlan): Promise<Plan> {
  if (shop.activeSubscription?.status === "ACTIVE") {
    return shop.activeSubscription.plan;
  }
  const starter = await prisma.plan.findUnique({ where: { id: "starter" } });
  if (!starter) throw new Error("Starter plan missing — run migrations + seed");
  return starter;
}

/** Snapshot used by the sidebar widget (also returned by app loader). */
export interface PlanUsage {
  planId: string;
  planName: string;
  status: string;
  trial: boolean;
  qrUsed: number;
  qrLimit: number | null;
  campaignUsed: number;
  campaignLimit: number | null;
}

export async function getPlanUsage(shop: ShopWithPlan): Promise<PlanUsage> {
  const plan = await resolvePlan(shop);
  const [qrUsed, campaignUsed] = await Promise.all([
    prisma.qrCode.count({ where: { shopId: shop.id, archivedAt: null } }),
    prisma.campaign.count({ where: { shopId: shop.id } }),
  ]);
  const status = shop.activeSubscription?.status ?? "TRIAL";
  const trial = !shop.activeSubscription;
  return {
    planId: plan.id,
    planName: plan.name,
    status,
    trial,
    qrUsed,
    qrLimit: plan.qrCodeLimit,
    campaignUsed,
    campaignLimit: plan.campaignLimit,
  };
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
