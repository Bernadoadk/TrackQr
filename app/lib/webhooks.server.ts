import prisma from "../db.server";

/**
 * Webhook deduplication (Shopify retries deliveries): the first delivery of
 * a webhook id claims it; later ones are acknowledged without work.
 */
export async function claimWebhook(webhookId: string | undefined, shopDomain: string, topic: string): Promise<boolean> {
  if (!webhookId) return true;
  try {
    const shop = await prisma.shop.findUnique({ where: { domain: shopDomain }, select: { id: true } });
    await prisma.webhookEvent.create({ data: { id: webhookId, shopId: shop?.id ?? null, topic } });
    return true;
  } catch (err) {
    if (typeof err === "object" && err && "code" in err && (err as { code: string }).code === "P2002") return false;
    throw err;
  }
}

export async function markWebhookProcessed(webhookId: string | undefined, error?: unknown) {
  if (!webhookId) return;
  await prisma.webhookEvent.update({
    where: { id: webhookId },
    data: {
      processedAt: new Date(),
      error: error ? (error instanceof Error ? error.message : String(error)).slice(0, 500) : null,
    },
  }).catch(() => undefined);
}
