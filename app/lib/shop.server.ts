import type { Session } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

/**
 * Ensure a Shop row exists for the authenticated session.
 * Called once per admin request via `requireShop(args)` — cheap upsert.
 */
export async function getOrCreateShop(session: Session) {
  const domain = session.shop;
  return prisma.shop.upsert({
    where: { domain },
    update: {
      uninstalledAt: null, // re-install resets uninstalled flag
    },
    create: {
      domain,
      name: domain.replace(".myshopify.com", ""),
      email: (session as { email?: string }).email ?? null,
    },
    include: {
      activeSubscription: { include: { plan: true } },
    },
  });
}

/** Lookup by domain only (read-only, used by webhooks). */
export async function getShopByDomain(domain: string) {
  return prisma.shop.findUnique({
    where: { domain },
    include: { activeSubscription: { include: { plan: true } } },
  });
}

/**
 * Higher-level helper for admin routes. Validates the Shopify session,
 * upserts the Shop, and returns both the Shop row and the Shopify
 * `admin` GraphQL client.
 */
import { authenticate } from "../shopify.server";

export async function requireShop(request: Request) {
  const { admin, billing, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session);
  return { admin, billing, session, shop };
}
