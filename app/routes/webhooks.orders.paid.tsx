import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopByDomain } from "../lib/shop.server";
import { attributeOrder } from "../lib/attribution.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const shopRow = await getShopByDomain(shop);
  if (!shopRow) return new Response();
  try {
    await attributeOrder(shopRow, payload as Parameters<typeof attributeOrder>[1]);
  } catch (err) {
    console.error(`[webhook] ${topic} attribution failed`, err);
  }
  return new Response();
};
