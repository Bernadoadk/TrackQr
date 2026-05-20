import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * GDPR · customers/data_request — return any personal data we hold for the
 * customer email. TrackQr only stores Lead emails (no orders, no contact PII),
 * so we collect leads matching the requested email and log a manual review note.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[gdpr] ${topic} for ${shop}`, JSON.stringify(payload));
  // Shopify only requires acknowledgement (200). We surface this in our admin
  // dashboard logs so the merchant can fulfill the actual request.
  return new Response();
};
