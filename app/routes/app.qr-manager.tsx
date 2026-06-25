import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useMemo, useState } from "react";
import { useLoaderData, useFetcher, useNavigate, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../lib/shop.server";
import { listQrCodes, setActive, deleteQr, duplicateQr, archiveQr } from "../lib/qr-crud.server";
import { QuotaExceededError } from "../lib/plan.server";
import { QR_TYPE_TO_UI } from "../lib/qr-types";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { StatCard } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { Segmented } from "../components/ui/Segmented";
import { useToast } from "../components/ui/Toast";
import { downloadQrAsset, type DownloadFormat } from "../lib/qr-download";
import type { QrType } from "@prisma/client";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const items = await listQrCodes(shop.id, {
    query:  url.searchParams.get("q")      ?? undefined,
    type:   (url.searchParams.get("type")   as QrType | "all" | null) ?? "all",
    status: (url.searchParams.get("status") as "all" | "active" | "inactive" | null) ?? "all",
    sort:   (url.searchParams.get("sort")   as "recent" | "scans" | "conv" | "name" | null) ?? "recent",
  });

  // Surface the public scan URL origin so the client can copy it without window hacks.
  const origin = (process.env.SHOPIFY_APP_URL ?? url.origin).replace(/\/$/, "");

  return { items, origin };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  if (!id && intent !== "export") return { ok: false, error: "missing-id" } as const;

  try {
    switch (intent) {
      case "toggle": {
        const active = form.get("active") === "1";
        await setActive(shop.id, id, active);
        return { ok: true, intent, id } as const;
      }
      case "delete": {
        await deleteQr(shop.id, id);
        return { ok: true, intent, id } as const;
      }
      case "archive": {
        await archiveQr(shop.id, id);
        return { ok: true, intent, id } as const;
      }
      case "duplicate": {
        const dup = await duplicateQr(shop, id);
        return { ok: true, intent, id: dup.id } as const;
      }
      default:
        return { ok: false, error: "unknown-intent" } as const;
    }
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return { ok: false, error: "quota", message: err.message } as const;
    }
    return { ok: false, error: "server", message: err instanceof Error ? err.message : "Server error" } as const;
  }
};

/* ── UI helpers ── */
const QR_TYPES = [
  { id: "home",    name: "Homepage",     icon: "home" },
  { id: "product", name: "Product page", icon: "package" },
  { id: "link",    name: "Link",         icon: "link" },
  { id: "atc",     name: "Add to cart",  icon: "shopping-cart" },
  { id: "promo",   name: "Promo code",   icon: "tag" },
  { id: "url",     name: "Custom URL",   icon: "globe" },
  { id: "text",    name: "Text",         icon: "type" },
  { id: "phone",   name: "Phone",        icon: "phone" },
  { id: "sms",     name: "SMS",          icon: "message-square" },
  { id: "email",   name: "Email",        icon: "mail" },
  { id: "wifi",    name: "WiFi",         icon: "wifi" },
  { id: "vcard",   name: "vCard",        icon: "id-card" },
];

function typeMeta(id: string) { return QR_TYPES.find(t => t.id === id) ?? { name: id, icon: "link" }; }
function fmt(n: number) {
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toLocaleString("en-US");
}
function fmtPct(n: number, digits = 1) { return n.toFixed(digits) + "%"; }
function fmtRel(date: Date | string) {
  const ts = new Date(date).getTime();
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
function fmtDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ════════════════════════ Page ════════════════════════ */
export default function QrManager() {
  const navigate = useNavigate();
  const toast    = useToast();
  const { items, origin } = useLoaderData<typeof loader>();
  const fetcher  = useFetcher<typeof action>();

  const [query,        setQuery]        = useState("");
  const [typeFilter,   setTypeFilter]   = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy,       setSortBy]       = useState("recent");
  const [downloading,   setDownloading]  = useState<string | null>(null);

  const totalScans  = items.reduce((s, q) => s + q.scans, 0);
  const totalConv   = items.reduce((s, q) => s + q.conversions, 0);
  const activeCount = items.filter(q => q.active).length;
  const activePct   = items.length ? (activeCount / items.length) * 100 : 0;

  const filtered = items.filter(q => {
    if (query && !q.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (typeFilter !== "all" && QR_TYPE_TO_UI[q.type] !== typeFilter) return false;
    if (statusFilter === "active"   && !q.active) return false;
    if (statusFilter === "inactive" &&  q.active) return false;
    return true;
  });

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if      (sortBy === "scans") arr.sort((a, b) => b.scans - a.scans);
    else if (sortBy === "conv")  arr.sort((a, b) => b.conversions - a.conversions);
    else if (sortBy === "name")  arr.sort((a, b) => a.name.localeCompare(b.name));
    else                         arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return arr;
  }, [filtered, sortBy]);

  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (query ? 1 : 0);

  const clearAll = () => { setQuery(""); setTypeFilter("all"); setStatusFilter("all"); };

  const submitIntent = (intent: string, id: string, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("id", id);
    Object.entries(extra).forEach(([k, v]) => fd.set(k, v));
    fetcher.submit(fd, { method: "post" });
  };

  const downloadQr = async (qr: (typeof items)[number], format: DownloadFormat) => {
    const key = `${qr.id}:${format}`;
    setDownloading(key);
    try {
      await downloadQrAsset(qr, format);
      toast({ title: `${format.toUpperCase()} downloaded`, type: "info" });
    } catch (err) {
      toast({ type: "error", title: "Download failed", desc: err instanceof Error ? err.message : "Try again." });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="qr-code" size={11} /> {items.length} codes</div>
          <h1 className="page-h1">My <span className="em">QR codes</span></h1>
          <div className="page-sub">Browse, edit and download every code your team has shipped.</div>
        </div>
        <div className="page-head-actions">
          <a href="/qr/export.csv" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            <Button variant="secondary" icon="download">Export CSV</Button>
          </a>
          <Button variant="primary" icon="plus" onClick={() => navigate("/app/create")}>New QR code</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-4 mb-6">
        <StatCard accent="blue"   label="Total QR codes" value={items.length}         icon="qr-code"      sub={`${activeCount} active`} />
        <StatCard accent="violet" label="Total scans"    value={fmt(totalScans)}      icon="scan" />
        <StatCard accent="green"  label="Active rate"    value={fmtPct(activePct, 0)} icon="circle-check" sub={`${activeCount} / ${items.length}`} />
        <StatCard accent="amber"  label="Conversions"    value={fmt(totalConv)}       icon="zap" />
      </div>

      {/* ── Filterbar ── */}
      <div className="filterbar">
        <div className="filterbar-search">
          <Icon name="search" size={15} />
          <input type="text" placeholder="Search QR codes by name…" value={query} onChange={e => setQuery(e.target.value)} />
          {query && (
            <button className="modal-close" style={{ width: 22, height: 22 }} onClick={() => setQuery("")} aria-label="Clear search">
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        <div className="filterbar-divider" />
        <div className="filterbar-group">
          <span className="filter-select-label">Type</span>
          <select className="filter-select" data-active={typeFilter !== "all"} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {QR_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="filterbar-divider" />
        <div className="filterbar-group">
          <span className="filter-select-label">Status</span>
          <Segmented value={statusFilter} onChange={setStatusFilter}
            options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "inactive", label: "Paused" }]} />
        </div>
        <div className="filterbar-divider" />
        <div className="filterbar-group">
          <span className="filter-select-label">Sort</span>
          <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="recent">Most recent</option>
            <option value="scans">Most scans</option>
            <option value="conv">Most conversions</option>
            <option value="name">Name (A→Z)</option>
          </select>
        </div>
      </div>

      <div className="filter-chips">
        {query && (
          <span className="filter-chip">
            <span className="filter-chip-label">Search</span>
            <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>&quot;{query}&quot;</span>
            <button className="filter-chip-x" onClick={() => setQuery("")} aria-label="Clear search"><Icon name="x" size={10} /></button>
          </span>
        )}
        {typeFilter !== "all" && (
          <span className="filter-chip">
            <span className="filter-chip-label">Type</span>
            {typeMeta(typeFilter).name}
            <button className="filter-chip-x" onClick={() => setTypeFilter("all")} aria-label="Clear type"><Icon name="x" size={10} /></button>
          </span>
        )}
        {statusFilter !== "all" && (
          <span className="filter-chip">
            <span className="filter-chip-label">Status</span>
            {statusFilter === "active" ? "Active" : "Paused"}
            <button className="filter-chip-x" onClick={() => setStatusFilter("all")} aria-label="Clear status"><Icon name="x" size={10} /></button>
          </span>
        )}
        {activeFilterCount > 1 && (<button className="filter-clear" onClick={clearAll}>Clear all</button>)}
        <span className="filter-count">
          <b>{sorted.length}</b> of {items.length} {items.length === 1 ? "code" : "codes"}
        </span>
      </div>

      {/* ── QR grid ── */}
      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon="qr-code"
            title="No QR codes yet"
            desc="Create your first QR code to start tracking scans and conversions."
            cta={<Link to="/app/create"><Button variant="primary" icon="plus">Create QR code</Button></Link>}
          />
        </Card>
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon="qr-code"
            title="No QR codes match those filters"
            desc="Try clearing your search or status filter."
            cta={<Button variant="secondary" onClick={clearAll}>Clear filters</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-3" style={{ gap: 16 }}>
          {sorted.map(qr => {
            const tm = typeMeta(QR_TYPE_TO_UI[qr.type] ?? "link");
            const scanLink = `${origin}/s/${qr.slug}`;
            return (
              <Card key={qr.id} hoverLift className="card-pad">
                <div className="flex items-center gap-3 mb-3" style={{ justifyContent: "space-between" }}>
                  <Badge tone="brand">
                    <Icon name={tm.icon} size={11} />
                    {tm.name}
                  </Badge>
                  <Badge tone={qr.active ? "success" : "neutral"} dot>
                    {qr.active ? "Active" : "Paused"}
                  </Badge>
                </div>

                <div style={{
                  background: "#fff", borderRadius: 10, border: "1px solid var(--border)",
                  padding: 14, aspectRatio: "1", display: "grid", placeItems: "center",
                  marginBottom: 14, maxWidth: 220, width: "100%", marginInline: "auto",
                }}>
                  <img
                    src={`/qr/${qr.id}/svg?size=300`}
                    alt={qr.name}
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    onError={(e) => {
                      // Fallback to static thumb if the server is still warming.
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>

                <div className="strong" style={{ fontSize: 13.5, marginBottom: 4 }}>{qr.name}</div>
                <div className="text-xs muted mb-3">Created {fmtRel(qr.createdAt)}</div>
                {(qr.activatesAt || qr.expiresAt) && (
                  <div className="text-xs muted mb-3" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon name="calendar" size={12} />
                    <span>
                      {qr.activatesAt ? fmtDate(qr.activatesAt) : "Now"} - {qr.expiresAt ? fmtDate(qr.expiresAt) : "No end"}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-3" style={{ paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
                  <div style={{ flex: 1 }}>
                    <div className="text-xs muted" style={{ fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10 }}>Scans</div>
                    <div className="strong num" style={{ fontSize: 16, fontFamily: "var(--ff-display)" }}>{fmt(qr.scans)}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="text-xs muted" style={{ fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10 }}>Conv.</div>
                    <div className="strong num" style={{ fontSize: 16, fontFamily: "var(--ff-display)" }}>{fmt(qr.conversions)}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost"
                      title="Edit QR code"
                      onClick={() => navigate(`/app/create?edit=${qr.id}`)}>
                      <Icon name="edit" size={13} />
                    </Button>
                    <Button size="sm" variant="ghost"
                      title="Copy scan link"
                      onClick={() => {
                        navigator.clipboard?.writeText(scanLink);
                        toast({ title: "Link copied", type: "info" });
                      }}>
                      <Icon name="copy" size={13} />
                    </Button>
                    <Button size="sm" variant="ghost"
                      title={qr.active ? "Deactivate QR code" : "Activate QR code"}
                      onClick={() => submitIntent("toggle", qr.id, { active: qr.active ? "0" : "1" })}>
                      <Icon name={qr.active ? "pause" : "play"} size={13} />
                    </Button>
                    <Button size="sm" variant="ghost"
                      title="Duplicate QR code"
                      onClick={() => submitIntent("duplicate", qr.id)}>
                      <Icon name="layers" size={13} />
                    </Button>
                    <details style={{ position: "relative" }}>
                      <summary
                        title="Download QR code"
                        style={{
                          listStyle: "none",
                          width: 30,
                          height: 30,
                          display: "grid",
                          placeItems: "center",
                          borderRadius: 8,
                          cursor: "pointer",
                          color: "var(--fg-muted)",
                        }}
                      >
                        <Icon name="download" size={13} />
                      </summary>
                      <div style={{
                        position: "absolute",
                        right: 0,
                        bottom: 36,
                        minWidth: 112,
                        padding: 6,
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        boxShadow: "0 18px 40px rgba(15, 23, 42, .18)",
                        zIndex: 20,
                      }}>
                        {(["png", "svg", "pdf"] as DownloadFormat[]).map(format => (
                          <button
                            key={format}
                            type="button"
                            disabled={downloading === `${qr.id}:${format}`}
                            onClick={() => downloadQr(qr, format)}
                            style={{
                              width: "100%",
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "8px 10px",
                              border: 0,
                              borderRadius: 6,
                              background: "transparent",
                              color: "var(--fg-strong)",
                              cursor: "pointer",
                              fontSize: 12,
                              textAlign: "left",
                            }}
                          >
                            <Icon name="download" size={12} />
                            {format.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </details>
                    <Button size="sm" variant="ghost"
                      title="Delete QR code"
                      onClick={() => {
                        if (!confirm(`Delete "${qr.name}"? This also removes its scans.`)) return;
                        submitIntent("delete", qr.id);
                      }}>
                      <Icon name="trash" size={13} />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
