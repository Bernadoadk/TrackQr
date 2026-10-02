import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { requireShop } from "../lib/shop.server";
import { getDashboardData } from "../lib/analytics.server";
import { getPlanEntitlements } from "../lib/plan.server";
import { readShopSettings } from "../lib/shop-settings.server";
import { QR_TYPE_TO_UI } from "../lib/qr-types";
import { formatMoney } from "../lib/format";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card, CardHead } from "../components/ui/Card";
import { StatCard } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { formatNumber, regionName, t, tp, tx } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const entitlements = await getPlanEntitlements(shop);
  const settings = readShopSettings(shop);
  const [data, firstScan, campaignCount] = await Promise.all([
    getDashboardData(shop.id, {
      earliestScanDate: entitlements.earliestScanDate,
      attribution: entitlements.attribution,
    }),
    prisma.scan.findFirst({ where: { qrCode: { shopId: shop.id } }, select: { id: true } }),
    prisma.campaign.count({ where: { shopId: shop.id } }),
  ]);

  const steps = [
    { id: "create", title: "Create your first QR code", desc: "Product, collection, cart, promo, link…", done: data.counts.total > 0, to: "/app/create", cta: "Create" },
    { id: "activate", title: "Activate it", desc: "Codes start as drafts — activate one when it's ready.", done: data.counts.active > 0, to: "/app/qr-manager", cta: "Open My QR codes" },
    { id: "scan", title: "Print it and get a first scan", desc: "Download it (PNG, or SVG/PDF for print) and scan it with your phone.", done: !!firstScan, to: "/app/qr-manager", cta: "Download" },
    { id: "campaign", title: "Build a campaign page", desc: "A landing page with email capture for your QR codes.", done: campaignCount > 0, to: "/app/campaigns", cta: "Create a campaign" },
    ...(entitlements.attribution
      ? [{ id: "attribution", title: "Turn on sales attribution", desc: "Enable the TrackQr app embed in your theme (one click).", done: settings.attributionEmbedOpened, to: "/app/settings", cta: "Open settings" }]
      : []),
  ];

  return {
    shop: { name: shop.name, domain: shop.domain, currency: shop.currency },
    canAttribution: entitlements.attribution,
    detailedAnalytics: entitlements.detailedAnalytics,
    historyDays: entitlements.historyDays,
    onboarding: { steps, dismissed: settings.onboardingDismissed },
    ...data,
  };
};

function fmtNum(n: number) {
  if (n >= 1000) return formatNumber(n / 1000, { maximumFractionDigits: 1 }) + "k";
  return formatNumber(n);
}
function fmtPct(n: number, digits = 1) {
  return formatNumber(n / 100, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtRel(date: Date | string) {
  const ts = new Date(date).getTime();
  const d = Date.now() - ts;
  if (d < 60000)   return t("just now");
  if (d < 3600000) return t("{n}m ago", { n: Math.round(d / 60000) });
  if (d < 86400000) return t("{n}h ago", { n: Math.round(d / 3600000) });
  return t("{n}d ago", { n: Math.round(d / 86400000) });
}

const TYPE_META: Record<string, { name: string; icon: string }> = {
  product:    { name: "Product",    icon: "shopping-cart" },
  collection: { name: "Collection", icon: "grid" },
  page:       { name: "Store page", icon: "layout" },
  promo:      { name: "Promo",      icon: "tag" },
  url:        { name: "URL",        icon: "link" },
  link:       { name: "Link",       icon: "link" },
  atc:        { name: "Cart",       icon: "shopping-cart" },
  home:       { name: "Home",       icon: "home" },
  text:       { name: "Text",       icon: "type" },
  phone:      { name: "Phone",      icon: "phone" },
  sms:        { name: "SMS",        icon: "message-square" },
  email:      { name: "Email",      icon: "mail" },
  wifi:       { name: "WiFi",       icon: "wifi" },
  vcard:      { name: "vCard",      icon: "id-card" },
};

function activityIcon(kind: string) {
  if (kind === "scan") return "scan";
  if (kind === "conversion") return "trending-up";
  if (kind === "create") return "plus";
  if (kind === "pause") return "pause";
  if (kind === "lead") return "mail";
  return "bell";
}

function greetingFor(hour: number) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Refresh the dashboard every minute while it is visible. */
function useLiveRefresh(intervalMs = 60_000) {
  const revalidator = useRevalidator();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") revalidator.revalidate();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, revalidator]);
}

export default function Dashboard() {
  const { shop, counts, kpis, series, activity, recent, canAttribution, detailedAnalytics, missed, onboarding } = useLoaderData<typeof loader>();
  useLiveRefresh();
  // Greeting from the merchant's local time (set after hydration).
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => setGreeting(greetingFor(new Date().getHours())), []);
  // The scan timeline is part of detailed analytics (Starter+); Free gets the counter only.
  const sparkScans = detailedAnalytics ? series.map(s => s.scans) : undefined;
  const sparkRevenue = canAttribution ? series.map(s => s.revenue) : undefined;

  return (
    <>
      {/* Page header */}
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><span className="dot" />{t(greeting)}</div>
          <h1 className="page-h1">{t("Hello,")} <span className="em">{shop.name ?? t("merchant")}</span>.</h1>
          <div className="page-sub">{canAttribution ? t("A pulse on every QR code and campaign with sales attribution — refreshed every minute.") : t("A pulse on every QR code and campaign — refreshed every minute.")}</div>
        </div>
        <div className="page-head-actions">
          <Link to="/app/analytics"><Button variant="secondary" icon="bar-chart">{t("Analytics")}</Button></Link>
          <Link to="/app/create"><Button variant="primary" icon="plus">{t("Create QR code")}</Button></Link>
        </div>
      </div>

      <OnboardingChecklist steps={onboarding.steps} dismissed={onboarding.dismissed} />

      {missed.total > 0 && (
        <div className={`plan-notice ${missed.overQuota ? "warning" : ""}`} role="status">
          <Icon name="alert-triangle" size={15} />
          <div className="plan-notice-body">
            <b>{tp(missed.total, "{count} scan this week", "{count} scans this week")}</b>{" "}
            {tp(missed.total, "reached a paused, scheduled or expired QR code and went to your fallback page", "reached paused, scheduled or expired QR codes and went to your fallback page")}
            {missed.overQuota ? <> {tx("— {count} because of your plan limit.", { count: <b>{formatNumber(missed.overQuota)}</b> })}</> : "."}
          </div>
          {missed.overQuota
            ? <Link to="/app/pricing" className="plan-notice-cta">{t("Upgrade")} <Icon name="arrow-right" size={12} /></Link>
            : <Link to="/app/qr-manager" className="plan-notice-cta">{t("Review codes")} <Icon name="arrow-right" size={12} /></Link>}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-4">
        <StatCard accent="blue"   label={t("QR codes")}    value={counts.total}             icon="qr-code"     sub={tp(counts.active, "{count} active")} />
        <StatCard accent="violet" label={t("Total scans")} value={fmtNum(kpis.totalScans)}  icon="scan"        sub={t("last 14 days")} sparklineData={sparkScans} />
        <StatCard accent="green"  label={t("Revenue")}     value={canAttribution ? formatMoney(kpis.revenue, shop.currency, true) : t("Locked")} icon={canAttribution ? "trending-up" : "lock"} sub={canAttribution ? tp(kpis.totalConversions, "{count} order · 14 days", "{count} orders · 14 days", { count: fmtNum(kpis.totalConversions) }) : t("Growth plan")} sparklineData={sparkRevenue} />
        <StatCard accent="amber"  label={t("Conv. rate")}  value={canAttribution ? fmtPct(kpis.convRate, 2) : t("Locked")} icon={canAttribution ? "zap" : "lock"} sub={!canAttribution ? t("Growth plan") : detailedAnalytics ? tp(kpis.uniqueVisitors, "{count} unique", "{count} unique", { count: fmtNum(kpis.uniqueVisitors) }) : t("last 14 days")} />
      </div>

      {/* Recent QRs + Activity */}
      <div className="grid grid-23 mt-6">
        <Card accent="blue">
          <CardHead
            title={t("Recent QR codes")}
            subtitle={t("Latest five additions")}
            actions={
              <Link to="/app/qr-manager">
                <Button size="sm" variant="ghost" iconRight="arrow-right">{t("View all")}</Button>
              </Link>
            }
          />
          {recent.length === 0 ? (
            <EmptyState
              icon="qr-code"
              title={t("No QR codes yet")}
              desc={t("Create your first QR code to start tracking scans and conversions.")}
              cta={<Link to="/app/create"><Button variant="primary" icon="plus">{t("Create QR code")}</Button></Link>}
            />
          ) : (
            <div>
              {recent.map(qr => {
                const uiType = QR_TYPE_TO_UI[qr.type] ?? "link";
                const typeInfo = TYPE_META[uiType] ?? { name: uiType, icon: "link" };
                return (
                  <Link to={`/app/create?edit=${qr.id}`} key={qr.id} className="row-item" style={{ display: "flex", textDecoration: "none", color: "inherit" }}>
                    <div className="row-thumb qr">
                      <img src={`/qr/${qr.id}/svg?size=80`} alt="" width={40} height={40} />
                    </div>
                    <div className="row-main">
                      <div className="row-title">{qr.name}</div>
                      <div className="row-meta">
                        <Icon name={typeInfo.icon} size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                        {t(typeInfo.name)}
                        <span className="sep">•</span>
                        <span className="num">{tp(qr.scans, "{count} scan", "{count} scans", { count: fmtNum(qr.scans) })}</span>
                        <span className="sep">•</span>
                        {fmtRel(qr.createdAt)}
                      </div>
                    </div>
                    <Badge tone={qr.active ? "success" : "neutral"} dot>{qr.active ? t("Active") : t("Paused")}</Badge>
                    <Icon name="chevron-right" className="row-item-arrow" />
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <Card accent="violet">
          <CardHead
            title={t("Activity")}
            actions={<Badge tone="success" live>{t("Live")}</Badge>}
          />
          <div>
            {activity.length === 0 ? (
              <div style={{ padding: "32px 24px", textAlign: "center" }}>
                <Icon name="bell" size={22} style={{ color: "var(--fg-subtle)", marginBottom: 10 }} />
                <div className="text-sm muted">{t("No activity yet.")}</div>
              </div>
            ) : activity.map((a, i) => (
              <div key={a.id} className={`feed-item ${i === 0 ? "live" : ""}`}>
                <div className={`feed-icon ${a.tone}`}>
                  <Icon name={activityIcon(a.kind)} size={13} />
                </div>
                <div className="feed-main">
                  <div className="feed-title"><b>{t(a.title, a.params)}</b></div>
                  <div className="feed-meta">{a.whoRaw ? a.who : t(a.who, { ...a.params, country: regionName(a.params.country) })}</div>
                </div>
                <div className="feed-time">{fmtRel(a.time)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="section">
        <h2 className="section-h">{t("Quick actions")}</h2>
        <div className="grid grid-4">
          <Link to="/app/create" className="action-card" data-accent="blue" style={{ display: "block", textDecoration: "none" }}>
            <div className="action-icon"><Icon name="plus" size={17} /></div>
            <div className="action-arrow"><Icon name="arrow-up-right" /></div>
            <div className="action-body">
              <div className="action-title">{t("Create a QR code")}</div>
              <div className="action-desc">{t("Link a product, collection, cart, promo or anything else — designed in seconds.")}</div>
            </div>
          </Link>
          <Link to="/app/bulk" className="action-card" data-accent="green" style={{ display: "block", textDecoration: "none" }}>
            <div className="action-icon"><Icon name="layers" size={17} /></div>
            <div className="action-arrow"><Icon name="arrow-up-right" /></div>
            <div className="action-body">
              <div className="action-title">{t("Bulk create")}</div>
              <div className="action-desc">{t("One QR code per product, variant or collection — or import a CSV.")}</div>
            </div>
          </Link>
          <Link to="/app/campaigns" className="action-card" data-accent="violet" style={{ display: "block", textDecoration: "none" }}>
            <div className="action-icon"><Icon name="megaphone" size={17} /></div>
            <div className="action-arrow"><Icon name="arrow-up-right" /></div>
            <div className="action-body">
              <div className="action-title">{t("Launch a campaign")}</div>
              <div className="action-desc">{t("A landing page with email capture, promo codes and product grids.")}</div>
            </div>
          </Link>
          <Link to="/app/analytics" className="action-card" data-accent="amber" style={{ display: "block", textDecoration: "none" }}>
            <div className="action-icon"><Icon name="bar-chart" size={17} /></div>
            <div className="action-arrow"><Icon name="arrow-up-right" /></div>
            <div className="action-body">
              <div className="action-title">{t("View analytics")}</div>
              <div className="action-desc">{canAttribution ? t("Scans by day, device and country, orders and revenue per QR code.") : t("Scans by day, device and country.")}</div>
            </div>
          </Link>
        </div>
      </div>
    </>
  );
}

type Step = { id: string; title: string; desc: string; done: boolean; to: string; cta: string };

function OnboardingChecklist({ steps, dismissed }: { steps: Step[]; dismissed: boolean }) {
  const fetcher = useFetcher();
  const [hidden, setHidden] = useState(dismissed);
  const done = steps.filter(s => s.done).length;
  if (hidden || done === steps.length) return null;
  const next = steps.find(s => !s.done);

  const dismiss = () => {
    setHidden(true);
    const fd = new FormData();
    fd.set("intent", "onboarding-dismiss");
    fetcher.submit(fd, { method: "post", action: "/app/settings" });
  };

  return (
    <Card className="card-pad-lg onboarding mb-6" accent="blue">
      <div className="onboarding-head">
        <div>
          <div className="section-h" style={{ fontSize: 15, marginBottom: 2 }}>{t("Get started with TrackQr")}</div>
          <div className="section-sub">{t("{done} of {total} done — about five minutes to your first tracked scan.", { done, total: steps.length })}</div>
        </div>
        <button type="button" className="onboarding-dismiss" onClick={dismiss} aria-label={t("Hide the setup guide")}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="progress-bar onboarding-progress" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="onboarding-steps">
        {steps.map(step => (
          <li key={step.id} className={`onboarding-step ${step.done ? "done" : ""} ${next?.id === step.id ? "next" : ""}`}>
            <span className="onboarding-check">{step.done ? <Icon name="check" size={12} /> : null}</span>
            <div className="onboarding-text">
              <div className="onboarding-title">{t(step.title)}</div>
              {!step.done && <div className="onboarding-desc">{t(step.desc)}</div>}
            </div>
            {!step.done && next?.id === step.id && (
              <Link to={step.to}><Button size="sm" variant="primary" iconRight="arrow-right">{t(step.cta)}</Button></Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
