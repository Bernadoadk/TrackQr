/** Plan constants — safe to import from client code (no Prisma, no server deps). */

/** Plan the store is on whenever there is no active Shopify subscription (no trial). */
export const FREE_PLAN_ID = "free";

export const PLAN_ORDER = ["free", "starter", "growth"] as const;
export type PlanId = (typeof PLAN_ORDER)[number];

export const PLAN_LABELS: Record<PlanId, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
};

/**
 * Gated features and the lowest plan that unlocks each one.
 *
 * The first five are also boolean columns of the Plan table (seeded by the
 * pricing migrations) and are read from there. The others are resolved from
 * this map by plan rank, so moving one to another plan is a one-line change.
 */
export const FEATURE_MIN_PLAN = {
  customDesign: "starter",
  detailedAnalytics: "starter",
  exports: "starter",
  attribution: "growth",
  prioritySupport: "growth",
  // Create one QR code per product / variant / collection, CSV import.
  bulkCreate: "starter",
  // Custom fallback URL + "after expiry, send scans to…".
  customFallback: "starter",
  // Per-order QR codes for packing slips and order emails (?ref=order).
  orderTracking: "starter",
  // Device / country / language / time rules and A/B split.
  smartRouting: "growth",
  // Campaign leads created as Shopify customers (optional write_customers scope).
  customerSync: "growth",
  // Unique discount code handed out by a capture block.
  leadRewards: "growth",
  // Shopify Flow triggers (lead captured, order attributed).
  automations: "growth",
  // GA4 / Meta Pixel on campaign pages.
  campaignPixels: "growth",
} as const satisfies Record<string, PlanId>;

export type GatedFeature = keyof typeof FEATURE_MIN_PLAN;

/** Features stored as boolean columns on the Plan table. */
export const PLAN_COLUMN_FEATURES = [
  "customDesign",
  "detailedAnalytics",
  "exports",
  "attribution",
  "prioritySupport",
] as const satisfies readonly GatedFeature[];

export type PlanColumnFeature = (typeof PLAN_COLUMN_FEATURES)[number];

export function isPlanColumnFeature(feature: GatedFeature): feature is PlanColumnFeature {
  return (PLAN_COLUMN_FEATURES as readonly string[]).includes(feature);
}

/** Position of a plan in the ladder (-1 for an unknown / retired plan). */
export function planRank(planId: string): number {
  return (PLAN_ORDER as readonly string[]).indexOf(planId);
}

/** Rank-based check — used for the features that are not Plan columns. */
export function planIncludes(planId: string, feature: GatedFeature): boolean {
  const rank = planRank(planId);
  return rank >= 0 && rank >= planRank(FEATURE_MIN_PLAN[feature]);
}

export function planLabel(planId: string): string {
  return PLAN_LABELS[planId as PlanId] ?? planId;
}

export function featureMinPlanLabel(feature: GatedFeature): string {
  return PLAN_LABELS[FEATURE_MIN_PLAN[feature]];
}
