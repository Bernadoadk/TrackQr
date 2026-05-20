import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * GDPR · shop/redact — fires 48h after a merchant uninstalls. Purge all
 * shop-scoped data (QR codes, scans, conversions, campaigns, leads, etc).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  await prisma.shop.deleteMany({ where: { domain: shop } });
  console.log(`[gdpr] ${topic} for ${shop} — shop data purged`);
  return new Response();
};
