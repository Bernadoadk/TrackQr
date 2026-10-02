import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopByDomain } from "../lib/shop.server";
import { attributeOrder } from "../lib/attribution.server";
import { claimWebhook, markWebhookProcessed } from "../lib/webhooks.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, webhookId } = await authenticate.webhook(request);
  if (!(await claimWebhook(webhookId, shop, topic))) return new Response();
  const shopRow = await getShopByDomain(shop);
  if (!shopRow) return new Response();
  try {
    await attributeOrder(shopRow, payload as Parameters<typeof attributeOrder>[1]);
    await markWebhookProcessed(webhookId);
  } catch (err) {
    console.error(`[webhook] ${topic} attribution failed`, err);
    await markWebhookProcessed(webhookId, err);
  }
  return new Response();
};
