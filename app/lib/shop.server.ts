import type { Session } from "@shopify/shopify-app-react-router/server";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";

const shopInclude = {
  activeSubscription: { include: { plan: true } },
} as const;

/**
 * Ensure a Shop row exists for the authenticated session.
 * Called once per admin request via `requireShop(args)` — cheap upsert.
 */
export async function getOrCreateShop(session: Session) {
  const domain = session.shop;
  const email = (session as { email?: string }).email ?? null;
  const data = {
    uninstalledAt: null,
    ...(email ? { email } : {}),
  };

  try {
    return await prisma.shop.upsert({
      where: { domain },
      update: data,
      create: {
        domain,
        name: domain.replace(".myshopify.com", ""),
        email,
      },
      include: shopInclude,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes("domain")
    ) {
      return prisma.shop.update({
        where: { domain },
        data,
        include: shopInclude,
      });
    }
    throw error;
  }
}

/** Lookup by domain only (read-only, used by webhooks). */
export async function getShopByDomain(domain: string) {
  return prisma.shop.findUnique({
    where: { domain },
    include: shopInclude,
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
