import { unauthenticated } from "../shopify.server";

/**
 * Shopify Flow triggers (Growth). Each handle matches an extension under
 * /extensions (flow_trigger). Payload keys must match the extension fields
 * exactly; reference fields use the numeric id (e.g. `order_id`).
 *
 * Fire-and-forget: a Flow error never blocks a scan, a lead or a webhook.
 */
export const FLOW_TRIGGERS = {
  leadCaptured: "trackqr-lead-captured",
  orderAttributed: "trackqr-order-attributed",
} as const;

type FlowPayload = Record<string, string | number | boolean>;

const MUTATION = `#graphql
  mutation TrackQrFlowTrigger($handle: String!, $payload: JSON!) {
    flowTriggerReceive(handle: $handle, payload: $payload) {
      userErrors { field message }
    }
  }
`;

export async function sendFlowTrigger(shopDomain: string, handle: string, payload: FlowPayload): Promise<void> {
  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    const response = await admin.graphql(MUTATION, { variables: { handle, payload } });
    const json = (await response.json()) as {
      data?: { flowTriggerReceive?: { userErrors: { message: string }[] } };
    };
    const errors = json.data?.flowTriggerReceive?.userErrors ?? [];
    // "No workflows" style errors are expected when the merchant has not
    // built a workflow with this trigger yet — log quietly.
    if (errors.length) console.info(`[flow] ${handle}: ${errors.map(e => e.message).join("; ")}`);
  } catch (err) {
    console.warn(`[flow] ${handle} failed for ${shopDomain}`, err instanceof Error ? err.message : err);
  }
}

/** Numeric id out of a Shopify GID ("gid://shopify/Order/123" → 123). */
export function legacyId(gidOrId: string | number | null | undefined): number | null {
  if (gidOrId == null) return null;
  const raw = String(gidOrId).split("/").pop() ?? "";
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
