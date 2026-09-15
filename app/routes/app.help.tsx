import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../lib/shop.server";
import { getPlanEntitlements } from "../lib/plan.server";
import { Icon } from "../components/ui/Icon";
import { Badge } from "../components/ui/Badge";
import { Card, CardHead } from "../components/ui/Card";

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
  { id: "a", q: "How does a TrackQr QR code differ from a static one?", a: "Every TrackQr code points to a unique short URL we own. That lets us track scans, devices and conversions — and you can change the destination later without reprinting." },
  { id: "b", q: "Will my QR code keep working if I edit it?", a: "Yes. The short URL stays the same. We re-route the destination in milliseconds when you edit and save." },
  { id: "c", q: "Can I add my logo to the center?", a: "Yes — under Design → Center logo. We auto-add error-correction so scanning stays reliable." },
  { id: "d", q: "How are conversions attributed?", a: "On the Growth plan each scan carries a hidden id to your storefront. Add-to-cart codes pass it to the cart automatically; for every other code, enable the \"TrackQr attribution\" app embed once (Online Store → Themes → Customize → App embeds) so the id is stored as a cart attribute. When the order is paid, TrackQr matches it back to the scan — up to 7 days after the scan, on the same device." },
  { id: "e", q: "Where are leads from a campaign stored?", a: "Campaign leads are saved in TrackQr, exportable as CSV, and the merchant receives each submission by SMTP when the block has a recipient email." },
  { id: "f", q: "Where can I leave feedback about TrackQr?", a: "You can contact support for help or share your experience on the Shopify App Store after you have used the app." },
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
          <div className="page-eyebrow"><Icon name="help-circle" size={11} /> Help center</div>
          <h1 className="page-h1"><span className="em">How</span> can we help?</h1>
          <div className="page-sub">Find quick answers, contact support, or share feedback after using TrackQr.</div>
        </div>
        <div className="page-head-actions">
          <a className="btn btn-primary" href={supportHref}>
            <Icon name="message-square" />
            Contact support
          </a>
        </div>
      </div>

      <div className="grid grid-3 mb-6">
        {[
          { icon: "rocket",  title: "Quick start",      desc: "Create your first QR code in under a minute." },
          { icon: "scan",    title: "How tracking works", desc: "Scans, conversions and attribution explained." },
          { icon: "lock",   title: "Privacy & GDPR",    desc: "What we collect, what we don't." },
        ].map((c, i) => (
          <Card key={i} hoverLift className="card-pad">
            <div style={{
              width: 36, height: 36, borderRadius: 9, marginBottom: 14,
              background: "var(--accent-soft)", color: "var(--accent)",
              border: "1px solid var(--accent-border)",
              display: "grid", placeItems: "center",
            }}>
              <Icon name={c.icon} size={18} />
            </div>
            <div style={{ fontFamily: "var(--ff-display)", fontSize: 15, fontWeight: 600, color: "var(--fg-strong)", marginBottom: 6 }}>{c.title}</div>
            <div className="text-sm muted">{c.desc}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-23">
        <Card>
          <CardHead title="Frequently asked" />
          {FAQS.map(f => (
            <button
              key={f.id}
              type="button"
              className="faq-row"
              aria-expanded={open === f.id}
              onClick={() => setOpen(open === f.id ? null : f.id)}
            >
              <div className="flex items-center justify-between">
                <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--fg-strong)", textAlign: "left" }}>{f.q}</div>
                <Icon name={open === f.id ? "chevron-up" : "chevron-down"} size={14} style={{ color: "var(--fg-subtle)", flexShrink: 0, marginLeft: 12 }} />
              </div>
              {open === f.id && (
                <div className="text-sm muted mt-2" style={{ maxWidth: 720, textAlign: "left" }}>{f.a}</div>
              )}
            </button>
          ))}
        </Card>

        <div className="col gap-4">
          <Card className="card-pad help-contact-card" accent="blue">
            <div className="help-card-icon"><Icon name="message-square" size={18} /></div>
            <div className="help-card-title">Need help before leaving a review?</div>
            <div className="mt-2 mb-2">
              {prioritySupport ? (
                <Badge tone="violet" dot>Priority support · {planName} plan · answered first</Badge>
              ) : (
                <Badge tone="neutral" dot>Standard support · {planName} plan</Badge>
              )}
            </div>
            <div className="text-sm muted">
              {prioritySupport
                ? "Your requests are flagged as priority and handled before the standard queue — usually within one business day."
                : "Send the issue, your shop domain, and what you were trying to do. We will help you get unstuck. Priority handling is included in the Growth plan."}
            </div>
            <a className="btn btn-primary mt-4" href={supportHref}>
              <Icon name="send" />
              Email support
            </a>
          </Card>

          <Card className="card-pad help-contact-card" accent="amber">
            <div className="help-card-icon amber"><Icon name="star" size={18} /></div>
            <div className="help-card-title">Reviews are requested natively</div>
            <div className="text-sm muted">
              After successful workflows, Shopify can show its native review prompt when the shop is eligible.
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
