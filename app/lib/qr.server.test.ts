import { describe, expect, it } from "vitest";
import { buildRedirectTarget, cartPermalinkItems, ensureUtm, scanUrl, storePagePath, withScanAttribution } from "./qr.server";

const SHOP = "aurora.myshopify.com";
type Qr = Parameters<typeof buildRedirectTarget>[0];
const qr = (over: Partial<Qr>): Qr => ({
  type: "HOME",
  target: "",
  utmCampaign: null,
  utmSource: null,
  utmMedium: null,
  utmTerm: null,
  discountCode: null,
  ...over,
});
const redirectUrl = (q: Qr) => {
  const d = buildRedirectTarget(q, SHOP);
  if (d.kind !== "redirect") throw new Error(`expected a redirect, got ${d.kind}`);
  return d.url;
};

describe("buildRedirectTarget", () => {
  it("sends store destinations to the shop", () => {
    expect(redirectUrl(qr({ type: "HOME" }))).toBe(`https://${SHOP}/`);
    expect(redirectUrl(qr({ type: "PRODUCT", target: "/products/aurora-tee" }))).toBe(`https://${SHOP}/products/aurora-tee`);
    expect(redirectUrl(qr({ type: "COLLECTION", target: "summer" }))).toBe(`https://${SHOP}/collections/summer`);
    expect(redirectUrl(qr({ type: "PAGE", target: "pages/about" }))).toBe(`https://${SHOP}/pages/about`);
  });

  it("appends UTM parameters (term included)", () => {
    const url = new URL(redirectUrl(qr({ type: "PRODUCT", target: "tee", utmCampaign: "summer", utmSource: "flyer", utmMedium: "qr", utmTerm: "window" })));
    expect(url.pathname).toBe("/products/tee");
    expect(Object.fromEntries(url.searchParams)).toEqual({ utm_campaign: "summer", utm_source: "flyer", utm_medium: "qr", utm_term: "window" });
  });

  it("applies a discount through /discount/CODE with the landing page (and UTMs) in redirect", () => {
    const url = new URL(redirectUrl(qr({ type: "PRODUCT", target: "tee", utmCampaign: "summer", discountCode: "WELCOME 10" })));
    expect(url.pathname).toBe("/discount/WELCOME%2010");
    expect(url.searchParams.get("redirect")).toBe("/products/tee?utm_campaign=summer");
  });

  it("builds cart permalinks with quantities and a native discount param", () => {
    const url = new URL(redirectUrl(qr({ type: "ATC", target: "123:2, 456", discountCode: "SAVE" })));
    expect(url.pathname).toBe("/cart/123:2,456:1");
    expect(url.searchParams.get("discount")).toBe("SAVE");
  });

  it("keeps promo-code UTMs inside the redirect target", () => {
    const url = new URL(redirectUrl(qr({ type: "PROMO", target: " SUMMER20 ", utmCampaign: "summer" })));
    expect(url.pathname).toBe("/discount/SUMMER20");
    expect(url.searchParams.get("redirect")).toBe("/?utm_campaign=summer");
    expect(url.searchParams.get("utm_campaign")).toBeNull();
  });

  it("adds https:// to bare web addresses", () => {
    expect(redirectUrl(qr({ type: "URL", target: "example.com/menu" }))).toBe("https://example.com/menu");
  });

  it("normalizes phone / SMS / email links", () => {
    expect(redirectUrl(qr({ type: "PHONE", target: "+1 (800) 278-7622" }))).toBe("tel:+18002787622");
    expect(redirectUrl(qr({ type: "SMS", target: "+33 6 12 34 56 78" }))).toBe("sms:+33612345678");
    expect(redirectUrl(qr({ type: "EMAIL", target: " hello@aurora.co " }))).toBe("mailto:hello@aurora.co");
  });

  it("renders a landing page for non-URL payloads", () => {
    expect(buildRedirectTarget(qr({ type: "TEXT", target: "Hello" }), SHOP)).toEqual({ kind: "landing", type: "TEXT", payload: "Hello" });
    expect(buildRedirectTarget(qr({ type: "WIFI", target: "WIFI:T:WPA;S:x;P:y;;" }), SHOP).kind).toBe("landing");
  });
});

describe("cartPermalinkItems", () => {
  it("parses ids and clamps quantities", () => {
    expect(cartPermalinkItems("42")).toBe("42:1");
    expect(cartPermalinkItems("/cart/42:3,43:0,44:500")).toBe("42:3,43:1,44:99");
    expect(cartPermalinkItems("abc,12x")).toBeNull();
  });
});

describe("storePagePath", () => {
  it("accepts handles, paths and full URLs", () => {
    expect(storePagePath("pages/about")).toBe("/pages/about");
    expect(storePagePath("//pages//about")).toBe("/pages/about");
    expect(storePagePath("https://aurora.com/pages/faq?x=1")).toBe("/pages/faq?x=1");
  });
});

describe("ensureUtm", () => {
  it("leaves URLs untouched without UTM values or for non-http links", () => {
    expect(ensureUtm("https://a.com/x?y=1", {})).toBe("https://a.com/x?y=1");
    expect(ensureUtm("tel:123", { utmSource: "qr" })).toBe("tel:123");
  });

  it("overrides existing UTM values", () => {
    expect(ensureUtm("https://a.com/?utm_source=old", { utmSource: "qr" })).toBe("https://a.com/?utm_source=qr");
  });
});

describe("scanUrl", () => {
  it("uses the given base without a trailing slash", () => {
    expect(scanUrl("Ab12Cd", "https://scan.example.com/")).toBe("https://scan.example.com/s/Ab12Cd");
  });
});

describe("withScanAttribution", () => {
  it("adds cart attributes to store links", () => {
    const url = new URL(withScanAttribution(`https://${SHOP}/products/tee?utm_source=qr`, "scan1", "Ab12Cd"));
    expect(url.searchParams.get("attributes[tqr_scan]")).toBe("scan1");
    expect(url.searchParams.get("attributes[tqr_qr]")).toBe("Ab12Cd");
    expect(url.searchParams.get("utm_source")).toBe("qr");
  });

  it("puts the params inside the redirect of discount links", () => {
    const url = new URL(withScanAttribution(`https://${SHOP}/discount/SAVE?redirect=%2Fproducts%2Ftee`, "scan1", "Ab12Cd"));
    expect(url.searchParams.get("redirect")).toBe("/products/tee?tqr_scan=scan1&tqr_qr=Ab12Cd");
    expect(url.searchParams.get("attributes[tqr_scan]")).toBeNull();
  });

  it("leaves other hosts and non-web links alone when store hosts are given", () => {
    expect(withScanAttribution("https://instagram.com/aurora", "s", "q", [SHOP])).toBe("https://instagram.com/aurora");
    expect(withScanAttribution("mailto:a@b.co", "s", "q")).toBe("mailto:a@b.co");
  });
});
