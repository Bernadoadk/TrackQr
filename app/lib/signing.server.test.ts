import { afterEach, describe, expect, it, vi } from "vitest";
import { campaignPreviewPath, createSignedToken, verifyCampaignPreviewToken, verifySignedToken } from "./signing.server";

afterEach(() => {
  vi.useRealTimers();
});

describe("signed tokens", () => {
  it("verifies a fresh token for the same payload only", () => {
    const token = createSignedToken("campaign-preview:c1", 60);
    expect(verifySignedToken("campaign-preview:c1", token)).toBe(true);
    expect(verifySignedToken("campaign-preview:c2", token)).toBe(false);
  });

  it("rejects missing, malformed and tampered tokens", () => {
    const token = createSignedToken("p", 60);
    const [exp, sig] = token.split(".");
    expect(verifySignedToken("p", null)).toBe(false);
    expect(verifySignedToken("p", "garbage")).toBe(false);
    expect(verifySignedToken("p", `${Number(exp) + 3600}.${sig}`)).toBe(false);
    expect(verifySignedToken("p", `${exp}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`)).toBe(false);
  });

  it("expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
    const token = createSignedToken("p", 60);
    vi.setSystemTime(new Date("2026-09-30T10:00:59Z"));
    expect(verifySignedToken("p", token)).toBe(true);
    vi.setSystemTime(new Date("2026-09-30T10:02:00Z"));
    expect(verifySignedToken("p", token)).toBe(false);
  });

  it("builds campaign preview links that verify", () => {
    const path = campaignPreviewPath("camp_1");
    const token = new URL(path, "https://app.example.com").searchParams.get("token");
    expect(path.startsWith("/campaigns/camp_1/preview?token=")).toBe(true);
    expect(verifyCampaignPreviewToken("camp_1", token)).toBe(true);
    expect(verifyCampaignPreviewToken("camp_2", token)).toBe(false);
  });
});
