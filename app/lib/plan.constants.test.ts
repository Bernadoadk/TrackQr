import { describe, expect, it } from "vitest";
import { FEATURE_MIN_PLAN, featureMinPlanLabel, isPlanColumnFeature, planIncludes, planRank, type GatedFeature } from "./plan.constants";

describe("plan ladder", () => {
  it("ranks plans and treats unknown plans as locked", () => {
    expect(planRank("free")).toBe(0);
    expect(planRank("growth")).toBe(2);
    expect(planRank("enterprise")).toBe(-1);
    expect(planIncludes("enterprise", "bulkCreate")).toBe(false);
  });

  it("unlocks each feature from its minimum plan upwards", () => {
    for (const feature of Object.keys(FEATURE_MIN_PLAN) as GatedFeature[]) {
      const min = planRank(FEATURE_MIN_PLAN[feature]);
      expect(planIncludes("free", feature)).toBe(min <= 0);
      expect(planIncludes("starter", feature)).toBe(min <= 1);
      expect(planIncludes("growth", feature)).toBe(true);
    }
  });

  it("matches the published pricing grid", () => {
    expect(planIncludes("starter", "bulkCreate")).toBe(true);
    expect(planIncludes("starter", "smartRouting")).toBe(false);
    expect(planIncludes("growth", "smartRouting")).toBe(true);
    expect(featureMinPlanLabel("leadRewards")).toBe("Growth");
    expect(isPlanColumnFeature("attribution")).toBe(true);
    expect(isPlanColumnFeature("automations")).toBe(false);
  });
});
