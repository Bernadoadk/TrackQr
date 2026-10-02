/**
 * Carry the scan id to the storefront so the resulting order can be attributed
 * (Growth plan). Cart permalinks (/cart/...) consume `attributes[...]` natively;
 * every other page relies on the "TrackQr attribution" app embed, which copies
 * the params into the cart attributes. Shopify's /discount/CODE link drops
 * unknown params, so there they travel inside its `redirect` target instead.
 * When `storeHosts` is given, only store URLs are decorated.
 *
 * Client-safe: used by the scan route and by campaign pages (store links).
 */
export function withScanAttribution(target: string, scanId: string, qrSlug: string, storeHosts?: string[]): string {
  if (!/^https?:\/\//i.test(target)) return target;
  try {
    const u = new URL(target);
    if (storeHosts?.length && !storeHosts.includes(u.hostname.toLowerCase())) return target;
    if (/^\/discount\//i.test(u.pathname)) {
      const after = new URL(u.searchParams.get("redirect") || "/", u.origin);
      after.searchParams.set("tqr_scan", scanId);
      after.searchParams.set("tqr_qr", qrSlug);
      u.searchParams.set("redirect", `${after.pathname}${after.search}`);
      return u.toString();
    }
    u.searchParams.set("attributes[tqr_scan]", scanId);
    u.searchParams.set("attributes[tqr_qr]", qrSlug);
    return u.toString();
  } catch {
    return target;
  }
}
