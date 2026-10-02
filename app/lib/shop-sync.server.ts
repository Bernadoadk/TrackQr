import prisma from "../db.server";
import { syncShopifySubscriptions } from "./billing.server";
import { readShopSettings, updateShopSettings } from "./shop-settings.server";

interface AdminGraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: <T>() => Promise<T> }>;
}

/** How long a successful sync stays fresh before the next admin page load re-syncs. */
const SYNC_TTL_MS = 5 * 60_000;

interface ShopProfilePayload {
  data?: {
    shop?: {
      name?: string | null;
      email?: string | null;
      currencyCode?: string | null;
      ianaTimezone?: string | null;
      primaryDomain?: { host?: string | null } | null;
    } | null;
  };
}

/**
 * Refresh what TrackQr mirrors from Shopify: the app subscription (Shopify is
 * the source of truth for the plan) and the store profile (name, contact
 * email, currency, timezone, primary domain). Throttled to one sync every
 * five minutes per store unless `force` (e.g. right after a billing change).
 */
export async function syncShopFromShopify(opts: {
  admin: AdminGraphqlClient;
  shop: { id: string; settings: unknown };
  force?: boolean;
}): Promise<void> {
  const settings = readShopSettings(opts.shop);
  const last = settings.lastShopifySyncAt ? Date.parse(settings.lastShopifySyncAt) : 0;
  if (!opts.force && Number.isFinite(last) && Date.now() - last < SYNC_TTL_MS) return;

  await syncShopifySubscriptions({ admin: opts.admin, shopId: opts.shop.id });

  try {
    const response = await opts.admin.graphql(`#graphql
      query TrackQrShopProfile {
        shop {
          name
          email
          currencyCode
          ianaTimezone
          primaryDomain { host }
        }
      }
    `);
    const json = await response.json<ShopProfilePayload>();
    const profile = json.data?.shop;
    if (profile) {
      await prisma.shop.update({
        where: { id: opts.shop.id },
        data: {
          ...(profile.name ? { name: profile.name } : {}),
          ...(profile.email ? { email: profile.email } : {}),
          ...(profile.currencyCode ? { currency: profile.currencyCode } : {}),
          ...(profile.ianaTimezone ? { ianaTimezone: profile.ianaTimezone } : {}),
        },
      });
    }
    await updateShopSettings(opts.shop.id, {
      primaryDomain: profile?.primaryDomain?.host ?? settings.primaryDomain,
      lastShopifySyncAt: new Date().toISOString(),
    });
  } catch (err) {
    // The profile is a nice-to-have; billing already synced above.
    console.warn("[shop-sync] profile refresh skipped", err instanceof Error ? err.message : err);
    await updateShopSettings(opts.shop.id, { lastShopifySyncAt: new Date().toISOString() });
  }
}
