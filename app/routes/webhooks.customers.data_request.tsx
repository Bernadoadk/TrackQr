import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopByDomain } from "../lib/shop.server";
import { isSmtpConfigured, sendSmtpMail } from "../lib/smtp.server";

interface DataRequestPayload {
  customer?: { email?: string };
  data_request?: { id?: number };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/**
 * GDPR · customers/data_request — the only personal data TrackQr keeps about
 * a customer is the campaign leads submitted with their email (scans are
 * anonymous: hashed IP, no identity). The matching records are emailed to the
 * store owner so they can answer the customer; support gets a copy.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const body = payload as DataRequestPayload;
  const email = body.customer?.email?.trim().toLowerCase();
  const shopRow = await getShopByDomain(shop);

  const leads = email && shopRow
    ? await prisma.lead.findMany({
        where: { email: { equals: email, mode: "insensitive" }, campaign: { shopId: shopRow.id } },
        orderBy: { createdAt: "asc" },
        select: { email: true, fields: true, consent: true, rewardCode: true, createdAt: true, campaign: { select: { name: true } } },
      })
    : [];
  // Never log the customer's personal data — counts only.
  console.log(`[gdpr] ${topic} for ${shop}: ${leads.length} lead record(s)`);

  if (email && shopRow && isSmtpConfigured()) {
    const rows = leads.map(l => {
      const fields = Object.entries((l.fields as Record<string, unknown>) ?? {})
        .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`)
        .join("<br>");
      return `<tr><td>${escapeHtml(l.createdAt.toISOString())}</td><td>${escapeHtml(l.campaign.name)}</td><td>${l.consent ? "Yes" : "No"}</td><td>${escapeHtml(l.rewardCode ?? "")}</td><td>${fields}</td></tr>`;
    }).join("");
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.5">
        <h2 style="margin:0 0 12px">Customer data request</h2>
        <p>Shopify forwarded a data request (${escapeHtml(String(body.data_request?.id ?? ""))}) for <b>${escapeHtml(email)}</b> on ${escapeHtml(shop)}.</p>
        <p>TrackQr stores ${leads.length ? `${leads.length} campaign sign-up record(s)` : "no personal data"} for this customer. Scans are anonymous and are not linked to customers.</p>
        ${leads.length ? `<table cellpadding="6" style="border-collapse:collapse" border="1"><tr><th>Date</th><th>Campaign</th><th>Marketing consent</th><th>Reward code</th><th>Form fields</th></tr>${rows}</table>` : ""}
        <p style="color:#6B7280;font-size:12px">Forward this information to the customer to complete the request.</p>
      </div>`;
    const recipients = [shopRow.email, process.env.SUPPORT_EMAIL].filter((r): r is string => !!r && r.includes("@"));
    for (const to of new Set(recipients)) {
      await sendSmtpMail({ to, subject: `Customer data request — ${shop}`, text: `Data request for ${email}: ${leads.length} lead record(s).`, html })
        .catch(err => console.error("[gdpr] data request email failed", err instanceof Error ? err.message : err));
    }
  }
  return new Response();
};
