/**
 * Keep the Shopify embedded-app params (`shop`, `host`) when building an
 * in-app link, so navigation inside the admin iframe stays authenticated.
 */
export function withEmbeddedParams(path: string, search: string, extra: Record<string, string> = {}): string {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams();
  const shop = current.get("shop");
  const host = current.get("host");
  if (shop) next.set("shop", shop);
  if (host) next.set("host", host);
  for (const [key, value] of Object.entries(extra)) {
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return query ? `${path}?${query}` : path;
}
