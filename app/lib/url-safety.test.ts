import { describe, expect, it } from "vitest";
import { normalizeWebUrl, safeCssUrl, safeHexColor, safeImageUrl, safeLinkUrl, safeMediaUrl } from "./url-safety";

describe("safeLinkUrl", () => {
  it("keeps web, mail, phone and same-site links", () => {
    expect(safeLinkUrl("https://shop.com/a")).toBe("https://shop.com/a");
    expect(safeLinkUrl(" /products/tee ")).toBe("/products/tee");
    expect(safeLinkUrl("mailto:hi@shop.com")).toBe("mailto:hi@shop.com");
    expect(safeLinkUrl("tel:+33612345678")).toBe("tel:+33612345678");
  });

  it("drops script, data and protocol-relative links", () => {
    expect(safeLinkUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeLinkUrl(" JaVaScRiPt:alert(1)")).toBeUndefined();
    expect(safeLinkUrl("data:text/html,<script>")).toBeUndefined();
    expect(safeLinkUrl("//evil.com")).toBeUndefined();
    expect(safeLinkUrl("https://")).toBeUndefined();
    expect(safeLinkUrl(42)).toBeUndefined();
  });
});

describe("media and image URLs", () => {
  it("accept absolute http(s) only", () => {
    expect(safeMediaUrl("https://cdn.shopify.com/a.png")).toBe("https://cdn.shopify.com/a.png");
    expect(safeMediaUrl("/a.png")).toBeUndefined();
    expect(safeMediaUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("allow inline image data URLs for logos", () => {
    expect(safeImageUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(safeImageUrl("data:text/html;base64,AAAA")).toBeUndefined();
  });

  it("escape characters that would break out of CSS url()", () => {
    expect(safeCssUrl("https://a.com/x\"),url(evil).png")).toBe("https://a.com/x%22%29,url%28evil%29.png");
  });
});

describe("safeHexColor", () => {
  it("accepts 6-digit hex colors only", () => {
    expect(safeHexColor("#A1b2C3", "#000000")).toBe("#A1b2C3");
    expect(safeHexColor("red;background:url(x)", "#000000")).toBe("#000000");
    expect(safeHexColor("#fff", "#000000")).toBe("#000000");
  });
});

describe("normalizeWebUrl", () => {
  it("adds https:// to bare hosts and rejects non-web values", () => {
    expect(normalizeWebUrl("shop.example.com/a")).toBe("https://shop.example.com/a");
    expect(normalizeWebUrl("http://x.co")).toBe("http://x.co/");
    expect(normalizeWebUrl("localhost")).toBeNull();
    expect(normalizeWebUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeWebUrl("")).toBeNull();
  });
});
