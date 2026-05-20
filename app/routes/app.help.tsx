import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card, CardHead } from "../components/ui/Card";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const FAQS = [
  { id: "a", q: "How does a TrackQr QR code differ from a static one?", a: "Every TrackQr code points to a unique short URL we own. That lets us track scans, devices and conversions — and you can change the destination later without reprinting." },
  { id: "b", q: "Will my QR code keep working if I edit it?", a: "Yes. The short URL stays the same. We re-route the destination in milliseconds when you edit and save." },
  { id: "c", q: "Can I add my logo to the center?", a: "Yes — under Design → Center logo. We auto-add error-correction so scanning stays reliable." },
  { id: "d", q: "How are conversions attributed?", a: "We attribute conversions to a scan when the visitor reaches the Shopify thank-you page within 7 days from the same device." },
  { id: "e", q: "Where are leads from a campaign stored?", a: "By default in TrackQr's database, exportable as CSV. Connect Klaviyo or Mailchimp under Campaign → Settings → Leads." },
];

export default function Help() {
  const [open, setOpen] = useState<string | null>("a");

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="help-circle" size={11} /> Help center</div>
          <h1 className="page-h1"><span className="em">How</span> can we help?</h1>
          <div className="page-sub">Most questions answered in a sentence. Anything else, chat us — we reply in minutes.</div>
        </div>
        <div className="page-head-actions">
          <Button variant="secondary" icon="external-link">Documentation</Button>
          <Button variant="primary" icon="message-square">Chat with us</Button>
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

      <Card>
        <CardHead title="Frequently asked" />
        {FAQS.map(f => (
          <div
            key={f.id}
            style={{
              borderBottom: "1px solid var(--border-soft)",
              padding: "14px 18px",
              cursor: "default",
            }}
            onClick={() => setOpen(open === f.id ? null : f.id)}
          >
            <div className="flex items-center justify-between">
              <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--fg-strong)" }}>{f.q}</div>
              <Icon name={open === f.id ? "chevron-up" : "chevron-down"} size={14} style={{ color: "var(--fg-subtle)", flexShrink: 0, marginLeft: 12 }} />
            </div>
            {open === f.id && (
              <div className="text-sm muted mt-2" style={{ maxWidth: 720 }}>{f.a}</div>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
