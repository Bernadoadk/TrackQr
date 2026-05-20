import prisma from "../db.server";

interface NoteAttribute { name: string; value: string }

interface OrderWebhookPayload {
  id: number;
  admin_graphql_api_id?: string;
  name?: string;
  total_price?: string;
  total_price_set?: { shop_money?: { amount?: string; currency_code?: string } };
  currency?: string;
  presentment_currency?: string;
  note_attributes?: NoteAttribute[];
  client_details?: { user_agent?: string; browser_ip?: string };
}

/**
 * Try to attribute a Shopify order to a previously recorded scan.
 * Strategy:
 *  1) Look at note_attributes — when the redirect set cart attributes
 *     `tqr_scan` and `tqr_qr`, the order inherits them.
 *  2) Fallback: match by session token in the cart's note_attributes
 *     (a separate `tqr_sid` attribute, optional).
 */
export async function attributeOrder(shopId: string, payload: OrderWebhookPayload): Promise<void> {
  const attrs = new Map<string, string>(
    (payload.note_attributes ?? []).map(a => [a.name, a.value])
  );

  const scanId = attrs.get("tqr_scan");
  const sid    = attrs.get("tqr_sid");
  const qrSlug = attrs.get("tqr_qr");
  if (!scanId && !sid && !qrSlug) return;

  // Resolve the scan row.
  let scan = scanId ? await prisma.scan.findUnique({ where: { id: scanId } }) : null;
  if (!scan && sid) {
    scan = await prisma.scan.findFirst({
      where: {
        sessionToken: sid,
        qrCode: { shopId },
      },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!scan && qrSlug) {
    const qr = await prisma.qrCode.findUnique({ where: { slug: qrSlug } });
    if (qr) {
      scan = await prisma.scan.findFirst({
        where: { qrCodeId: qr.id },
        orderBy: { createdAt: "desc" },
      });
    }
  }
  if (!scan) return;

  // Sanity-check shop ownership.
  const qr = await prisma.qrCode.findUnique({ where: { id: scan.qrCodeId } });
  if (!qr || qr.shopId !== shopId) return;

  // Already attributed? Upsert.
  const orderGid = payload.admin_graphql_api_id ?? `gid://shopify/Order/${payload.id}`;
  const amountStr = payload.total_price_set?.shop_money?.amount ?? payload.total_price ?? "0";
  const cents = Math.round(parseFloat(amountStr) * 100);
  const currency = payload.total_price_set?.shop_money?.currency_code ?? payload.currency ?? payload.presentment_currency ?? null;

  await prisma.conversion.upsert({
    where: { shopifyOrderId: orderGid },
    create: {
      scanId: scan.id,
      shopifyOrderId: orderGid,
      orderName: payload.name ?? null,
      amount: Number.isFinite(cents) ? cents : null,
      currency,
    },
    update: {
      orderName: payload.name ?? null,
      amount: Number.isFinite(cents) ? cents : null,
      currency,
    },
  });
}
