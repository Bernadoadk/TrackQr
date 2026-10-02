import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { useLoaderData, useFetcher, useNavigate, Link, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../lib/shop.server";
import { listQrCodes, setActive, deleteQr, duplicateQr, archiveQr, bulkQrAction, type BulkQrAction } from "../lib/qr-crud.server";
import { getPlanEntitlements, getQuotaState, QuotaExceededError } from "../lib/plan.server";
import { featureMinPlanLabel } from "../lib/plan.constants";
import { QR_TYPE_FROM_UI, QR_TYPE_TO_UI } from "../lib/qr-types";
import { scanBaseUrl } from "../lib/qr.server";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { StatCard } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { Segmented } from "../components/ui/Segmented";
import { useToast } from "../components/ui/Toast";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Modal } from "../components/ui/Modal";
import { FeatureLock } from "../components/ui/FeatureLock";
import { downloadQrAsset, downloadQrZip, type DownloadFormat } from "../lib/qr-download";
import { downloadPrintSheet, type PaperSize } from "../lib/print-sheet.client";
import { downloadFile } from "../lib/download.client";
import { formatMoney } from "../lib/format";
import type { QrType } from "@prisma/client";
import { formatDate, formatNumber, t, tem, tm, tp, tx } from "../lib/i18n";

function coerceQrTypeFilter(value: string | null): QrType | "all" {
  if (!value || value === "all") return "all";
  const normalized = value.toLowerCase();
  return QR_TYPE_FROM_UI[normalized] ?? "all";
}

function coerceUiTypeFilter(value: string | null): string {
  if (!value || value === "all") return "all";
  const normalized = value.toLowerCase();
  return QR_TYPE_FROM_UI[normalized] ? normalized : "all";
}

function coerceStatusFilter(value: string | null): "all" | "active" | "inactive" {
  return value === "active" || value === "inactive" ? value : "all";
}

function coerceSort(value: string | null): "recent" | "scans" | "conv" | "name" {
  return value === "scans" || value === "conv" || value === "name" ? value : "recent";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const entitlements = await getPlanEntitlements(shop);
  const items = await listQrCodes(shop.id, {
    query:  url.searchParams.get("q")      ?? undefined,
    type:   coerceQrTypeFilter(url.searchParams.get("type")),
    status: coerceStatusFilter(url.searchParams.get("status")),
    sort:   coerceSort(url.searchParams.get("sort")),
  }, {
    earliestScanDate: entitlements.earliestScanDate,
    attribution: entitlements.attribution,
  });

  // Public scan URL origin (stable scan domain when configured).
  const origin = scanBaseUrl() || url.origin;
  const quota = await getQuotaState(shop.id, "qrCodes", entitlements.qrCodeLimit);

  return {
    items,
    origin,
    shopDomain: shop.domain,
    currency: shop.currency,
    canAttribution: entitlements.attribution,
    canExport: entitlements.exports,
    canOrderTracking: entitlements.orderTracking,
    canBulkCreate: entitlements.bulkCreate,
    historyDays: entitlements.historyDays,
    planName: entitlements.planName,
    qrLimit: entitlements.qrCodeLimit,
    overQuotaIds: quota.overQuotaIds,
  };
};

const BULK_ACTIONS: BulkQrAction[] = ["activate", "pause", "archive", "delete"];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "bulk") {
      const bulkAction = String(form.get("bulkAction") ?? "") as BulkQrAction;
      const ids = String(form.get("ids") ?? "").split(",").filter(Boolean);
      if (!BULK_ACTIONS.includes(bulkAction) || !ids.length) return { ok: false, error: "invalid", message: "Nothing to update." } as const;
      const result = await bulkQrAction(shop, ids, bulkAction);
      return { ok: true, intent, bulkAction, ...result } as const;
    }

    const id = String(form.get("id") ?? "");
    if (!id) return { ok: false, error: "missing-id", message: "Missing QR code." } as const;
    switch (intent) {
      case "toggle": {
        const active = form.get("active") === "1";
        await setActive(shop, id, active);
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
        return { ok: false, error: "unknown-intent", message: "Unknown action." } as const;
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
  { id: "home",       name: "Homepage",     icon: "home" },
  { id: "product",    name: "Product page", icon: "package" },
  { id: "collection", name: "Collection",   icon: "grid" },
  { id: "page",       name: "Store page",   icon: "layout" },
  { id: "link",       name: "Link",         icon: "link" },
  { id: "atc",        name: "Add to cart",  icon: "shopping-cart" },
  { id: "promo",      name: "Promo code",   icon: "tag" },
  { id: "url",        name: "Custom URL",   icon: "globe" },
  { id: "text",       name: "Text",         icon: "type" },
  { id: "phone",      name: "Phone",        icon: "phone" },
  { id: "sms",        name: "SMS",          icon: "message-square" },
  { id: "email",      name: "Email",        icon: "mail" },
  { id: "wifi",       name: "WiFi",         icon: "wifi" },
  { id: "vcard",      name: "vCard",        icon: "id-card" },
];

function typeMeta(id: string) { return QR_TYPES.find(item => item.id === id) ?? { name: id, icon: "link" }; }
function fmt(n: number) {
  if (n >= 10000) return formatNumber(n / 1000, { maximumFractionDigits: 1 }) + "k";
  return formatNumber(n);
}
function fmtPct(n: number, digits = 1) {
  return formatNumber(n / 100, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtRel(date: Date | string) {
  const ts = new Date(date).getTime();
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("just now");
  if (min < 60) return t("{n}m ago", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("{n}h ago", { n: hr });
  return t("{n}d ago", { n: Math.floor(hr / 24) });
}
function fmtDate(date: Date | string) {
  return formatDate(date);
}
function embeddedResourceHref(path: string, searchParams: URLSearchParams, fallbackShop?: string, params: Record<string, string> = {}) {
  const next = new URLSearchParams();
  const shop = searchParams.get("shop") || fallbackShop;
  const host = searchParams.get("host");
  if (shop) next.set("shop", shop);
  if (host) next.set("host", host);
  Object.entries(params).forEach(([key, value]) => {
    if (value) next.set(key, value);
  });
  const query = next.toString();
  return query ? `${path}?${query}` : path;
}

type Item = ReturnType<typeof useLoaderData<typeof loader>>["items"][number];

function bulkDoneLabel(action: BulkQrAction, count: number) {
  switch (action) {
    case "activate": return tp(count, "{count} QR code activated", "{count} QR codes activated");
    case "pause": return tp(count, "{count} QR code paused", "{count} QR codes paused");
    case "archive": return tp(count, "{count} QR code archived", "{count} QR codes archived");
    case "delete": return tp(count, "{count} QR code deleted", "{count} QR codes deleted");
  }
}

/* ════════════════════════ Page ════════════════════════ */
export default function QrManager() {
  const navigate = useNavigate();
  const toast    = useToast();
  const {
    items, origin, shopDomain, currency, canAttribution, canExport, canOrderTracking, canBulkCreate,
    historyDays, planName, qrLimit, overQuotaIds,
  } = useLoaderData<typeof loader>();
  const fetcher  = useFetcher<typeof action>();
  const [searchParams] = useSearchParams();
  const overQuota = useMemo(() => new Set(overQuotaIds), [overQuotaIds]);
  const exportPlan = featureMinPlanLabel("exports");

  const [query,        setQuery]        = useState(searchParams.get("q") ?? "");
  const [typeFilter,   setTypeFilter]   = useState(coerceUiTypeFilter(searchParams.get("type")));
  const [statusFilter, setStatusFilter] = useState(coerceStatusFilter(searchParams.get("status")));
  const [sortBy,       setSortBy]       = useState(coerceSort(searchParams.get("sort")));
  const [downloading,   setDownloading]  = useState<string | null>(null);
  const [exporting,     setExporting]    = useState(false);
  const [qrToDelete,    setQrToDelete]   = useState<Item | null>(null);
  const [selected,      setSelected]     = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkProgress,  setBulkProgress] = useState<string | null>(null);
  const [printOpen,     setPrintOpen]    = useState(false);
  const [embedQr,       setEmbedQr]      = useState<Item | null>(null);

  // Server feedback: failures and bulk results.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const data = fetcher.data;
    if (!data.ok) {
      toast({
        type: "error",
        title: data.error === "quota" ? t("Plan limit reached") : t("Action failed"),
        desc: "message" in data ? tm(data.message) : t("Try again."),
      });
      return;
    }
    if (data.intent === "bulk") {
      toast({
        title: bulkDoneLabel(data.bulkAction, data.changed),
        desc: data.refused ? t("{refused} could not be activated — they are beyond your {planName} plan limit.", { refused: data.refused, planName }) : undefined,
        type: data.refused ? "warning" : "success",
      });
      setSelected(new Set());
    }
  }, [fetcher.state, fetcher.data]);

  // Drop selections that disappeared (deleted / archived / filtered out server-side).
  useEffect(() => {
    setSelected(prev => {
      const ids = new Set(items.map(i => i.id));
      const next = new Set([...prev].filter(id => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const totalScans   = items.reduce((s, q) => s + q.scans, 0);
  const totalConv    = items.reduce((s, q) => s + q.conversions, 0);
  const totalRevenue = items.reduce((s, q) => s + q.revenue, 0);
  const totalMissed  = items.reduce((s, q) => s + q.missed, 0);
  const activeCount  = items.filter(q => q.active).length;
  const activePct    = items.length ? (activeCount / items.length) * 100 : 0;

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
    else if (sortBy === "conv" && canAttribution) arr.sort((a, b) => b.revenue - a.revenue || b.conversions - a.conversions);
    else if (sortBy === "name")  arr.sort((a, b) => a.name.localeCompare(b.name));
    else                         arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return arr;
  }, [filtered, sortBy, canAttribution]);

  const selectedItems = sorted.filter(q => selected.has(q.id));
  const allVisibleSelected = sorted.length > 0 && sorted.every(q => selected.has(q.id));

  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (query ? 1 : 0);
  const exportHref = embeddedResourceHref("/qr/export.csv", searchParams, shopDomain, {
    q: query.trim(),
    type: typeFilter !== "all" ? typeFilter : "",
    status: statusFilter !== "all" ? statusFilter : "",
    sort: sortBy !== "recent" ? sortBy : "",
  });

  const clearAll = () => { setQuery(""); setTypeFilter("all"); setStatusFilter("all"); };

  const submitIntent = (intent: string, id: string, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("id", id);
    Object.entries(extra).forEach(([k, v]) => fd.set(k, v));
    fetcher.submit(fd, { method: "post" });
  };

  const submitBulk = (bulkAction: BulkQrAction) => {
    const fd = new FormData();
    fd.set("intent", "bulk");
    fd.set("bulkAction", bulkAction);
    fd.set("ids", selectedItems.map(q => q.id).join(","));
    fetcher.submit(fd, { method: "post" });
  };

  const toggleSelected = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const downloadQr = async (qr: Item, format: DownloadFormat) => {
    const key = `${qr.id}:${format}`;
    setDownloading(key);
    try {
      await downloadQrAsset(qr, format);
      toast({ title: t("{format} downloaded", { format: format.toUpperCase() }), type: "info" });
    } catch (err) {
      toast({ type: "error", title: t("Download failed"), desc: err instanceof Error ? tm(err.message) : t("Try again.") });
    } finally {
      setDownloading(null);
    }
  };

  const downloadSelectionZip = async (format: "png" | "svg") => {
    if (!canExport) {
      toast({ type: "info", title: t("ZIP downloads are locked"), desc: t("Upgrade to {exportPlan} to download several QR codes at once.", { exportPlan }) });
      return;
    }
    const list = selectedItems;
    setBulkProgress(`0 / ${list.length}`);
    try {
      await downloadQrZip(list, format, done => setBulkProgress(`${done} / ${list.length}`));
      toast({ title: t("ZIP downloaded"), desc: tp(list.length, "{count} QR code", "{count} QR codes"), type: "info" });
    } catch (err) {
      toast({ type: "error", title: t("ZIP failed"), desc: err instanceof Error ? tm(err.message) : t("Try again.") });
    } finally {
      setBulkProgress(null);
    }
  };

  const exportCodes = async () => {
    if (!canExport) {
      toast({ type: "info", title: t("CSV export is locked"), desc: t("Upgrade to {exportPlan} to export your QR codes.", { exportPlan }) });
      return;
    }
    setExporting(true);
    try {
      await downloadFile(exportHref, "trackqr-codes.csv");
      toast({ title: t("Export downloaded"), type: "info" });
    } catch (err) {
      toast({ type: "error", title: t("Export failed"), desc: err instanceof Error ? tm(err.message) : t("Try again.") });
    } finally {
      setExporting(false);
    }
  };

  const downloadFormats: DownloadFormat[] = canExport ? ["png", "svg", "pdf"] : ["png"];
  const busy = fetcher.state !== "idle";

  return (
    <>
      <ConfirmDialog
        open={!!qrToDelete}
        title={t("Delete this QR code?")}
        description={qrToDelete ? t("\"{name}\" and its scan history will be deleted permanently. Printed copies will send visitors to your store home page. Archive it instead to keep the history.", { name: qrToDelete.name }) : ""}
        confirmLabel={t("Delete")}
        cancelLabel={t("Cancel")}
        tone="danger"
        loading={busy}
        onClose={() => setQrToDelete(null)}
        onConfirm={() => {
          if (!qrToDelete) return;
          submitIntent("delete", qrToDelete.id);
          setQrToDelete(null);
        }}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        title={tp(selectedItems.length, "Delete {count} QR code?", "Delete {count} QR codes?")}
        description={t("They will be deleted permanently with their scan history. Archive them instead to keep the history.")}
        confirmLabel={t("Delete")}
        cancelLabel={t("Cancel")}
        tone="danger"
        loading={busy}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={() => {
          submitBulk("delete");
          setBulkDeleteOpen(false);
        }}
      />

      <PrintSheetModal
        open={printOpen}
        count={selectedItems.length}
        onClose={() => setPrintOpen(false)}
        onGenerate={async opts => {
          const list = selectedItems;
          setBulkProgress(`0 / ${list.length}`);
          try {
            await downloadPrintSheet(list, opts, done => setBulkProgress(`${done} / ${list.length}`));
            toast({ title: t("Print sheet downloaded"), type: "info" });
            setPrintOpen(false);
          } catch (err) {
            toast({ type: "error", title: t("Print sheet failed"), desc: err instanceof Error ? tm(err.message) : t("Try again.") });
          } finally {
            setBulkProgress(null);
          }
        }}
        busy={!!bulkProgress}
      />

      <EmbedModal
        qr={embedQr}
        origin={origin}
        canOrderTracking={canOrderTracking}
        onClose={() => setEmbedQr(null)}
        onCopied={() => toast({ title: t("Snippet copied"), type: "info" })}
      />

      {/* Header */}
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="qr-code" size={11} /> {t("{count} codes · {plan} plan", { count: qrLimit != null ? `${items.length} / ${qrLimit}` : String(items.length), plan: planName })}</div>
          <h1 className="page-h1">{tem("My <em>QR codes</em>")}</h1>
          <div className="page-sub">{historyDays ? t("Browse, edit and download every code your team has shipped. Scan stats show the last {days} days.", { days: historyDays }) : t("Browse, edit and download every code your team has shipped. Scan stats show the full history.")}</div>
        </div>
        <div className="page-head-actions">
          <Button
            variant="secondary"
            icon={canExport ? "download" : "lock"}
            onClick={exportCodes}
            disabled={exporting}
            title={canExport ? t("Export the list as CSV") : t("CSV export requires the {exportPlan} plan", { exportPlan })}
          >
            {exporting ? t("Exporting...") : t("Export CSV")}
          </Button>
          <Button variant="secondary" icon={canBulkCreate ? "layers" : "lock"} onClick={() => navigate("/app/bulk")}>{t("Bulk create")}</Button>
          <Button variant="primary" icon="plus" onClick={() => navigate("/app/create")}>{t("New QR code")}</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-4 mb-6">
        <StatCard accent="blue"   label={t("Total QR codes")} value={items.length}         icon="qr-code"      sub={tp(activeCount, "{count} active")} />
        <StatCard accent="violet" label={t("Total scans")}    value={fmt(totalScans)}      icon="scan"         sub={totalMissed ? t("{count} to fallback", { count: fmt(totalMissed) }) : undefined} />
        <StatCard accent="green"  label={t("Active rate")}    value={fmtPct(activePct, 0)} icon="circle-check" sub={`${activeCount} / ${items.length}`} />
        {canAttribution ? (
          <StatCard accent="amber" label={t("Revenue")} value={formatMoney(totalRevenue, currency)} icon="trending-up" sub={tp(totalConv, "{count} order", "{count} orders", { count: fmt(totalConv) })} />
        ) : (
          <StatCard accent="amber" label={t("Revenue")} value={t("Locked")} icon="lock" sub={t("Growth plan")} />
        )}
      </div>

      {/* ── Filterbar ── */}
      <div className="filterbar">
        <div className="filterbar-search">
          <Icon name="search" size={15} />
          <input type="text" placeholder={t("Search QR codes by name…")} value={query} onChange={e => setQuery(e.target.value)} aria-label={t("Search QR codes")} />
          {query && (
            <button className="modal-close" style={{ width: 22, height: 22 }} onClick={() => setQuery("")} aria-label={t("Clear search")}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        <div className="filterbar-divider" />
        <div className="filterbar-group">
          <span className="filter-select-label">{t("Type")}</span>
          <select className="filter-select" data-active={typeFilter !== "all"} value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label={t("Filter by type")}>
            <option value="all">{t("All types")}</option>
            {QR_TYPES.map(item => <option key={item.id} value={item.id}>{t(item.name)}</option>)}
          </select>
        </div>
        <div className="filterbar-divider" />
        <div className="filterbar-group">
          <span className="filter-select-label">{t("Status")}</span>
          <Segmented value={statusFilter} onChange={v => setStatusFilter(coerceStatusFilter(v))}
            options={[{ value: "all", label: t("All") }, { value: "active", label: t("Active") }, { value: "inactive", label: t("Paused") }]} />
        </div>
        <div className="filterbar-divider" />
        <div className="filterbar-group">
          <span className="filter-select-label">{t("Sort")}</span>
          <select className="filter-select" value={sortBy} onChange={e => setSortBy(coerceSort(e.target.value))} aria-label={t("Sort QR codes")}>
            <option value="recent">{t("Most recent")}</option>
            <option value="scans">{t("Most scans")}</option>
            {canAttribution && <option value="conv">{t("Most revenue")}</option>}
            <option value="name">{t("Name (A→Z)")}</option>
          </select>
        </div>
      </div>

      <div className="filter-chips">
        {sorted.length > 0 && (
          <label className="select-all">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(sorted.map(q => q.id)))}
            />
            {t("Select all")}
          </label>
        )}
        {query && (
          <span className="filter-chip">
            <span className="filter-chip-label">{t("Search")}</span>
            <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>&quot;{query}&quot;</span>
            <button className="filter-chip-x" onClick={() => setQuery("")} aria-label={t("Clear search")}><Icon name="x" size={10} /></button>
          </span>
        )}
        {typeFilter !== "all" && (
          <span className="filter-chip">
            <span className="filter-chip-label">{t("Type")}</span>
            {t(typeMeta(typeFilter).name)}
            <button className="filter-chip-x" onClick={() => setTypeFilter("all")} aria-label={t("Clear type")}><Icon name="x" size={10} /></button>
          </span>
        )}
        {statusFilter !== "all" && (
          <span className="filter-chip">
            <span className="filter-chip-label">{t("Status")}</span>
            {statusFilter === "active" ? t("Active") : t("Paused")}
            <button className="filter-chip-x" onClick={() => setStatusFilter("all")} aria-label={t("Clear status")}><Icon name="x" size={10} /></button>
          </span>
        )}
        {activeFilterCount > 1 && (<button className="filter-clear" onClick={clearAll}>{t("Clear all")}</button>)}
        <span className="filter-count">
          {tx(tp(items.length, "{shown} of {count} code", "{shown} of {count} codes"), { shown: <b>{sorted.length}</b> })}
        </span>
      </div>

      {/* ── Bulk action bar ── */}
      {selectedItems.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label={t("Bulk actions")}>
          <span className="bulk-bar-count"><b>{selectedItems.length}</b> {tp(selectedItems.length, "selected")}</span>
          <div className="bulk-bar-actions">
            <Button size="sm" variant="ghost" icon="play" disabled={busy} onClick={() => submitBulk("activate")}>{t("Activate")}</Button>
            <Button size="sm" variant="ghost" icon="pause" disabled={busy} onClick={() => submitBulk("pause")}>{t("Pause")}</Button>
            <Button size="sm" variant="ghost" icon={canExport ? "download" : "lock"} disabled={!!bulkProgress} onClick={() => downloadSelectionZip("png")}>{t("ZIP · PNG")}</Button>
            {canExport && <Button size="sm" variant="ghost" icon="download" disabled={!!bulkProgress} onClick={() => downloadSelectionZip("svg")}>{t("ZIP · SVG")}</Button>}
            <Button size="sm" variant="ghost" icon={canExport ? "grid" : "lock"} disabled={!!bulkProgress}
              onClick={() => canExport ? setPrintOpen(true) : toast({ type: "info", title: t("Print sheets are locked"), desc: t("Upgrade to {exportPlan} to print sheets of QR codes.", { exportPlan }) })}>
              {t("Print sheet")}
            </Button>
            <Button size="sm" variant="ghost" icon="inbox" disabled={busy} onClick={() => submitBulk("archive")}>{t("Archive")}</Button>
            <Button size="sm" variant="ghost" icon="trash" disabled={busy} onClick={() => setBulkDeleteOpen(true)}>{t("Delete")}</Button>
          </div>
          {bulkProgress && <span className="bulk-bar-progress">{t("Preparing {progress}…", { progress: bulkProgress })}</span>}
          <button type="button" className="bulk-bar-clear" onClick={() => setSelected(new Set())} aria-label={t("Clear selection")}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {/* ── QR grid ── */}
      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon="qr-code"
            title={t("No QR codes yet")}
            desc={t("Create your first QR code to start tracking scans and conversions.")}
            cta={<Link to="/app/create"><Button variant="primary" icon="plus">{t("Create QR code")}</Button></Link>}
          />
        </Card>
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon="qr-code"
            title={t("No QR codes match those filters")}
            desc={t("Try clearing your search or status filter.")}
            cta={<Button variant="secondary" onClick={clearAll}>{t("Clear filters")}</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-3" style={{ gap: 16 }}>
          {sorted.map(qr => {
            const meta = typeMeta(QR_TYPE_TO_UI[qr.type] ?? "link");
            const scanLink = `${origin}/s/${qr.slug}`;
            const isOverQuota = overQuota.has(qr.id);
            const isSelected = selected.has(qr.id);
            return (
              <Card key={qr.id} hoverLift className={`card-pad qr-card ${isSelected ? "selected" : ""}`}>
                <div className="flex items-center gap-3 mb-3" style={{ justifyContent: "space-between" }}>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="qr-card-check"
                      checked={isSelected}
                      onChange={() => toggleSelected(qr.id)}
                      aria-label={t("Select {name}", { name: qr.name })}
                    />
                    <Badge tone="brand">
                      <Icon name={meta.icon} size={11} />
                      {t(meta.name)}
                    </Badge>
                  </div>
                  {isOverQuota ? (
                    <Badge tone="warning" dot>{t("Over plan limit")}</Badge>
                  ) : (
                    <Badge tone={qr.active ? "success" : "neutral"} dot>
                      {qr.active ? t("Active") : t("Paused")}
                    </Badge>
                  )}
                </div>

                <div className="qr-card-thumb-box">
                  <img
                    src={`/qr/${qr.id}/svg?size=300`}
                    alt={qr.name}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    onError={(e) => {
                      // Fallback to static thumb if the server is still warming.
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>

                <div className="strong" style={{ fontSize: 13.5, marginBottom: 4 }}>{qr.name}</div>
                <div className="text-xs muted mb-3" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span>{t("Created {time}", { time: fmtRel(qr.createdAt) })}</span>
                  {qr.hasRouting && <Badge tone="violet">{t("Smart routing")}</Badge>}
                  {qr.discountCode && <Badge tone="neutral"><Icon name="tag" size={10} /> {qr.discountCode}</Badge>}
                </div>
                {(qr.activatesAt || qr.expiresAt) && (
                  <div className="text-xs muted mb-3" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon name="calendar" size={12} />
                    <span>
                      {qr.activatesAt ? fmtDate(qr.activatesAt) : t("Now")} - {qr.expiresAt ? fmtDate(qr.expiresAt) : t("No end")}
                    </span>
                  </div>
                )}
                {qr.missed > 0 && (
                  <div className="qr-card-missed" title={t("Scans sent to the fallback page because this code was paused, scheduled, expired or over your plan limit.")}>
                    <Icon name="alert-triangle" size={12} /> {tp(qr.missed, "{count} scan sent to fallback", "{count} scans sent to fallback", { count: fmt(qr.missed) })}
                  </div>
                )}

                <div className="flex items-center gap-3" style={{ paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
                  <div style={{ flex: 1 }}>
                    <div className="stat-mini-label">{t("Scans")}</div>
                    <div className="strong num stat-mini-value">{fmt(qr.scans)}</div>
                  </div>
                  {canAttribution && (
                    <div style={{ flex: 1 }}>
                      <div className="stat-mini-label">{t("Revenue")}</div>
                      <div className="strong num stat-mini-value" title={tp(qr.conversions, "{count} order", "{count} orders")}>{formatMoney(qr.revenue, currency, true)}</div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost"
                      title={t("Edit QR code")}
                      onClick={() => navigate(`/app/create?edit=${qr.id}`)}>
                      <Icon name="edit" size={13} />
                    </Button>
                    <Button size="sm" variant="ghost"
                      title={t("Copy scan link")}
                      onClick={() => {
                        navigator.clipboard?.writeText(scanLink);
                        toast({ title: t("Link copied"), type: "info" });
                      }}>
                      <Icon name="copy" size={13} />
                    </Button>
                    <Button size="sm" variant="ghost"
                      title={isOverQuota ? t("Beyond your {planName} plan limit — archive older codes or upgrade to reactivate", { planName }) : qr.active ? t("Deactivate QR code") : t("Activate QR code")}
                      disabled={isOverQuota && !qr.active}
                      onClick={() => submitIntent("toggle", qr.id, { active: qr.active ? "0" : "1" })}>
                      <Icon name={qr.active ? "pause" : isOverQuota ? "lock" : "play"} size={13} />
                    </Button>
                    <details className="qr-card-menu">
                      <summary title={t("More actions")} aria-label={t("More actions")}>
                        <Icon name="more-horizontal" size={14} />
                      </summary>
                      <div className="qr-card-menu-panel">
                        {downloadFormats.map(format => (
                          <button key={format} type="button" disabled={downloading === `${qr.id}:${format}`} onClick={() => downloadQr(qr, format)}>
                            <Icon name="download" size={12} /> {t("Download {format}", { format: format.toUpperCase() })}
                          </button>
                        ))}
                        {!canExport && (
                          <div className="qr-card-menu-note"><Icon name="lock" size={10} /> {t("SVG · PDF on {plan}", { plan: exportPlan })}</div>
                        )}
                        <button type="button" onClick={() => setEmbedQr(qr)}>
                          <Icon name={canOrderTracking ? "mail" : "lock"} size={12} /> {t("Order emails & packing slips")}
                        </button>
                        <button type="button" onClick={() => submitIntent("duplicate", qr.id)}>
                          <Icon name="layers" size={12} /> {t("Duplicate")}
                        </button>
                        <button type="button" onClick={() => submitIntent("archive", qr.id)}>
                          <Icon name="inbox" size={12} /> {t("Archive")}
                        </button>
                        <button type="button" className="danger" onClick={() => setQrToDelete(qr)}>
                          <Icon name="trash" size={12} /> {t("Delete")}
                        </button>
                      </div>
                    </details>
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

/* ── Print sheet (Starter+) ── */
function PrintSheetModal({ open, count, busy, onClose, onGenerate }: {
  open: boolean;
  count: number;
  busy: boolean;
  onClose: () => void;
  onGenerate: (opts: { paper: PaperSize; columns: number; rows: number; showNames: boolean }) => void;
}) {
  const [paper, setPaper] = useState<PaperSize>("a4");
  const [grid, setGrid] = useState("3x4");
  const [showNames, setShowNames] = useState(true);
  const [columns, rows] = grid.split("x").map(Number);
  const pages = Math.max(1, Math.ceil(count / (columns * rows)));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Print sheet")}
      subtitle={t("{codes} · {pages}. Print at 100% scale for reliable scanning.", {
        codes: tp(count, "{count} QR code", "{count} QR codes"),
        pages: tp(pages, "{count} page", "{count} pages"),
      })}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t("Cancel")}</Button>
        <Button variant="primary" icon="download" disabled={busy || !count} onClick={() => onGenerate({ paper, columns, rows, showNames })}>
          {busy ? t("Preparing…") : t("Download PDF")}
        </Button>
      </>}
    >
      <div className="field">
        <span className="field-label">{t("Paper")}</span>
        <Segmented value={paper} onChange={v => setPaper(v as PaperSize)} options={[{ value: "a4", label: "A4" }, { value: "letter", label: t("US Letter") }]} />
      </div>
      <div className="field">
        <span className="field-label">{t("QR codes per page")}</span>
        <Segmented value={grid} onChange={setGrid} options={[
          { value: "2x3", label: t("6 · large") },
          { value: "3x4", label: t("12 · medium") },
          { value: "4x5", label: t("20 · small") },
        ]} />
      </div>
      <label className="flex items-center gap-2" style={{ cursor: "pointer", fontSize: 13 }}>
        <input type="checkbox" checked={showNames} onChange={e => setShowNames(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
        {t("Print the QR code name under each code")}
      </label>
    </Modal>
  );
}

/* ── Order emails & packing slips (Starter+) ── */
function EmbedModal({ qr, origin, canOrderTracking, onClose, onCopied }: {
  qr: Item | null;
  origin: string;
  canOrderTracking: boolean;
  onClose: () => void;
  onCopied: () => void;
}) {
  const [target, setTarget] = useState<"email" | "slip">("email");
  if (!qr) return null;
  // Same Liquid variable in both templates: the order number becomes the scan reference.
  const snippet = `<img src="${origin}/qr/${qr.id}/png?size=300&ref={{ order.name | url_encode }}" width="140" height="140" alt="${t("Scan me").replace(/"/g, "&quot;")}" style="display:block;margin:16px auto">`;
  const copy = () => {
    navigator.clipboard?.writeText(snippet);
    onCopied();
  };
  return (
    <Modal
      open={!!qr}
      onClose={onClose}
      title={t("Order emails & packing slips")}
      subtitle={t("Print \"{name}\" on every order: each order gets its own code, so you know which orders bring customers back.", { name: qr.name })}
      footer={canOrderTracking
        ? <><Button variant="ghost" onClick={onClose}>{t("Close")}</Button><Button variant="primary" icon="copy" onClick={copy}>{t("Copy snippet")}</Button></>
        : <Button variant="ghost" onClick={onClose}>{t("Close")}</Button>}
    >
      {canOrderTracking ? (<>
        <Segmented value={target} onChange={v => setTarget(v as "email" | "slip")} options={[
          { value: "email", label: t("Order confirmation email") },
          { value: "slip", label: t("Packing slip") },
        ]} />
        <ol className="embed-steps">
          {target === "email" ? (<>
            <li>{tx("In Shopify admin, open {path}.", { path: <b>{t("Settings → Notifications → Customer notifications → Order confirmation")}</b> })}</li>
            <li>{tx("Click {button} and paste the snippet where the QR code should appear.", { button: <b>{t("Edit code")}</b> })}</li>
            <li>{t("Save, then send yourself a test email.")}</li>
          </>) : (<>
            <li>{tx("In Shopify admin, open {path}.", { path: <b>{t("Settings → Shipping and delivery → Packing slip template")}</b> })}</li>
            <li>{t("Paste the snippet where the QR code should appear (for example after the order items).")}</li>
            <li>{t("Save, then print a test packing slip.")}</li>
          </>)}
        </ol>
        <pre className="embed-snippet">{snippet}</pre>
        <div className="text-xs muted">{t("Scans record the order number as the reference — find it in the scans export (Analytics → Export).")}</div>
      </>) : (
        <FeatureLock
          title={t("Per-order QR codes")}
          desc={t("Put a trackable QR code on every order confirmation and packing slip — reviews, reorders, tutorials — and see which orders scan it.")}
          plan="Starter"
        />
      )}
    </Modal>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
