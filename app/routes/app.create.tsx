import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { requireShop } from "../lib/shop.server";
import { createQr, getQrForEdit, updateQr } from "../lib/qr-crud.server";
import { listTemplates, createTemplate, deleteTemplate } from "../lib/templates.server";
import { createDiscountCode } from "../lib/discounts.server";
import { scanBaseUrl } from "../lib/qr.server";
import { readShopSettings } from "../lib/shop-settings.server";
import { normalizeRoutingConfig, type RoutingConfig } from "../lib/routing";
import { parseWifiPayload as parseWifi, wifiPayload as buildWifi } from "../lib/wifi";
import { STORE_QR_TYPES, QR_TYPE_FROM_UI, QR_TYPE_TO_UI } from "../lib/qr-types";
import { SmartRoutingCard } from "../components/qr/SmartRoutingCard";
import { RangeSlider } from "../components/ui/RangeSlider";
import { FeatureLockedError, getPlanEntitlements, QuotaExceededError, requireFeature } from "../lib/plan.server";
import { featureMinPlanLabel } from "../lib/plan.constants";
import { STANDARD_DESIGN, STANDARD_LABEL_FORMAT } from "../lib/qr-standard";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { FeatureLock } from "../components/ui/FeatureLock";
import { Field, Input, Textarea } from "../components/ui/Input";
import { Segmented } from "../components/ui/Segmented";
import { useToast } from "../components/ui/Toast";
import { useReviewRequest } from "../lib/use-review-request";
import { renderQrSvg as renderQrSvgClient, renderFrameSvg, framesForPosition, frameInvertsLabel, FRAME_LABEL, FRAMES_WITH_LABEL_ZONE, type FrameStyle, type QrLabelOpts } from "../lib/qr-render";
import { LogoPicker, logoSvgDataUrl, type LogoSelection } from "../components/ui/LogoPicker";
import { LABEL_FONTS, LABEL_FONT_GROUPS, DEFAULT_FONT, getLabelFont } from "../lib/label-fonts";
import { contrastRatio, contrastVerdict } from "../lib/contrast";
import { downloadQrAsset, type DownloadFormat } from "../lib/qr-download";
import { t, tem, tm } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const editId = url.searchParams.get("edit");
  const origin = scanBaseUrl() || url.origin;
  // Load templates + active campaigns once for the page (cheap queries).
  const [templates, campaigns, editQr, entitlements] = await Promise.all([
    listTemplates(shop.id),
    prisma.campaign.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, slug: true, status: true } }),
    editId ? getQrForEdit(shop.id, editId) : Promise.resolve(null),
    getPlanEntitlements(shop),
  ]);
  return {
    plan: {
      name: entitlements.planName,
      customDesign: entitlements.customDesign,
      exports: entitlements.exports,
      customFallback: entitlements.customFallback,
      smartRouting: entitlements.smartRouting,
    },
    shopDomain: shop.domain,
    timezone: shop.ianaTimezone || "UTC",
    defaultFallback: entitlements.customFallback ? readShopSettings(shop).defaultFallbackUrl : null,
    templates: templates.map(tpl => ({
      id: tpl.id,
      name: tpl.name,
      design: tpl.design as Record<string, unknown>,
      label:  tpl.label  as Record<string, unknown>,
      updatedAt: tpl.updatedAt.toISOString(),
    })),
    campaigns: campaigns.map(c => ({ id: c.id, name: c.name, slug: c.slug, status: c.status })),
    origin,
    editQr: editQr ? {
      id: editQr.id,
      slug: editQr.slug,
      name: editQr.name,
      description: editQr.description,
      type: QR_TYPE_TO_UI[editQr.type],
      target: editQr.target,
      shopifyRef: editQr.shopifyRef,
      design: editQr.design as Record<string, unknown>,
      label: editQr.label as Record<string, unknown>,
      utmCampaign: editQr.utmCampaign,
      utmSource: editQr.utmSource,
      utmMedium: editQr.utmMedium,
      utmTerm: editQr.utmTerm,
      activatesAt: editQr.activatesAt?.toISOString() ?? null,
      expiresAt: editQr.expiresAt?.toISOString() ?? null,
      campaignId: editQr.campaignId,
      fallbackUrl: editQr.fallbackUrl,
      discountCode: editQr.discountCode,
      rules: normalizeRoutingConfig(editQr.rules),
      active: editQr.active,
    } : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // We need both the shop record (for templates/QR) AND the admin GraphQL
  // client (for optional Shopify discount creation).
  const { admin, shop } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "create");

  // ── Template intents ─────────────────────────────────
  if (intent === "template:save") {
    try {
      // Saved design presets belong to the custom-design feature (Starter+).
      await requireFeature(shop, "customDesign", featureMinPlanLabel("customDesign"));
      const tpl = await createTemplate(shop.id, {
        name:   String(form.get("name") ?? "Untitled template"),
        design: JSON.parse(String(form.get("design") ?? "{}")),
        label:  JSON.parse(String(form.get("label")  ?? "{}")),
      });
      return { ok: true as const, intent: "template:save" as const, id: tpl.id, name: tpl.name };
    } catch (err) {
      return { ok: false as const, intent: "template:save" as const, message: err instanceof Error ? err.message : "Save failed" };
    }
  }
  if (intent === "template:delete") {
    await deleteTemplate(shop.id, String(form.get("id") ?? ""));
    return { ok: true as const, intent: "template:delete" as const };
  }

  // ── Default: create/update QR ─────────────────────────
  try {
    const design = JSON.parse(String(form.get("design") ?? "{}"));
    const label = JSON.parse(String(form.get("label") ?? "{}"));
    // Plan-gated fields are only sent by the form when the plan allows them,
    // so a downgraded store keeps what it configured before (like designs).
    const rules = form.has("rules") ? JSON.parse(String(form.get("rules"))) : undefined;
    const fallbackUrl = form.has("fallbackUrl") ? String(form.get("fallbackUrl") ?? "").trim() || null : undefined;
    const type   = String(form.get("type") ?? "");
    const target = String(form.get("target") ?? "");
    const discountCode = String(form.get("discountCode") ?? "").trim();

    // Opt-in: auto-create the Shopify discount before persisting the QR.
    // Best-effort — if it fails, we still create the QR (the merchant can
    // create the discount manually in admin).
    let discountWarning: string | null = null;
    const codeToCreate = type === "promo" ? target.trim().toUpperCase() : discountCode.toUpperCase();
    if (form.get("autoCreateDiscount") === "1" && codeToCreate) {
      const pct = Math.max(0.05, Math.min(0.50, Number(form.get("discountValuePct") ?? "0.10")));
      const result = await createDiscountCode(admin, {
        code: codeToCreate,
        percentage: pct,
        title: `TrackQr · ${codeToCreate}`,
      });
      if (!result.ok) discountWarning = result.error;
    }

    const payload = {
      name: String(form.get("name") ?? ""),
      description: (form.get("description") as string | null) || null,
      type,
      target,
      shopifyRef: (form.get("shopifyRef") as string | null) || null,
      design,
      label,
      utmCampaign: (form.get("utmCampaign") as string | null) || null,
      utmSource:   (form.get("utmSource")   as string | null) || null,
      utmMedium:   (form.get("utmMedium")   as string | null) || null,
      utmTerm:     (form.get("utmTerm")     as string | null) || null,
      activatesAt: (form.get("activatesAt") as string | null) || null,
      expiresAt:   (form.get("expiresAt")   as string | null) || null,
      campaignId:  (form.get("campaignId")  as string | null) || null,
      discountCode: type === "promo" ? null : codeToCreate || null,
      ...(fallbackUrl !== undefined ? { fallbackUrl } : {}),
      ...(rules !== undefined ? { rules } : {}),
      activate: form.get("activate") === "1",
    };

    const editId = String(form.get("id") ?? "");
    const qr = intent === "update" && editId
      ? await updateQr(shop, editId, payload)
      : await createQr(shop, payload);

    return {
      ok: true,
      intent: intent === "update" ? "update" as const : "create" as const,
      id: qr.id,
      slug: qr.slug,
      name: qr.name,
      active: qr.active,
      discountWarning,
    } as const;
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return {
        ok: false,
        intent: "create" as const,
        error: "quota",
        message: err.message,
      } as const;
    }
    if (err instanceof FeatureLockedError) {
      return { ok: false, intent: "create" as const, error: "locked", message: err.message } as const;
    }
    const message = err instanceof Error ? err.message : "Could not save QR code";
    return { ok: false, intent: "create" as const, error: "validation", message } as const;
  }
};

/* ── Types ── */
type QrStyle     = "square" | "rounded" | "dot" | "classy";
type CornerStyle = "square" | "rounded" | "extra-rounded";
type LabelPos    = "none" | "top" | "bottom" | "left" | "right";

const QR_TYPES = [
  { id: "home",       name: "Homepage",     icon: "home",           group: "shopify", url: "/" },
  { id: "product",    name: "Product page", icon: "package",        group: "shopify", url: "/products/aurora-tee" },
  { id: "collection", name: "Collection",   icon: "grid",           group: "shopify", url: "/collections/" },
  { id: "page",       name: "Store page",   icon: "layout",         group: "shopify", url: "/pages/" },
  { id: "atc",        name: "Add to cart",  icon: "shopping-cart",  group: "shopify", url: "/cart/add" },
  { id: "promo",      name: "Promo code",   icon: "tag",            group: "shopify", url: "/discount/" },
  // Legacy type: kept for existing codes, hidden from the picker (Custom URL / Store page replace it).
  { id: "link",       name: "Link",         icon: "link",           group: "legacy",  url: "https://" },
  { id: "url",        name: "Custom URL",   icon: "globe",          group: "custom",  url: "https://" },
  { id: "text",    name: "Text",         icon: "type",           group: "custom" },
  { id: "phone",   name: "Phone",        icon: "phone",          group: "custom" },
  { id: "sms",     name: "SMS",          icon: "message-square", group: "custom" },
  { id: "email",   name: "Email",        icon: "mail",           group: "custom" },
  { id: "wifi",    name: "WiFi",         icon: "wifi",           group: "custom" },
  { id: "vcard",   name: "vCard",        icon: "id-card",        group: "custom" },
] as const;

type QrTypeId = (typeof QR_TYPES)[number]["id"];

function typeMeta(id: QrTypeId) { return QR_TYPES.find(item => item.id === id) ?? QR_TYPES[0]; }

const QR_STYLES: QrStyle[]      = ["square", "rounded", "dot", "classy"];
const QR_CORNERS: CornerStyle[] = ["square", "rounded", "extra-rounded"];
const QR_COLORS    = ["#0B1220", "#2563EB", "#7C3AED", "#16A34A", "#D97706", "#DB2777"];
const QR_BG_COLORS = ["#FFFFFF", "#F1F5F9", "#FEF3C7", "#DCFCE7", "#DBEAFE", "#FCE7F3"];
const LABEL_POSITIONS: LabelPos[] = ["none", "top", "bottom", "left", "right"];

/* ── QrSvg (live preview) ──
 * Renders the QR using shared renderQrSvg, overlaying a brand logo or
 * a custom uploaded image at the center when set.
 */
function QrSvg({
  text, size = 220, fg, bg, style, cornerStyle, logo,
  logoSize: logoSizeFrac = 0.20,
  margin = 8,
  cornerColor,
  gradient,
  label,
}: {
  text: string; size?: number; fg: string; bg: string;
  style: QrStyle; cornerStyle: CornerStyle;
  logo: LogoSelection;
  logoSize?: number;
  margin?: number;
  cornerColor?: string;
  gradient?: { from: string; to: string; angle?: number } | null;
  label?: QrLabelOpts;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Resolve the logo to a data/source URL for embedding in the SVG.
  const rawLogoSrc =
    logo.kind === "brand"  && logo.brandId   ? logoSvgDataUrl(logo.brandId, 80) :
    logo.kind === "custom" && (logo.customPreviewUrl || logo.customUrl) ? (logo.customPreviewUrl || logo.customUrl) :
    "";
  const [resolvedLogoSrc, setResolvedLogoSrc] = useState(rawLogoSrc);

  useEffect(() => {
    let cancelled = false;
    setResolvedLogoSrc(rawLogoSrc);
    if (!rawLogoSrc || rawLogoSrc.startsWith("data:") || rawLogoSrc.startsWith("blob:")) return;

    fetch(rawLogoSrc)
      .then(res => res.ok ? res.blob() : Promise.reject(new Error(`Logo image failed: ${res.status}`)))
      .then(blob => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      }))
      .then(dataUrl => {
        if (!cancelled && dataUrl) setResolvedLogoSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setResolvedLogoSrc(rawLogoSrc);
      });

    return () => { cancelled = true; };
  }, [rawLogoSrc]);

  const logoKind = logo.kind;
  const gradientFrom = gradient?.from;
  const gradientTo = gradient?.to;
  const gradientAngle = gradient?.angle;
  const labelText = label?.text;
  const labelPosition = label?.position;
  const labelFrame = label?.frame;
  const labelFrameColor = label?.frameColor;
  const labelColor = label?.labelColor;
  const labelBandColor = label?.bandColor;
  const labelFont = label?.font;
  const labelSize = label?.size;
  const labelBold = label?.bold;
  const labelItalic = label?.italic;
  const labelUnderline = label?.underline;
  const labelAlign = label?.align;
  const hasLabel = !!label;

  useEffect(() => {
    if (!ref.current) return;
    try {
      const svg = renderQrSvgClient(text || "TrackQr placeholder", {
        size, fg, bg, style, cornerStyle, withLogo: logoKind !== "none",
        logoDataUrl: resolvedLogoSrc || undefined,
        logoSize: logoSizeFrac,
        margin,
        cornerColor,
        gradient: gradientFrom && gradientTo ? { from: gradientFrom, to: gradientTo, angle: gradientAngle } : null,
        label: hasLabel ? {
          text: labelText,
          position: labelPosition,
          frame: labelFrame,
          frameColor: labelFrameColor,
          labelColor,
          bandColor: labelBandColor,
          font: labelFont,
          size: labelSize,
          bold: labelBold,
          italic: labelItalic,
          underline: labelUnderline,
          align: labelAlign,
        } : undefined,
      });
      ref.current.innerHTML = svg;
    } catch (err) {
      console.error("[qr-preview] render failed", err);
    }
  }, [
    text, size, fg, bg, style, cornerStyle, logoKind, resolvedLogoSrc, logoSizeFrac, margin, cornerColor,
    gradientFrom, gradientTo, gradientAngle,
    hasLabel, labelText, labelPosition, labelFrame, labelFrameColor, labelColor, labelBandColor,
    labelFont, labelSize, labelBold, labelItalic, labelUnderline, labelAlign,
  ]);

  return <div ref={ref} style={{ display: "grid", placeItems: "center", lineHeight: 0 }} />;
}

/* ── StyleIllus — static mini pattern illustration (no CDN needed) ── */
const ILLUS_BITS = [
  [1,0,1,1,0,1,0],
  [0,1,0,1,1,0,1],
  [1,0,1,0,1,1,0],
  [1,1,0,1,0,0,1],
  [0,1,1,0,1,0,1],
  [1,0,0,1,1,1,0],
  [0,1,1,0,0,1,1],
];
function StyleIllus({ qrStyle, size = 36 }: { qrStyle: QrStyle; size?: number }) {
  const cell = size / ILLUS_BITS.length;
  const r =
    qrStyle === "dot"     ? cell / 2 :
    qrStyle === "rounded" ? cell * 0.38 :
    qrStyle === "classy"  ? cell * 0.22 : 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ display: "block" }}>
      {ILLUS_BITS.flatMap((row, ri) =>
        row.map((dark, ci) => {
          if (!dark) return null;
          const x = ci * cell + 0.5;
          const y = ri * cell + 0.5;
          const w = cell - 1;
          const key = `${ri}-${ci}`;
          return qrStyle === "dot"
            ? <circle key={key} cx={x + w / 2} cy={y + w / 2} r={w * 0.42} fill="currentColor" />
            : <rect key={key} x={x} y={y} width={w} height={w} rx={r} fill="currentColor" />;
        })
      )}
    </svg>
  );
}

/* ── FrameMini — small preview of each frame style ──
 * Uses currentColor so it inherits from a theme-adaptive CSS variable
 * (var(--fg-strong)) — visible in both light and dark mode regardless
 * of the QR's chosen foreground color.
 */
function FrameMini({ style, labelPos }: { style: FrameStyle; labelPos: LabelPos }) {
  const w = 56, h = 40;
  // Render with currentColor so the SVG can inherit from CSS.
  const svg = renderFrameSvg(style, {
    width: w, height: h,
    color: "currentColor",
    bg: "transparent",
    inset: 3,
    strokeWidth: 1.2,
    bandSize: 12,
    labelPosition: labelPos === "none" ? undefined : labelPos,
  });
  return (
    <div style={{ width: w, height: h, color: "var(--fg-strong)" }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/* ── CornerMini ── */
function CornerMini({ corner }: { corner: CornerStyle }) {
  const r = corner === "extra-rounded" ? 11 : corner === "rounded" ? 6 : 0;
  return (
    <svg viewBox="0 0 28 28" width="32" height="32">
      <rect x="1" y="1" width="26" height="26" rx={r} fill="currentColor" />
      <rect x="5" y="5" width="18" height="18" rx={Math.max(0, r - 4)} fill="var(--bg-surface)" />
      <rect x="9" y="9" width="10" height="10" rx={Math.max(0, r - 8)} fill="currentColor" />
    </svg>
  );
}

/* ── PositionMini ── */
function PositionMini({ pos }: { pos: LabelPos }) {
  const qrRect = <rect x="11" y="11" width="14" height="14" rx="1.6" fill="currentColor" />;
  const line = (x: number, y: number, w: number, h = 1.4) =>
    <rect key={`${x}${y}`} x={x} y={y} width={w} height={h} rx="0.7" fill="currentColor" />;
  return (
    <svg viewBox="0 0 36 36" width="40" height="40">
      {qrRect}
      {pos === "top"    && <>{line(6, 4, 24)}{line(10, 7, 16)}</>}
      {pos === "bottom" && <>{line(10, 28, 16)}{line(6, 31, 24)}</>}
      {pos === "left"   && <>{line(1, 14, 7)}{line(1, 17, 7)}{line(1, 20, 5)}</>}
      {pos === "right"  && <>{line(28, 14, 7)}{line(28, 17, 7)}{line(30, 20, 5)}</>}
      {pos === "none"   && <g opacity="0.35"><line x1="6" y1="6" x2="30" y2="30" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 2" /></g>}
    </svg>
  );
}

/* ════════════════════════ Page ════════════════════════ */

/* ── Encoders for composite QR types (WiFi, vCard) ── */

const wifiPayload = buildWifi;
const parseWifiPayload = parseWifi;

function vcardPayload(o: { fullName: string; title?: string; org?: string; phone?: string; email?: string; url?: string }): string {
  // One property per line: strip line breaks so a value can't add fields.
  const v = (s?: string) => (s ?? "").replace(/[\r\n]+/g, " ").trim();
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${v(o.fullName)}`,
    o.org   ? `ORG:${v(o.org)}`         : "",
    o.title ? `TITLE:${v(o.title)}`     : "",
    o.phone ? `TEL;TYPE=CELL:${v(o.phone)}` : "",
    o.email ? `EMAIL:${v(o.email)}`     : "",
    o.url   ? `URL:${v(o.url)}`         : "",
    "END:VCARD",
  ];
  return lines.filter(Boolean).join("\n");
}

function parseVcardPayload(payload: string) {
  const lines = payload.split(/\r?\n/);
  const get = (key: string) => {
    const line = lines.find(l => l.toUpperCase().startsWith(`${key.toUpperCase()}:`) || l.toUpperCase().startsWith(`${key.toUpperCase()};`));
    return line ? line.substring(line.indexOf(":") + 1) : "";
  };
  return {
    fullName: get("FN"),
    title: get("TITLE"),
    org: get("ORG"),
    phone: get("TEL"),
    email: get("EMAIL"),
    url: get("URL"),
  };
}

interface CartItem {
  /** Numeric variant id (cart permalinks use legacy ids). */
  variantId: string;
  title: string;
  quantity: number;
}

/** "123:2,456:1" ↔ cart items (titles come from the picker, or a fallback). */
function parseCartTarget(target: string): CartItem[] {
  return target.split(",").map(part => {
    const [id, qty] = part.trim().replace(/^\/?(cart\/)?/, "").split(":");
    return /^\d+$/.test(id ?? "") ? { variantId: id, title: t("Variant #{id}", { id }), quantity: Math.max(1, Number(qty) || 1) } : null;
  }).filter((x): x is CartItem => !!x);
}

function cartTarget(items: CartItem[]): string {
  return items.map(i => `${i.variantId}:${Math.min(99, Math.max(1, i.quantity))}`).join(",");
}

function toDatetimeLocal(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function CreateQr() {
  const navigate = useNavigate();
  const toast    = useToast();
  const fetcher  = useFetcher<typeof action>();
  const templateFetcher = useFetcher<typeof action>();
  const shopify  = useAppBridge();
  const requestReview = useReviewRequest();
  // Loader data — saved templates + active campaigns to attach to.
  const { templates, campaigns, editQr, origin, plan, shopDomain, defaultFallback, timezone } = useLoaderData<typeof loader>();
  const isEditing = !!editQr;
  // Plan gating: without `customDesign` the QR keeps the standard look and
  // only the label text / position can be edited; SVG / PDF need `exports`.
  const canCustomDesign = plan.customDesign;
  const canExport = plan.exports;
  const designPlan = featureMinPlanLabel("customDesign");
  const exportPlan = featureMinPlanLabel("exports");

  const [name,        setName]        = useState("");
  const [description, setDescription] = useState("");
  const [type,        setType]        = useState<QrTypeId>("product");
  const [target,      setTarget]      = useState("");
  const [shopifyRef,  setShopifyRef]  = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string>(""); // human-readable display

  // Composite type sub-fields
  const [wifiSsid, setWifiSsid]   = useState("");
  const [wifiPwd,  setWifiPwd]    = useState("");
  const [wifiEnc,  setWifiEnc]    = useState<"WPA" | "WEP" | "nopass">("WPA");
  const [vcFull,   setVcFull]     = useState("");
  const [vcTitle,  setVcTitle]    = useState("");
  const [vcOrg,    setVcOrg]      = useState("");
  const [vcEmail,  setVcEmail]    = useState("");
  const [vcPhone,  setVcPhone]    = useState("");
  const [vcUrl,    setVcUrl]      = useState("");

  // Design — including advanced controls (logo size, margin, finder color, gradient)
  const [style,       setStyle]       = useState<QrStyle>("rounded");
  const [cornerStyle, setCornerStyle] = useState<CornerStyle>("rounded");
  const [fg,          setFg]          = useState("#0B1220");
  const [bg,          setBg]          = useState("#FFFFFF");
  const [logoSel,     setLogoSel]     = useState<LogoSelection>({ kind: "none" });
  const [logoSizePct, setLogoSizePct] = useState<number>(20);   // % of QR (10–30)
  const [qrMargin,    setQrMargin]    = useState<number>(8);    // pixel quiet zone (0–24)
  const [cornerColor, setCornerColor] = useState<string>("#0B1220");
  // Gradient (Batch B — toggle controls visibility).
  const [gradientOn,  setGradientOn]  = useState<boolean>(false);
  const [gradientFrom, setGradientFrom] = useState<string>("#2563EB");
  const [gradientTo,   setGradientTo]   = useState<string>("#7C3AED");
  const [gradientAngle, setGradientAngle] = useState<number>(45);

  // Keep cornerColor in sync with fg until the user explicitly customizes it.
  const cornerCustomized = useRef(false);
  useEffect(() => {
    if (!cornerCustomized.current) setCornerColor(fg);
  }, [fg]);

  // Computed contrast (used by the warning under fg/bg).
  const contrast = contrastRatio(fg, bg);
  const contrastInfo = contrastVerdict(contrast);

  // UTM tracking state (was uncontrolled before — converted to controlled
  // inputs so we can actually submit the values, and added medium + term).
  const [utmCampaign, setUtmCampaign] = useState<string>("");
  const [utmSource,   setUtmSource]   = useState<string>("");
  const [utmMedium,   setUtmMedium]   = useState<string>("qr");   // sensible default
  const [utmTerm,     setUtmTerm]     = useState<string>("");

  // Schedule (Batch C) — optional ISO timestamps for activation/expiration.
  const [scheduleEnabled, setScheduleEnabled] = useState<boolean>(false);
  const [activatesAt, setActivatesAt] = useState<string>("");
  const [expiresAt,   setExpiresAt]   = useState<string>("");

  // Campaign link (Batch C) — optional campaign FK.
  const [campaignId,  setCampaignId]  = useState<string>("");

  // Fallback destination while the code can't serve its target (Starter+).
  const [fallbackUrl, setFallbackUrl] = useState<string>("");
  // Smart routing rules + A/B split (Growth).
  const [routing, setRouting] = useState<RoutingConfig>({ rules: [], abTest: null });

  // "Add to cart" can hold several variants with quantities.
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Discount applied automatically on Shopify destinations (any store type),
  // and the promo code of the "Promo code" type. Auto-create is opt-in on
  // other types (the code often already exists in Shopify).
  const [discountCode, setDiscountCode] = useState<string>("");
  const [autoCreateDiscount, setAutoCreateDiscount] = useState<boolean>(true);
  const [discountValuePct,   setDiscountValuePct]   = useState<number>(10);

  // Template UI state.
  const [templateName, setTemplateName] = useState<string>("");
  const [showTemplateSave, setShowTemplateSave] = useState<boolean>(false);

  // Label — text + inline rich-text formatting
  const [labelText, setLabelText] = useState(() => t("Scan to discover"));
  const [labelPos,  setLabelPos]  = useState<LabelPos>("bottom");
  const [frameStyle, setFrameStyle] = useState<FrameStyle>("none");
  const [labelFont,  setLabelFont]  = useState<string>(DEFAULT_FONT);
  const [labelFontSize,  setLabelFontSize]  = useState<number>(16);
  const [labelBold,      setLabelBold]      = useState<boolean>(false);
  const [labelItalic,    setLabelItalic]    = useState<boolean>(false);
  const [labelUnderline, setLabelUnderline] = useState<boolean>(false);
  const [labelAlign,     setLabelAlign]     = useState<"left" | "center" | "right">("center");

  // Whether the current frame exposes a colored text zone (polaroid/banner/ticket/header).
  const hasTextZone = canCustomDesign && FRAMES_WITH_LABEL_ZONE.includes(frameStyle);

  // Effective appearance — what the preview shows and what gets saved. Plans
  // without `customDesign` always get the standard style, whatever the
  // (possibly hydrated from a higher plan) form state says.
  const eff = canCustomDesign
    ? {
        style, cornerStyle, fg, bg, logoSel, logoSizePct, qrMargin, cornerColor,
        gradient: gradientOn ? { from: gradientFrom, to: gradientTo, angle: gradientAngle } : null,
        frameStyle, labelFont, labelFontSize, labelBold, labelItalic, labelUnderline, labelAlign,
      }
    : {
        style: STANDARD_DESIGN.style as QrStyle,
        cornerStyle: STANDARD_DESIGN.cornerStyle as CornerStyle,
        fg: STANDARD_DESIGN.fg,
        bg: STANDARD_DESIGN.bg,
        logoSel: { kind: "none" } as LogoSelection,
        logoSizePct: Math.round(STANDARD_DESIGN.logoSize * 100),
        qrMargin: STANDARD_DESIGN.margin,
        cornerColor: STANDARD_DESIGN.cornerColor,
        gradient: null,
        frameStyle: STANDARD_LABEL_FORMAT.frame as FrameStyle,
        labelFont: STANDARD_LABEL_FORMAT.font,
        labelFontSize: STANDARD_LABEL_FORMAT.size,
        labelBold: STANDARD_LABEL_FORMAT.bold,
        labelItalic: STANDARD_LABEL_FORMAT.italic,
        labelUnderline: STANDARD_LABEL_FORMAT.underline,
        labelAlign: STANDARD_LABEL_FORMAT.align as "left" | "center" | "right",
      };

  // Text-zone colors — only meaningful when the frame has a label band.
  // Defaults: label text follows the frame inversion logic, band matches fg.
  const [labelTextColor, setLabelTextColor] = useState<string>(fg);
  const [labelBgColor,   setLabelBgColor]   = useState<string>(fg);

  // Re-seed the colors with sensible defaults whenever the user switches frame
  // (or when the underlying fg/bg moves and they haven't customized yet).
  useEffect(() => {
    if (FRAMES_WITH_LABEL_ZONE.includes(frameStyle)) {
      setLabelTextColor(frameInvertsLabel(frameStyle) ? bg : fg);
      setLabelBgColor(fg);
    }
  }, [frameStyle]);

  // List of frame styles available for the current label position.
  const availableFrames = framesForPosition(labelPos);
  // Auto-reset to "none" when the user changes position and the current frame isn't supported.
  useEffect(() => {
    if (!availableFrames.includes(frameStyle)) setFrameStyle("none");
  }, [labelPos]);

  const [activated,    setActivated]    = useState(false);
  const [downloading,  setDownloading]  = useState<DownloadFormat | null>(null);
  const [savedQr,      setSavedQr]      = useState<{ id: string; slug: string; name: string } | null>(
    editQr ? { id: editQr.id, slug: editQr.slug, name: editQr.name } : null,
  );
  const [submitMode, setSubmitMode] = useState<"save" | "saveExit" | "activate" | null>(null);

  const editHydrated = useRef(false);
  useEffect(() => {
    if (!editQr || editHydrated.current) return;
    editHydrated.current = true;

    const d = editQr.design as Record<string, unknown>;
    const l = editQr.label as Record<string, unknown>;
    const editType = (editQr.type || "product") as QrTypeId;

    setName(editQr.name ?? "");
    setDescription(editQr.description ?? "");
    setType(editType);
    setShopifyRef(editQr.shopifyRef ?? null);
    setSelectedLabel("");

    if (editType === "wifi") {
      const wifi = parseWifiPayload(editQr.target ?? "");
      setWifiSsid(wifi.ssid);
      setWifiPwd(wifi.password);
      setWifiEnc(wifi.encryption);
      setTarget("");
    } else if (editType === "vcard") {
      const vcard = parseVcardPayload(editQr.target ?? "");
      setVcFull(vcard.fullName);
      setVcTitle(vcard.title);
      setVcOrg(vcard.org);
      setVcPhone(vcard.phone);
      setVcEmail(vcard.email);
      setVcUrl(vcard.url);
      setTarget("");
    } else if (editType === "atc") {
      setCartItems(parseCartTarget(editQr.target ?? ""));
      setTarget(editQr.target ?? "");
    } else {
      setTarget(editQr.target ?? "");
    }
    setDiscountCode(editQr.discountCode ?? "");
    // An existing code is usually already in Shopify — don't recreate it.
    setAutoCreateDiscount(false);
    setFallbackUrl(editQr.fallbackUrl ?? "");
    setRouting(editQr.rules ?? { rules: [], abTest: null });

    if (QR_STYLES.includes(d.style as QrStyle)) setStyle(d.style as QrStyle);
    if (QR_CORNERS.includes(d.cornerStyle as CornerStyle)) setCornerStyle(d.cornerStyle as CornerStyle);
    if (typeof d.fg === "string") setFg(d.fg);
    if (typeof d.bg === "string") setBg(d.bg);
    if (typeof d.cornerColor === "string") {
      cornerCustomized.current = true;
      setCornerColor(d.cornerColor);
    }
    if (typeof d.logoSize === "number") setLogoSizePct(Math.round(d.logoSize * 100));
    if (typeof d.margin === "number") setQrMargin(d.margin);
    if (d.logoBrand && typeof d.logoBrand === "string") {
      setLogoSel({ kind: "brand", brandId: d.logoBrand });
    } else if (d.logoUrl && typeof d.logoUrl === "string") {
      setLogoSel({ kind: "custom", customUrl: d.logoUrl, customAssetId: typeof d.logoAssetId === "string" ? d.logoAssetId : undefined });
    } else {
      setLogoSel({ kind: "none" });
    }
    const gradient = d.gradient as { from?: unknown; to?: unknown; angle?: unknown } | null | undefined;
    if (gradient && typeof gradient.from === "string" && typeof gradient.to === "string") {
      setGradientOn(true);
      setGradientFrom(gradient.from);
      setGradientTo(gradient.to);
      setGradientAngle(typeof gradient.angle === "number" ? gradient.angle : 45);
    } else {
      setGradientOn(false);
    }

    setLabelText(typeof l.text === "string" ? l.text : "");
    if (LABEL_POSITIONS.includes(l.position as LabelPos)) setLabelPos(l.position as LabelPos);
    if (framesForPosition(l.position as LabelPos).includes(l.frame as FrameStyle)) setFrameStyle(l.frame as FrameStyle);
    if (typeof l.font === "string" && l.font) setLabelFont(l.font);
    if (typeof l.size === "number") setLabelFontSize(l.size);
    setLabelBold(!!l.bold);
    setLabelItalic(!!l.italic);
    setLabelUnderline(!!l.underline);
    if (l.align === "left" || l.align === "center" || l.align === "right") setLabelAlign(l.align);
    if (typeof l.labelColor === "string") setLabelTextColor(l.labelColor);
    if (typeof l.bandColor === "string") setLabelBgColor(l.bandColor);

    setUtmCampaign(editQr.utmCampaign ?? "");
    setUtmSource(editQr.utmSource ?? "");
    setUtmMedium(editQr.utmMedium ?? "qr");
    setUtmTerm(editQr.utmTerm ?? "");
    setScheduleEnabled(!!(editQr.activatesAt || editQr.expiresAt));
    setActivatesAt(toDatetimeLocal(editQr.activatesAt));
    setExpiresAt(toDatetimeLocal(editQr.expiresAt));
    setCampaignId(editQr.campaignId ?? "");
    setActivated(editQr.active);
    setSavedQr({ id: editQr.id, slug: editQr.slug, name: editQr.name });
  }, [editQr]);

  // Compose the effective target whenever sub-fields change.
  const effectiveTarget = (() => {
    if (type === "wifi")  return wifiSsid ? wifiPayload(wifiSsid, wifiPwd, wifiEnc) : "";
    if (type === "vcard") return vcFull ? vcardPayload({ fullName: vcFull, title: vcTitle, org: vcOrg, phone: vcPhone, email: vcEmail, url: vcUrl }) : "";
    if (type === "atc")   return cartTarget(cartItems);
    return target;
  })();
  const isStoreType = STORE_QR_TYPES.includes(QR_TYPE_FROM_UI[type]);


  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    // Only react to QR create/update responses here; template intents use templateFetcher.
    if (fetcher.data.intent && fetcher.data.intent !== "create" && fetcher.data.intent !== "update") return;
    if (fetcher.data.ok) {
      setSavedQr({ id: fetcher.data.id, slug: fetcher.data.slug, name: fetcher.data.name || name || fetcher.data.slug });
      setActivated(fetcher.data.active);
      toast({
        title: submitMode === "activate" ? t("QR code activated") : t("QR code saved"),
        desc: submitMode === "activate" ? t("It is now ready to scan.") : t("Saved to My QR codes."),
      });
      // A QR code going live is a meaningful success — the right moment to
      // let Shopify ask for a review (never on page load).
      if (submitMode === "activate" && fetcher.data.active) void requestReview("qr-activated");
      if (submitMode === "saveExit") navigate("/app/qr-manager");
      // Surface a non-fatal warning if the Shopify discount couldn't be created.
      if ("discountWarning" in fetcher.data && fetcher.data.discountWarning) {
        toast({
          type: "error",
          title: t("Discount code skipped"),
          desc: tm(fetcher.data.discountWarning),
        });
      }
    } else if ("error" in fetcher.data) {
      toast({
        type: "error",
        title: fetcher.data.error === "quota" ? t("Plan limit reached") : fetcher.data.error === "locked" ? t("Feature locked") : t("Could not save"),
        desc: tm(fetcher.data.message),
      });
    }
    setSubmitMode(null);
  }, [fetcher.state, fetcher.data]);

  // Template fetcher feedback — uses a separate fetcher so it doesn't trigger
  // the "QR activated" toast on a successful template save.
  useEffect(() => {
    if (templateFetcher.state !== "idle" || !templateFetcher.data) return;
    const d = templateFetcher.data;
    if (d.intent === "template:save") {
      if (d.ok) toast({ title: t("Template saved"), desc: t("\"{name}\" added to your presets.", { name: d.name }) });
      else      toast({ type: "error", title: t("Could not save template"), desc: tm(d.message) });
    } else if (d.intent === "template:delete") {
      if (d.ok) toast({ title: t("Template removed") });
    }
  }, [templateFetcher.state, templateFetcher.data]);

  const submitting = fetcher.state !== "idle";

  function validateBeforeSave() {
    if (!valid) {
      toast({ type: "error", title: t("Add a name first"), desc: t("QR code name is required before saving.") });
      return false;
    }
    if (scheduleEnabled) {
      if (!activatesAt || !expiresAt) {
        toast({ type: "error", title: t("Schedule incomplete"), desc: t("Set both activation and expiration dates.") });
        return false;
      }
      if (new Date(expiresAt).getTime() <= new Date(activatesAt).getTime()) {
        toast({ type: "error", title: t("Invalid schedule"), desc: t("Expiration must be after activation.") });
        return false;
      }
    }
    return true;
  }

  function submitQr(mode: "save" | "saveExit" | "activate") {
    if (!validateBeforeSave()) return;
    const id = savedQr?.id ?? editQr?.id;
    if (mode === "activate" && !id) {
      toast({ type: "error", title: t("Save first"), desc: t("Save this QR code before activating it.") });
      return;
    }
    const nextActive = mode === "activate" ? true : activated;
    const fd = new FormData();
    fd.set("intent", id ? "update" : "create");
    if (id) fd.set("id", id);
    fd.set("name", name);
    fd.set("description", description);
    fd.set("type", type);
    fd.set("target", effectiveTarget);
    if (shopifyRef) fd.set("shopifyRef", shopifyRef);
    fd.set("design", JSON.stringify({
      style: eff.style, cornerStyle: eff.cornerStyle, fg: eff.fg, bg: eff.bg,
      withLogo: eff.logoSel.kind !== "none",
      logoBrand:    eff.logoSel.kind === "brand"  ? eff.logoSel.brandId       : null,
      logoUrl:      eff.logoSel.kind === "custom" ? eff.logoSel.customUrl     : null,
      logoAssetId:  eff.logoSel.kind === "custom" ? eff.logoSel.customAssetId : null,
      logoSize:     eff.logoSizePct / 100,
      margin:       eff.qrMargin,
      cornerColor:  eff.cornerColor,
      gradient:     eff.gradient,
    }));
    fd.set("label", JSON.stringify({
      text: labelText,
      position: labelPos,
      frame: eff.frameStyle,
      font: eff.labelFont,
      size: eff.labelFontSize,
      bold: eff.labelBold,
      italic: eff.labelItalic,
      underline: eff.labelUnderline,
      align: eff.labelAlign,
      labelColor: hasTextZone ? labelTextColor : undefined,
      bandColor:  hasTextZone ? labelBgColor   : undefined,
    }));
    if (utmCampaign) fd.set("utmCampaign", utmCampaign);
    if (utmSource)   fd.set("utmSource",   utmSource);
    if (utmMedium)   fd.set("utmMedium",   utmMedium);
    if (utmTerm)     fd.set("utmTerm",     utmTerm);
    // Datetime-local inputs return e.g. "2026-05-23T15:30" — convert to ISO 8601
    // (with seconds + Z) so the Zod .datetime() validator accepts them.
    if (scheduleEnabled && activatesAt) fd.set("activatesAt", new Date(activatesAt).toISOString());
    if (scheduleEnabled && expiresAt)   fd.set("expiresAt",   new Date(expiresAt).toISOString());
    if (campaignId)  fd.set("campaignId",  campaignId);
    if (isStoreType && type !== "promo") fd.set("discountCode", discountCode.trim());
    const codeForAutoCreate = type === "promo" ? target : isStoreType ? discountCode : "";
    if (!id && autoCreateDiscount && codeForAutoCreate.trim()) {
      fd.set("autoCreateDiscount", "1");
      fd.set("discountValuePct", String(discountValuePct / 100));
    }
    if (plan.customFallback) fd.set("fallbackUrl", fallbackUrl.trim());
    if (plan.smartRouting) fd.set("rules", JSON.stringify(routing));
    fd.set("activate", nextActive ? "1" : "0");
    setSubmitMode(mode);
    fetcher.submit(fd, { method: "post" });
  }

  async function handleDownload(format: DownloadFormat) {
    if (!savedQr) {
      toast({ type: "error", title: t("Save first"), desc: t("Save this QR code before downloading it.") });
      return;
    }
    if (format !== "png" && !canExport) {
      toast({ type: "info", title: t("{format} download is locked", { format: format.toUpperCase() }), desc: t("Upgrade to {exportPlan} for SVG and PDF files.", { exportPlan }) });
      return;
    }
    setDownloading(format);
    try {
      await downloadQrAsset({ id: savedQr.id, slug: savedQr.slug, name: name || savedQr.name || savedQr.slug }, format);
      toast({ title: t("{format} downloaded", { format: format.toUpperCase() }), type: "info" });
    } catch (err) {
      toast({ type: "error", title: t("Download failed"), desc: err instanceof Error ? tm(err.message) : t("Try again.") });
    } finally {
      setDownloading(null);
    }
  }

  /* Reset the entire Design card to defaults — fg/bg/style/corners + advanced. */
  function resetDesign() {
    setStyle("rounded");
    setCornerStyle("rounded");
    setFg("#0B1220");
    setBg("#FFFFFF");
    setLogoSel({ kind: "none" });
    setLogoSizePct(20);
    setQrMargin(8);
    cornerCustomized.current = false;
    setCornerColor("#0B1220");
    setGradientOn(false);
    setGradientFrom("#2563EB");
    setGradientTo("#7C3AED");
    setGradientAngle(45);
  }

  /* Reset the Label card — text untouched (often the merchant typed it), but
     every formatting / position / frame option goes back to defaults. */
  function resetLabel() {
    setLabelPos("bottom");
    setFrameStyle("none");
    setLabelFont(DEFAULT_FONT);
    setLabelFontSize(16);
    setLabelBold(false);
    setLabelItalic(false);
    setLabelUnderline(false);
    setLabelAlign("center");
    setLabelTextColor(fg);
    setLabelBgColor(fg);
  }

  /* Reset destination-specific state when type changes. */
  function changeType(newType: QrTypeId) {
    setType(newType);
    setActivated(false);
    setTarget("");
    setShopifyRef(null);
    setSelectedLabel("");
    setCartItems([]);
  }

  /* ── Template handlers ── */
  function currentDesignSnapshot() {
    return {
      style, cornerStyle, fg, bg,
      withLogo: logoSel.kind !== "none",
      logoBrand:    logoSel.kind === "brand"  ? logoSel.brandId       : null,
      logoUrl:      logoSel.kind === "custom" ? logoSel.customUrl     : null,
      logoAssetId:  logoSel.kind === "custom" ? logoSel.customAssetId : null,
      logoSize:     logoSizePct / 100,
      margin:       qrMargin,
      cornerColor,
      gradient:     gradientOn ? { from: gradientFrom, to: gradientTo, angle: gradientAngle } : null,
    };
  }
  function currentLabelSnapshot() {
    return {
      position: labelPos,
      frame: frameStyle,
      font: labelFont,
      size: labelFontSize,
      bold: labelBold,
      italic: labelItalic,
      underline: labelUnderline,
      align: labelAlign,
      labelColor: hasTextZone ? labelTextColor : undefined,
      bandColor:  hasTextZone ? labelBgColor   : undefined,
    };
  }

  function saveTemplate() {
    const name = templateName.trim();
    if (!name) {
      toast({ type: "error", title: t("Name required"), desc: t("Give the template a name first.") });
      return;
    }
    const fd = new FormData();
    fd.set("intent", "template:save");
    fd.set("name", name);
    fd.set("design", JSON.stringify(currentDesignSnapshot()));
    fd.set("label",  JSON.stringify(currentLabelSnapshot()));
    templateFetcher.submit(fd, { method: "post" });
    setTemplateName("");
    setShowTemplateSave(false);
  }

  function applyTemplate(item: typeof templates[number]) {
    const d = item.design as Record<string, unknown>;
    const l = item.label  as Record<string, unknown>;
    // Design
    if (typeof d.style === "string") setStyle(d.style as QrStyle);
    if (typeof d.cornerStyle === "string") setCornerStyle(d.cornerStyle as CornerStyle);
    if (typeof d.fg === "string") setFg(d.fg);
    if (typeof d.bg === "string") setBg(d.bg);
    if (typeof d.logoSize === "number") setLogoSizePct(Math.round(d.logoSize * 100));
    if (typeof d.margin === "number") setQrMargin(d.margin);
    if (typeof d.cornerColor === "string") {
      cornerCustomized.current = true;
      setCornerColor(d.cornerColor);
    }
    const grad = d.gradient as { from?: string; to?: string; angle?: number } | null | undefined;
    if (grad && grad.from && grad.to) {
      setGradientOn(true);
      setGradientFrom(grad.from);
      setGradientTo(grad.to);
      if (typeof grad.angle === "number") setGradientAngle(grad.angle);
    } else {
      setGradientOn(false);
    }
    // Label
    if (typeof l.position === "string") setLabelPos(l.position as LabelPos);
    if (typeof l.frame === "string") setFrameStyle(l.frame as FrameStyle);
    if (typeof l.font === "string") setLabelFont(l.font);
    if (typeof l.size === "number") setLabelFontSize(l.size);
    if (typeof l.bold === "boolean") setLabelBold(l.bold);
    if (typeof l.italic === "boolean") setLabelItalic(l.italic);
    if (typeof l.underline === "boolean") setLabelUnderline(l.underline);
    if (typeof l.align === "string") setLabelAlign(l.align as "left" | "center" | "right");
    if (typeof l.labelColor === "string") setLabelTextColor(l.labelColor);
    if (typeof l.bandColor  === "string") setLabelBgColor(l.bandColor);
    toast({ title: t("Template applied"), desc: item.name });
  }

  function removeTemplate(id: string) {
    const fd = new FormData();
    fd.set("intent", "template:delete");
    fd.set("id", id);
    templateFetcher.submit(fd, { method: "post" });
  }

  /* App Bridge resource pickers — for product/atc types. */
  async function pickProduct() {
    try {
      const result = await (shopify as unknown as { resourcePicker: (opts: { type: string; multiple: boolean; filter?: { variants?: boolean } }) => Promise<unknown> })
        .resourcePicker({ type: "product", multiple: false, filter: { variants: false } });
      const arr = result as Array<{ id: string; title: string; handle: string }> | undefined;
      if (arr && arr.length > 0) {
        const p = arr[0];
        setTarget(p.handle);
        setShopifyRef(p.id);
        setSelectedLabel(p.title);
      }
    } catch (err) {
      console.error("resourcePicker failed", err);
      toast({ type: "error", title: t("Picker unavailable"), desc: t("Open this app inside Shopify admin to pick products.") });
    }
  }

  /** Add-to-cart: pick one or several variants (quantities are set in the list). */
  async function pickVariant() {
    try {
      const result = await (shopify as unknown as { resourcePicker: (opts: { type: string; multiple: boolean | number; filter?: { variants?: boolean } }) => Promise<unknown> })
        .resourcePicker({ type: "product", multiple: 10, filter: { variants: true } });
      const arr = result as Array<{ id: string; title: string; handle: string; variants?: Array<{ id: string; title: string }> }> | undefined;
      if (!arr?.length) return;
      const picked: CartItem[] = [];
      for (const p of arr) {
        for (const v of p.variants ?? []) {
          // Variant gid → numeric id for /cart/{id}:{qty}
          const numericId = v.id.split("/").pop() ?? "";
          if (!/^\d+$/.test(numericId)) continue;
          const title = v.title && v.title !== "Default Title" ? `${p.title} — ${v.title}` : p.title;
          picked.push({ variantId: numericId, title, quantity: 1 });
        }
      }
      if (!picked.length) return;
      // Keep quantities of variants already in the cart.
      setCartItems(prev => picked.map(item => prev.find(x => x.variantId === item.variantId) ?? item).slice(0, 20));
      setShopifyRef(arr[0].variants?.[0]?.id ?? arr[0].id);
    } catch (err) {
      console.error("resourcePicker (variant) failed", err);
      toast({ type: "error", title: t("Picker unavailable"), desc: t("Open this app inside Shopify admin to pick products.") });
    }
  }

  async function pickCollection() {
    try {
      const result = await (shopify as unknown as { resourcePicker: (opts: { type: string; multiple: boolean }) => Promise<unknown> })
        .resourcePicker({ type: "collection", multiple: false });
      const arr = result as Array<{ id: string; title: string; handle: string }> | undefined;
      if (arr && arr.length > 0) {
        const c = arr[0];
        setTarget(c.handle);
        setShopifyRef(c.id);
        setSelectedLabel(c.title);
      }
    } catch (err) {
      console.error("resourcePicker (collection) failed", err);
      toast({ type: "error", title: t("Picker unavailable"), desc: t("Open this app inside Shopify admin to pick collections.") });
    }
  }

  const meta = typeMeta(type);

  const previewText = savedQr?.slug
    ? `${origin}/s/${savedQr.slug}`
    : effectiveTarget || (name ? `${name} · ${meta.name}` : "TrackQr placeholder");

  const labelFontSpec = getLabelFont(labelFont);

  const valid = name.trim().length > 0 && (
    type === "home"  ? true :
    type === "wifi"  ? wifiSsid.length > 0 :
    type === "vcard" ? vcFull.length > 0 :
    type === "atc"   ? cartItems.length > 0 :
    effectiveTarget.length > 0
  );
  const previewLabel: QrLabelOpts = {
    text: labelText,
    position: labelPos,
    frame: eff.frameStyle,
    font: eff.labelFont,
    size: eff.labelFontSize,
    bold: eff.labelBold,
    italic: eff.labelItalic,
    underline: eff.labelUnderline,
    align: eff.labelAlign,
    labelColor: hasTextZone ? labelTextColor : undefined,
    bandColor:  hasTextZone ? labelBgColor   : undefined,
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => navigate(isEditing ? "/app/qr-manager" : "/app")} style={{ marginBottom: 8, marginLeft: -10 }}>
            {isEditing ? t("Back to My QR codes") : t("Back to dashboard")}
          </Button>
          <h1 className="page-h1">{isEditing ? tem("Edit <em>QR code</em>") : tem("Create a <em>QR code</em>")}</h1>
          <div className="page-sub">{t("Configure the destination, customize the design, add a label, activate when ready.")}</div>
        </div>
      </div>

      <div style={{
        display: "grid",
        // Form takes the rest, preview column grows to fit its content
        // (long labels in left/right positions need extra horizontal room).
        gridTemplateColumns: "minmax(0, 1fr) minmax(420px, max-content)",
        gap: 24,
        alignItems: "start",
      }}>

        {/* ══ LEFT — Form ══ */}
        <div className="col gap-4">

          {/* Templates — saved design+label presets (custom-design feature) */}
          {canCustomDesign && (templates.length > 0 || showTemplateSave) && (
            <Card className="card-pad-lg">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>
                    <Icon name="layers" size={14} style={{ verticalAlign: "-2px", marginRight: 6, color: "var(--accent)" }} />
                    {t("Templates")}
                  </div>
                  <div className="section-sub">{t("Apply a saved design preset or capture the current style.")}</div>
                </div>
                <Button size="sm" variant="secondary" icon="save" onClick={() => setShowTemplateSave(v => !v)}>
                  {showTemplateSave ? t("Cancel") : t("Save current")}
                </Button>
              </div>

              {showTemplateSave && (
                <div className="mt-3" style={{ display: "flex", gap: 8 }}>
                  <Input
                    placeholder={t("e.g. Brand summer 2026")}
                    value={templateName}
                    onChange={e => setTemplateName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveTemplate(); } }}
                    style={{ flex: 1 }}
                  />
                  <Button size="md" variant="primary" onClick={saveTemplate}>{t("Save")}</Button>
                </div>
              )}

              {templates.length > 0 && (
                <div className="template-grid mt-3">
                  {templates.map(tpl => {
                    const td = tpl.design as { fg?: string; bg?: string; gradient?: { from: string; to: string } | null };
                    const swatchFg = td.gradient?.from ?? td.fg ?? "#0B1220";
                    const swatchFg2 = td.gradient?.to ?? swatchFg;
                    const swatchBg = td.bg ?? "#FFFFFF";
                    return (
                      <div key={tpl.id} className="template-card">
                        <button
                          type="button"
                          className="template-apply"
                          onClick={() => applyTemplate(tpl)}
                          title={t("Apply \"{name}\"", { name: tpl.name })}
                        >
                          <div
                            className="template-swatch"
                            style={{ background: `linear-gradient(135deg, ${swatchFg} 0%, ${swatchFg2} 100%)` }}
                          >
                            <div className="template-swatch-inner" style={{ background: swatchBg }} />
                          </div>
                          <div className="template-name">{tpl.name}</div>
                        </button>
                        <button
                          type="button"
                          className="template-del"
                          onClick={(e) => { e.stopPropagation(); removeTemplate(tpl.id); }}
                          title={t("Delete template")}
                          aria-label={t("Delete {name}", { name: tpl.name })}
                        >
                          <Icon name="trash" size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* Floating "Save as template" button shown when no templates exist yet */}
          {canCustomDesign && templates.length === 0 && !showTemplateSave && (
            <div style={{ textAlign: "right", margin: "-4px 0 0" }}>
              <Button size="sm" variant="ghost" icon="save" onClick={() => setShowTemplateSave(true)}>
                {t("Save this design as a template")}
              </Button>
            </div>
          )}

          {/* Basics */}
          <Card className="card-pad-lg">
            <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>{t("Basics")}</div>
            <div className="section-sub">{t("Internal label and notes — only visible to your team.")}</div>
            <div className="grid grid-2 mt-4">
              <Field label={t("QR code name")} required hint={t("e.g. 'Summer drop · Hero banner'")}>
                <Input placeholder={t("Untitled QR code")} value={name} onChange={e => setName(e.target.value)} />
              </Field>
              <Field label={t("Description")} hint={t("Optional — visible in My QR codes")}>
                <Input placeholder={t("Add a description")} value={description} onChange={e => setDescription(e.target.value)} />
              </Field>
            </div>
          </Card>

          {/* Destination */}
          <Card className="card-pad-lg">
            <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>{t("Destination")}</div>
            <div className="section-sub">{t("Pick what visitors will see when they scan.")}</div>

            <div className="text-xs strong" style={{ color: "var(--fg-muted)", margin: "16px 0 8px", letterSpacing: ".06em", textTransform: "uppercase", fontFamily: "var(--ff-mono)" }}>
              {t("Shopify")}
            </div>
            <div className="tile-grid">
              {QR_TYPES.filter(item => item.group === "shopify" || (item.group === "legacy" && type === item.id)).map(item => (
                <button type="button" key={item.id} className={`tile ${type === item.id ? "active" : ""}`}
                  aria-pressed={type === item.id}
                  onClick={() => changeType(item.id as QrTypeId)}>
                  <div className="tile-icon"><Icon name={item.icon} /></div>
                  <div className="tile-name">{t(item.name)}</div>
                </button>
              ))}
            </div>

            <div className="text-xs strong" style={{ color: "var(--fg-muted)", margin: "20px 0 8px", letterSpacing: ".06em", textTransform: "uppercase", fontFamily: "var(--ff-mono)" }}>
              {t("Custom")}
            </div>
            <div className="tile-grid">
              {QR_TYPES.filter(item => item.group === "custom").map(item => (
                <button type="button" key={item.id} className={`tile ${type === item.id ? "active" : ""}`}
                  aria-pressed={type === item.id}
                  onClick={() => changeType(item.id as QrTypeId)}>
                  <div className="tile-icon"><Icon name={item.icon} /></div>
                  <div className="tile-name">{t(item.name)}</div>
                </button>
              ))}
            </div>

            <div className="mt-6">
              {type === "product" && (
                <Field label={t("Shopify product")} hint={t("Browse your live Shopify catalog.")}>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" icon="search" onClick={pickProduct}>
                      {selectedLabel ? t("Change product") : t("Browse products")}
                    </Button>
                    {selectedLabel && (
                      <div style={{
                        flex: 1, fontSize: 13, padding: "8px 12px",
                        background: "var(--bg-sunken)", border: "1px solid var(--border-soft)",
                        borderRadius: 8, display: "flex", alignItems: "center", gap: 8,
                      }}>
                        <Icon name="package" size={14} style={{ color: "var(--accent)" }} />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedLabel}</span>
                        <span style={{ fontSize: 11, fontFamily: "var(--ff-mono)", color: "var(--fg-muted)" }}>/{target}</span>
                      </div>
                    )}
                  </div>
                </Field>
              )}

              {type === "collection" && (
                <Field label={t("Shopify collection")} hint={t("Scans open the collection page of your store.")}>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" icon="search" onClick={pickCollection}>
                      {selectedLabel || target ? t("Change collection") : t("Browse collections")}
                    </Button>
                    {(selectedLabel || target) && (
                      <div className="picked-chip">
                        <Icon name="grid" size={14} style={{ color: "var(--accent)" }} />
                        <span className="picked-chip-label">{selectedLabel || target}</span>
                        <span className="picked-chip-path">/collections/{target}</span>
                      </div>
                    )}
                  </div>
                </Field>
              )}

              {type === "page" && (
                <Field label={t("Page of your store")} hint={t("A page, blog post, policy or any path of your storefront — e.g. /pages/about-us or /blogs/news/spring-lookbook.")}>
                  <div className="input-prefix">
                    <span className="input-prefix-label">{shopDomain}</span>
                    <input
                      className="input"
                      placeholder="/pages/about-us"
                      value={target}
                      onChange={e => setTarget(e.target.value.trim().startsWith("http") ? e.target.value.trim() : e.target.value)}
                    />
                  </div>
                </Field>
              )}

              {type === "atc" && (
                <Field label={t("Products added to the cart")} hint={t("Scans open a pre-filled cart with these variants and quantities (up to 20).")}>
                  <div className="col gap-2">
                    {cartItems.length > 0 && (
                      <div className="cart-items">
                        {cartItems.map(item => (
                          <div key={item.variantId} className="cart-item">
                            <Icon name="shopping-cart" size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
                            <span className="cart-item-title">{item.title}</span>
                            <div className="qty-stepper" role="group" aria-label={t("Quantity for {title}", { title: item.title })}>
                              <button type="button" aria-label={t("Decrease quantity")} disabled={item.quantity <= 1}
                                onClick={() => setCartItems(items => items.map(i => i.variantId === item.variantId ? { ...i, quantity: Math.max(1, i.quantity - 1) } : i))}>−</button>
                              <span className="num">{item.quantity}</span>
                              <button type="button" aria-label={t("Increase quantity")} disabled={item.quantity >= 99}
                                onClick={() => setCartItems(items => items.map(i => i.variantId === item.variantId ? { ...i, quantity: Math.min(99, i.quantity + 1) } : i))}>+</button>
                            </div>
                            <button type="button" className="routing-icon-btn danger" aria-label={t("Remove {title}", { title: item.title })}
                              onClick={() => setCartItems(items => items.filter(i => i.variantId !== item.variantId))}>
                              <Icon name="x" size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div>
                      <Button variant="secondary" icon="search" onClick={pickVariant}>
                        {cartItems.length ? t("Change products") : t("Browse products & variants")}
                      </Button>
                    </div>
                  </div>
                </Field>
              )}

              {isStoreType && type !== "promo" && (
                <div className="mt-4 discount-box">
                  <Field label={t("Apply a discount code (optional)")} hint={t("The code is applied automatically when the QR code is scanned — great for in-store and packaging offers.")}>
                    <Input icon="tag" placeholder="WELCOME10" value={discountCode} onChange={e => setDiscountCode(e.target.value.toUpperCase())} />
                  </Field>
                  {discountCode.trim() && !isEditing && (
                    <div className="mt-3">
                      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={autoCreateDiscount}
                          onChange={e => setAutoCreateDiscount(e.target.checked)}
                          style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                        />
                        <span style={{ fontSize: 12.5, color: "var(--fg-strong)" }}>{t("Create this code in Shopify ({value}% off)", { value: discountValuePct })}</span>
                      </label>
                      {autoCreateDiscount && (
                        <RangeSlider
                          min={5}
                          max={50}
                          step={5}
                          value={discountValuePct}
                          onChange={setDiscountValuePct}
                          className="mt-2"
                          aria-label={t("Discount value")}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {type === "promo" && (
                <>
                  <Field label={t("Discount code")} hint={t("The code is applied to the visitor's cart and they land on your store.")}>
                    <Input icon="tag" placeholder="FREESHIP" value={target} onChange={e => setTarget(e.target.value.toUpperCase())} />
                  </Field>
                  <div className="mt-3" style={{ padding: 12, background: "var(--bg-sunken)", border: "1px solid var(--border-soft)", borderRadius: 10 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        aria-label={t("Auto-create this discount in Shopify")}
                        checked={autoCreateDiscount}
                        onChange={e => setAutoCreateDiscount(e.target.checked)}
                        style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-strong)" }}>
                          {t("Auto-create this discount in Shopify")}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>
                          {t("Creates a percentage-off discount code via Shopify Admin. Skip if the code already exists.")}
                        </div>
                      </div>
                    </label>
                    {autoCreateDiscount && (
                      <div className="mt-3" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ fontSize: 12, color: "var(--fg-muted)", minWidth: 70 }}>{t("Value · {value}%", { value: discountValuePct })}</div>
                        <RangeSlider
                          min={5}
                          max={50}
                          step={5}
                          value={discountValuePct}
                          onChange={setDiscountValuePct}
                          style={{ flex: 1 }}
                          aria-label={t("Discount value")}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              {(type === "link" || type === "url") && (
                <Field label={t("Destination URL")} hint={t("Any https:// link — you can change it later without reprinting.")}>
                  <Input icon="link" placeholder="https://aurora.co/landing" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}

              {type === "home" && (
                <div className="text-sm muted" style={{ padding: 12, background: "var(--bg-sunken)", borderRadius: 8, border: "1px solid var(--border-soft)" }}>
                  <Icon name="home" size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  {t("Scans will open your storefront home page. No additional config required.")}
                </div>
              )}

              {type === "text" && (
                <Field label={t("Text content")} hint={t("Shown on a landing page when scanned (with copy-to-clipboard).")}>
                  <Textarea placeholder={t("Anything you want — instructions, a message, a serial number…")} value={target} onChange={e => setTarget(e.target.value)} rows={3} />
                </Field>
              )}

              {(type === "phone" || type === "sms") && (
                <Field label={type === "sms" ? t("SMS number") : t("Phone number")} hint={t("International format recommended (E.164).")}>
                  <Input icon={type === "sms" ? "message-square" : "phone"} placeholder="+1 800 278 7622" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}

              {type === "email" && (
                <Field label={t("Email address")} hint={t("Tapping the QR opens the visitor's mail app.")}>
                  <Input icon="mail" placeholder="hello@aurora.co" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}

              {type === "wifi" && (
                <>
                  <div className="grid grid-2">
                    <Field label={t("Network name (SSID)")} required>
                      <Input icon="wifi" placeholder={t("Aurora Guest")} value={wifiSsid} onChange={e => setWifiSsid(e.target.value)} />
                    </Field>
                    <Field label={t("Encryption")}>
                      <Segmented value={wifiEnc} onChange={v => setWifiEnc(v as "WPA" | "WEP" | "nopass")}
                        options={[
                          { value: "WPA", label: "WPA/WPA2" },
                          { value: "WEP", label: "WEP" },
                          { value: "nopass", label: t("None") },
                        ]} />
                    </Field>
                  </div>
                  {wifiEnc !== "nopass" && (
                    <Field label={t("Password")} className="mt-4">
                      <Input type="password" placeholder="••••••••" value={wifiPwd} onChange={e => setWifiPwd(e.target.value)} />
                    </Field>
                  )}
                  <div className="text-xs muted mt-2">{t("Camera apps will auto-prompt to connect on iOS & Android.")}</div>
                </>
              )}

              {type === "vcard" && (
                <>
                  <div className="grid grid-2">
                    <Field label={t("Full name")} required><Input placeholder={t("Aurora Sasaki")} value={vcFull} onChange={e => setVcFull(e.target.value)} /></Field>
                    <Field label={t("Title")}><Input placeholder={t("Founder")} value={vcTitle} onChange={e => setVcTitle(e.target.value)} /></Field>
                    <Field label={t("Organization")}><Input placeholder={t("Aurora Studios")} value={vcOrg} onChange={e => setVcOrg(e.target.value)} /></Field>
                    <Field label={t("Phone")}><Input icon="phone" placeholder="+1 800 278 7622" value={vcPhone} onChange={e => setVcPhone(e.target.value)} /></Field>
                    <Field label={t("Email")}><Input icon="mail" placeholder="aurora@aurora.co" value={vcEmail} onChange={e => setVcEmail(e.target.value)} /></Field>
                    <Field label={t("Website")}><Input icon="link" placeholder="https://aurora.co" value={vcUrl} onChange={e => setVcUrl(e.target.value)} /></Field>
                  </div>
                  <div className="text-xs muted mt-2">{t("Scanning prompts “Add contact” in the camera app.")}</div>
                </>
              )}
            </div>
          </Card>

          {/* Design */}
          <Card className="card-pad-lg">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>{t("Design")}</div>
                <div className="section-sub">
                  {canCustomDesign
                    ? t("Pattern, finders, colors and an optional logo at the center.")
                    : t("Standard style on the {name} plan — dark modules on white, square pattern, no logo.", { name: plan.name })}
                </div>
              </div>
              {canCustomDesign && (
                <Button size="sm" variant="ghost" icon="undo" onClick={resetDesign} title={t("Reset design to defaults")}>{t("Reset")}</Button>
              )}
            </div>

            {!canCustomDesign ? (
              <div className="mt-4">
                <FeatureLock
                  title={t("Logo, colors, shapes & gradients")}
                  desc={isEditing
                    ? t("Brand your QR codes with your logo, custom colors, rounded or dotted patterns and saved design templates on {plan}. Designs saved on a higher plan come back as soon as you upgrade.", { plan: designPlan })
                    : t("Brand your QR codes with your logo, custom colors, rounded or dotted patterns and saved design templates on {plan}.", { plan: designPlan })}
                  plan={designPlan}
                />
              </div>
            ) : (
            <>
            <Field label={t("Pattern style")} hint={t("Affects every module except the corner finders.")} className="mt-4">
              <div className="style-picker">
                {QR_STYLES.map(s => (
                  <button type="button" key={s} className={`style-opt ${style === s ? "active" : ""}`} aria-pressed={style === s} onClick={() => setStyle(s)}>
                    <div className="style-opt-illus">
                      <StyleIllus qrStyle={s} size={36} />
                    </div>
                    <div className="style-opt-label">{s}</div>
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t("Corner finders")} hint={t("The three big squares — affect scanning reliability.")} className="mt-4">
              <div className="style-picker" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {QR_CORNERS.map(c => (
                  <button type="button" key={c} className={`style-opt ${cornerStyle === c ? "active" : ""}`} aria-pressed={cornerStyle === c} onClick={() => setCornerStyle(c)}>
                    <div className="style-opt-illus"><CornerMini corner={c} /></div>
                    <div className="style-opt-label">{c.replace("-", " ")}</div>
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-2 mt-4">
              <Field label={t("Foreground")} hint={t("The dark modules.")}>
                <div className="swatch-row">
                  {QR_COLORS.map(c => (
                    <button type="button" key={c} className={`swatch ${fg === c ? "active" : ""}`} style={{ background: c }} aria-label={t("Color {c}", { c })} aria-pressed={fg === c} onClick={() => setFg(c)} />
                  ))}
                  <label className={`swatch swatch-picker ${!QR_COLORS.includes(fg) ? "active" : ""}`} title={t("Custom color")}>
                    <input type="color" value={fg} onChange={e => setFg(e.target.value)} />
                    <span className="picker-icon"><Icon name="edit" size={11} /></span>
                  </label>
                </div>
                {!QR_COLORS.includes(fg) && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--ff-mono)", display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: fg, border: "1px solid var(--border)" }} />
                    {fg.toUpperCase()}
                  </div>
                )}
              </Field>
              <Field label={t("Background")} hint={t("Keep contrast strong for reliable scanning.")}>
                <div className="swatch-row">
                  {QR_BG_COLORS.map(c => (
                    <button type="button" key={c} className={`swatch ${bg === c ? "active" : ""}`} style={{ background: c }} aria-label={t("Color {c}", { c })} aria-pressed={bg === c} onClick={() => setBg(c)} />
                  ))}
                  <label className={`swatch swatch-picker ${!QR_BG_COLORS.includes(bg) ? "active" : ""}`} title={t("Custom color")}>
                    <input type="color" value={bg} onChange={e => setBg(e.target.value)} />
                    <span className="picker-icon"><Icon name="edit" size={11} /></span>
                  </label>
                </div>
                {!QR_BG_COLORS.includes(bg) && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--ff-mono)", display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: bg, border: "1px solid var(--border)" }} />
                    {bg.toUpperCase()}
                  </div>
                )}
              </Field>
            </div>

            {/* WCAG-style contrast indicator — warns when the picked fg/bg
                combination would produce a QR that scanners can't reliably read. */}
            <div
              className={`contrast-pill contrast-${contrastInfo.level}`}
              role="status"
              aria-live="polite"
            >
              <Icon
                name={contrastInfo.level === "ok" ? "circle-check" : "alert-triangle"}
                size={13}
              />
              <span>{tm(contrastInfo.message)}</span>
            </div>

            <Field label={t("Center logo")} hint={t("Pick a brand logo or upload your own. Higher error correction is auto-applied.")} className="mt-4">
              <LogoPicker value={logoSel} onChange={setLogoSel} />
            </Field>

            {logoSel.kind !== "none" && (
              <Field label={t("Logo size · {logoSizePct}%", { logoSizePct })} hint={t("Smaller logo = more reliable scan. 20% is the sweet spot.")} className="mt-4">
                <RangeSlider min={10} max={30} step={1} value={logoSizePct} onChange={setLogoSizePct} aria-label={t("Logo size")} />
              </Field>
            )}

            {/* ── Advanced design controls ── */}
            <div className="advanced-divider mt-6">
              <span>{t("Advanced")}</span>
            </div>

            <Field label={t("Quiet zone (margin) · {qrMargin}px", { qrMargin })} hint={t("White space around the QR. Bigger = more reliable scanning, especially in print.")} className="mt-3">
              <RangeSlider min={0} max={24} step={2} value={qrMargin} onChange={setQrMargin} aria-label={t("Quiet zone")} />
            </Field>

            <Field label={t("Finder (eye) color")} hint={t("Color of the 3 corner squares. Defaults to the foreground.")} className="mt-4">
              <div className="swatch-row">
                {QR_COLORS.map(c => (
                  <button type="button" key={c}
                    className={`swatch ${cornerColor === c ? "active" : ""}`}
                    style={{ background: c }}
                    aria-label={t("Color {c}", { c })}
                    aria-pressed={cornerColor === c}
                    onClick={() => { cornerCustomized.current = true; setCornerColor(c); }}
                  />
                ))}
                <label className={`swatch swatch-picker ${!QR_COLORS.includes(cornerColor) ? "active" : ""}`} title={t("Custom color")}>
                  <input type="color" value={cornerColor} onChange={e => { cornerCustomized.current = true; setCornerColor(e.target.value); }} />
                  <span className="picker-icon"><Icon name="edit" size={11} /></span>
                </label>
                {cornerCustomized.current && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => { cornerCustomized.current = false; setCornerColor(fg); }}
                    title={t("Sync with foreground")}
                    style={{ marginLeft: 6 }}
                  >
                    {t("sync with fg")}
                  </button>
                )}
              </div>
            </Field>

            <Field
              label={t("Gradient foreground")}
              hint={t("Use a linear gradient instead of a flat color for the QR modules. Premium look.")}
              className="mt-4"
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: gradientOn ? 10 : 0 }}>
                <label className="toggle">
                  <input type="checkbox" aria-label={t("Gradient foreground")} checked={gradientOn} onChange={e => setGradientOn(e.target.checked)} />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                </label>
                <span style={{ fontSize: 12.5, color: "var(--fg-muted)" }}>
                  {gradientOn ? t("Gradient active — overrides foreground color") : t("Solid foreground")}
                </span>
              </div>

              {gradientOn && (
                <div className="grid grid-2" style={{ gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginBottom: 4 }}>{t("From")}</div>
                    <div className="swatch-row">
                      {QR_COLORS.map(c => (
                        <button type="button" key={c} className={`swatch ${gradientFrom === c ? "active" : ""}`} style={{ background: c }} aria-label={t("Color {c}", { c })} aria-pressed={gradientFrom === c} onClick={() => setGradientFrom(c)} />
                      ))}
                      <label className={`swatch swatch-picker ${!QR_COLORS.includes(gradientFrom) ? "active" : ""}`} title={t("Custom color")}>
                        <input type="color" value={gradientFrom} onChange={e => setGradientFrom(e.target.value)} />
                        <span className="picker-icon"><Icon name="edit" size={11} /></span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginBottom: 4 }}>{t("To")}</div>
                    <div className="swatch-row">
                      {QR_COLORS.map(c => (
                        <button type="button" key={c} className={`swatch ${gradientTo === c ? "active" : ""}`} style={{ background: c }} aria-label={t("Color {c}", { c })} aria-pressed={gradientTo === c} onClick={() => setGradientTo(c)} />
                      ))}
                      <label className={`swatch swatch-picker ${!QR_COLORS.includes(gradientTo) ? "active" : ""}`} title={t("Custom color")}>
                        <input type="color" value={gradientTo} onChange={e => setGradientTo(e.target.value)} />
                        <span className="picker-icon"><Icon name="edit" size={11} /></span>
                      </label>
                    </div>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginBottom: 4 }}>{t("Angle · {angle}°", { angle: gradientAngle })}</div>
                    <RangeSlider min={0} max={360} step={15} value={gradientAngle} onChange={setGradientAngle} aria-label={t("Gradient angle")} />
                  </div>
                </div>
              )}
            </Field>
            </>
            )}
          </Card>

          {/* Label */}
          <Card className="card-pad-lg">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>{t("Label")}</div>
                <div className="section-sub">{t("Add text around the QR — “Scan me”, a brand name, or a tagline.")}</div>
              </div>
              {canCustomDesign && (
                <Button size="sm" variant="ghost" icon="undo" onClick={resetLabel} title={t("Reset label formatting to defaults")}>{t("Reset")}</Button>
              )}
            </div>

            <Field label={t("Text")} hint={t("{length}/20 chars · keep it short for the best read", { length: labelText.length })} className="mt-4">
              <Input
                value={labelText}
                onChange={e => setLabelText(e.target.value.slice(0, 20))}
                placeholder={t("Scan to discover")}
                maxLength={20}
              />
              {/* Rich text toolbar — font, size, B/I/U, alignment. Every change
                  reflects live in the preview on the right. */}
              {canCustomDesign && (
              <div className="rte-bar" role="toolbar" aria-label={t("Label formatting")}>
                <select
                  className="rte-select"
                  value={labelFont}
                  onChange={e => setLabelFont(e.target.value)}
                  title={t("Font")}
                  style={{
                    fontFamily: labelFontSpec.family,
                    fontWeight: labelFontSpec.weight,
                    letterSpacing: labelFontSpec.letterSpacing,
                    textTransform: labelFontSpec.textTransform,
                    minWidth: 150,
                  }}
                >
                  {/* Group fonts by category so the long list stays scannable. */}
                  {(Object.keys(LABEL_FONT_GROUPS) as Array<keyof typeof LABEL_FONT_GROUPS>).map(g => {
                    const fonts = LABEL_FONTS.filter(f => f.group === g);
                    if (!fonts.length) return null;
                    return (
                      <optgroup key={g} label={LABEL_FONT_GROUPS[g]}>
                        {fonts.map(f => (
                          <option key={f.value} value={f.value}
                            style={{
                              fontFamily: f.family,
                              fontWeight: f.weight,
                              letterSpacing: f.letterSpacing,
                              textTransform: f.textTransform,
                            }}>
                            {f.name}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>

                <select
                  className="rte-select"
                  value={labelFontSize}
                  onChange={e => setLabelFontSize(Number(e.target.value))}
                  title={t("Size")}
                  style={{ minWidth: 64 }}
                >
                  {[10, 12, 14, 16, 18, 20, 24, 28, 32].map(s => (
                    <option key={s} value={s}>{s}px</option>
                  ))}
                </select>

                <div className="rte-sep" />

                <div className="rte-group">
                  <button type="button"
                    className={`rte-btn ${labelBold ? "active" : ""}`}
                    aria-pressed={labelBold}
                    title={t("Bold")}
                    onClick={() => setLabelBold(v => !v)}>
                    <Icon name="bold" size={14} />
                  </button>
                  <button type="button"
                    className={`rte-btn ${labelItalic ? "active" : ""}`}
                    aria-pressed={labelItalic}
                    title={t("Italic")}
                    onClick={() => setLabelItalic(v => !v)}>
                    <Icon name="italic" size={14} />
                  </button>
                  <button type="button"
                    className={`rte-btn ${labelUnderline ? "active" : ""}`}
                    aria-pressed={labelUnderline}
                    title={t("Underline")}
                    onClick={() => setLabelUnderline(v => !v)}>
                    <Icon name="underline" size={14} />
                  </button>
                </div>

                <div className="rte-sep" />

                <div className="rte-group" role="radiogroup" aria-label={t("Text alignment")}>
                  <button type="button"
                    className={`rte-btn ${labelAlign === "left" ? "active" : ""}`}
                    aria-pressed={labelAlign === "left"}
                    title={t("Align left")}
                    onClick={() => setLabelAlign("left")}>
                    <Icon name="align-left" size={14} />
                  </button>
                  <button type="button"
                    className={`rte-btn ${labelAlign === "center" ? "active" : ""}`}
                    aria-pressed={labelAlign === "center"}
                    title={t("Align center")}
                    onClick={() => setLabelAlign("center")}>
                    <Icon name="align-center" size={14} />
                  </button>
                  <button type="button"
                    className={`rte-btn ${labelAlign === "right" ? "active" : ""}`}
                    aria-pressed={labelAlign === "right"}
                    title={t("Align right")}
                    onClick={() => setLabelAlign("right")}>
                    <Icon name="align-right" size={14} />
                  </button>
                </div>
              </div>
              )}
            </Field>

            <Field label={t("Position")} hint={t("Where the text sits relative to the QR.")} className="mt-4">
              <div className="pos-picker">
                {LABEL_POSITIONS.map(p => (
                  <button type="button" key={p} className={`style-opt pos-opt ${labelPos === p ? "active" : ""}`} aria-pressed={labelPos === p} onClick={() => setLabelPos(p)}>
                    <div className="pos-opt-illus"><PositionMini pos={p} /></div>
                    <div className="style-opt-label">{p === "none" ? t("Off") : p}</div>
                  </button>
                ))}
              </div>
            </Field>

            {!canCustomDesign && (
              <div className="mt-4">
                <FeatureLock
                  compact
                  title={t("Fonts, formatting & frames")}
                  desc={t("Pick a font, size, bold / italic, and add a decorative frame around the QR on {designPlan}.", { designPlan })}
                  plan={designPlan}
                />
              </div>
            )}

            {canCustomDesign && (
            <Field
              label={t("Frame style")}
              hint={
                labelPos === "none"
                  ? t("Decorative outline around the QR. Pick a label position to unlock frames with text zones.")
                  : t("Frames with a text zone on the {labelPos} — adapts to your label.", { labelPos: t(labelPos) })
              }
              className="mt-4"
            >
              <div className="style-picker" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {availableFrames.map(fs => (
                  <button type="button" key={fs}
                    className={`style-opt ${frameStyle === fs ? "active" : ""}`}
                    aria-pressed={frameStyle === fs}
                    onClick={() => setFrameStyle(fs)}
                    title={FRAME_LABEL[fs]}>
                    <div className="style-opt-illus" style={{ width: 56, height: 40, display: "grid", placeItems: "center" }}>
                      <FrameMini style={fs} labelPos={labelPos} />
                    </div>
                    <div className="style-opt-label" style={{ textTransform: "capitalize" }}>{FRAME_LABEL[fs]}</div>
                  </button>
                ))}
              </div>
            </Field>
            )}

            {hasTextZone && (
              <div className="grid grid-2 mt-4">
                <Field label={t("Label text color")} hint={t("Color of the text inside the frame's text zone.")}>
                  <div className="swatch-row">
                    {QR_COLORS.map(c => (
                      <button type="button" key={c} className={`swatch ${labelTextColor === c ? "active" : ""}`} style={{ background: c }} aria-label={t("Color {c}", { c })} aria-pressed={labelTextColor === c} onClick={() => setLabelTextColor(c)} />
                    ))}
                    <label className={`swatch swatch-picker ${!QR_COLORS.includes(labelTextColor) ? "active" : ""}`} title={t("Custom color")}>
                      <input type="color" value={labelTextColor} onChange={e => setLabelTextColor(e.target.value)} />
                      <span className="picker-icon"><Icon name="edit" size={11} /></span>
                    </label>
                  </div>
                  {!QR_COLORS.includes(labelTextColor) && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--ff-mono)", display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: labelTextColor, border: "1px solid var(--border)" }} />
                      {labelTextColor.toUpperCase()}
                    </div>
                  )}
                </Field>
                <Field label={t("Text zone background")} hint={t("Fill color of the band behind the label.")}>
                  <div className="swatch-row">
                    {QR_COLORS.map(c => (
                      <button type="button" key={c} className={`swatch ${labelBgColor === c ? "active" : ""}`} style={{ background: c }} aria-label={t("Color {c}", { c })} aria-pressed={labelBgColor === c} onClick={() => setLabelBgColor(c)} />
                    ))}
                    {QR_BG_COLORS.map(c => (
                      <button type="button" key={`bg-${c}`} className={`swatch ${labelBgColor === c ? "active" : ""}`} style={{ background: c }} aria-label={t("Color {c}", { c })} aria-pressed={labelBgColor === c} onClick={() => setLabelBgColor(c)} />
                    ))}
                    <label className={`swatch swatch-picker ${![...QR_COLORS, ...QR_BG_COLORS].includes(labelBgColor) ? "active" : ""}`} title={t("Custom color")}>
                      <input type="color" value={labelBgColor} onChange={e => setLabelBgColor(e.target.value)} />
                      <span className="picker-icon"><Icon name="edit" size={11} /></span>
                    </label>
                  </div>
                  {![...QR_COLORS, ...QR_BG_COLORS].includes(labelBgColor) && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--ff-mono)", display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: labelBgColor, border: "1px solid var(--border)" }} />
                      {labelBgColor.toUpperCase()}
                    </div>
                  )}
                </Field>
              </div>
            )}
          </Card>

          {/* Tracking */}
          <Card className="card-pad-lg">
            <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>{t("Tracking")}</div>
            <div className="section-sub">{t("UTM parameters appended to scan redirects automatically — surface QR traffic in Google Analytics, Shopify Analytics, Klaviyo, etc.")}</div>
            <div className="grid grid-2 mt-4">
              <Field label={t("UTM campaign")} hint={t("The campaign / promotion name. Example: summer-drop-2026.")}>
                <Input placeholder={t("summer-drop-2026")} value={utmCampaign} onChange={e => setUtmCampaign(e.target.value)} />
              </Field>
              <Field label={t("UTM source")} hint={t("The physical/digital placement. Example: qr-flyer, in-store, packaging.")}>
                <Input placeholder={t("qr-flyer")} value={utmSource} onChange={e => setUtmSource(e.target.value)} />
              </Field>
              <Field label={t("UTM medium")} hint={t("The marketing channel. Defaults to 'qr' so all your QR traffic groups together in analytics.")}>
                <Input placeholder={t("qr")} value={utmMedium} onChange={e => setUtmMedium(e.target.value)} />
              </Field>
              <Field label={t("UTM term")} hint={t("Optional. Identifies the QR placement or variant — e.g. 'storefront-window', 'flyer-v2'.")}>
                <Input placeholder={t("storefront-window")} value={utmTerm} onChange={e => setUtmTerm(e.target.value)} />
              </Field>
            </div>
          </Card>

          {/* Schedule + Campaign link */}
          <Card className="card-pad-lg">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>{t("Schedule & campaign")}</div>
                <div className="section-sub">{t("Schedule when the QR activates / expires, and choose the Campaign page this QR should open.")}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={scheduleEnabled}
                onClick={() => setScheduleEnabled(v => !v)}
                style={{
                  width: 42,
                  height: 24,
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  background: scheduleEnabled ? "var(--accent)" : "var(--bg-sunken)",
                  padding: 2,
                  cursor: "pointer",
                  flex: "0 0 auto",
                }}
                title={scheduleEnabled ? t("Disable schedule") : t("Enable schedule")}
              >
                <span style={{
                  display: "block",
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "#fff",
                  transform: scheduleEnabled ? "translateX(16px)" : "translateX(0)",
                  transition: "transform 160ms ease",
                  boxShadow: "0 1px 2px rgba(0,0,0,.18)",
                }} />
              </button>
            </div>

            {scheduleEnabled && (
              <div className="grid grid-2 mt-4">
                <Field label={t("Activates at")} hint={t("Required when schedule is enabled.")} required>
                  <input
                    type="datetime-local"
                    className="filter-select"
                    value={activatesAt}
                    onChange={e => setActivatesAt(e.target.value)}
                    required={scheduleEnabled}
                    style={{
                      height: 38,
                      width: "100%",
                      padding: "6px 12px",
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      color: "var(--fg-strong)",
                      fontSize: 13,
                    }}
                  />
                </Field>
                <Field label={t("Expires at")} hint={t("Required when schedule is enabled.")} required>
                  <input
                    type="datetime-local"
                    className="filter-select"
                    value={expiresAt}
                    onChange={e => setExpiresAt(e.target.value)}
                    required={scheduleEnabled}
                    style={{
                      height: 38,
                      width: "100%",
                      padding: "6px 12px",
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      color: "var(--fg-strong)",
                      fontSize: 13,
                    }}
                  />
                </Field>
              </div>
            )}

            {campaigns.length > 0 && (
              <Field label={t("Campaign page")} hint={t("Scans land on the selected Campaign. Draft and paused campaigns can still be previewed before activation.")} className="mt-4">
                <select
                  className="filter-select"
                  value={campaignId}
                  onChange={e => setCampaignId(e.target.value)}
                  style={{
                    height: 38,
                    width: "100%",
                    padding: "6px 12px",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--fg-strong)",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <option value="">{t("— No campaign —")}</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id} disabled={c.status === "ENDED"}>
                      {c.name} {c.status !== "ACTIVE" ? `(${c.status.toLowerCase()})` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <div className="advanced-divider" />
            <div className="strong" style={{ fontSize: 13 }}>{t("When this QR code can't open its destination")}</div>
            <div className="text-xs muted" style={{ marginTop: 2 }}>
              {t("Paused, not active yet, expired or over your plan limit: scans never hit an error page. They go to the page below and appear as missed scans in your stats.")}
            </div>
            {plan.customFallback ? (
              <Field label={t("Fallback page")} hint={defaultFallback ? t("Leave empty to use your default ({defaultFallback}).", { defaultFallback }) : t("Leave empty to use your store home page. Tip: set an expiry date above and a fallback here to switch destination automatically.")} className="mt-3">
                <Input icon="link" placeholder={defaultFallback ?? `https://${shopDomain}/`} value={fallbackUrl} onChange={e => setFallbackUrl(e.target.value)} />
              </Field>
            ) : (
              <div className="mt-3">
                <FeatureLock
                  compact
                  title={t("Scans go to your store home page ({shopDomain})", { shopDomain })}
                  desc={t("Choose your own fallback page — and switch destination automatically after an expiry date — from the Starter plan.")}
                  plan="Starter"
                />
              </div>
            )}
          </Card>

          <SmartRoutingCard
            value={routing}
            onChange={setRouting}
            locked={!plan.smartRouting}
            timezone={timezone}
          />
        </div>

        {/* ══ RIGHT — Sticky preview ══ */}
        <div style={{ position: "sticky", top: 28 }}>
          <Card className="card-pad-lg" accent={activated ? "green" : "blue"}>
            <div className="flex items-center justify-between mb-4">
              <div className="strong" style={{ fontSize: 13.5 }}>{t("Live preview")}</div>
              <Badge tone={activated ? "success" : "neutral"} dot>{activated ? t("Active") : savedQr ? t("Saved draft") : t("Unsaved")}</Badge>
            </div>

            <div
              className="qr-stage-export-preview"
              style={{
                position: "relative",
                display: "grid",
                placeItems: "center",
                width: "max-content",
                maxWidth: "100%",
                margin: "0 auto",
                overflow: "visible",
              }}
            >
              {!valid ? (
                <div style={{ width: 248, height: 248, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: eff.bg, color: "var(--fg-subtle)", fontSize: 11.5, textAlign: "center", padding: 16, borderRadius: 12 }}>
                  <Icon name="qr-code" size={28} />
                  <div>{t("Name your QR code")}<br />{t("to preview it.")}</div>
                </div>
              ) : (
                <>
                  <QrSvg
                    text={previewText}
                    size={220}
                    fg={eff.fg}
                    bg={eff.bg}
                    style={eff.style}
                    cornerStyle={eff.cornerStyle}
                    logo={eff.logoSel}
                    logoSize={eff.logoSizePct / 100}
                    margin={eff.qrMargin}
                    cornerColor={eff.cornerColor}
                    gradient={eff.gradient}
                    label={previewLabel}
                  />
                </>
              )}
            </div>

            <div className="text-sm muted mt-4">
              {t("Destination:")} <span className="strong">{t(meta.name)}</span>
              {selectedLabel && (
                <div style={{ fontSize: 12, marginTop: 6, color: "var(--fg-strong)" }}>{selectedLabel}</div>
              )}
              {effectiveTarget && (
                <div style={{ fontFamily: "var(--ff-mono)", fontSize: 11, marginTop: 6, padding: "6px 8px", background: "var(--bg-sunken)", border: "1px solid var(--border-soft)", borderRadius: 6, wordBreak: "break-all", maxHeight: 80, overflow: "hidden" }}>
                  {effectiveTarget.length > 160 ? effectiveTarget.slice(0, 160) + "…" : effectiveTarget}
                </div>
              )}
            </div>

            <div className="col gap-2 mt-4">
              <div className="grid grid-2 gap-2">
                <Button
                  variant="primary"
                  size="lg"
                  icon="save"
                  disabled={submitting}
                  onClick={() => submitQr("save")}
                  style={{ width: "100%" }}
                >
                  {submitting && submitMode === "save" ? t("Saving…") : t("Save")}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  icon="save"
                  disabled={submitting}
                  onClick={() => submitQr("saveExit")}
                  style={{ width: "100%" }}
                >
                  {submitting && submitMode === "saveExit" ? t("Saving…") : t("Save & exit")}
                </Button>
              </div>

              <Button
                variant="success"
                size="lg"
                icon={activated ? "circle-check" : "zap"}
                disabled={submitting || !savedQr || activated}
                title={!savedQr ? t("Save this QR code before activating it") : activated ? t("QR code is already active") : t("Activate QR code")}
                onClick={() => submitQr("activate")}
                style={{ width: "100%" }}
              >
                {submitting && submitMode === "activate" ? t("Activating…") : activated ? t("Active") : t("Activate")}
              </Button>

              <div className="text-xs muted" style={{ textAlign: "center" }}>
                {!savedQr ? t("Save first to unlock activation and downloads.") : activated ? t("Changes can still be saved while this QR stays active.") : t("Saved drafts can be activated here or from My QR codes.")}
              </div>


              <div className="strong mt-2" style={{ fontSize: 12 }}>{t("Scan URL")}</div>
              <div style={{ fontFamily: "var(--ff-mono)", fontSize: 11, padding: "8px 10px", background: "var(--bg-sunken)", border: "1px solid var(--border)", borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: savedQr ? "var(--fg-strong)" : "var(--fg-muted)" }}>
                  {savedQr ? previewText : t("Save first to generate a scan URL")}
                </span>
                <Button size="sm" variant="ghost" disabled={!savedQr} onClick={() => {
                  if (!savedQr) return;
                  navigator.clipboard?.writeText(previewText);
                  toast({ title: t("Link copied"), type: "info" });
                }}>
                  <Icon name="copy" size={12} />
                </Button>
              </div>

              <div className="grid grid-3 gap-2 mt-2">
                {(["png", "svg", "pdf"] as DownloadFormat[]).map(format => {
                  const locked = format !== "png" && !canExport;
                  return (
                    <Button
                      key={format}
                      size="sm"
                      variant="secondary"
                      icon={locked ? "lock" : "download"}
                      disabled={!savedQr || downloading === format}
                      title={!savedQr ? t("Save this QR code before downloading it") : locked ? t("{format} requires the {exportPlan} plan", { format: format.toUpperCase(), exportPlan }) : t("Download {format}", { format: format.toUpperCase() })}
                      onClick={() => handleDownload(format)}
                      style={{ width: "100%", ...(locked ? { opacity: 0.7 } : {}) }}
                    >
                      {format.toUpperCase()}
                    </Button>
                  );
                })}
              </div>
              {!canExport && (
                <div className="text-xs muted" style={{ textAlign: "center" }}>
                  {t("SVG and PDF files are included from the {plan} plan.", { plan: exportPlan })}
                </div>
              )}

              <Button size="md" variant="primary" icon="eye"
                style={{ marginTop: 4 }}
                onClick={() => navigate("/app/qr-manager")}>
                {t("Go to My QR codes")}
              </Button>
            </div>
          </Card>

          <div className="text-xs muted mt-4" style={{ textAlign: "center", padding: "0 12px" }}>
            {t("TrackQr tracks every scan, device and conversion through a unique short URL.")}
          </div>
        </div>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
