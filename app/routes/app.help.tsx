import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../lib/shop.server";
import { getPlanEntitlements } from "../lib/plan.server";
import { Icon } from "../components/ui/Icon";
import { Badge } from "../components/ui/Badge";
import { Card, CardHead } from "../components/ui/Card";
import { t, tem } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const entitlements = await getPlanEntitlements(shop);
  return {
    supportEmail: process.env.SUPPORT_EMAIL?.trim() || process.env.SMTP_FROM_EMAIL?.trim() || "adikpetobernado@gmail.com",
    shopDomain: shop.domain,
    planName: entitlements.planName,
    // Growth plan: requests are flagged so they are answered first.
    prioritySupport: entitlements.prioritySupport,
  };
};

const FAQS = [
  { id: "a", q: "How does a TrackQr QR code differ from a static one?", a: "Every TrackQr code points to a unique short URL. That lets us count scans, devices and countries — and you can change the destination, add a discount code or a routing rule later without reprinting." },
  { id: "b", q: "What happens when a code is paused, scheduled or expired?", a: "Visitors never see an error page: they land on your store home page, or on the fallback page you choose (Starter and Growth). These scans are counted as missed scans on the dashboard and in Analytics. Tip: an expiry date + a fallback page switches the destination automatically." },
  { id: "c", q: "Can I create QR codes for my whole catalog?", a: "Yes — Bulk create (Starter and Growth) makes one QR code per product, variant or collection in a few clicks, or imports a CSV file. Select codes in My QR codes to download them as a ZIP or as a print sheet (A4 / Letter)." },
  { id: "d", q: "How are sales attributed?", a: "On the Growth plan each scan carries a hidden id to your storefront. Add-to-cart codes pass it to the cart automatically; for every other code, enable the \"TrackQr attribution\" app embed once (Settings → Sales attribution → Enable). When the order is created, TrackQr matches it back to the scan — up to 7 days after the scan, on the same device. Orders and revenue then appear per QR code and per campaign." },
  { id: "e", q: "Can I put a QR code on order emails and packing slips?", a: "Yes (Starter and Growth): in My QR codes, open the ⋯ menu of a code → Order emails & packing slips, copy the snippet and paste it in Shopify's notification or packing slip template. Each order gets its own code, and scans record the order number." },
  { id: "f", q: "Where are campaign leads stored?", a: "In TrackQr, with their marketing consent, exportable as CSV (Starter and Growth). You get each sign-up by email. On Growth, leads can also become Shopify customers (Settings) and receive a unique discount code." },
  { id: "g", q: "Can I add my logo to the center?", a: "Yes — under Design → Center logo (Starter and Growth). Error correction is raised automatically so scanning stays reliable. Keep a good contrast between the code and its background." },
];

export default function Help() {
  const { supportEmail, shopDomain, planName, prioritySupport } = useLoaderData<typeof loader>();
  const [open, setOpen] = useState<string | null>("a");
  const subject = `[TrackQr · ${planName}${prioritySupport ? " · PRIORITY" : ""}] Support request — ${shopDomain}`;
  const supportHref = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}`;

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="help-circle" size={11} /> {t("Help center")}</div>
          <h1 className="page-h1">{tem("<em>How</em> can we help?")}</h1>
          <div className="page-sub">{t("Find quick answers, contact support, or share feedback after using TrackQr.")}</div>
        </div>
        <div className="page-head-actions">
          <a className="btn btn-primary" href={supportHref}>
            <Icon name="message-square" />
            {t("Contact support")}
          </a>
        </div>
      </div>

      <div className="grid grid-3 mb-6">
        {[
          { icon: "rocket", title: "Quick start",        desc: "Create your first QR code in under a minute.", to: "/app/create" },
          { icon: "scan",   title: "How tracking works", desc: "Scans, missed scans and sales attribution explained.", faq: "d" },
          { icon: "lock",   title: "Privacy & GDPR",     desc: "What we collect, what we don't.", to: "/app/settings" },
        ].map(c => (
          <Link
            key={c.title}
            to={c.to ?? "#faq"}
            onClick={() => { if (c.faq) setOpen(c.faq); }}
            className="help-link-card"
          >
            <Card hoverLift className="card-pad">
              <div style={{
                width: 36, height: 36, borderRadius: 9, marginBottom: 14,
                background: "var(--accent-soft)", color: "var(--accent)",
                border: "1px solid var(--accent-border)",
                display: "grid", placeItems: "center",
              }}>
                <Icon name={c.icon} size={18} />
              </div>
              <div style={{ fontFamily: "var(--ff-display)", fontSize: 15, fontWeight: 600, color: "var(--fg-strong)", marginBottom: 6 }}>{t(c.title)}</div>
              <div className="text-sm muted">{t(c.desc)}</div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-23" id="faq">
        <Card>
          <CardHead title={t("Frequently asked")} />
          {FAQS.map(f => (
            <button
              key={f.id}
              type="button"
              className="faq-row"
              aria-expanded={open === f.id}
              onClick={() => setOpen(open === f.id ? null : f.id)}
            >
              <div className="flex items-center justify-between">
                <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--fg-strong)", textAlign: "left" }}>{t(f.q)}</div>
                <Icon name={open === f.id ? "chevron-up" : "chevron-down"} size={14} style={{ color: "var(--fg-subtle)", flexShrink: 0, marginLeft: 12 }} />
              </div>
              {open === f.id && (
                <div className="text-sm muted mt-2" style={{ maxWidth: 720, textAlign: "left" }}>{t(f.a)}</div>
              )}
            </button>
          ))}
        </Card>

        <div className="col gap-4">
          <Card className="card-pad help-contact-card" accent="blue">
            <div className="help-card-icon"><Icon name="message-square" size={18} /></div>
            <div className="help-card-title">{t("Need help before leaving a review?")}</div>
            <div className="mt-2 mb-2">
              {prioritySupport ? (
                <Badge tone="violet" dot>{t("Priority support · {plan} plan · answered first", { plan: planName })}</Badge>
              ) : (
                <Badge tone="neutral" dot>{t("Standard support · {plan} plan", { plan: planName })}</Badge>
              )}
            </div>
            <div className="text-sm muted">
              {prioritySupport
                ? t("Your requests are flagged as priority and handled before the standard queue — usually within one business day.")
                : t("Send the issue, your shop domain, and what you were trying to do. We will help you get unstuck. Priority handling is included in the Growth plan.")}
            </div>
            <a className="btn btn-primary mt-4" href={supportHref}>
              <Icon name="send" />
              {t("Email support")}
            </a>
          </Card>

          <Card className="card-pad help-contact-card" accent="amber">
            <div className="help-card-icon amber"><Icon name="star" size={18} /></div>
            <div className="help-card-title">{t("Reviews are requested natively")}</div>
            <div className="text-sm muted">
              {t("After successful workflows, Shopify can show its native review prompt when the shop is eligible.")}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
