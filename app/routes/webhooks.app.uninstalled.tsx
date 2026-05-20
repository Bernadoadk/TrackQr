import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Delete Shopify sessions for this shop.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Soft-mark the Shop row as uninstalled (we keep data for 48h in case of
  // re-install; shop/redact will hard-delete it after Shopify's grace period).
  await db.shop.updateMany({
    where: { domain: shop },
    data: { uninstalledAt: new Date() },
  });

  return new Response();
};
