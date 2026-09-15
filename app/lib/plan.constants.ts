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

/** Gated features and the lowest plan that unlocks each one (for upsell copy). */
export const FEATURE_MIN_PLAN = {
  customDesign: "starter",
  detailedAnalytics: "starter",
  exports: "starter",
  attribution: "growth",
  prioritySupport: "growth",
} as const satisfies Record<string, PlanId>;

export type GatedFeature = keyof typeof FEATURE_MIN_PLAN;

export function planLabel(planId: string): string {
  return PLAN_LABELS[planId as PlanId] ?? planId;
}

export function featureMinPlanLabel(feature: GatedFeature): string {
  return PLAN_LABELS[FEATURE_MIN_PLAN[feature]];
}
