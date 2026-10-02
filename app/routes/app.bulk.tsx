import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { requireShop } from "../lib/shop.server";
import { createQr } from "../lib/qr-crud.server";
import { FeatureLockedError, getPlanEntitlements, getQuotaState, QuotaExceededError, requireFeature } from "../lib/plan.server";
import { featureMinPlanLabel } from "../lib/plan.constants";
import { listTemplates } from "../lib/templates.server";
import { parseCsv } from "../lib/csv-parse";
import { normalizeWebUrl } from "../lib/url-safety";
import { triggerDownload } from "../lib/qr-download";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Field, Input, Select } from "../components/ui/Input";
import { Segmented } from "../components/ui/Segmented";
import { FeatureLock } from "../components/ui/FeatureLock";
import { useToast } from "../components/ui/Toast";
import { t, tem, tm, tp, tx } from "../lib/i18n";

const MAX_ROWS = 200;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const [entitlements, templates] = await Promise.all([getPlanEntitlements(shop), listTemplates(shop.id)]);
  const quota = await getQuotaState(shop.id, "qrCodes", entitlements.qrCodeLimit);
  return {
    canBulk: entitlements.bulkCreate,
    canDesign: entitlements.customDesign,
    planName: entitlements.planName,
    qrLimit: entitlements.qrCodeLimit,
    qrUsed: quota.used,
    templates: entitlements.customDesign ? templates.map(tpl => ({ id: tpl.id, name: tpl.name })) : [],
  };
};

interface RowInput {
  name: string;
  type: string;
  target: string;
  shopifyRef?: string | null;
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  discountCode?: string;
}

interface SharedInput {
  templateId?: string;
  label?: "none" | "name";
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  discountCode?: string;
  activate?: boolean;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  try {
    await requireFeature(shop, "bulkCreate", featureMinPlanLabel("bulkCreate"));
  } catch (err) {
    if (err instanceof FeatureLockedError) return { ok: false as const, error: "locked", message: err.message };
    throw err;
  }
  const form = await request.formData();
  let rows: RowInput[] = [];
  let shared: SharedInput = {};
  try {
    rows = (JSON.parse(String(form.get("rows") ?? "[]")) as RowInput[]).slice(0, MAX_ROWS);
    shared = JSON.parse(String(form.get("shared") ?? "{}")) as SharedInput;
  } catch {
    return { ok: false as const, error: "invalid", message: "The list could not be read." };
  }
  if (!rows.length) return { ok: false as const, error: "invalid", message: "Nothing to create." };

  const templates = shared.templateId ? await listTemplates(shop.id) : [];
  const template = templates.find(tpl => tpl.id === shared.templateId);
  const baseDesign = (template?.design ?? {}) as Record<string, unknown>;
  const baseLabel = (template?.label ?? {}) as Record<string, unknown>;

  let created = 0;
  let stoppedByQuota = false;
  const failed: { name: string; message: string }[] = [];
  for (const row of rows) {
    try {
      await createQr(shop, {
        name: String(row.name || "").slice(0, 120),
        type: row.type,
        target: row.target ?? "",
        shopifyRef: row.shopifyRef ?? null,
        design: baseDesign,
        label: {
          ...baseLabel,
          text: shared.label === "name" ? String(row.name || "").slice(0, 20) : "",
          position: shared.label === "name" ? ((baseLabel.position as "bottom") || "bottom") : "none",
        },
        utmCampaign: row.utmCampaign || shared.utmCampaign || null,
        utmSource: row.utmSource || shared.utmSource || null,
        utmMedium: row.utmMedium || shared.utmMedium || null,
        discountCode: row.discountCode || shared.discountCode || null,
        activate: shared.activate !== false,
      });
      created++;
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        stoppedByQuota = true;
        break;
      }
      failed.push({ name: row.name, message: err instanceof Error ? err.message : "Could not create" });
    }
  }
  return { ok: true as const, created, failed, stoppedByQuota, skipped: rows.length - created - failed.length };
};

/* ════════════════════════ Client ════════════════════════ */

type Source = "product" | "atc" | "collection";
type RowType = "home" | "product" | "collection" | "page" | "atc" | "promo" | "url" | "text" | "phone" | "sms" | "email";

interface Row extends RowInput {
  key: string;
  type: RowType;
  error?: string;
}

/** What the action receives: the editable fields only (no UI key / validation message). */
function toRowInput(r: Row): RowInput {
  return {
    name: r.name,
    type: r.type,
    target: r.target,
    shopifyRef: r.shopifyRef,
    utmCampaign: r.utmCampaign,
    utmSource: r.utmSource,
    utmMedium: r.utmMedium,
    discountCode: r.discountCode,
  };
}

const ROW_TYPES: RowType[] = ["home", "product", "collection", "page", "atc", "promo", "url", "text", "phone", "sms", "email"];
const TYPE_LABELS: Record<RowType, string> = {
  home: "Homepage", product: "Product page", collection: "Collection", page: "Store page", atc: "Add to cart",
  promo: "Promo code", url: "Custom URL", text: "Text", phone: "Phone", sms: "SMS", email: "Email",
};

function validateRow(row: Row): string | undefined {
  if (!row.name.trim()) return "Missing name";
  if (!ROW_TYPES.includes(row.type)) return "Unknown type";
  const value = row.target.trim();
  if (row.type !== "home" && !value) return "Missing target";
  if (row.type === "url" && !normalizeWebUrl(value)) return "Invalid URL";
  if (row.type === "atc" && !/^\d+(:\d+)?(,\d+(:\d+)?)*$/.test(value.replace(/\s/g, ""))) return "Use variant ids, e.g. 42569231:2";
  if (row.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return "Invalid email";
  return undefined;
}

const CSV_TEMPLATE = [
  "name,type,target,utm_campaign,utm_source,utm_medium,discount_code",
  "Aurora Tee — shelf tag,product,aurora-tee,summer-drop,in-store,qr,",
  "Summer collection poster,collection,summer-2026,summer-drop,poster,qr,SUMMER10",
  "Starter bundle,atc,42569231:1,bundle,flyer,qr,",
  "About us,page,/pages/about-us,,,qr,",
  "Instagram,url,https://instagram.com/yourbrand,,,qr,",
].join("\n");

type PickedResource = { id: string; title: string; handle: string; variants?: Array<{ id: string; title: string }> };

export default function BulkCreate() {
  const { canBulk, canDesign, planName, qrLimit, qrUsed, templates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const toast = useToast();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<"catalog" | "csv">("catalog");
  const [source, setSource] = useState<Source>("product");
  const [rows, setRows] = useState<Row[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [label, setLabel] = useState<"none" | "name">("none");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [utmSource, setUtmSource] = useState("");
  const [utmMedium, setUtmMedium] = useState("qr");
  const [discountCode, setDiscountCode] = useState("");
  const [activate, setActivate] = useState(true);

  const remaining = qrLimit == null ? Infinity : Math.max(0, qrLimit - qrUsed);
  const validRows = useMemo(() => rows.filter(r => !r.error), [rows]);
  const willCreate = Math.min(validRows.length, remaining, MAX_ROWS);
  const submitting = fetcher.state !== "idle";
  const result = fetcher.data;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const data = fetcher.data;
    if (!data.ok) {
      toast({ type: "error", title: t("Bulk creation failed"), desc: tm(data.message) });
      return;
    }
    toast({
      title: tp(data.created, "{count} QR code created", "{count} QR codes created"),
      desc: data.stoppedByQuota ? t("Your {planName} plan limit was reached — upgrade to create the rest.", { planName }) : data.failed.length ? t("{length} could not be created.", { length: data.failed.length }) : undefined,
      type: data.failed.length || data.stoppedByQuota ? "warning" : "success",
    });
    if (data.created) setRows([]);
  }, [fetcher.state, fetcher.data]);

  const addRows = (next: Row[]) => {
    setRows(prev => {
      const seen = new Set(prev.map(r => `${r.type}:${r.target}`));
      const merged = [...prev];
      for (const r of next) {
        const k = `${r.type}:${r.target}`;
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push({ ...r, error: validateRow(r) });
      }
      return merged.slice(0, MAX_ROWS);
    });
  };

  async function browse() {
    try {
      const picker = (shopify as unknown as {
        resourcePicker: (opts: { type: string; multiple: boolean | number; filter?: { variants?: boolean } }) => Promise<unknown>;
      }).resourcePicker;
      if (source === "collection") {
        const picked = (await picker({ type: "collection", multiple: MAX_ROWS })) as PickedResource[] | undefined;
        if (!picked?.length) return;
        addRows(picked.map(c => ({ key: c.id, name: c.title, type: "collection", target: c.handle, shopifyRef: c.id })));
        return;
      }
      const picked = (await picker({ type: "product", multiple: MAX_ROWS, filter: { variants: source === "atc" } })) as PickedResource[] | undefined;
      if (!picked?.length) return;
      if (source === "product") {
        addRows(picked.map(p => ({ key: p.id, name: p.title, type: "product", target: p.handle, shopifyRef: p.id })));
      } else {
        const next: Row[] = [];
        for (const p of picked) {
          for (const v of p.variants ?? []) {
            const numeric = v.id.split("/").pop() ?? "";
            if (!/^\d+$/.test(numeric)) continue;
            const title = v.title && v.title !== "Default Title" ? `${p.title} — ${v.title}` : p.title;
            next.push({ key: v.id, name: title, type: "atc", target: `${numeric}:1`, shopifyRef: v.id });
          }
        }
        addRows(next);
      }
    } catch (err) {
      console.error("resourcePicker failed", err);
      toast({ type: "error", title: t("Picker unavailable"), desc: t("Open this app inside Shopify admin to pick from your catalog.") });
    }
  }

  function importCsv(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) {
      toast({ type: "error", title: t("File too large"), desc: t("Up to 1 MB / 200 rows per import.") });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const table = parseCsv(String(reader.result ?? ""), MAX_ROWS);
      const [head, ...body] = table;
      if (!head) return;
      const col = (name: string) => head.findIndex(h => h.toLowerCase().replace(/\s+/g, "_") === name);
      const idx = {
        name: col("name"), type: col("type"), target: col("target"),
        utmCampaign: col("utm_campaign"), utmSource: col("utm_source"), utmMedium: col("utm_medium"), discount: col("discount_code"),
      };
      if (idx.name < 0 || idx.type < 0) {
        toast({ type: "error", title: t("Missing columns"), desc: t("The file needs at least the name and type columns — download the template.") });
        return;
      }
      const at = (r: string[], i: number) => (i >= 0 ? r[i] ?? "" : "");
      addRows(body.map((r, i) => ({
        key: `csv-${Date.now()}-${i}`,
        name: at(r, idx.name),
        type: at(r, idx.type).toLowerCase() as RowType,
        target: at(r, idx.target),
        utmCampaign: at(r, idx.utmCampaign),
        utmSource: at(r, idx.utmSource),
        utmMedium: at(r, idx.utmMedium),
        discountCode: at(r, idx.discount).toUpperCase(),
      })));
      toast({ title: t("File loaded"), desc: tp(body.length, "{count} row read — review them below.", "{count} rows read — review them below."), type: "info" });
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  function submit() {
    const fd = new FormData();
    fd.set("rows", JSON.stringify(validRows.slice(0, willCreate).map(toRowInput)));
    fd.set("shared", JSON.stringify({ templateId: templateId || undefined, label, utmCampaign, utmSource, utmMedium, discountCode, activate } satisfies SharedInput));
    fetcher.submit(fd, { method: "post" });
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="layers" size={11} /> {t("Bulk create · {plan} plan", { plan: planName })}</div>
          <h1 className="page-h1">{tem("Create QR codes <em>in bulk</em>")}</h1>
          <div className="page-sub">{t("One QR code per product, variant or collection in a few clicks — or import a spreadsheet. Perfect for shelf tags, packaging and catalogs.")}</div>
        </div>
        <div className="page-head-actions">
          <Link to="/app/qr-manager"><Button variant="secondary" icon="qr-code">{t("My QR codes")}</Button></Link>
        </div>
      </div>

      {!canBulk ? (
        <Card className="card-pad-lg">
          <FeatureLock
            title={t("Bulk creation")}
            desc={t("Generate a trackable QR code for every product, variant or collection of your catalog at once, import a CSV, then download them as a ZIP or a print sheet.")}
            plan={featureMinPlanLabel("bulkCreate")}
          />
        </Card>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 24, alignItems: "start" }}>
          <div className="col gap-4">
            <Card className="card-pad-lg">
              <div className="flex items-center justify-between gap-3" style={{ flexWrap: "wrap" }}>
                <div>
                  <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>{t("1. Choose what to encode")}</div>
                  <div className="section-sub">{t("Up to {count} QR codes per batch.", { count: MAX_ROWS })}</div>
                </div>
                <Segmented value={tab} onChange={v => setTab(v as "catalog" | "csv")} options={[
                  { value: "catalog", label: t("From your catalog"), icon: "package" },
                  { value: "csv", label: t("Import CSV"), icon: "list" },
                ]} />
              </div>

              {tab === "catalog" ? (
                <div className="mt-4 col gap-3">
                  <Field label={t("One QR code per…")}>
                    <Segmented value={source} onChange={v => setSource(v as Source)} options={[
                      { value: "product", label: t("Product page") },
                      { value: "atc", label: t("Variant · add to cart") },
                      { value: "collection", label: t("Collection") },
                    ]} />
                  </Field>
                  <div>
                    <Button variant="secondary" icon="search" onClick={browse}>
                      {source === "collection" ? t("Browse collections") : t("Browse products")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 col gap-3">
                  <div className="text-sm muted">
                    {tx("Columns: {required} and optional {optional}. Types: {types}.", {
                      required: <><code>name</code>, <code>type</code>, <code>target</code></>,
                      optional: <><code>utm_campaign</code>, <code>utm_source</code>, <code>utm_medium</code>, <code>discount_code</code></>,
                      types: ROW_TYPES.join(", "),
                    })}
                  </div>
                  <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                    <Button variant="secondary" icon="download" onClick={() => triggerDownload(new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" }), "trackqr-bulk-template.csv")}>
                      {t("Download the template")}
                    </Button>
                    <Button variant="primary" icon="list" onClick={() => fileRef.current?.click()}>{t("Choose a CSV file")}</Button>
                    <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => importCsv(e.currentTarget.files?.[0])} />
                  </div>
                </div>
              )}
            </Card>

            <Card>
              <div className="card-head">
                <div>
                  <div className="card-title">{t("2. Review the list")}</div>
                  <div className="card-sub">{tp(rows.length, "{count} row · edit names before creating", "{count} rows · edit names before creating")}</div>
                </div>
                {rows.length > 0 && <Button size="sm" variant="ghost" icon="trash" onClick={() => setRows([])}>{t("Clear")}</Button>}
              </div>
              {rows.length === 0 ? (
                <div className="bulk-empty">
                  <Icon name="inbox" size={20} />
                  <span>{tab === "catalog" ? t("Browse your catalog to add products or collections.") : t("Import a CSV file to fill the list.")}</span>
                </div>
              ) : (
                <div className="bulk-table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>{t("Name")}</th><th>{t("Destination")}</th><th>{t("Target")}</th><th /></tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.key} className={r.error ? "row-error" : ""}>
                          <td style={{ minWidth: 200 }}>
                            <input
                              className="input input-sm"
                              value={r.name}
                              maxLength={120}
                              aria-label={t("QR code name")}
                              onChange={e => setRows(rs => rs.map(x => x.key === r.key ? { ...x, name: e.target.value, error: validateRow({ ...x, name: e.target.value }) } : x))}
                            />
                          </td>
                          <td><Badge tone="brand">{t(TYPE_LABELS[r.type] ?? r.type)}</Badge></td>
                          <td className="num" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.target}>
                            {r.target || "—"}
                            {r.error && <div className="row-error-msg"><Icon name="alert-triangle" size={11} /> {t(r.error)}</div>}
                          </td>
                          <td className="right">
                            <button type="button" className="routing-icon-btn danger" aria-label={t("Remove {name}", { name: r.name })} onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>
                              <Icon name="x" size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <div className="col gap-4" style={{ position: "sticky", top: 28 }}>
            <Card className="card-pad-lg">
              <div className="section-h" style={{ fontSize: 15, marginBottom: 12 }}>{t("3. Shared settings")}</div>
              <div className="col gap-3">
                {canDesign && templates.length > 0 && (
                  <Field label={t("Design")} hint={t("Saved templates from the Create page.")}>
                    <Select value={templateId} onChange={e => setTemplateId(e.target.value)}>
                      <option value="">{t("Default style")}</option>
                      {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                    </Select>
                  </Field>
                )}
                <Field label={t("Label under the code")}>
                  <Segmented value={label} onChange={v => setLabel(v as "none" | "name")} options={[{ value: "none", label: t("None") }, { value: "name", label: t("QR code name") }]} />
                </Field>
                <div className="grid grid-2">
                  <Field label={t("UTM campaign")}><Input value={utmCampaign} onChange={e => setUtmCampaign(e.target.value)} placeholder={t("summer-drop")} /></Field>
                  <Field label={t("UTM source")}><Input value={utmSource} onChange={e => setUtmSource(e.target.value)} placeholder={t("shelf-tag")} /></Field>
                </div>
                <Field label={t("UTM medium")}><Input value={utmMedium} onChange={e => setUtmMedium(e.target.value)} placeholder="qr" /></Field>
                <Field label={t("Discount code (optional)")} hint={t("Applied on store destinations — must exist in Shopify.")}>
                  <Input icon="tag" value={discountCode} onChange={e => setDiscountCode(e.target.value.toUpperCase())} placeholder="WELCOME10" />
                </Field>
                <label className="flex items-center gap-2" style={{ cursor: "pointer", fontSize: 13 }}>
                  <input type="checkbox" checked={activate} onChange={e => setActivate(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                  {t("Activate the codes right away")}
                </label>
              </div>
            </Card>

            <Card className="card-pad-lg">
              <div className="col gap-3">
                <div className="text-sm">
                  {qrLimit == null
                    ? <>{t("Unlimited QR codes on your plan.")}</>
                    : <>{t("{remaining} of {limit} QR codes left on your {plan} plan.", { remaining, limit: qrLimit, plan: planName })}</>}
                </div>
                {validRows.length > remaining && (
                  <div className="plan-notice warning" style={{ margin: 0 }}>
                    <Icon name="alert-triangle" size={15} />
                    <div className="plan-notice-body">{tx("Only the first {count} will be created. {upgrade} for more.", { upgrade: <Link to="/app/pricing">{t("Upgrade")}</Link> }, { count: remaining })}</div>
                  </div>
                )}
                {rows.length !== validRows.length && (
                  <div className="text-xs muted">{tp(rows.length - validRows.length, "{count} row with errors will be skipped.", "{count} rows with errors will be skipped.")}</div>
                )}
                <Button variant="primary" size="lg" icon="plus" disabled={!willCreate || submitting} onClick={submit} style={{ width: "100%" }}>
                  {submitting ? t("Creating…") : willCreate ? tp(willCreate, "Create {count} QR code", "Create {count} QR codes") : t("Create QR codes")}
                </Button>
                {result?.ok && result.created > 0 && (
                  <Button variant="secondary" icon="arrow-right" onClick={() => navigate("/app/qr-manager")} style={{ width: "100%" }}>
                    {t("See them in My QR codes")}
                  </Button>
                )}
                {result?.ok && result.failed.length > 0 && (
                  <div className="text-xs" style={{ color: "var(--red-fg)" }}>
                    {result.failed.slice(0, 5).map(f => <div key={f.name}>{f.name}: {tm(f.message)}</div>)}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
