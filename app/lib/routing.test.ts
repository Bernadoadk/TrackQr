import { describe, expect, it } from "vitest";
import {
  normalizeRoutingConfig,
  parseAcceptLanguage,
  resolveRouting,
  MAX_ROUTING_RULES,
  type RoutingConfig,
  type RoutingContext,
} from "./routing";

const ctx = (over: Partial<RoutingContext> = {}): RoutingContext => ({
  device: "DESKTOP",
  os: "Windows",
  country: "FR",
  languages: ["fr", "en"],
  now: new Date("2026-09-30T10:00:00Z"), // Wednesday
  bucket: 0.5,
  ...over,
});

const rule = (conditions: unknown[], url = "https://example.com/rule", id = "r1") => ({ id, label: "", conditions, url });

describe("normalizeRoutingConfig", () => {
  it("returns an empty config for garbage", () => {
    expect(normalizeRoutingConfig(null)).toEqual({ rules: [], abTest: null });
    expect(normalizeRoutingConfig("x")).toEqual({ rules: [], abTest: null });
    expect(normalizeRoutingConfig({ rules: "nope", abTest: 3 })).toEqual({ rules: [], abTest: null });
  });

  it("drops rules without a valid URL or without valid conditions", () => {
    const config = normalizeRoutingConfig({
      rules: [
        rule([{ type: "device", devices: ["ios"] }], "javascript:alert(1)"),
        rule([{ type: "device", devices: ["toaster"] }]),
        rule([{ type: "country", countries: ["fr", "usa", 12] }], "shop.example.com/fr"),
      ],
    });
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].url).toBe("https://shop.example.com/fr");
    expect(config.rules[0].conditions).toEqual([{ type: "country", countries: ["FR"] }]);
  });

  it("normalizes languages, schedules and time zones", () => {
    const config = normalizeRoutingConfig({
      rules: [
        rule([
          { type: "language", languages: ["FR-ca", "es", "es"] },
          { type: "schedule", days: [5, 1, 1, 9], from: "09:00", to: "18:00", timezone: "Mars/Olympus" },
        ]),
      ],
    });
    expect(config.rules[0].conditions).toEqual([
      { type: "language", languages: ["fr", "es"] },
      { type: "schedule", days: [1, 5], from: "09:00", to: "18:00", timezone: "UTC" },
    ]);
  });

  it("rejects malformed schedule times", () => {
    const config = normalizeRoutingConfig({ rules: [rule([{ type: "schedule", days: [1], from: "9h", to: "25:00" }])] });
    expect(config.rules).toEqual([]);
  });

  it("caps the number of rules", () => {
    const rules = Array.from({ length: MAX_ROUTING_RULES + 5 }, (_, i) => rule([{ type: "device", devices: ["ios"] }], "https://example.com", `r${i}`));
    expect(normalizeRoutingConfig({ rules }).rules).toHaveLength(MAX_ROUTING_RULES);
  });

  it("keeps an A/B test only with a URL and a 1–99 share", () => {
    expect(normalizeRoutingConfig({ abTest: { url: "https://b.example.com", share: 30 } }).abTest).toEqual({ url: "https://b.example.com/", share: 30 });
    expect(normalizeRoutingConfig({ abTest: { url: "https://b.example.com", share: 0 } }).abTest).toBeNull();
    expect(normalizeRoutingConfig({ abTest: { url: "https://b.example.com", share: 100 } }).abTest).toBeNull();
    expect(normalizeRoutingConfig({ abTest: { url: "", share: 50 } }).abTest).toBeNull();
  });
});

describe("resolveRouting", () => {
  const config = (rules: RoutingConfig["rules"], abTest: RoutingConfig["abTest"] = null): RoutingConfig => ({ rules, abTest });

  it("matches devices", () => {
    const c = config([
      { id: "ios", label: "", conditions: [{ type: "device", devices: ["ios"] }], url: "https://apps.apple.com/x" },
      { id: "android", label: "", conditions: [{ type: "device", devices: ["android"] }], url: "https://play.google.com/x" },
      { id: "mobile", label: "", conditions: [{ type: "device", devices: ["mobile"] }], url: "https://m.example.com" },
    ]);
    expect(resolveRouting(c, ctx({ device: "MOBILE", os: "iOS" }))).toEqual({ url: "https://apps.apple.com/x", route: "rule:ios" });
    expect(resolveRouting(c, ctx({ device: "MOBILE", os: "Android" }))).toEqual({ url: "https://play.google.com/x", route: "rule:android" });
    expect(resolveRouting(c, ctx({ device: "TABLET", os: "Other" })).route).toBe("rule:mobile");
    expect(resolveRouting(c, ctx())).toEqual({ url: null, route: null });
  });

  it("requires every condition of a rule (AND) and keeps the first match", () => {
    const c = config([
      { id: "fr-mobile", label: "", conditions: [{ type: "country", countries: ["FR"] }, { type: "device", devices: ["mobile"] }], url: "https://fr-m.example.com" },
      { id: "fr", label: "", conditions: [{ type: "country", countries: ["FR"] }], url: "https://fr.example.com" },
    ]);
    expect(resolveRouting(c, ctx({ device: "MOBILE" })).route).toBe("rule:fr-mobile");
    expect(resolveRouting(c, ctx()).route).toBe("rule:fr");
    expect(resolveRouting(c, ctx({ country: null })).route).toBeNull();
  });

  it("matches the visitor's languages", () => {
    const c = config([{ id: "es", label: "", conditions: [{ type: "language", languages: ["es"] }], url: "https://es.example.com" }]);
    expect(resolveRouting(c, ctx({ languages: ["de", "es"] })).route).toBe("rule:es");
    expect(resolveRouting(c, ctx({ languages: [] })).route).toBeNull();
  });

  it("evaluates schedules in the rule's time zone", () => {
    // 10:00 UTC on Wednesday = 12:00 in Paris (CEST).
    const c = config([{ id: "lunch", label: "", conditions: [{ type: "schedule", days: [3], from: "11:30", to: "14:00", timezone: "Europe/Paris" }], url: "https://lunch.example.com" }]);
    expect(resolveRouting(c, ctx()).route).toBe("rule:lunch");
    expect(resolveRouting(c, ctx({ now: new Date("2026-09-30T13:00:00Z") })).route).toBeNull();
    expect(resolveRouting(c, ctx({ now: new Date("2026-10-01T10:00:00Z") })).route).toBeNull(); // Thursday
  });

  it("handles overnight windows (the part after midnight belongs to the previous day)", () => {
    const c = config([{ id: "night", label: "", conditions: [{ type: "schedule", days: [5], from: "22:00", to: "06:00", timezone: "UTC" }], url: "https://night.example.com" }]);
    expect(resolveRouting(c, ctx({ now: new Date("2026-10-02T23:00:00Z") })).route).toBe("rule:night"); // Friday 23:00
    expect(resolveRouting(c, ctx({ now: new Date("2026-10-03T03:00:00Z") })).route).toBe("rule:night"); // Saturday 03:00
    expect(resolveRouting(c, ctx({ now: new Date("2026-10-03T07:00:00Z") })).route).toBeNull();
    expect(resolveRouting(c, ctx({ now: new Date("2026-10-02T03:00:00Z") })).route).toBeNull(); // Friday 03:00 = Thursday night
  });

  it("splits the default destination with a sticky A/B bucket", () => {
    const c = config([], { url: "https://b.example.com", share: 30 });
    expect(resolveRouting(c, ctx({ bucket: 0.1 }))).toEqual({ url: "https://b.example.com", route: "ab:B" });
    expect(resolveRouting(c, ctx({ bucket: 0.3 }))).toEqual({ url: null, route: "ab:A" });
    expect(resolveRouting(c, ctx({ bucket: 0.9 }))).toEqual({ url: null, route: "ab:A" });
  });

  it("gives rules priority over the A/B test", () => {
    const c = config([{ id: "fr", label: "", conditions: [{ type: "country", countries: ["FR"] }], url: "https://fr.example.com" }], { url: "https://b.example.com", share: 99 });
    expect(resolveRouting(c, ctx({ bucket: 0 })).route).toBe("rule:fr");
  });
});

describe("parseAcceptLanguage", () => {
  it("orders by quality and dedupes regions", () => {
    expect(parseAcceptLanguage("fr-CA,fr;q=0.9,en-US;q=0.8,en;q=0.7")).toEqual(["fr", "en"]);
    expect(parseAcceptLanguage("de;q=0.2, es")).toEqual(["es", "de"]);
  });

  it("ignores empty and invalid values", () => {
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage("*")).toEqual([]);
    expect(parseAcceptLanguage("en;q=abc")).toEqual([]);
  });
});
