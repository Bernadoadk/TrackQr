import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopByDomain } from "../lib/shop.server";

interface RedactPayload {
  customer?: { email?: string };
}

/**
 * GDPR · customers/redact — purge any TrackQr data tied to this customer.
 * We only store leads keyed by email. Scans are anonymous (no PII).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const email = (payload as RedactPayload).customer?.email?.toLowerCase();
  if (email) {
    const shopRow = await getShopByDomain(shop);
    if (shopRow) {
      await prisma.lead.deleteMany({
        where: {
          email: { equals: email, mode: "insensitive" },
          campaign: { shopId: shopRow.id },
        },
      });
    }
  }
  console.log(`[gdpr] ${topic} for ${shop} — email purged`);
  return new Response();
};
