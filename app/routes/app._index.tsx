import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../lib/shop.server";
import { getDashboardData } from "../lib/analytics.server";
import { getPlanEntitlements } from "../lib/plan.server";
import { QR_TYPE_TO_UI } from "../lib/qr-types";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card, CardHead } from "../components/ui/Card";
import { StatCard } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const entitlements = await getPlanEntitlements(shop);
  const data = await getDashboardData(shop.id, {
    earliestScanDate: entitlements.earliestScanDate,
    attribution: entitlements.attribution,
  });
  return {
    shop: { name: shop.name, domain: shop.domain },
    canAttribution: entitlements.attribution,
    historyDays: entitlements.historyDays,
    ...data,
  };
};

function fmtNum(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}
function fmtPct(n: number, digits = 1) { return n.toFixed(digits) + "%"; }
function fmtRel(date: Date | string) {
  const ts = new Date(date).getTime();
  const d = Date.now() - ts;
  if (d < 60000)   return "just now";
  if (d < 3600000) return `${Math.round(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.round(d / 3600000)}h ago`;
  return `${Math.round(d / 86400000)}d ago`;
}

const TYPE_META: Record<string, { name: string; icon: string }> = {
  product: { name: "Product",  icon: "shopping-cart" },
  promo:   { name: "Promo",    icon: "tag" },
  url:     { name: "URL",      icon: "link" },
  link:    { name: "Link",     icon: "link" },
  atc:     { name: "Cart",     icon: "shopping-cart" },
  home:    { name: "Home",     icon: "home" },
  text:    { name: "Text",     icon: "type" },
  phone:   { name: "Phone",    icon: "phone" },
  sms:     { name: "SMS",      icon: "message-square" },
  email:   { name: "Email",    icon: "mail" },
  wifi:    { name: "WiFi",     icon: "wifi" },
  vcard:   { name: "vCard",    icon: "id-card" },
};

function activityIcon(kind: string) {
  if (kind === "scan") return "scan";
  if (kind === "conversion") return "trending-up";
  if (kind === "create") return "plus";
  if (kind === "pause") return "pause";
  return "bell";
}

export default function Dashboard() {
  const { shop, counts, kpis, series, activity, recent, canAttribution } = useLoaderData<typeof loader>();
  const sparkScans = series.map(s => s.scans);

  return (
    <>
      {/* Page header */}
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><span className="dot" />Welcome back</div>
          <h1 className="page-h1">Good morning, <span className="em">{shop.name ?? "merchant"}</span>.</h1>
          <div className="page-sub">A pulse on every QR code and campaign{canAttribution ? " with conversion attribution" : ""} — refreshed every minute.</div>
        </div>
        <div className="page-head-actions">
          <Link to="/app/analytics"><Button variant="secondary" icon="bar-chart">Analytics</Button></Link>
          <Link to="/app/create"><Button variant="primary" icon="plus">Create QR code</Button></Link>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-4">
        <StatCard accent="blue"   label="QR codes"    value={counts.total}             icon="qr-code"     sub={`${recent.filter(r => r.active).length} active`} />
        <StatCard accent="violet" label="Total scans" value={fmtNum(kpis.totalScans)}  icon="scan"        sub="last 14 days" sparklineData={sparkScans} />
        <StatCard accent="green"  label={canAttribution ? "Conversions" : "Conversions locked"} value={canAttribution ? fmtNum(kpis.totalConversions) : "Growth"} icon="trending-up" sub="last 14 days" />
        <StatCard accent="amber"  label="Conv. rate"  value={canAttribution ? fmtPct(kpis.convRate, 2) : "Growth"} icon="zap" sub={`${fmtNum(kpis.uniqueVisitors)} unique`} />
      </div>

      {/* Recent QRs + Activity */}
      <div className="grid grid-23 mt-6">
        <Card accent="blue">
          <CardHead
            title="Recent QR codes"
            subtitle="Latest five additions"
            actions={
              <Link to="/app/qr-manager">
                <Button size="sm" variant="ghost" iconRight="arrow-right">View all</Button>
              </Link>
            }
          />
          {recent.length === 0 ? (
            <EmptyState
              icon="qr-code"
              title="No QR codes yet"
              desc="Create your first QR code to start tracking scans and conversions."
              cta={<Link to="/app/create"><Button variant="primary" icon="plus">Create QR code</Button></Link>}
            />
          ) : (
            <div>
              {recent.map(qr => {
                const uiType = QR_TYPE_TO_UI[qr.type] ?? "link";
                const tm = TYPE_META[uiType] ?? { name: uiType, icon: "link" };
                return (
                  <Link to="/app/qr-manager" key={qr.id} className="row-item" style={{ display: "flex", textDecoration: "none", color: "inherit" }}>
                    <div className="row-thumb qr">
                      <img src={`/qr/${qr.id}/svg?size=80`} alt="" width={40} height={40} />
                    </div>
                    <div className="row-main">
                      <div className="row-title">{qr.name}</div>
                      <div className="row-meta">
                        <Icon name={tm.icon} size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                        {tm.name}
                        <span className="sep">•</span>
                        <span className="num">{fmtNum(qr.scans)} scans</span>
                        <span className="sep">•</span>
                        {fmtRel(qr.createdAt)}
                      </div>
                    </div>
                    <Badge tone={qr.active ? "success" : "neutral"} dot>{qr.active ? "Active" : "Paused"}</Badge>
                    <Icon name="chevron-right" className="row-item-arrow" />
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <Card accent="violet">
          <CardHead
            title="Activity"
            actions={<Badge tone="success" live>Live</Badge>}
          />
          <div>
            {activity.length === 0 ? (
              <div style={{ padding: "32px 24px", textAlign: "center" }}>
                <Icon name="bell" size={22} style={{ color: "var(--fg-subtle)", marginBottom: 10 }} />
                <div className="text-sm muted">No activity yet.</div>
              </div>
            ) : activity.map((a, i) => (
              <div key={a.id} className={`feed-item ${i === 0 ? "live" : ""}`}>
                <div className={`feed-icon ${a.tone}`}>
                  <Icon name={activityIcon(a.kind)} size={13} />
                </div>
                <div className="feed-main">
                  <div className="feed-title"><b>{a.title}</b></div>
                  <div className="feed-meta">{a.who}</div>
                </div>
                <div className="feed-time">{fmtRel(a.time)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="section">
        <h2 className="section-h">Quick actions</h2>
        <div className="grid grid-3">
          <Link to="/app/create" className="action-card" data-accent="blue" style={{ display: "block", textDecoration: "none" }}>
            <div className="action-icon"><Icon name="plus" size={17} /></div>
            <div className="action-arrow"><Icon name="arrow-up-right" /></div>
            <div className="action-body">
              <div className="action-title">Create a QR code</div>
              <div className="action-desc">Link a product, page, promo or anything else — designed in seconds.</div>
            </div>
          </Link>
          <Link to="/app/campaigns" className="action-card" data-accent="violet" style={{ display: "block", textDecoration: "none" }}>
            <div className="action-icon"><Icon name="megaphone" size={17} /></div>
            <div className="action-arrow"><Icon name="arrow-up-right" /></div>
            <div className="action-body">
              <div className="action-title">Launch a campaign</div>
              <div className="action-desc">Collect leads, run loyalty programs and track campaigns end-to-end.</div>
            </div>
          </Link>
          <Link to="/app/analytics" className="action-card" data-accent="amber" style={{ display: "block", textDecoration: "none" }}>
            <div className="action-icon"><Icon name="bar-chart" size={17} /></div>
            <div className="action-arrow"><Icon name="arrow-up-right" /></div>
            <div className="action-body">
              <div className="action-title">View analytics</div>
              <div className="action-desc">Scans by day, device, geography and conversion funnel — all in one view.</div>
            </div>
          </Link>
        </div>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
