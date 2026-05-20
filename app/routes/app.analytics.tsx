import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../lib/shop.server";
import {
  getKpis, getDailySeries, getDeviceBreakdown, getCountryBreakdown,
  getTopQrCodes, getRecentScans, type PeriodKey,
} from "../lib/analytics.server";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card, CardHead } from "../components/ui/Card";
import { StatCard } from "../components/ui/StatCard";
import { Select } from "../components/ui/Input";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const period = (url.searchParams.get("period") as PeriodKey) || "14d";

  const [kpis, series, devices, countries, topQr, recentScans] = await Promise.all([
    getKpis(shop.id, period),
    getDailySeries(shop.id, period),
    getDeviceBreakdown(shop.id, period),
    getCountryBreakdown(shop.id, period),
    getTopQrCodes(shop.id, period, 5),
    getRecentScans(shop.id, 10),
  ]);

  return { period, kpis, series, devices, countries, topQr, recentScans };
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
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function fmtRel(d: Date | string) {
  const ts = new Date(d).getTime();
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1)  return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

const DEVICE_LABEL: Record<string, { name: string; icon: string }> = {
  MOBILE:  { name: "Mobile",  icon: "smartphone" },
  DESKTOP: { name: "Desktop", icon: "monitor" },
  TABLET:  { name: "Tablet",  icon: "tablet" },
  UNKNOWN: { name: "Unknown", icon: "help-circle" },
};

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return "🌐";
  // 0x1F1E6 = Regional Indicator A
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

export default function Analytics() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [series, setSeries] = useState<"scans" | "conv">("scans");

  const scanData = data.series.map(s => s.scans);
  const convData = data.series.map(s => s.conversions);

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="bar-chart" size={11} /> Analytics</div>
          <h1 className="page-h1"><span className="em">Scan</span> analytics</h1>
          <div className="page-sub">Scans by day, device, geography and conversion funnel — all in one view.</div>
        </div>
        <div className="page-head-actions">
          <Select
            value={data.period}
            onChange={e => setSearchParams(prev => { prev.set("period", e.target.value); return prev; })}
            style={{ height: 34, width: 130 }}>
            <option value="7d">Last 7 days</option>
            <option value="14d">Last 14 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </Select>
          <a href={`/qr/scans.csv?period=${data.period}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            <Button variant="secondary" icon="download">Export</Button>
          </a>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-4">
        <StatCard accent="blue"   label="Total scans"     value={fmtNum(data.kpis.totalScans)}        icon="scan"        sparklineData={scanData} sub={`${data.series.length}-day window`} />
        <StatCard accent="green"  label="Conversions"     value={fmtNum(data.kpis.totalConversions)} icon="trending-up" sparklineData={convData} />
        <StatCard accent="violet" label="Conv. rate"      value={data.kpis.convRate.toFixed(2) + "%"} icon="zap" />
        <StatCard accent="amber"  label="Unique visitors" value={fmtNum(data.kpis.uniqueVisitors)}    icon="users"       sub="by session token" />
      </div>

      {/* Charts */}
      <div className="grid grid-23 mt-6">
        <Card accent="blue">
          <CardHead
            title={series === "scans" ? "Scans over time" : "Conversions over time"}
            subtitle="Daily volume"
            actions={
              <div className="segmented">
                <button className={series === "scans" ? "active" : ""} onClick={() => setSeries("scans")}>Scans</button>
                <button className={series === "conv"  ? "active" : ""} onClick={() => setSeries("conv")}>Conv.</button>
              </div>
            }
          />
          <div style={{ padding: "16px 18px 14px" }}>
            <AreaChart data={series === "scans" ? scanData : convData} height={180} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, padding: "0 2px" }}>
              {data.series.filter((_, i) => i % Math.max(1, Math.floor(data.series.length / 4)) === 0).map(s => (
                <span key={s.date} style={{ fontSize: 10, color: "var(--fg-subtle)", fontFamily: "var(--ff-mono)" }}>{s.date.slice(5)}</span>
              ))}
            </div>
          </div>
        </Card>

        <Card accent="violet">
          <CardHead title="By device" />
          <div style={{ padding: "14px 18px" }}>
            {data.devices.length === 0 ? (
              <div className="text-sm muted" style={{ textAlign: "center", padding: "24px 0" }}>No scans yet.</div>
            ) : data.devices.map(d => {
              const meta = DEVICE_LABEL[d.device];
              return (
                <div key={d.device} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Icon name={meta.icon} size={14} style={{ color: "var(--fg-muted)" }} />
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg-strong)" }}>{meta.name}</span>
                    </div>
                    <span style={{ fontSize: 12, fontFamily: "var(--ff-mono)", color: "var(--fg-muted)" }}>{fmtNum(d.scans)}</span>
                  </div>
                  <div className="progress-bar"><div className="progress-fill" style={{ width: `${d.pct}%` }} /></div>
                  <div style={{ fontSize: 11, color: "var(--fg-subtle)", marginTop: 4, fontFamily: "var(--ff-mono)" }}>{d.pct.toFixed(0)}%</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Geo + Top QR */}
      <div className="grid grid-2 mt-6">
        <Card>
          <CardHead title="Top countries" subtitle="By scan volume" />
          <div style={{ padding: "6px 18px 14px" }}>
            {data.countries.length === 0 ? (
              <div className="text-sm muted" style={{ textAlign: "center", padding: "24px 0" }}>No geo data yet — requires Cloudflare CF-IPCountry header in production.</div>
            ) : data.countries.map(g => (
              <div key={g.country} className="progress-row">
                <span className="progress-flag">{countryFlag(g.country)}</span>
                <span className="progress-name">{g.country}</span>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${g.pct}%` }} />
                </div>
                <span className="progress-val">{fmtNum(g.scans)}</span>
                <span className="progress-pct">{g.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead title="Top QR codes" subtitle="By scan volume" />
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="right">Scans</th>
                <th className="right">Conv.</th>
                <th className="right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.topQr.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: "center", padding: "20px", color: "var(--fg-muted)" }}>No QR codes yet</td></tr>
              ) : data.topQr.map(qr => (
                <tr key={qr.id}>
                  <td style={{ fontWeight: 500, color: "var(--fg-strong)" }}>{qr.name}</td>
                  <td className="num right">{fmtNum(qr.scans)}</td>
                  <td className="num right">{fmtNum(qr.conversions)}</td>
                  <td className="num right">
                    <Badge tone={qr.rate > 10 ? "success" : "brand"}>{qr.rate.toFixed(1)}%</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Recent scans table */}
      <Card className="mt-6">
        <CardHead title="Recent scans" subtitle="Latest individual scan events"
          actions={
            <a href={`/qr/scans.csv?period=${data.period}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
              <Button size="sm" variant="ghost" icon="download">Export</Button>
            </a>
          }
        />
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>QR Code</th>
                <th>Location</th>
                <th>Device</th>
                <th>Time</th>
                <th>Converted</th>
              </tr>
            </thead>
            <tbody>
              {data.recentScans.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: "24px", color: "var(--fg-muted)" }}>No scans yet.</td></tr>
              ) : data.recentScans.map(s => {
                const meta = DEVICE_LABEL[s.device];
                return (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 500, color: "var(--fg-strong)" }}>{s.qrName}</td>
                    <td style={{ color: "var(--fg-muted)" }}>
                      {s.country ? `${countryFlag(s.country)} ${s.country}` : "—"}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon name={meta.icon} size={12} style={{ color: "var(--fg-muted)" }} />
                        <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>{meta.name}</span>
                      </div>
                    </td>
                    <td style={{ fontFamily: "var(--ff-mono)", fontSize: 12, color: "var(--fg-muted)" }}>
                      {fmtRel(s.createdAt)}
                    </td>
                    <td><Badge tone={s.converted ? "success" : "neutral"} dot>{s.converted ? "Yes" : "No"}</Badge></td>
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
