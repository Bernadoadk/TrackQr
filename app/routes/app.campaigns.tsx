import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { useNavigate, useLoaderData, useFetcher, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../lib/shop.server";
import { listCampaigns, createCampaign, setCampaignStatus, deleteCampaign, duplicateCampaign } from "../lib/campaign.server";
import { getPlanEntitlements, getQuotaState, QuotaExceededError } from "../lib/plan.server";
import { featureMinPlanLabel } from "../lib/plan.constants";
import type { CampaignStatus } from "@prisma/client";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { StatCard } from "../components/ui/StatCard";
import { Field, Input, Textarea } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Modal } from "../components/ui/Modal";
import { campaignPreviewPath } from "../lib/signing.server";
import { downloadFile } from "../lib/download.client";
import { formatMoney } from "../lib/format";
import { formatDate, formatNumber, t, tem, tm, tp } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const entitlements = await getPlanEntitlements(shop);
  const [items, quota] = await Promise.all([
    listCampaigns(shop.id, {
      earliestScanDate: entitlements.earliestScanDate,
      attribution: entitlements.attribution,
    }),
    getQuotaState(shop.id, "campaigns", entitlements.campaignLimit),
  ]);
  return {
    items,
    shopDomain: shop.domain,
    currency: shop.currency,
    // Signed 24h links: a preview opens in a new tab, without the Shopify session.
    previewPaths: Object.fromEntries(items.map(c => [c.id, campaignPreviewPath(c.id)])),
    canAttribution: entitlements.attribution,
    canExport: entitlements.exports,
    historyDays: entitlements.historyDays,
    planName: entitlements.planName,
    campaignLimit: entitlements.campaignLimit,
    overQuotaIds: quota.overQuotaIds,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    switch (intent) {
      case "create": {
        const c = await createCampaign(shop, {
          name: String(form.get("name") ?? ""),
          description: (form.get("description") as string | null) || null,
          startAt: (form.get("startAt") as string | null) || null,
          endAt:   (form.get("endAt")   as string | null) || null,
        });
        return { ok: true, intent, id: c.id } as const;
      }
      case "status": {
        const id = String(form.get("id") ?? "");
        const status = String(form.get("status") ?? "") as CampaignStatus;
        await setCampaignStatus(shop, id, status);
        return { ok: true, intent, id } as const;
      }
      case "delete": {
        const id = String(form.get("id") ?? "");
        await deleteCampaign(shop.id, id);
        return { ok: true, intent, id } as const;
      }
      case "duplicate": {
        const id = String(form.get("id") ?? "");
        const dup = await duplicateCampaign(shop, id);
        return { ok: true, intent, id: dup.id } as const;
      }
      default:
        return { ok: false, error: "unknown" } as const;
    }
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return { ok: false, error: "quota", message: err.message } as const;
    }
    return { ok: false, error: "server", message: err instanceof Error ? err.message : "Server error" } as const;
  }
};

const STATUS_TONE: Record<CampaignStatus, "success" | "warning" | "neutral" | "danger"> = {
  ACTIVE: "success", PAUSED: "warning", DRAFT: "neutral", ENDED: "danger",
};
const STATUS_LABEL: Record<CampaignStatus, string> = {
  ACTIVE: "Active", PAUSED: "Paused", DRAFT: "Draft", ENDED: "Ended",
};
const GRADIENT: Record<CampaignStatus, string> = {
  ACTIVE: "linear-gradient(135deg,#2563EB,#7C3AED)",
  PAUSED: "linear-gradient(135deg,#F59E0B,#D97706)",
  DRAFT:  "linear-gradient(135deg,#94A3B8,#475569)",
  ENDED:  "linear-gradient(135deg,#DC2626,#B91C1C)",
};

function fmt(n: number) {
  if (n >= 10000) return formatNumber(n / 1000, { maximumFractionDigits: 1 }) + "k";
  return formatNumber(n);
}
function fmtPct(n: number) {
  return formatNumber(n / 100, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function fmtDate(d: Date | string | null) {
  if (!d) return "—";
  return formatDate(d, { month: "short", day: "2-digit", year: "numeric" });
}
function embeddedResourceHref(path: string, searchParams: URLSearchParams, fallbackShop?: string) {
  const next = new URLSearchParams();
  const shop = searchParams.get("shop") || fallbackShop;
  const host = searchParams.get("host");
  if (shop) next.set("shop", shop);
  if (host) next.set("host", host);
  const query = next.toString();
  return query ? `${path}?${query}` : path;
}

function NewCampaignModal({ onClose, fetcher }: { onClose: () => void; fetcher: ReturnType<typeof useFetcher<typeof action>> }) {
  const [name,  setName]  = useState("");
  const [desc,  setDesc]  = useState("");
  const [start, setStart] = useState("");
  const [end,   setEnd]   = useState("");

  const submit = () => {
    const fd = new FormData();
    fd.set("intent", "create");
    fd.set("name", name);
    fd.set("description", desc);
    if (start) fd.set("startAt", start);
    if (end)   fd.set("endAt", end);
    fetcher.submit(fd, { method: "post" });
  };

  // Focus the name field when the dialog opens (keyboard users land in the form).
  useEffect(() => {
    document.getElementById("new-campaign-name")?.focus();
  }, []);

  return (
    <Modal
      open
      title={t("New campaign")}
      subtitle={t("Set the basics — fine-tune blocks, leads, and design in the editor.")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" iconRight="arrow-right" disabled={!name.trim() || fetcher.state !== "idle"} onClick={submit}>
            {fetcher.state !== "idle" ? t("Creating…") : t("Create & open editor")}
          </Button>
        </>
      }
    >
      <Field label={t("Campaign name")} required hint={t("e.g. Summer drop · Hero landing")}>
        <Input id="new-campaign-name" placeholder={t("Untitled campaign")} value={name} onChange={e => setName(e.target.value)} />
      </Field>
      <Field label={t("Description")} hint={t("Brief summary — shown in the campaigns list.")}>
        <Textarea placeholder={t("What's this campaign about?")} value={desc} onChange={e => setDesc(e.target.value)} rows={2} />
      </Field>
      <div className="grid grid-2">
        <Field label={t("Start date")}><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></Field>
        <Field label={t("End date")}>  <Input type="date" value={end}   onChange={e => setEnd(e.target.value)}   /></Field>
      </div>
    </Modal>
  );
}

export default function Campaigns() {
  const navigate = useNavigate();
  const toast    = useToast();
  const { items, shopDomain, currency, canAttribution, canExport, historyDays, planName, campaignLimit, overQuotaIds, previewPaths } = useLoaderData<typeof loader>();
  const fetcher  = useFetcher<typeof action>();
  const [searchParams] = useSearchParams();
  const overQuota = new Set(overQuotaIds);
  const exportPlan = featureMinPlanLabel("exports");

  const [query,  setQuery]  = useState("");
  const [status, setStatus] = useState<string>("all");
  const [showNew, setShowNew] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState<(typeof items)[number] | null>(null);
  const [exportingLeads, setExportingLeads] = useState<string | null>(null);

  // React to action results once (never during render): open the editor after
  // a create, surface errors as toasts.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const data = fetcher.data;
    if (data.ok && data.intent === "create" && data.id) {
      setShowNew(false);
      navigate(`/app/campaigns/${data.id}/edit`);
      return;
    }
    if (!data.ok) {
      toast({ type: "error", title: data.error === "quota" ? t("Plan limit reached") : t("Could not save"), desc: tm(data.message) || t("Operation failed") });
    }
  }, [fetcher.state, fetcher.data]);

  const filtered = items.filter(c =>
    (query === "" || c.name.toLowerCase().includes(query.toLowerCase())) &&
    (status === "all" || c.status === status.toUpperCase())
  );

  const totalActive = items.filter(c => c.status === "ACTIVE").length;
  const totalLeads  = items.reduce((s, c) => s + c.leads, 0);
  const totalViews  = items.reduce((s, c) => s + c.views, 0);
  const totalRevenue = items.reduce((s, c) => s + c.revenue, 0);
  const totalConv   = items.reduce((s, c) => s + c.conversions, 0);

  const exportLeads = async (campaign: (typeof items)[number]) => {
    setExportingLeads(campaign.id);
    try {
      await downloadFile(embeddedResourceHref(`/c/${campaign.slug}/leads.csv`, searchParams, shopDomain), `leads-${campaign.slug}.csv`);
      toast({ title: t("Leads downloaded"), type: "info" });
    } catch (err) {
      toast({ type: "error", title: t("Export failed"), desc: err instanceof Error ? tm(err.message) : t("Try again.") });
    } finally {
      setExportingLeads(null);
    }
  };

  const STATUS_TABS = [
    { value: "all",    label: t("All")    },
    { value: "active", label: t("Active") },
    { value: "paused", label: t("Paused") },
    { value: "draft",  label: t("Draft")  },
    { value: "ended",  label: t("Ended")  },
  ];

  const submitIntent = (intent: string, id: string, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("id", id);
    Object.entries(extra).forEach(([k, v]) => fd.set(k, v));
    fetcher.submit(fd, { method: "post" });
  };
  const openPreview = (id: string) => {
    const path = previewPaths[id];
    if (path) window.open(`${window.location.origin}${path}`, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <ConfirmDialog
        open={!!campaignToDelete}
        title={t("Delete this campaign?")}
        description={campaignToDelete ? t("\"{name}\" and its leads will be deleted permanently. QR codes linked to it will open your store instead.", { name: campaignToDelete.name }) : ""}
        confirmLabel={t("Delete")}
        cancelLabel={t("Cancel")}
        tone="danger"
        loading={fetcher.state !== "idle"}
        onClose={() => setCampaignToDelete(null)}
        onConfirm={() => {
          if (!campaignToDelete) return;
          submitIntent("delete", campaignToDelete.id);
          setCampaignToDelete(null);
        }}
      />
      {showNew && <NewCampaignModal onClose={() => setShowNew(false)} fetcher={fetcher} />}

      {/* Header */}
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="megaphone" size={11} /> {t("{active} running · {count} on {plan}", { active: totalActive, count: campaignLimit != null ? `${items.length} / ${campaignLimit}` : String(items.length), plan: planName })}</div>
          <h1 className="page-h1">{tem("<em>Campaigns</em>")}</h1>
          <div className="page-sub">{historyDays ? t("Landing pages built block-by-block, attached to a QR code. Scan stats show the last {days} days.", { days: historyDays }) : t("Landing pages built block-by-block, attached to a QR code. Scan stats show the full history.")}</div>
        </div>
        <div className="page-head-actions">
          <Button variant="primary" icon="plus" onClick={() => setShowNew(true)}>{t("New campaign")}</Button>
        </div>
      </div>

      <div className="grid grid-4 mb-6">
        <StatCard accent="green"  label={t("Active")}       value={totalActive}      icon="play"     sub={t("of {count} total", { count: items.length })} />
        <StatCard accent="blue"   label={t("Page views")}   value={fmt(totalViews)}  icon="eye" />
        <StatCard accent="violet" label={t("Total leads")}  value={fmt(totalLeads)}  icon="mail" sub={totalViews ? t("{rate} sign-up rate", { rate: fmtPct((totalLeads / totalViews) * 100) }) : undefined} />
        <StatCard accent="amber"  label={t("Revenue")} value={canAttribution ? formatMoney(totalRevenue, currency, true) : t("Locked")} icon={canAttribution ? "trending-up" : "lock"} sub={canAttribution ? tp(totalConv, "{count} order", "{count} orders", { count: fmt(totalConv) }) : t("Growth plan")} />
      </div>

      <div className="toolbar mb-4">
        <div className="grow">
          <Input icon="search" placeholder={t("Search campaigns…")} value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="tabs" style={{ display: "inline-flex" }}>
          {STATUS_TABS.map(item => (
            <button key={item.value} className={`tab ${status === item.value ? "active" : ""}`} onClick={() => setStatus(item.value)}>
              {item.label}
              {item.value !== "all" && (
                <span style={{
                  marginLeft: 5, fontSize: 10, fontWeight: 600,
                  background: status === item.value ? "var(--accent-soft)" : "var(--bg-sunken)",
                  color: status === item.value ? "var(--accent-fg)" : "var(--fg-muted)",
                  borderRadius: "var(--r-full)", padding: "0 5px",
                  border: "1px solid var(--border-soft)",
                }}>
                  {items.filter(c => c.status === item.value.toUpperCase()).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="col" style={{ gap: 12 }}>
        {items.length === 0 ? (
          <Card>
            <div style={{ padding: "32px 24px", textAlign: "center" }}>
              <Icon name="megaphone" size={28} style={{ color: "var(--fg-subtle)", marginBottom: 12 }} />
              <div className="strong" style={{ fontSize: 14, marginBottom: 6 }}>{t("No campaigns yet")}</div>
              <div className="text-sm muted">{t("Create a campaign to launch your first landing page.")}</div>
              <Button variant="primary" icon="plus" style={{ marginTop: 16 }} onClick={() => setShowNew(true)}>{t("New campaign")}</Button>
            </div>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <div style={{ padding: "32px 24px", textAlign: "center" }}>
              <Icon name="megaphone" size={28} style={{ color: "var(--fg-subtle)", marginBottom: 12 }} />
              <div className="strong" style={{ fontSize: 14, marginBottom: 6 }}>{t("No campaigns match those filters")}</div>
              <div className="text-sm muted">{t("Try adjusting your search or status filter.")}</div>
              <Button variant="secondary" style={{ marginTop: 16 }} onClick={() => { setQuery(""); setStatus("all"); }}>{t("Clear filters")}</Button>
            </div>
          </Card>
        ) : filtered.map(c => {
          const isOverQuota = overQuota.has(c.id);
          return (
          <Card key={c.id} hoverLift className="card-pad" style={{ cursor: "default" }}>
            <div className="flex gap-4 items-start">
              <div style={{
                width: 56, height: 56, background: GRADIENT[c.status],
                borderRadius: 12, display: "grid", placeItems: "center",
                color: "#fff", flexShrink: 0, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
              }}>
                <Icon name="megaphone" size={22} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="strong" style={{ fontFamily: "var(--ff-display)", fontSize: 16, letterSpacing: "-0.012em" }}>{c.name}</div>
                  <Badge tone={STATUS_TONE[c.status]} dot>{t(STATUS_LABEL[c.status])}</Badge>
                  {isOverQuota && (
                    <Badge tone="warning" dot>{t("Over plan limit")}</Badge>
                  )}
                </div>
                {c.description && <div className="text-sm muted mb-3" style={{ maxWidth: 600 }}>{c.description}</div>}
                <div className="flex items-center gap-6 text-sm muted" style={{ fontFamily: "var(--ff-mono)", fontSize: 11.5, flexWrap: "wrap", rowGap: 6 }}>
                  <div><Icon name="calendar" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />{fmtDate(c.startAt)} → {fmtDate(c.endAt)}</div>
                  <div><Icon name="scan" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} /><span className="num strong">{fmt(c.scans)}</span> {tp(c.scans, "scan", "scans")}</div>
                  <div><Icon name="eye" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} /><span className="num strong">{fmt(c.views)}</span> {tp(c.views, "view", "views")}</div>
                  <div><Icon name="mail" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} /><span className="num strong">{fmt(c.leads)}</span> {tp(c.leads, "lead", "leads")}{c.views ? ` · ${fmtPct(c.signupRate)}` : ""}</div>
                  {canAttribution && (
                    <div><Icon name="trending-up" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} /><span className="num strong">{formatMoney(c.revenue, currency, true)}</span> · {t("{rate} conv.", { rate: fmtPct(c.convRate) })}</div>
                  )}
                </div>
              </div>

              <div className="flex gap-2" style={{ flexShrink: 0 }}>
                <Button variant="secondary" size="sm" icon="eye" onClick={() => openPreview(c.id)}>{t("Preview")}</Button>
                {c.status === "DRAFT" ? (
                  <Button variant="primary" size="sm" icon="edit" onClick={() => navigate(`/app/campaigns/${c.id}/edit`)}>{t("Edit")}</Button>
                ) : (
                  <>
                    {c.status === "ACTIVE" && (
                      <a href={`/c/${c.slug}`} target="_blank" rel="noopener noreferrer">
                        <Button variant="secondary" size="sm" icon="external-link">{t("Live page")}</Button>
                      </a>
                    )}
                    <Button variant="secondary" size="sm" icon="edit" onClick={() => navigate(`/app/campaigns/${c.id}/edit`)}>{t("Edit")}</Button>
                  </>
                )}
                {c.status === "ACTIVE" && (
                  <Button variant="ghost" size="sm" onClick={() => submitIntent("status", c.id, { status: "PAUSED" })}>
                    <Icon name="pause" size={13} />
                  </Button>
                )}
                {c.status === "PAUSED" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isOverQuota}
                    title={isOverQuota ? t("Beyond your {planName} plan limit — delete older campaigns or upgrade to reactivate", { planName }) : t("Resume campaign")}
                    onClick={() => submitIntent("status", c.id, { status: "ACTIVE" })}
                  >
                    <Icon name={isOverQuota ? "lock" : "play"} size={13} />
                  </Button>
                )}
                {canExport ? (
                  <Button variant="ghost" size="sm" title={t("Download leads (CSV)")} disabled={exportingLeads === c.id} onClick={() => exportLeads(c)}>
                    <Icon name="download" size={13} />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    title={t("Lead export requires the {exportPlan} plan", { exportPlan })}
                    onClick={() => toast({ type: "info", title: t("CSV export is locked"), desc: t("Upgrade to {exportPlan} to download campaign leads.", { exportPlan }) })}
                  >
                    <Icon name="lock" size={13} />
                  </Button>
                )}
                <Button variant="ghost" size="sm" title={t("Duplicate campaign")} onClick={() => submitIntent("duplicate", c.id)}>
                  <Icon name="copy" size={13} />
                </Button>
                <Button variant="ghost" size="sm" title={t("Delete campaign")} onClick={() => {
                  setCampaignToDelete(c);
                }}>
                  <Icon name="trash" size={13} />
                </Button>
              </div>
            </div>
          </Card>
          );
        })}
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
