import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../lib/shop.server";
import { getPlanEntitlements } from "../lib/plan.server";
import {
  getKpis, getDailySeries, getDeviceBreakdown, getCountryBreakdown,
  getTopQrCodes, getRecentScans, getMissedScanSummary, limitedPeriodRange, parsePeriod,
} from "../lib/analytics.server";
import { formatMoney } from "../lib/format";
import { featureMinPlanLabel } from "../lib/plan.constants";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card, CardHead } from "../components/ui/Card";
import { StatCard } from "../components/ui/StatCard";
import { FeatureLock } from "../components/ui/FeatureLock";
import { Select } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { downloadFile } from "../lib/download.client";
import { formatDate, formatNumber, regionName, t, tem, tm, tp } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const period = parsePeriod(url.searchParams.get("period"), "14d");
  const entitlements = await getPlanEntitlements(shop);
  const access = {
    earliestScanDate: entitlements.earliestScanDate,
    attribution: entitlements.attribution,
  };

  // Plans without `detailedAnalytics` (Free) only get the scan counters:
  // totals + scans per QR code. Breakdowns and the scan log stay locked.
  const detailed = entitlements.detailedAnalytics;
  const days = limitedPeriodRange(period, access).days;
  const [kpis, topQr, series, devices, countries, recentScans, missed] = await Promise.all([
    getKpis(shop.id, period, access),
    getTopQrCodes(shop.id, period, detailed ? 8 : 10, access),
    detailed ? getDailySeries(shop.id, period, access) : Promise.resolve([]),
    detailed ? getDeviceBreakdown(shop.id, period, access) : Promise.resolve([]),
    detailed ? getCountryBreakdown(shop.id, period, 8, access) : Promise.resolve([]),
    detailed ? getRecentScans(shop.id, 10, access) : Promise.resolve([]),
    getMissedScanSummary(shop.id, days),
  ]);

  return {
    period,
    kpis,
    series,
    devices,
    countries,
    topQr,
    recentScans,
    missed,
    currency: shop.currency,
    shopDomain: shop.domain,
    canAttribution: entitlements.attribution,
    canExport: entitlements.exports,
    detailedAnalytics: detailed,
    historyDays: entitlements.historyDays,
    planName: entitlements.planName,
  };
};

function AreaChart({ data, height = 200, accent = "var(--accent)" }: { data: number[]; height?: number; accent?: string }) {
  const w = 100;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const step = w / (data.length - 1 || 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / (max - min || 1)) * height * 0.85 - height * 0.075;
    return [x, y] as [number, number];
  });
  const line = "M " + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L ");
  const area = line + ` L ${w},${height} L 0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
      <defs>
        <linearGradient id="area-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#area-g)" />
      <path d={line} fill="none" stroke={accent} strokeWidth="0.45" strokeLinejoin="round" strokeLinecap="round" />
      {pts.slice(-1).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.2" fill="var(--bg-surface)" stroke={accent} strokeWidth="0.5" />
      ))}
    </svg>
  );
}

function fmtNum(n: number) {
  if (n >= 1000) return formatNumber(n / 1000, { maximumFractionDigits: 1 }) + "k";
  return formatNumber(n);
}

function fmtPct(n: number, digits = 1) {
  return formatNumber(n / 100, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtRel(d: Date | string) {
  const ts = new Date(d).getTime();
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1)  return t("just now");
  if (min < 60) return t("{n}m ago", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("{n}h ago", { n: hr });
  return t("{n}d ago", { n: Math.floor(hr / 24) });
}

const DEVICE_LABEL: Record<string, { name: string; icon: string }> = {
  MOBILE:  { name: "Mobile",  icon: "smartphone" },
  DESKTOP: { name: "Desktop", icon: "monitor" },
  TABLET:  { name: "Tablet",  icon: "tablet" },
  UNKNOWN: { name: "Unknown", icon: "help-circle" },
};

function embeddedResourceHref(path: string, searchParams: URLSearchParams, params: Record<string, string>, fallbackShop?: string) {
  const next = new URLSearchParams();
  const shop = searchParams.get("shop") || fallbackShop;
  const host = searchParams.get("host");
  if (shop) next.set("shop", shop);
  if (host) next.set("host", host);
  Object.entries(params).forEach(([key, value]) => next.set(key, value));
  const query = next.toString();
  return query ? `${path}?${query}` : path;
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return "🌐";
  // 0x1F1E6 = Regional Indicator A
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

export default function Analytics() {
  const data = useLoaderData<typeof loader>();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [series, setSeries] = useState<"scans" | "conv" | "revenue">("scans");
  const [exporting, setExporting] = useState(false);

  const scanData = data.series.map(s => s.scans);
  const convData = data.series.map(s => s.conversions);
  const revenueData = data.series.map(s => s.revenue);
  const scansExportHref = embeddedResourceHref("/qr/scans.csv", searchParams, { period: data.period }, data.shopDomain);
  const analyticsPlan = featureMinPlanLabel("detailedAnalytics");
  const exportPlan = featureMinPlanLabel("exports");

  const updatePeriod = (period: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("period", period);
    setSearchParams(next);
  };

  const exportScans = async () => {
    if (!data.canExport) {
      toast({ type: "info", title: t("CSV export is locked"), desc: t("Upgrade to {exportPlan} to export your scans.", { exportPlan }) });
      return;
    }
    setExporting(true);
    try {
      await downloadFile(scansExportHref, `trackqr-scans-${data.period}.csv`);
      toast({ title: t("Export downloaded"), type: "info" });
    } catch (err) {
      toast({ type: "error", title: t("Export failed"), desc: err instanceof Error ? tm(err.message) : t("Try again.") });
    } finally {
      setExporting(false);
    }
  };

  const showConversions = () => {
    if (data.canAttribution) {
      setSeries("conv");
      return;
    }
    toast({ type: "info", title: t("Conversions locked"), desc: t("Upgrade to a plan with attribution to view conversion data.") });
  };

  if (!data.detailedAnalytics) {
    return (
      <>
        <div className="page-head">
          <div className="page-head-left">
            <div className="page-eyebrow"><Icon name="bar-chart" size={11} /> {t("Analytics · {plan} plan", { plan: data.planName })}</div>
            <h1 className="page-h1">{tem("<em>Scan</em> counter")}</h1>
            <div className="page-sub">
              {t("Total scans and scans per QR code over the last {days} days. Detailed analytics are available on {plan}.", { days: data.historyDays ?? 30, plan: analyticsPlan })}
            </div>
          </div>
          <div className="page-head-actions">
            <Select
              value={data.period}
              onChange={e => updatePeriod(e.target.value)}
              style={{ height: 34, width: 130 }}>
              <option value="7d">{t("Last 7 days")}</option>
              <option value="14d">{t("Last 14 days")}</option>
              <option value="30d">{t("Last 30 days")}</option>
            </Select>
            <Button variant="secondary" icon="lock" onClick={exportScans} title={t("CSV export requires the {exportPlan} plan", { exportPlan })}>
              {t("Export")}
            </Button>
          </div>
        </div>

        <div className="grid grid-2">
          <StatCard accent="blue"  label={t("Total scans")}      value={fmtNum(data.kpis.totalScans)} icon="scan"    sub={t("last {days} days", { days: Number.parseInt(data.period, 10) })} />
          <StatCard accent="amber" label={t("QR codes scanned")} value={data.topQr.filter(q => q.scans > 0).length} icon="qr-code" sub={t("of {count} codes", { count: data.topQr.length })} />
        </div>

        <div className="grid grid-2 mt-6">
          <Card>
            <CardHead title={t("Scans per QR code")} subtitle={t("Counter over the selected period")} />
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Name")}</th>
                  <th className="right">{t("Scans")}</th>
                </tr>
              </thead>
              <tbody>
                {data.topQr.length === 0 ? (
                  <tr><td colSpan={2} style={{ textAlign: "center", padding: "20px", color: "var(--fg-muted)" }}>{t("No QR codes yet")}</td></tr>
                ) : data.topQr.map(qr => (
                  <tr key={qr.id}>
                    <td style={{ fontWeight: 500, color: "var(--fg-strong)" }}>{qr.name}</td>
                    <td className="num right">{fmtNum(qr.scans)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <CardHead title={t("Detailed analytics")} subtitle={t("Included from the {analyticsPlan} plan", { analyticsPlan })} />
            <div style={{ padding: "0 18px 18px" }}>
              <ul className="pricing-features" style={{ listStyle: "none", padding: 0, margin: "0 0 16px", display: "flex", flexDirection: "column", gap: 9 }}>
                {[
                  "Scans over time, day by day",
                  "Breakdown by device, OS and browser",
                  "Top countries",
                  "Unique visitors and recent scan log",
                  "CSV export of every scan",
                  "90-day history (unlimited on Growth)",
                ].map(label => (
                  <li key={label} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--fg)" }}>
                    <Icon name="circle-check" size={13} style={{ color: "var(--green)", marginTop: 2, flexShrink: 0 }} />
                    <span>{t(label)}</span>
                  </li>
                ))}
              </ul>
              <FeatureLock
                compact
                title={t("Unlock detailed analytics")}
                desc={t("See where, when and how your codes are scanned.")}
                plan={analyticsPlan}
              />
            </div>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="bar-chart" size={11} /> {t("Analytics")}</div>
          <h1 className="page-h1">{tem("<em>Scan</em> analytics")}</h1>
          <div className="page-sub">
            {data.canAttribution
              ? t("Scans by day, device and geography, with the orders and revenue they brought — {history} on your plan.", { history: data.historyDays ? t("{days}-day history", { days: data.historyDays }) : t("full history") })
              : t("Scans by day, device and geography — {history} on your plan.", { history: data.historyDays ? t("{days}-day history", { days: data.historyDays }) : t("full history") })}
          </div>
        </div>
        <div className="page-head-actions">
          <Select
            value={data.period}
            onChange={e => updatePeriod(e.target.value)}
            style={{ height: 34, width: 130 }}>
            <option value="7d">{t("Last 7 days")}</option>
            <option value="14d">{t("Last 14 days")}</option>
            <option value="30d">{t("Last 30 days")}</option>
            <option value="90d">{t("Last 90 days")}</option>
          </Select>
          <Button variant="secondary" icon={data.canExport ? "download" : "lock"} onClick={exportScans} disabled={exporting}>
            {exporting ? t("Exporting...") : t("Export")}
          </Button>
        </div>
      </div>

      {data.missed.total > 0 && (
        <div className={`plan-notice ${data.missed.overQuota ? "warning" : ""}`} role="status">
          <Icon name="alert-triangle" size={15} />
          <div className="plan-notice-body">
            <b>{tp(data.missed.total, "{count} scan", "{count} scans", { count: fmtNum(data.missed.total) })}</b>{" "}
            {tp(data.missed.total, "went to your fallback page in this period ({reasons}).", "went to your fallback page in this period ({reasons}).", {
              reasons: [
                data.missed.byReason.PAUSED ? tp(data.missed.byReason.PAUSED, "{count} paused") : "",
                data.missed.byReason.SCHEDULED ? tp(data.missed.byReason.SCHEDULED, "{count} not active yet") : "",
                data.missed.byReason.EXPIRED ? tp(data.missed.byReason.EXPIRED, "{count} expired") : "",
                data.missed.byReason.OVER_QUOTA ? tp(data.missed.byReason.OVER_QUOTA, "{count} over plan limit") : "",
                data.missed.byReason.ARCHIVED ? tp(data.missed.byReason.ARCHIVED, "{count} archived") : "",
              ].filter(Boolean).join(", "),
            })}
          </div>
          {data.missed.overQuota > 0 && <Link to="/app/pricing" className="plan-notice-cta">{t("Upgrade")} <Icon name="arrow-right" size={12} /></Link>}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-4">
        <StatCard accent="blue"   label={t("Total scans")}     value={fmtNum(data.kpis.totalScans)}        icon="scan"        sparklineData={scanData} sub={tp(data.kpis.uniqueVisitors, "{count} unique visitor", "{count} unique visitors", { count: fmtNum(data.kpis.uniqueVisitors) })} />
        <StatCard accent="green"  label={t("Revenue")}         value={data.canAttribution ? formatMoney(data.kpis.revenue, data.currency, true) : t("Locked")} icon={data.canAttribution ? "trending-up" : "lock"} sub={data.canAttribution ? tp(data.kpis.totalConversions, "{count} order", "{count} orders", { count: fmtNum(data.kpis.totalConversions) }) : t("Growth plan")} sparklineData={data.canAttribution ? revenueData : undefined} />
        <StatCard accent="violet" label={t("Conv. rate")}      value={data.canAttribution ? fmtPct(data.kpis.convRate, 2) : t("Locked")} icon={data.canAttribution ? "zap" : "lock"} sub={data.canAttribution ? t("orders / scans") : t("Growth plan")} />
        <StatCard accent="amber"  label={t("Avg. order value")} value={data.canAttribution ? formatMoney(data.kpis.aov, data.currency) : t("Locked")} icon={data.canAttribution ? "shopping-cart" : "lock"} sub={data.canAttribution ? t("attributed orders") : t("Growth plan")} />
      </div>

      {/* Charts */}
      <div className="grid grid-23 mt-6">
        <Card accent="blue">
          <CardHead
            title={series === "scans" ? t("Scans over time") : series === "conv" ? t("Orders over time") : t("Revenue over time")}
            subtitle={t("Daily volume")}
            actions={
              <div className="segmented">
                <button className={series === "scans" ? "active" : ""} onClick={() => setSeries("scans")}>{t("Scans")}</button>
                <button className={series === "conv"  ? "active" : ""} onClick={showConversions} title={data.canAttribution ? t("Show orders") : t("Orders require attribution")}>{t("Orders")}</button>
                <button className={series === "revenue" ? "active" : ""} onClick={() => data.canAttribution ? setSeries("revenue") : showConversions()} title={data.canAttribution ? t("Show revenue") : t("Revenue requires attribution")}>{t("Revenue")}</button>
              </div>
            }
          />
          <div style={{ padding: "16px 18px 14px" }}>
            <AreaChart data={series === "scans" ? scanData : series === "conv" ? convData : revenueData} height={180} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, padding: "0 2px" }}>
              {data.series.filter((_, i) => i % Math.max(1, Math.floor(data.series.length / 4)) === 0).map(s => (
                <span key={s.date} style={{ fontSize: 10, color: "var(--fg-subtle)", fontFamily: "var(--ff-mono)" }}>{formatDate(s.date, { day: "2-digit", month: "2-digit", timeZone: "UTC" })}</span>
              ))}
            </div>
          </div>
        </Card>

        <Card accent="violet">
          <CardHead title={t("By device")} />
          <div style={{ padding: "14px 18px" }}>
            {data.devices.length === 0 ? (
              <div className="text-sm muted" style={{ textAlign: "center", padding: "24px 0" }}>{t("No scans yet.")}</div>
            ) : data.devices.map(d => {
              const meta = DEVICE_LABEL[d.device];
              return (
                <div key={d.device} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Icon name={meta.icon} size={14} style={{ color: "var(--fg-muted)" }} />
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg-strong)" }}>{t(meta.name)}</span>
                    </div>
                    <span style={{ fontSize: 12, fontFamily: "var(--ff-mono)", color: "var(--fg-muted)" }}>{fmtNum(d.scans)}</span>
                  </div>
                  <div className="progress-bar"><div className="progress-fill" style={{ width: `${d.pct}%` }} /></div>
                  <div style={{ fontSize: 11, color: "var(--fg-subtle)", marginTop: 4, fontFamily: "var(--ff-mono)" }}>{fmtPct(d.pct, 0)}</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Geo + Top QR */}
      <div className="grid grid-2 mt-6">
        <Card>
          <CardHead title={t("Top countries")} subtitle={t("By scan volume")} />
          <div style={{ padding: "6px 18px 14px" }}>
            {data.countries.length === 0 ? (
              <div className="text-sm muted" style={{ textAlign: "center", padding: "24px 0" }}>{t("No geo data yet — countries come from the hosting provider's geolocation header (Vercel, Cloudflare, CloudFront).")}</div>
            ) : data.countries.map(g => (
              <div key={g.country} className="progress-row">
                <span className="progress-flag">{countryFlag(g.country)}</span>
                <span className="progress-name">{regionName(g.country)}</span>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${g.pct}%` }} />
                </div>
                <span className="progress-val">{fmtNum(g.scans)}</span>
                <span className="progress-pct">{fmtPct(g.pct, 0)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead title={t("Top QR codes")} subtitle={data.canAttribution ? t("Scans, orders and revenue") : t("By scan volume")} />
          <table className="table">
            <thead>
              <tr>
                <th>{t("Name")}</th>
                <th className="right">{t("Scans")}</th>
                {data.canAttribution && <th className="right">{t("Orders")}</th>}
                {data.canAttribution && <th className="right">{t("Revenue")}</th>}
                {data.canAttribution && <th className="right">{t("Rate")}</th>}
              </tr>
            </thead>
            <tbody>
              {data.topQr.length === 0 ? (
                <tr><td colSpan={data.canAttribution ? 5 : 2} style={{ textAlign: "center", padding: "20px", color: "var(--fg-muted)" }}>{t("No QR codes yet")}</td></tr>
              ) : data.topQr.map(qr => (
                <tr key={qr.id}>
                  <td style={{ fontWeight: 500, color: "var(--fg-strong)" }}>{qr.name}</td>
                  <td className="num right">{fmtNum(qr.scans)}</td>
                  {data.canAttribution && <td className="num right">{fmtNum(qr.conversions)}</td>}
                  {data.canAttribution && <td className="num right">{formatMoney(qr.revenue, data.currency, true)}</td>}
                  {data.canAttribution && (
                    <td className="num right">
                      <Badge tone={qr.rate > 10 ? "success" : "brand"}>{fmtPct(qr.rate, 1)}</Badge>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Recent scans table */}
      <Card className="mt-6">
        <CardHead title={t("Recent scans")} subtitle={t("Latest individual scan events")}
          actions={
            <Button size="sm" variant="ghost" icon="download" onClick={exportScans} disabled={exporting}>
              {exporting ? t("Exporting...") : t("Export")}
            </Button>
          }
        />
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("QR Code")}</th>
                <th>{t("Location")}</th>
                <th>{t("Device")}</th>
                <th>{t("Time")}</th>
                {data.canAttribution && <th>{t("Converted")}</th>}
              </tr>
            </thead>
            <tbody>
              {data.recentScans.length === 0 ? (
                <tr><td colSpan={data.canAttribution ? 5 : 4} style={{ textAlign: "center", padding: "24px", color: "var(--fg-muted)" }}>{t("No scans yet.")}</td></tr>
              ) : data.recentScans.map(s => {
                const meta = DEVICE_LABEL[s.device];
                return (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 500, color: "var(--fg-strong)" }}>
                      {s.qrName}
                      {s.ref && <span className="text-xs muted" style={{ marginLeft: 6, fontFamily: "var(--ff-mono)" }}>{t("ref {ref}", { ref: s.ref })}</span>}
                    </td>
                    <td style={{ color: "var(--fg-muted)" }}>
                      {s.country ? `${countryFlag(s.country)} ${regionName(s.country)}` : "—"}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon name={meta.icon} size={12} style={{ color: "var(--fg-muted)" }} />
                        <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>{t(meta.name)}</span>
                      </div>
                    </td>
                    <td style={{ fontFamily: "var(--ff-mono)", fontSize: 12, color: "var(--fg-muted)" }}>
                      {fmtRel(s.createdAt)}
                    </td>
                    {data.canAttribution && <td><Badge tone={s.converted ? "success" : "neutral"} dot>{s.converted ? t("Yes") : t("No")}</Badge></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
