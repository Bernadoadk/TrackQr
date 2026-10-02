import prisma from "../db.server";
import { entitlementsForPlan, getBillingAccess } from "./plan.server";
import { getKpis, getMissedScanSummary, getTopQrCodes } from "./analytics.server";
import { readShopSettings, updateShopSettings } from "./shop-settings.server";
import { isSmtpConfigured, sendSmtpMail } from "./smtp.server";
import { formatNumber, intlLocale, t, tp } from "./i18n";
import { runWithLocale } from "./i18n.server";

/**
 * Weekly summary email (every plan, on by default — Settings → Weekly
 * report). Run by the Vercel cron /api/cron/weekly-report once a day: each
 * store gets a report when its last one is 6.5+ days old, so a store keeps
 * its weekday and a run cut short by the time budget resumes the next day.
 * Weeks without any activity are skipped.
 */

const REPORT_INTERVAL_MS = 6.5 * 86400000;
const TIME_BUDGET_MS = 45_000;

function money(cents: number, currency: string | null) {
  try {
    return new Intl.NumberFormat(intlLocale(), { style: "currency", currency: currency || "USD" }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
  }
}

function esc(value: string) {
  return value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function adminUrl(shopDomain: string, path: string) {
  const apiKey = process.env.SHOPIFY_API_KEY;
  return apiKey ? `https://${shopDomain}/admin/apps/${apiKey}${path}` : `https://${shopDomain}/admin/apps`;
}

export interface WeeklyReportRun { sent: number; skipped: number; failed: number; pending: number }

type ShopRow = { domain: string; name: string | null; currency: string | null };

function weeklyEmail(input: {
  shop: ShopRow;
  kpis: { totalScans: number; uniqueVisitors: number; totalConversions: number; revenue: number };
  top: { name: string; scans: number }[];
  missed: { total: number; overQuota: number };
  leads: number;
  attribution: boolean;
}): { subject: string; text: string; html: string } {
  const { shop, kpis, top, missed, leads, attribution } = input;
  const shopName = shop.name ?? shop.domain;
  const rows: [string, string][] = [
    [t("Scans"), formatNumber(kpis.totalScans)],
    [t("Unique visitors"), formatNumber(kpis.uniqueVisitors)],
    [t("Campaign leads"), formatNumber(leads)],
  ];
  if (attribution) {
    rows.push([t("Orders attributed"), formatNumber(kpis.totalConversions)]);
    rows.push([t("Revenue attributed"), money(kpis.revenue, shop.currency)]);
  }
  const topRows = top.filter(q => q.scans > 0)
    .map(q => `<tr><td style="padding:6px 0">${esc(q.name)}</td><td style="padding:6px 0;text-align:right">${esc(tp(q.scans, "{count} scan", "{count} scans"))}</td></tr>`)
    .join("");
  const lostLine = missed.total
    ? `<p style="margin:16px 0 0;padding:12px 14px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px">
         <b>${esc(tp(missed.total, "{count} scan", "{count} scans"))}</b> ${esc(tp(missed.total, "reached a paused, scheduled or expired QR code and went to your fallback page", "reached paused, scheduled or expired QR codes and went to your fallback page"))}.
         ${missed.overQuota ? `${esc(t("{count} of them hit codes paused by your plan limit.", { count: missed.overQuota }))} <a href="${adminUrl(shop.domain, "/app/pricing")}">${esc(t("Upgrade to reactivate them"))}</a>` : ""}
       </p>`
    : "";
  const teaser = !attribution
    ? `<p style="margin:16px 0 0;color:#6B7280">${esc(t("Want to know which QR codes drive sales? Shopify order attribution is included in the Growth plan."))}</p>`
    : "";
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.5;max-width:560px">
      <h2 style="margin:0 0 4px">${esc(t("Your TrackQr week"))}</h2>
      <p style="margin:0 0 16px;color:#6B7280">${esc(t("{shop} · last 7 days", { shop: shopName }))}</p>
      <table style="width:100%;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #E5E7EB">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #E5E7EB;text-align:right;font-weight:600">${esc(v)}</td></tr>`).join("")}</table>
      ${topRows ? `<h3 style="margin:20px 0 6px;font-size:15px">${esc(t("Top QR codes"))}</h3><table style="width:100%;border-collapse:collapse">${topRows}</table>` : ""}
      ${lostLine}
      ${teaser}
      <p style="margin:20px 0 0"><a href="${adminUrl(shop.domain, "/app/analytics")}" style="background:#2563EB;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">${esc(t("Open analytics"))}</a></p>
      <p style="margin:20px 0 0;font-size:12px;color:#9CA3AF">${esc(t("You receive this weekly summary because it is turned on in TrackQr → Settings."))}</p>
    </div>`;
  const text = [
    t("Your TrackQr week — {shop}", { shop: shopName }),
    ...rows.map(([k, v]) => `${k}: ${v}`),
    missed.total ? tp(missed.total, "{count} scan went to your fallback page.", "{count} scans went to your fallback page.") : "",
  ].filter(Boolean).join("\n");
  return {
    subject: tp(kpis.totalScans, "TrackQr weekly report — {count} scan", "TrackQr weekly report — {count} scans"),
    text,
    html,
  };
}

export async function sendWeeklyReports(opts: { force?: boolean; shopDomain?: string } = {}): Promise<WeeklyReportRun> {
  const result: WeeklyReportRun = { sent: 0, skipped: 0, failed: 0, pending: 0 };
  if (!isSmtpConfigured()) return result;
  const started = Date.now();
  const shops = await prisma.shop.findMany({
    where: { uninstalledAt: null, ...(opts.shopDomain ? { domain: opts.shopDomain } : {}) },
    include: { activeSubscription: { include: { plan: true } } },
    orderBy: { installedAt: "asc" },
  });

  for (const shop of shops) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      result.pending++;
      continue;
    }
    const settings = readShopSettings(shop);
    const last = settings.lastWeeklyReportAt ? Date.parse(settings.lastWeeklyReportAt) : 0;
    const recipient = settings.leadNotifyEmail || shop.email;
    if (!settings.weeklyReport || !recipient || (!opts.force && Date.now() - last < REPORT_INTERVAL_MS)) {
      result.skipped++;
      continue;
    }
    try {
      const access = await getBillingAccess(shop);
      const ent = entitlementsForPlan(access.plan, access.status);
      const scope = { earliestScanDate: ent.earliestScanDate, attribution: ent.attribution };
      const since = new Date(Date.now() - 7 * 86400000);
      const [kpis, top, missed, leads] = await Promise.all([
        getKpis(shop.id, "7d", scope),
        getTopQrCodes(shop.id, "7d", 3, scope),
        getMissedScanSummary(shop.id, 7),
        prisma.lead.count({ where: { campaign: { shopId: shop.id }, createdAt: { gte: since } } }),
      ]);
      if (!kpis.totalScans && !leads && !missed.total) {
        await updateShopSettings(shop.id, { lastWeeklyReportAt: new Date().toISOString() });
        result.skipped++;
        continue;
      }

      // Built in the merchant's admin language.
      const mail = runWithLocale(settings.adminLocale, () => weeklyEmail({
        shop, kpis, top, missed, leads, attribution: ent.attribution,
      }));
      await sendSmtpMail({ to: recipient, ...mail });
      await updateShopSettings(shop.id, { lastWeeklyReportAt: new Date().toISOString() });
      result.sent++;
    } catch (err) {
      console.error(`[weekly-report] ${shop.domain} failed`, err instanceof Error ? err.message : err);
      result.failed++;
    }
  }
  return result;
}
