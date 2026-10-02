/**
 * URL / color sanitizers for merchant-authored content rendered on public
 * pages (campaign landing pages, scan landing pages, QR SVGs).
 *
 * Client-safe: used by the campaign editor preview and the SSR public page,
 * so both sides drop the same values.
 */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/** Return the color when it is a 6-digit hex value, else the fallback. */
export function safeHexColor(value: unknown, fallback: string): string {
  return isHexColor(value) ? value : fallback;
}

/**
 * Links a visitor can follow: absolute http(s), mailto:, tel:, sms:, or a
 * same-site path ("/products/…"). Anything else (javascript:, data:, a
 * protocol-relative "//evil.com") is dropped.
 */
export function safeLinkUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const href = value.trim();
  if (!href || href === "https://" || href === "http://") return undefined;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (/^(mailto|tel|sms):/i.test(href)) return href;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Media sources (images, video files, embeds): absolute http(s) only. */
export function safeMediaUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const src = value.trim();
  if (!src) return undefined;
  try {
    const url = new URL(src);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Image sources that may also be inline data URLs (logo previews). */
export function safeImageUrl(value: unknown): string | undefined {
  if (typeof value === "string" && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(value.trim())) {
    return value.trim();
  }
  return safeMediaUrl(value);
}

/** A value that can sit inside CSS `url("…")` without breaking out of it. */
export function safeCssUrl(value: unknown): string | undefined {
  const url = safeMediaUrl(value);
  if (!url) return undefined;
  const escapes: Record<string, string> = { '"': "%22", "'": "%27", "(": "%28", ")": "%29", "\\": "%5C" };
  return url.replace(/["'()\\]/g, c => escapes[c]).replace(/\s/g, "%20");
}

/**
 * Normalize a merchant-entered web address: adds https:// when only a host
 * was typed, and returns null for anything that is not an http(s) URL.
 */
export function normalizeWebUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}
