import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireShop } from "../lib/shop.server";
import { createQr, getQrForEdit, updateQr } from "../lib/qr-crud.server";
import { listTemplates, createTemplate, deleteTemplate } from "../lib/templates.server";
import { listCampaigns } from "../lib/campaign.server";
import { createDiscountCode } from "../lib/discounts.server";
import { QuotaExceededError } from "../lib/plan.server";
import { QR_TYPE_TO_UI } from "../lib/qr-types";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Field, Input, Textarea } from "../components/ui/Input";
import { Segmented } from "../components/ui/Segmented";
import { useToast } from "../components/ui/Toast";
import { renderQrSvg as renderQrSvgClient, renderFrameSvg, framesForPosition, frameInvertsLabel, FRAME_LABEL, FRAMES_WITH_LABEL_ZONE, type FrameStyle, type QrLabelOpts } from "../lib/qr-render";
import { LogoPicker, logoSvgDataUrl, type LogoSelection } from "../components/ui/LogoPicker";
import { LABEL_FONTS, LABEL_FONT_GROUPS, DEFAULT_FONT, getLabelFont } from "../lib/label-fonts";
import { contrastRatio, contrastVerdict } from "../lib/contrast";
import { downloadQrAsset, type DownloadFormat } from "../lib/qr-download";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const { shop } = await requireShop(request);
  const url = new URL(request.url);
  const editId = url.searchParams.get("edit");
  const origin = (process.env.SHOPIFY_APP_URL ?? url.origin).replace(/\/$/, "");
  // Load templates + active campaigns once for the page (cheap queries).
  const [templates, campaigns, editQr] = await Promise.all([
    listTemplates(shop.id),
    listCampaigns(shop.id),
    editId ? getQrForEdit(shop.id, editId) : Promise.resolve(null),
  ]);
  return {
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      design: t.design as Record<string, unknown>,
      label:  t.label  as Record<string, unknown>,
      updatedAt: t.updatedAt.toISOString(),
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
      active: editQr.active,
    } : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // We need both the shop record (for templates/QR) AND the admin GraphQL
  // client (for optional Shopify discount creation).
  const { admin } = await authenticate.admin(request);
  const { shop } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "create");

  // ── Template intents ─────────────────────────────────
  if (intent === "template:save") {
    try {
      const t = await createTemplate(shop.id, {
        name:   String(form.get("name") ?? "Untitled template"),
        design: JSON.parse(String(form.get("design") ?? "{}")),
        label:  JSON.parse(String(form.get("label")  ?? "{}")),
      });
      return { ok: true as const, intent: "template:save" as const, id: t.id, name: t.name };
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
    const type   = String(form.get("type") ?? "");
    const target = String(form.get("target") ?? "");

    // Opt-in: auto-create the Shopify discount before persisting the QR.
    // Best-effort — if it fails, we still create the QR (the merchant can
    // create the discount manually in admin).
    let discountWarning: string | null = null;
    if (type === "promo" && form.get("autoCreateDiscount") === "1" && target) {
      const pct = Math.max(0.05, Math.min(0.50, Number(form.get("discountValuePct") ?? "0.10")));
      const result = await createDiscountCode(admin, {
        code: target.trim().toUpperCase(),
        percentage: pct,
        title: `TrackQr · ${target.trim().toUpperCase()}`,
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
      activate: form.get("activate") === "1",
    };

    const editId = String(form.get("id") ?? "");
    const qr = intent === "update" && editId
      ? await updateQr(shop.id, editId, payload)
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
        message: `Plan limit reached — ${err.resource} (${err.limit} max on ${err.planId}). Upgrade to add more.`,
      } as const;
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
  { id: "home",    name: "Homepage",     icon: "home",           group: "shopify", url: "/" },
  { id: "product", name: "Product page", icon: "package",        group: "shopify", url: "/products/aurora-tee" },
  { id: "link",    name: "Link",         icon: "link",           group: "shopify", url: "https://" },
  { id: "atc",     name: "Add to cart",  icon: "shopping-cart",  group: "shopify", url: "/cart/add" },
  { id: "promo",   name: "Promo code",   icon: "tag",            group: "shopify", url: "/discount/" },
  { id: "url",     name: "Custom URL",   icon: "globe",          group: "custom",  url: "https://" },
  { id: "text",    name: "Text",         icon: "type",           group: "custom" },
  { id: "phone",   name: "Phone",        icon: "phone",          group: "custom" },
  { id: "sms",     name: "SMS",          icon: "message-square", group: "custom" },
  { id: "email",   name: "Email",        icon: "mail",           group: "custom" },
  { id: "wifi",    name: "WiFi",         icon: "wifi",           group: "custom" },
  { id: "vcard",   name: "vCard",        icon: "id-card",        group: "custom" },
] as const;

type QrTypeId = (typeof QR_TYPES)[number]["id"];

function typeMeta(id: QrTypeId) { return QR_TYPES.find(t => t.id === id) ?? QR_TYPES[0]; }

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

function wifiPayload(ssid: string, password: string, encryption: "WPA" | "WEP" | "nopass" = "WPA", hidden = false): string {
  const esc = (s: string) => s.replace(/([\\;,"':])/g, "\\$1");
  return `WIFI:T:${encryption};S:${esc(ssid)};P:${esc(password)};${hidden ? "H:true;" : ""};`;
}

function vcardPayload(o: { fullName: string; title?: string; org?: string; phone?: string; email?: string; url?: string }): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${o.fullName}`,
    o.org   ? `ORG:${o.org}`         : "",
    o.title ? `TITLE:${o.title}`     : "",
    o.phone ? `TEL;TYPE=CELL:${o.phone}` : "",
    o.email ? `EMAIL:${o.email}`     : "",
    o.url   ? `URL:${o.url}`         : "",
    "END:VCARD",
  ];
  return lines.filter(Boolean).join("\n");
}

function parseWifiPayload(payload: string) {
  const parts: Record<string, string> = {};
  payload.replace(/^WIFI:/, "").split(";").forEach(part => {
    const [key, ...value] = part.split(":");
    if (key) parts[key] = value.join(":").replace(/\\([\\;,"':])/g, "$1");
  });
  return {
    ssid: parts.S ?? "",
    password: parts.P ?? "",
    encryption: (parts.T === "WEP" || parts.T === "nopass" ? parts.T : "WPA") as "WPA" | "WEP" | "nopass",
  };
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
  // Loader data — saved templates + active campaigns to attach to.
  const { templates, campaigns, editQr, origin } = useLoaderData<typeof loader>();
  const isEditing = !!editQr;

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

  // Auto-create Shopify discount (only relevant for type=promo).
  const [autoCreateDiscount, setAutoCreateDiscount] = useState<boolean>(true);
  const [discountValuePct,   setDiscountValuePct]   = useState<number>(10);

  // Template UI state.
  const [templateName, setTemplateName] = useState<string>("");
  const [showTemplateSave, setShowTemplateSave] = useState<boolean>(false);

  // Label — text + inline rich-text formatting
  const [labelText, setLabelText] = useState("Scan to discover");
  const [labelPos,  setLabelPos]  = useState<LabelPos>("bottom");
  const [frameStyle, setFrameStyle] = useState<FrameStyle>("none");
  const [labelFont,  setLabelFont]  = useState<string>(DEFAULT_FONT);
  const [labelFontSize,  setLabelFontSize]  = useState<number>(16);
  const [labelBold,      setLabelBold]      = useState<boolean>(false);
  const [labelItalic,    setLabelItalic]    = useState<boolean>(false);
  const [labelUnderline, setLabelUnderline] = useState<boolean>(false);
  const [labelAlign,     setLabelAlign]     = useState<"left" | "center" | "right">("center");

  // Whether the current frame exposes a colored text zone (polaroid/banner/ticket/header).
  const hasTextZone = FRAMES_WITH_LABEL_ZONE.includes(frameStyle);

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
  const [generating,   setGenerating]   = useState(false);
  const [renderToken,  setRenderToken]  = useState(0);
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
    } else {
      setTarget(editQr.target ?? "");
    }

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
    return target;
  })();

  useEffect(() => {
    setGenerating(true);
    const t = setTimeout(() => { setGenerating(false); setRenderToken(k => k + 1); }, 380);
    return () => clearTimeout(t);
  }, [
    style, cornerStyle, fg, bg, logoSel, logoSizePct, qrMargin, cornerColor,
    gradientOn, gradientFrom, gradientTo, gradientAngle,
    labelText, labelPos, frameStyle, labelFont, labelFontSize, labelBold, labelItalic, labelUnderline,
    labelAlign, labelTextColor, labelBgColor,
    name, type, effectiveTarget, activated,
  ]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    // Only react to QR create/update responses here; template intents use templateFetcher.
    if (fetcher.data.intent && fetcher.data.intent !== "create" && fetcher.data.intent !== "update") return;
    if (fetcher.data.ok) {
      setSavedQr({ id: fetcher.data.id, slug: fetcher.data.slug, name: fetcher.data.name || name || fetcher.data.slug });
      setActivated(fetcher.data.active);
      toast({
        title: submitMode === "activate" ? "QR code activated" : "QR code saved",
        desc: submitMode === "activate" ? "It is now ready to scan." : "Saved to My QR codes.",
      });
      if (submitMode === "saveExit") navigate("/app/qr-manager");
      // Surface a non-fatal warning if the Shopify discount couldn't be created.
      if ("discountWarning" in fetcher.data && fetcher.data.discountWarning) {
        toast({
          type: "error",
          title: "Discount code skipped",
          desc: fetcher.data.discountWarning,
        });
      }
    } else if ("error" in fetcher.data) {
      toast({
        type: "error",
        title: fetcher.data.error === "quota" ? "Plan limit reached" : "Could not save",
        desc: fetcher.data.message,
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
      if (d.ok) toast({ title: "Template saved", desc: `"${d.name}" added to your presets.` });
      else      toast({ type: "error", title: "Could not save template", desc: d.message });
    } else if (d.intent === "template:delete") {
      if (d.ok) toast({ title: "Template removed" });
    }
  }, [templateFetcher.state, templateFetcher.data]);

  const submitting = fetcher.state !== "idle";

  function validateBeforeSave() {
    if (!valid) {
      toast({ type: "error", title: "Add a name first", desc: "QR code name is required before saving." });
      return false;
    }
    if (scheduleEnabled) {
      if (!activatesAt || !expiresAt) {
        toast({ type: "error", title: "Schedule incomplete", desc: "Set both activation and expiration dates." });
        return false;
      }
      if (new Date(expiresAt).getTime() <= new Date(activatesAt).getTime()) {
        toast({ type: "error", title: "Invalid schedule", desc: "Expiration must be after activation." });
        return false;
      }
    }
    return true;
  }

  function submitQr(mode: "save" | "saveExit" | "activate") {
    if (!validateBeforeSave()) return;
    const id = savedQr?.id ?? editQr?.id;
    if (mode === "activate" && !id) {
      toast({ type: "error", title: "Save first", desc: "Save this QR code before activating it." });
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
      style, cornerStyle, fg, bg,
      withLogo: logoSel.kind !== "none",
      logoBrand:    logoSel.kind === "brand"  ? logoSel.brandId       : null,
      logoUrl:      logoSel.kind === "custom" ? logoSel.customUrl     : null,
      logoAssetId:  logoSel.kind === "custom" ? logoSel.customAssetId : null,
      logoSize:     logoSizePct / 100,
      margin:       qrMargin,
      cornerColor,
      gradient:     gradientOn ? { from: gradientFrom, to: gradientTo, angle: gradientAngle } : null,
    }));
    fd.set("label", JSON.stringify({
      text: labelText,
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
    if (!id && type === "promo" && autoCreateDiscount && target) {
      fd.set("autoCreateDiscount", "1");
      fd.set("discountValuePct", String(discountValuePct / 100));
    }
    fd.set("activate", nextActive ? "1" : "0");
    setSubmitMode(mode);
    fetcher.submit(fd, { method: "post" });
  }

  async function handleDownload(format: DownloadFormat) {
    if (!savedQr) {
      toast({ type: "error", title: "Save first", desc: "Save this QR code before downloading it." });
      return;
    }
    setDownloading(format);
    try {
      await downloadQrAsset({ id: savedQr.id, slug: savedQr.slug, name: name || savedQr.name || savedQr.slug }, format);
      toast({ title: `${format.toUpperCase()} downloaded`, type: "info" });
    } catch (err) {
      toast({ type: "error", title: "Download failed", desc: err instanceof Error ? err.message : "Try again." });
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
      toast({ type: "error", title: "Name required", desc: "Give the template a name first." });
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

  function applyTemplate(t: typeof templates[number]) {
    const d = t.design as Record<string, unknown>;
    const l = t.label  as Record<string, unknown>;
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
    toast({ title: "Template applied", desc: t.name });
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
      toast({ type: "error", title: "Picker unavailable", desc: "Open this app inside Shopify admin to pick products." });
    }
  }

  async function pickVariant() {
    try {
      const result = await (shopify as unknown as { resourcePicker: (opts: { type: string; multiple: boolean; filter?: { variants?: boolean } }) => Promise<unknown> })
        .resourcePicker({ type: "product", multiple: false, filter: { variants: true } });
      const arr = result as Array<{ id: string; title: string; handle: string; variants?: Array<{ id: string; title: string }> }> | undefined;
      if (arr && arr.length > 0) {
        const p = arr[0];
        const v = p.variants?.[0];
        if (v) {
          // Variant gid → numeric id for /cart/{id}:1
          const numericId = v.id.split("/").pop() ?? "";
          setTarget(numericId);
          setShopifyRef(v.id);
          setSelectedLabel(`${p.title} — ${v.title}`);
        }
      }
    } catch (err) {
      console.error("resourcePicker (variant) failed", err);
      toast({ type: "error", title: "Picker unavailable" });
    }
  }

  const tm = typeMeta(type);

  const previewText = savedQr?.slug
    ? `${origin}/s/${savedQr.slug}`
    : effectiveTarget || (name ? `${name} · ${tm.name}` : "TrackQr placeholder");

  const labelFontSpec = getLabelFont(labelFont);

  const valid = name.trim().length > 0 && (
    type === "home"  ? true :
    type === "wifi"  ? wifiSsid.length > 0 :
    type === "vcard" ? vcFull.length > 0 :
    effectiveTarget.length > 0
  );
  const previewLabel: QrLabelOpts = {
    text: labelText,
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

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => navigate(isEditing ? "/app/qr-manager" : "/app")} style={{ marginBottom: 8, marginLeft: -10 }}>
            {isEditing ? "Back to My QR codes" : "Back to dashboard"}
          </Button>
          <h1 className="page-h1">{isEditing ? "Edit" : "Create a"} <span className="em">QR code</span></h1>
          <div className="page-sub">Configure the destination, customize the design, add a label, activate when ready.</div>
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

          {/* Templates — saved design+label presets */}
          {(templates.length > 0 || showTemplateSave) && (
            <Card className="card-pad-lg">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>
                    <Icon name="layers" size={14} style={{ verticalAlign: "-2px", marginRight: 6, color: "var(--accent)" }} />
                    Templates
                  </div>
                  <div className="section-sub">Apply a saved design preset or capture the current style.</div>
                </div>
                <Button size="sm" variant="secondary" icon="save" onClick={() => setShowTemplateSave(v => !v)}>
                  {showTemplateSave ? "Cancel" : "Save current"}
                </Button>
              </div>

              {showTemplateSave && (
                <div className="mt-3" style={{ display: "flex", gap: 8 }}>
                  <Input
                    placeholder="e.g. Brand summer 2026"
                    value={templateName}
                    onChange={e => setTemplateName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveTemplate(); } }}
                    style={{ flex: 1 }}
                  />
                  <Button size="md" variant="primary" onClick={saveTemplate}>Save</Button>
                </div>
              )}

              {templates.length > 0 && (
                <div className="template-grid mt-3">
                  {templates.map(t => {
                    const td = t.design as { fg?: string; bg?: string; gradient?: { from: string; to: string } | null };
                    const swatchFg = td.gradient?.from ?? td.fg ?? "#0B1220";
                    const swatchFg2 = td.gradient?.to ?? swatchFg;
                    const swatchBg = td.bg ?? "#FFFFFF";
                    return (
                      <div key={t.id} className="template-card">
                        <button
                          type="button"
                          className="template-apply"
                          onClick={() => applyTemplate(t)}
                          title={`Apply "${t.name}"`}
                        >
                          <div
                            className="template-swatch"
                            style={{ background: `linear-gradient(135deg, ${swatchFg} 0%, ${swatchFg2} 100%)` }}
                          >
                            <div className="template-swatch-inner" style={{ background: swatchBg }} />
                          </div>
                          <div className="template-name">{t.name}</div>
                        </button>
                        <button
                          type="button"
                          className="template-del"
                          onClick={(e) => { e.stopPropagation(); removeTemplate(t.id); }}
                          title="Delete template"
                          aria-label={`Delete ${t.name}`}
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
          {templates.length === 0 && !showTemplateSave && (
            <div style={{ textAlign: "right", margin: "-4px 0 0" }}>
              <Button size="sm" variant="ghost" icon="save" onClick={() => setShowTemplateSave(true)}>
                Save this design as a template
              </Button>
            </div>
          )}

          {/* Basics */}
          <Card className="card-pad-lg">
            <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>Basics</div>
            <div className="section-sub">Internal label and notes — only visible to your team.</div>
            <div className="grid grid-2 mt-4">
              <Field label="QR code name" required hint="e.g. 'Summer drop · Hero banner'">
                <Input placeholder="Untitled QR code" value={name} onChange={e => setName(e.target.value)} />
              </Field>
              <Field label="Description" hint="Optional — visible in My QR codes">
                <Input placeholder="Add a description" value={description} onChange={e => setDescription(e.target.value)} />
              </Field>
            </div>
          </Card>

          {/* Destination */}
          <Card className="card-pad-lg">
            <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>Destination</div>
            <div className="section-sub">Pick what visitors will see when they scan.</div>

            <div className="text-xs strong" style={{ color: "var(--fg-muted)", margin: "16px 0 8px", letterSpacing: ".06em", textTransform: "uppercase", fontFamily: "var(--ff-mono)" }}>
              Shopify
            </div>
            <div className="tile-grid">
              {QR_TYPES.filter(t => t.group === "shopify").map(t => (
                <div key={t.id} className={`tile ${type === t.id ? "active" : ""}`}
                  onClick={() => changeType(t.id as QrTypeId)}>
                  <div className="tile-icon"><Icon name={t.icon} /></div>
                  <div className="tile-name">{t.name}</div>
                </div>
              ))}
            </div>

            <div className="text-xs strong" style={{ color: "var(--fg-muted)", margin: "20px 0 8px", letterSpacing: ".06em", textTransform: "uppercase", fontFamily: "var(--ff-mono)" }}>
              Custom
            </div>
            <div className="tile-grid">
              {QR_TYPES.filter(t => t.group === "custom").map(t => (
                <div key={t.id} className={`tile ${type === t.id ? "active" : ""}`}
                  onClick={() => changeType(t.id as QrTypeId)}>
                  <div className="tile-icon"><Icon name={t.icon} /></div>
                  <div className="tile-name">{t.name}</div>
                </div>
              ))}
            </div>

            <div className="mt-6">
              {type === "product" && (
                <Field label="Shopify product" hint="Browse your live Shopify catalog.">
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" icon="search" onClick={pickProduct}>
                      {selectedLabel ? "Change product" : "Browse products"}
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

              {type === "atc" && (
                <Field label="Product variant" hint="Visitor lands on cart with this variant added.">
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" icon="search" onClick={pickVariant}>
                      {selectedLabel ? "Change variant" : "Browse products & variants"}
                    </Button>
                    {selectedLabel && (
                      <div style={{
                        flex: 1, fontSize: 13, padding: "8px 12px",
                        background: "var(--bg-sunken)", border: "1px solid var(--border-soft)",
                        borderRadius: 8, display: "flex", alignItems: "center", gap: 8,
                      }}>
                        <Icon name="shopping-cart" size={14} style={{ color: "var(--accent)" }} />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedLabel}</span>
                      </div>
                    )}
                  </div>
                </Field>
              )}

              {type === "promo" && (
                <>
                  <Field label="Discount code" hint="Customer lands at checkout with code pre-applied.">
                    <Input icon="tag" placeholder="FREESHIP" value={target} onChange={e => setTarget(e.target.value.toUpperCase())} />
                  </Field>
                  <div className="mt-3" style={{ padding: 12, background: "var(--bg-sunken)", border: "1px solid var(--border-soft)", borderRadius: 10 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={autoCreateDiscount}
                        onChange={e => setAutoCreateDiscount(e.target.checked)}
                        style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-strong)" }}>
                          Auto-create this discount in Shopify
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>
                          Creates a percentage-off discount code via Shopify Admin. Skip if the code already exists.
                        </div>
                      </div>
                    </label>
                    {autoCreateDiscount && (
                      <div className="mt-3" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ fontSize: 12, color: "var(--fg-muted)", minWidth: 70 }}>Value · {discountValuePct}%</div>
                        <input
                          type="range"
                          min={5}
                          max={50}
                          step={5}
                          value={discountValuePct}
                          onChange={e => setDiscountValuePct(Number(e.target.value))}
                          className="range-slider"
                          style={{ flex: 1 }}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              {(type === "link" || type === "url") && (
                <Field label="Destination URL" hint="Any https:// link.">
                  <Input icon="link" placeholder="https://aurora.co/landing" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}

              {type === "home" && (
                <div className="text-sm muted" style={{ padding: 12, background: "var(--bg-sunken)", borderRadius: 8, border: "1px solid var(--border-soft)" }}>
                  <Icon name="home" size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  Scans will open your storefront home page. No additional config required.
                </div>
              )}

              {type === "text" && (
                <Field label="Text content" hint="Shown on a landing page when scanned (with copy-to-clipboard).">
                  <Textarea placeholder="Anything you want — instructions, a message, a serial number…" value={target} onChange={e => setTarget(e.target.value)} rows={3} />
                </Field>
              )}

              {(type === "phone" || type === "sms") && (
                <Field label={type === "sms" ? "SMS number" : "Phone number"} hint="International format recommended (E.164).">
                  <Input icon={type === "sms" ? "message-square" : "phone"} placeholder="+1 800 278 7622" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}

              {type === "email" && (
                <Field label="Email address" hint="Tapping the QR opens the visitor's mail app.">
                  <Input icon="mail" placeholder="hello@aurora.co" value={target} onChange={e => setTarget(e.target.value)} />
                </Field>
              )}

              {type === "wifi" && (
                <>
                  <div className="grid grid-2">
                    <Field label="Network name (SSID)" required>
                      <Input icon="wifi" placeholder="Aurora Guest" value={wifiSsid} onChange={e => setWifiSsid(e.target.value)} />
                    </Field>
                    <Field label="Encryption">
                      <Segmented value={wifiEnc} onChange={v => setWifiEnc(v as "WPA" | "WEP" | "nopass")}
                        options={[
                          { value: "WPA", label: "WPA/WPA2" },
                          { value: "WEP", label: "WEP" },
                          { value: "nopass", label: "None" },
                        ]} />
                    </Field>
                  </div>
                  {wifiEnc !== "nopass" && (
                    <Field label="Password" className="mt-4">
                      <Input type="password" placeholder="••••••••" value={wifiPwd} onChange={e => setWifiPwd(e.target.value)} />
                    </Field>
                  )}
                  <div className="text-xs muted mt-2">Camera apps will auto-prompt to connect on iOS &amp; Android.</div>
                </>
              )}

              {type === "vcard" && (
                <>
                  <div className="grid grid-2">
                    <Field label="Full name" required><Input placeholder="Aurora Sasaki" value={vcFull} onChange={e => setVcFull(e.target.value)} /></Field>
                    <Field label="Title"><Input placeholder="Founder" value={vcTitle} onChange={e => setVcTitle(e.target.value)} /></Field>
                    <Field label="Organization"><Input placeholder="Aurora Studios" value={vcOrg} onChange={e => setVcOrg(e.target.value)} /></Field>
                    <Field label="Phone"><Input icon="phone" placeholder="+1 800 278 7622" value={vcPhone} onChange={e => setVcPhone(e.target.value)} /></Field>
                    <Field label="Email"><Input icon="mail" placeholder="aurora@aurora.co" value={vcEmail} onChange={e => setVcEmail(e.target.value)} /></Field>
                    <Field label="Website"><Input icon="link" placeholder="https://aurora.co" value={vcUrl} onChange={e => setVcUrl(e.target.value)} /></Field>
                  </div>
                  <div className="text-xs muted mt-2">Scanning prompts "Add contact" in the camera app.</div>
                </>
              )}
            </div>
          </Card>

          {/* Design */}
          <Card className="card-pad-lg">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>Design</div>
                <div className="section-sub">Pattern, finders, colors and an optional logo at the center.</div>
              </div>
              <Button size="sm" variant="ghost" icon="undo" onClick={resetDesign} title="Reset design to defaults">Reset</Button>
            </div>

            <Field label="Pattern style" hint="Affects every module except the corner finders." className="mt-4">
              <div className="style-picker">
                {QR_STYLES.map(s => (
                  <div key={s} className={`style-opt ${style === s ? "active" : ""}`} onClick={() => setStyle(s)}>
                    <div className="style-opt-illus">
                      <StyleIllus qrStyle={s} size={36} />
                    </div>
                    <div className="style-opt-label">{s}</div>
                  </div>
                ))}
              </div>
            </Field>

            <Field label="Corner finders" hint="The three big squares — affect scanning reliability." className="mt-4">
              <div className="style-picker" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {QR_CORNERS.map(c => (
                  <div key={c} className={`style-opt ${cornerStyle === c ? "active" : ""}`} onClick={() => setCornerStyle(c)}>
                    <div className="style-opt-illus"><CornerMini corner={c} /></div>
                    <div className="style-opt-label">{c.replace("-", " ")}</div>
                  </div>
                ))}
              </div>
            </Field>

            <div className="grid grid-2 mt-4">
              <Field label="Foreground" hint="The dark modules.">
                <div className="swatch-row">
                  {QR_COLORS.map(c => (
                    <div key={c} className={`swatch ${fg === c ? "active" : ""}`} style={{ background: c }} onClick={() => setFg(c)} />
                  ))}
                  <label className={`swatch swatch-picker ${!QR_COLORS.includes(fg) ? "active" : ""}`} title="Custom color">
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
              <Field label="Background" hint="Keep contrast strong for reliable scanning.">
                <div className="swatch-row">
                  {QR_BG_COLORS.map(c => (
                    <div key={c} className={`swatch ${bg === c ? "active" : ""}`} style={{ background: c }} onClick={() => setBg(c)} />
                  ))}
                  <label className={`swatch swatch-picker ${!QR_BG_COLORS.includes(bg) ? "active" : ""}`} title="Custom color">
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
              <span>{contrastInfo.message}</span>
            </div>

            <Field label="Center logo" hint="Pick a brand logo or upload your own. Higher error correction is auto-applied." className="mt-4">
              <LogoPicker value={logoSel} onChange={setLogoSel} />
            </Field>

            {logoSel.kind !== "none" && (
              <Field label={`Logo size · ${logoSizePct}%`} hint="Smaller logo = more reliable scan. 20% is the sweet spot." className="mt-4">
                <input
                  type="range"
                  min={10}
                  max={30}
                  step={1}
                  value={logoSizePct}
                  onChange={e => setLogoSizePct(Number(e.target.value))}
                  className="range-slider"
                />
              </Field>
            )}

            {/* ── Advanced design controls ── */}
            <div className="advanced-divider mt-6">
              <span>Advanced</span>
            </div>

            <Field label={`Quiet zone (margin) · ${qrMargin}px`} hint="White space around the QR. Bigger = more reliable scanning, especially in print." className="mt-3">
              <input
                type="range"
                min={0}
                max={24}
                step={2}
                value={qrMargin}
                onChange={e => setQrMargin(Number(e.target.value))}
                className="range-slider"
              />
            </Field>

            <Field label="Finder (eye) color" hint="Color of the 3 corner squares. Defaults to the foreground." className="mt-4">
              <div className="swatch-row">
                {QR_COLORS.map(c => (
                  <div key={c}
                    className={`swatch ${cornerColor === c ? "active" : ""}`}
                    style={{ background: c }}
                    onClick={() => { cornerCustomized.current = true; setCornerColor(c); }}
                  />
                ))}
                <label className={`swatch swatch-picker ${!QR_COLORS.includes(cornerColor) ? "active" : ""}`} title="Custom color">
                  <input type="color" value={cornerColor} onChange={e => { cornerCustomized.current = true; setCornerColor(e.target.value); }} />
                  <span className="picker-icon"><Icon name="edit" size={11} /></span>
                </label>
                {cornerCustomized.current && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => { cornerCustomized.current = false; setCornerColor(fg); }}
                    title="Sync with foreground"
                    style={{ marginLeft: 6 }}
                  >
                    sync with fg
                  </button>
                )}
              </div>
            </Field>

            <Field
              label="Gradient foreground"
              hint="Use a linear gradient instead of a flat color for the QR modules. Premium look."
              className="mt-4"
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: gradientOn ? 10 : 0 }}>
                <label className="toggle">
                  <input type="checkbox" checked={gradientOn} onChange={e => setGradientOn(e.target.checked)} />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                </label>
                <span style={{ fontSize: 12.5, color: "var(--fg-muted)" }}>
                  {gradientOn ? "Gradient active — overrides foreground color" : "Solid foreground"}
                </span>
              </div>

              {gradientOn && (
                <div className="grid grid-2" style={{ gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginBottom: 4 }}>From</div>
                    <div className="swatch-row">
                      {QR_COLORS.map(c => (
                        <div key={c} className={`swatch ${gradientFrom === c ? "active" : ""}`} style={{ background: c }} onClick={() => setGradientFrom(c)} />
                      ))}
                      <label className={`swatch swatch-picker ${!QR_COLORS.includes(gradientFrom) ? "active" : ""}`} title="Custom color">
                        <input type="color" value={gradientFrom} onChange={e => setGradientFrom(e.target.value)} />
                        <span className="picker-icon"><Icon name="edit" size={11} /></span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginBottom: 4 }}>To</div>
                    <div className="swatch-row">
                      {QR_COLORS.map(c => (
                        <div key={c} className={`swatch ${gradientTo === c ? "active" : ""}`} style={{ background: c }} onClick={() => setGradientTo(c)} />
                      ))}
                      <label className={`swatch swatch-picker ${!QR_COLORS.includes(gradientTo) ? "active" : ""}`} title="Custom color">
                        <input type="color" value={gradientTo} onChange={e => setGradientTo(e.target.value)} />
                        <span className="picker-icon"><Icon name="edit" size={11} /></span>
                      </label>
                    </div>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginBottom: 4 }}>Angle · {gradientAngle}°</div>
                    <input
                      type="range"
                      min={0}
                      max={360}
                      step={15}
                      value={gradientAngle}
                      onChange={e => setGradientAngle(Number(e.target.value))}
                      className="range-slider"
                    />
                  </div>
                </div>
              )}
            </Field>
          </Card>

          {/* Label */}
          <Card className="card-pad-lg">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>Label</div>
                <div className="section-sub">Add text around the QR — "Scan me", a brand name, or a tagline.</div>
              </div>
              <Button size="sm" variant="ghost" icon="undo" onClick={resetLabel} title="Reset label formatting to defaults">Reset</Button>
            </div>

            <Field label="Text" hint={`${labelText.length}/20 chars · keep it short for the best read`} className="mt-4">
              <Input
                value={labelText}
                onChange={e => setLabelText(e.target.value.slice(0, 20))}
                placeholder="Scan to discover"
                maxLength={20}
              />
              {/* Rich text toolbar — font, size, B/I/U, alignment. Every change
                  reflects live in the preview on the right. */}
              <div className="rte-bar" role="toolbar" aria-label="Label formatting">
                <select
                  className="rte-select"
                  value={labelFont}
                  onChange={e => setLabelFont(e.target.value)}
                  title="Font"
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
                  title="Size"
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
                    title="Bold"
                    onClick={() => setLabelBold(v => !v)}>
                    <Icon name="bold" size={14} />
                  </button>
                  <button type="button"
                    className={`rte-btn ${labelItalic ? "active" : ""}`}
                    aria-pressed={labelItalic}
                    title="Italic"
                    onClick={() => setLabelItalic(v => !v)}>
                    <Icon name="italic" size={14} />
                  </button>
                  <button type="button"
                    className={`rte-btn ${labelUnderline ? "active" : ""}`}
                    aria-pressed={labelUnderline}
                    title="Underline"
                    onClick={() => setLabelUnderline(v => !v)}>
                    <Icon name="underline" size={14} />
                  </button>
                </div>

                <div className="rte-sep" />

                <div className="rte-group" role="radiogroup" aria-label="Text alignment">
                  <button type="button"
                    className={`rte-btn ${labelAlign === "left" ? "active" : ""}`}
                    aria-pressed={labelAlign === "left"}
                    title="Align left"
                    onClick={() => setLabelAlign("left")}>
                    <Icon name="align-left" size={14} />
                  </button>
                  <button type="button"
                    className={`rte-btn ${labelAlign === "center" ? "active" : ""}`}
                    aria-pressed={labelAlign === "center"}
                    title="Align center"
                    onClick={() => setLabelAlign("center")}>
                    <Icon name="align-center" size={14} />
                  </button>
                  <button type="button"
                    className={`rte-btn ${labelAlign === "right" ? "active" : ""}`}
                    aria-pressed={labelAlign === "right"}
                    title="Align right"
                    onClick={() => setLabelAlign("right")}>
                    <Icon name="align-right" size={14} />
                  </button>
                </div>
              </div>
            </Field>

            <Field label="Position" hint="Where the text sits relative to the QR." className="mt-4">
              <div className="pos-picker">
                {LABEL_POSITIONS.map(p => (
                  <div key={p} className={`style-opt pos-opt ${labelPos === p ? "active" : ""}`} onClick={() => setLabelPos(p)}>
                    <div className="pos-opt-illus"><PositionMini pos={p} /></div>
                    <div className="style-opt-label">{p === "none" ? "Off" : p}</div>
                  </div>
                ))}
              </div>
            </Field>

            <Field
              label="Frame style"
              hint={
                labelPos === "none"
                  ? "Decorative outline around the QR. Pick a label position to unlock frames with text zones."
                  : `Frames with a text zone on the ${labelPos} — adapts to your label.`
              }
              className="mt-4"
            >
              <div className="style-picker" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {availableFrames.map(fs => (
                  <div key={fs}
                    className={`style-opt ${frameStyle === fs ? "active" : ""}`}
                    onClick={() => setFrameStyle(fs)}
                    title={FRAME_LABEL[fs]}>
                    <div className="style-opt-illus" style={{ width: 56, height: 40, display: "grid", placeItems: "center" }}>
                      <FrameMini style={fs} labelPos={labelPos} />
                    </div>
                    <div className="style-opt-label" style={{ textTransform: "capitalize" }}>{FRAME_LABEL[fs]}</div>
                  </div>
                ))}
              </div>
            </Field>

            {hasTextZone && (
              <div className="grid grid-2 mt-4">
                <Field label="Label text color" hint="Color of the text inside the frame's text zone.">
                  <div className="swatch-row">
                    {QR_COLORS.map(c => (
                      <div key={c} className={`swatch ${labelTextColor === c ? "active" : ""}`} style={{ background: c }} onClick={() => setLabelTextColor(c)} />
                    ))}
                    <label className={`swatch swatch-picker ${!QR_COLORS.includes(labelTextColor) ? "active" : ""}`} title="Custom color">
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
                <Field label="Text zone background" hint="Fill color of the band behind the label.">
                  <div className="swatch-row">
                    {QR_COLORS.map(c => (
                      <div key={c} className={`swatch ${labelBgColor === c ? "active" : ""}`} style={{ background: c }} onClick={() => setLabelBgColor(c)} />
                    ))}
                    {QR_BG_COLORS.map(c => (
                      <div key={`bg-${c}`} className={`swatch ${labelBgColor === c ? "active" : ""}`} style={{ background: c }} onClick={() => setLabelBgColor(c)} />
                    ))}
                    <label className={`swatch swatch-picker ${![...QR_COLORS, ...QR_BG_COLORS].includes(labelBgColor) ? "active" : ""}`} title="Custom color">
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
            <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>Tracking</div>
            <div className="section-sub">UTM parameters appended to scan redirects automatically — surface QR traffic in Google Analytics, Shopify Analytics, Klaviyo, etc.</div>
            <div className="grid grid-2 mt-4">
              <Field label="UTM campaign" hint="The campaign / promotion name. Example: summer-drop-2026.">
                <Input placeholder="summer-drop-2026" value={utmCampaign} onChange={e => setUtmCampaign(e.target.value)} />
              </Field>
              <Field label="UTM source" hint="The physical/digital placement. Example: qr-flyer, in-store, packaging.">
                <Input placeholder="qr-flyer" value={utmSource} onChange={e => setUtmSource(e.target.value)} />
              </Field>
              <Field label="UTM medium" hint="The marketing channel. Defaults to 'qr' so all your QR traffic groups together in analytics.">
                <Input placeholder="qr" value={utmMedium} onChange={e => setUtmMedium(e.target.value)} />
              </Field>
              <Field label="UTM term" hint="Optional. Identifies the QR placement or variant — e.g. 'storefront-window', 'flyer-v2'.">
                <Input placeholder="storefront-window" value={utmTerm} onChange={e => setUtmTerm(e.target.value)} />
              </Field>
            </div>
          </Card>

          {/* Schedule + Campaign link */}
          <Card className="card-pad-lg">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>Schedule &amp; campaign</div>
                <div className="section-sub">Schedule when the QR activates / expires, and choose the Campaign page this QR should open.</div>
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
                title={scheduleEnabled ? "Disable schedule" : "Enable schedule"}
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
                <Field label="Activates at" hint="Required when schedule is enabled." required>
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
                <Field label="Expires at" hint="Required when schedule is enabled." required>
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
              <Field label="Campaign page" hint="Scans land on the selected Campaign. Draft and paused campaigns can still be previewed before activation." className="mt-4">
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
                  <option value="">— No campaign —</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id} disabled={c.status === "ENDED"}>
                      {c.name} {c.status !== "ACTIVE" ? `(${c.status.toLowerCase()})` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </Card>
        </div>

        {/* ══ RIGHT — Sticky preview ══ */}
        <div style={{ position: "sticky", top: 28 }}>
          <Card className="card-pad-lg" accent={activated ? "green" : "blue"}>
            <div className="flex items-center justify-between mb-4">
              <div className="strong" style={{ fontSize: 13.5 }}>Live preview</div>
              <Badge tone={activated ? "success" : "neutral"} dot>{activated ? "Active" : savedQr ? "Saved draft" : "Unsaved"}</Badge>
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
                <div style={{ width: 248, height: 248, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: bg, color: "var(--fg-subtle)", fontSize: 11.5, textAlign: "center", padding: 16, borderRadius: 12 }}>
                  <Icon name="qr-code" size={28} />
                  <div>Name your QR code<br />to preview it.</div>
                </div>
              ) : (
                <>
                  <QrSvg
                    key={renderToken}
                    text={previewText}
                    size={220}
                    fg={fg}
                    bg={bg}
                    style={style}
                    cornerStyle={cornerStyle}
                    logo={logoSel}
                    logoSize={logoSizePct / 100}
                    margin={qrMargin}
                    cornerColor={cornerColor}
                    gradient={gradientOn ? { from: gradientFrom, to: gradientTo, angle: gradientAngle } : null}
                    label={previewLabel}
                  />
                  <div className={`qr-loading-overlay ${generating ? "active" : ""}`}>
                    <div className="qr-loading-spinner" />
                    <div className="qr-loading-text">Generating…</div>
                  </div>
                </>
              )}
            </div>

            <div className="text-sm muted mt-4">
              Destination: <span className="strong">{tm.name}</span>
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
                  {submitting && submitMode === "save" ? "Saving…" : "Save"}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  icon="save"
                  disabled={submitting}
                  onClick={() => submitQr("saveExit")}
                  style={{ width: "100%" }}
                >
                  {submitting && submitMode === "saveExit" ? "Saving…" : "Save & exit"}
                </Button>
              </div>

              <Button
                variant="success"
                size="lg"
                icon={activated ? "circle-check" : "zap"}
                disabled={submitting || !savedQr || activated}
                title={!savedQr ? "Save this QR code before activating it" : activated ? "QR code is already active" : "Activate QR code"}
                onClick={() => submitQr("activate")}
                style={{ width: "100%" }}
              >
                {submitting && submitMode === "activate" ? "Activating…" : activated ? "Active" : "Activate"}
              </Button>

              <div className="text-xs muted" style={{ textAlign: "center" }}>
                {!savedQr ? "Save first to unlock activation and downloads." : activated ? "Changes can still be saved while this QR stays active." : "Saved drafts can be activated here or from My QR codes."}
              </div>

              <div className="strong mt-2" style={{ fontSize: 12 }}>Scan URL</div>
              <div style={{ fontFamily: "var(--ff-mono)", fontSize: 11, padding: "8px 10px", background: "var(--bg-sunken)", border: "1px solid var(--border)", borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: savedQr ? "var(--fg-strong)" : "var(--fg-muted)" }}>
                  {savedQr ? previewText : "Save first to generate a scan URL"}
                </span>
                <Button size="sm" variant="ghost" disabled={!savedQr} onClick={() => {
                  if (!savedQr) return;
                  navigator.clipboard?.writeText(previewText);
                  toast({ title: "Link copied", type: "info" });
                }}>
                  <Icon name="copy" size={12} />
                </Button>
              </div>

              <div className="grid grid-3 gap-2 mt-2">
                {(["png", "svg", "pdf"] as DownloadFormat[]).map(format => (
                  <Button
                    key={format}
                    size="sm"
                    variant="secondary"
                    icon="download"
                    disabled={!savedQr || downloading === format}
                    title={!savedQr ? "Save this QR code before downloading it" : `Download ${format.toUpperCase()}`}
                    onClick={() => handleDownload(format)}
                    style={{ width: "100%" }}
                  >
                    {format.toUpperCase()}
                  </Button>
                ))}
              </div>

              <Button size="md" variant="primary" icon="eye"
                style={{ marginTop: 4 }}
                onClick={() => navigate("/app/qr-manager")}>
                Go to My QR codes
              </Button>
            </div>
          </Card>

          <div className="text-xs muted mt-4" style={{ textAlign: "center", padding: "0 12px" }}>
            TrackQr tracks every scan, device and conversion through a unique short URL.
          </div>
        </div>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
