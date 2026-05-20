import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useState } from "react";
import { useNavigate, useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../lib/shop.server";
import { listCampaigns, createCampaign, setCampaignStatus, deleteCampaign, duplicateCampaign } from "../lib/campaign.server";
import { QuotaExceededError } from "../lib/plan.server";
import type { CampaignStatus } from "@prisma/client";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { StatCard } from "../components/ui/StatCard";
import { Field, Input, Textarea } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const items = await listCampaigns(shop.id);
  return { items };
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
        await setCampaignStatus(shop.id, id, status);
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
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toLocaleString("en-US");
}
function fmtDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">New campaign</div>
            <div className="modal-sub">Set the basics — fine-tune blocks, leads, and design in the editor.</div>
          </div>
          <button className="modal-close" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>
        <div className="modal-body">
          <Field label="Campaign name" required hint="e.g. Summer drop · Hero landing">
            <Input placeholder="Untitled campaign" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Description" hint="Brief summary — shown in the campaigns list.">
            <Textarea placeholder="What's this campaign about?" value={desc} onChange={e => setDesc(e.target.value)} rows={2} />
          </Field>
          <div className="grid grid-2">
            <Field label="Start date"><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></Field>
            <Field label="End date">  <Input type="date" value={end}   onChange={e => setEnd(e.target.value)}   /></Field>
          </div>
        </div>
        <div className="modal-foot">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" iconRight="arrow-right" disabled={!name.trim() || fetcher.state !== "idle"} onClick={submit}>
            {fetcher.state !== "idle" ? "Creating…" : "Create & open editor"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Campaigns() {
  const navigate = useNavigate();
  const toast    = useToast();
  const { items } = useLoaderData<typeof loader>();
  const fetcher  = useFetcher<typeof action>();

  const [query,  setQuery]  = useState("");
  const [status, setStatus] = useState<string>("all");
  const [showNew, setShowNew] = useState(false);

  // After create, navigate to editor
  if (showNew && fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.intent === "create" && fetcher.data.id) {
    setShowNew(false);
    navigate(`/app/campaigns/${fetcher.data.id}/edit`);
  }

  // Surface error toasts
  if (fetcher.state === "idle" && fetcher.data && !fetcher.data.ok) {
    const message = fetcher.data.error === "quota" ? fetcher.data.message : fetcher.data.message ?? "Operation failed";
    toast({ type: "error", title: "Could not save", desc: message });
    // reset by mutating the fetcher data — simplest approach is to ignore and let user retry
  }

  const filtered = items.filter(c =>
    (query === "" || c.name.toLowerCase().includes(query.toLowerCase())) &&
    (status === "all" || c.status === status.toUpperCase())
  );

  const totalActive = items.filter(c => c.status === "ACTIVE").length;
  const totalLeads  = items.reduce((s, c) => s + c.leads, 0);
  const totalScans  = items.reduce((s, c) => s + c.scans, 0);
  const totalConv   = items.reduce((s, c) => s + c.conversions, 0);

  const STATUS_TABS = [
    { value: "all",    label: "All"    },
    { value: "active", label: "Active" },
    { value: "paused", label: "Paused" },
    { value: "draft",  label: "Draft"  },
    { value: "ended",  label: "Ended"  },
  ];

  const submitIntent = (intent: string, id: string, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("id", id);
    Object.entries(extra).forEach(([k, v]) => fd.set(k, v));
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <>
      {showNew && <NewCampaignModal onClose={() => setShowNew(false)} fetcher={fetcher} />}

      {/* Header */}
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="megaphone" size={11} /> {totalActive} running</div>
          <h1 className="page-h1"><span className="em">Campaigns</span></h1>
          <div className="page-sub">Landing pages built block-by-block, attached to a QR code, tracked end-to-end.</div>
        </div>
        <div className="page-head-actions">
          <Button variant="primary" icon="plus" onClick={() => setShowNew(true)}>New campaign</Button>
        </div>
      </div>

      <div className="grid grid-4 mb-6">
        <StatCard accent="green"  label="Active"       value={totalActive}      icon="play"     sub={`of ${items.length} total`} />
        <StatCard accent="violet" label="Total leads"  value={fmt(totalLeads)}  icon="mail" />
        <StatCard accent="blue"   label="Total scans"  value={fmt(totalScans)}  icon="scan" />
        <StatCard accent="amber"  label="Conversions"  value={fmt(totalConv)}   icon="zap" />
      </div>

      <div className="toolbar mb-4">
        <div className="grow">
          <Input icon="search" placeholder="Search campaigns…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="tabs" style={{ display: "inline-flex" }}>
          {STATUS_TABS.map(t => (
            <button key={t.value} className={`tab ${status === t.value ? "active" : ""}`} onClick={() => setStatus(t.value)}>
              {t.label}
              {t.value !== "all" && (
                <span style={{
                  marginLeft: 5, fontSize: 10, fontWeight: 600,
                  background: status === t.value ? "var(--accent-soft)" : "var(--bg-sunken)",
                  color: status === t.value ? "var(--accent-fg)" : "var(--fg-muted)",
                  borderRadius: "var(--r-full)", padding: "0 5px",
                  border: "1px solid var(--border-soft)",
                }}>
                  {items.filter(c => c.status === t.value.toUpperCase()).length}
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
              <div className="strong" style={{ fontSize: 14, marginBottom: 6 }}>No campaigns yet</div>
              <div className="text-sm muted">Create a campaign to launch your first landing page.</div>
              <Button variant="primary" icon="plus" style={{ marginTop: 16 }} onClick={() => setShowNew(true)}>New campaign</Button>
            </div>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <div style={{ padding: "32px 24px", textAlign: "center" }}>
              <Icon name="megaphone" size={28} style={{ color: "var(--fg-subtle)", marginBottom: 12 }} />
              <div className="strong" style={{ fontSize: 14, marginBottom: 6 }}>No campaigns match those filters</div>
              <div className="text-sm muted">Try adjusting your search or status filter.</div>
              <Button variant="secondary" style={{ marginTop: 16 }} onClick={() => { setQuery(""); setStatus("all"); }}>Clear filters</Button>
            </div>
          </Card>
        ) : filtered.map(c => (
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
                  <Badge tone={STATUS_TONE[c.status]} dot>{STATUS_LABEL[c.status]}</Badge>
                </div>
                {c.description && <div className="text-sm muted mb-3" style={{ maxWidth: 600 }}>{c.description}</div>}
                <div className="flex items-center gap-6 text-sm muted" style={{ fontFamily: "var(--ff-mono)", fontSize: 11.5 }}>
                  <div><Icon name="calendar" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />{fmtDate(c.startAt)} → {fmtDate(c.endAt)}</div>
                  <div><Icon name="scan" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} /><span className="num strong">{fmt(c.scans)}</span> scans</div>
                  <div><Icon name="mail" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} /><span className="num strong">{fmt(c.leads)}</span> leads</div>
                  <div><Icon name="trending-up" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} /><span className="num strong">{c.convRate.toFixed(2)}%</span> conv.</div>
                </div>
              </div>

              <div className="flex gap-2" style={{ flexShrink: 0 }}>
                {c.status === "DRAFT" ? (
                  <Button variant="primary" size="sm" icon="play" onClick={() => navigate(`/app/campaigns/${c.id}/edit`)}>Continue</Button>
                ) : (
                  <>
                    <a href={`/c/${c.slug}`} target="_blank" rel="noopener noreferrer">
                      <Button variant="secondary" size="sm" icon="external-link">Live page</Button>
                    </a>
                    <Button variant="secondary" size="sm" icon="edit" onClick={() => navigate(`/app/campaigns/${c.id}/edit`)}>Edit</Button>
                  </>
                )}
                {c.status === "ACTIVE" && (
                  <Button variant="ghost" size="sm" onClick={() => submitIntent("status", c.id, { status: "PAUSED" })}>
                    <Icon name="pause" size={13} />
                  </Button>
                )}
                {c.status === "PAUSED" && (
                  <Button variant="ghost" size="sm" onClick={() => submitIntent("status", c.id, { status: "ACTIVE" })}>
                    <Icon name="play" size={13} />
                  </Button>
                )}
                <a href={`/c/${c.slug}/leads.csv`} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="sm"><Icon name="download" size={13} /></Button>
                </a>
                <Button variant="ghost" size="sm" onClick={() => submitIntent("duplicate", c.id)}>
                  <Icon name="copy" size={13} />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  if (!confirm(`Delete "${c.name}"?`)) return;
                  submitIntent("delete", c.id);
                }}>
                  <Icon name="trash" size={13} />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
