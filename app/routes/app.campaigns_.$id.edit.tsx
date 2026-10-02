import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { siFacebook, siInstagram, siTiktok, siX } from "simple-icons";
import { requireShop } from "../lib/shop.server";
import { getCampaign, listCampaignBlockQrChoices, saveBlocks, setCampaignStatus } from "../lib/campaign.server";
import { getPlanEntitlements, QuotaExceededError } from "../lib/plan.server";
import { applyDesignEntitlement } from "../lib/qr-standard";
import type { CampaignStatus } from "@prisma/client";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { Segmented } from "../components/ui/Segmented";
import { useToast } from "../components/ui/Toast";
import { renderQrSvg } from "../lib/qr-render";
import { LABEL_FONTS, LABEL_FONT_GROUPS, DEFAULT_FONT, getLabelFont } from "../lib/label-fonts";
import { DEFAULT_CAMPAIGN_PAGE_SETTINGS, campaignPageSettingsForPlan, normalizeCampaignPageSettings, type CampaignPageSettings } from "../lib/campaign-settings";
import { useReviewRequest } from "../lib/use-review-request";
import { campaignPreviewPath } from "../lib/signing.server";
import { FeatureLock } from "../components/ui/FeatureLock";
import { RangeSlider } from "../components/ui/RangeSlider";
import { formatNumber, t, tm, tp } from "../lib/i18n";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  if (!params.id) throw new Response("Missing id", { status: 400 });
  const campaign = await getCampaign(shop.id, params.id);
  if (!campaign) throw new Response("Not found", { status: 404 });
  const [qrChoices, entitlements] = await Promise.all([
    listCampaignBlockQrChoices(shop.id),
    getPlanEntitlements(shop),
  ]);
  const appUrl = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "");
  return {
    campaign: {
      id: campaign.id,
      slug: campaign.slug,
      name: campaign.name,
      status: campaign.status,
      settings: normalizeCampaignPageSettings(campaign.settings),
      blocks: (campaign.blocks as unknown) as Array<{ id: string; type: string; props: Record<string, unknown>; layout: { padding: string; align: string; bg: string }; visibility: { mobile: boolean; desktop: boolean } }>,
    },
    // The "Powered by TrackQr" watermark is forced on the Free plan.
    isFreePlan: entitlements.status !== "active",
    planFeatures: {
      leadRewards: entitlements.leadRewards,
      campaignPixels: entitlements.campaignPixels,
      customerSync: entitlements.customerSync,
    },
    // Signed 24h link: the preview tab has no Shopify session.
    previewPath: campaignPreviewPath(campaign.id),
    shopDomain: shop.domain,
    qrChoices: qrChoices.map(q => {
      // Embedded QR previews follow the plan's design rules (standard style without `customDesign`).
      const appearance = applyDesignEntitlement(entitlements.customDesign, q.design, q.label);
      return {
        id: q.id,
        name: q.name,
        slug: q.slug,
        type: q.type,
        target: q.target,
        active: q.active,
        campaignId: q.campaignId,
        design: appearance.design,
        label: appearance.label,
        scanUrl: appUrl ? `${appUrl}/s/${q.slug}` : `/s/${q.slug}`,
      };
    }),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  if (!params.id) return { ok: false, error: "no-id" } as const;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");

  try {
    if (intent === "save") {
      const blocks = JSON.parse(String(form.get("blocks") ?? "[]"));
      const settings = normalizeCampaignPageSettings(JSON.parse(String(form.get("settings") ?? "{}")));
      const name = (form.get("name") as string | null) ?? undefined;
      await saveBlocks(shop.id, params.id, blocks, name, settings);
      return { ok: true, savedAt: new Date().toISOString() } as const;
    }
    if (intent === "publish") {
      const blocksRaw = form.get("blocks");
      const name = (form.get("name") as string | null) ?? undefined;
      if (blocksRaw) {
        const blocks = JSON.parse(String(blocksRaw));
        const settings = normalizeCampaignPageSettings(JSON.parse(String(form.get("settings") ?? "{}")));
        await saveBlocks(shop.id, params.id, blocks, name, settings);
      }
      await setCampaignStatus(shop, params.id, "ACTIVE");
      return { ok: true, status: "ACTIVE" as CampaignStatus } as const;
    }
    if (intent === "pause") {
      await setCampaignStatus(shop, params.id, "PAUSED");
      return { ok: true, status: "PAUSED" as CampaignStatus } as const;
    }
    if (intent === "draft") {
      await setCampaignStatus(shop, params.id, "DRAFT");
      return { ok: true, status: "DRAFT" as CampaignStatus } as const;
    }
    return { ok: false, error: "unknown" } as const;
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return { ok: false, error: "quota", message: err.message } as const;
    }
    return { ok: false, error: "server", message: err instanceof Error ? err.message : "" } as const;
  }
};

/* ══════════════ Data / types ══════════════ */

type BlockType =
  | "hero" | "timer" | "products" | "capture" | "promo"
  | "text" | "button" | "image" | "video" | "reviews"
  | "faq" | "urgency" | "qr";

interface Block {
  id: string;
  type: BlockType;
  props: Record<string, unknown>;
  layout: { padding: string; align: string; bg: string };
  visibility: { mobile: boolean; desktop: boolean };
}

type DeviceType = "desktop" | "tablet" | "mobile";
type MerchantQrChoice = {
  id: string;
  name: string;
  slug: string;
  type: string;
  target: string;
  active: boolean;
  campaignId: string | null;
  scanUrl: string;
  design?: Record<string, unknown> | null;
  label?: Record<string, unknown> | null;
};
type ShopifyPickedResource = {
  id: string;
  title: string;
  handle?: string;
  onlineStoreUrl?: string;
  image?: string;
};
type UploadedImageAsset = {
  assetId: string;
  shopifyFileId: string;
  url: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
};
type BlockEditorActions = {
  uploadImage: (file: File, apply: (asset: UploadedImageAsset) => void) => Promise<void>;
  pickProducts: (apply: (items: ShopifyPickedResource[]) => void) => Promise<void>;
  pickCollection: (apply: (item: ShopifyPickedResource) => void) => Promise<void>;
};
type BlockPropSetter = (k: string, v: unknown) => void;
type BlockPropsSetter = (values: Record<string, unknown>) => void;
const PAGE_SETTINGS_ID = "__page_settings";
function isPickedResource(value: unknown): value is ShopifyPickedResource {
  return !!value && typeof value === "object" && typeof (value as ShopifyPickedResource).id === "string" && typeof (value as ShopifyPickedResource).title === "string";
}
function pickedResources(value: unknown): ShopifyPickedResource[] {
  return Array.isArray(value) ? value.filter(isPickedResource) : [];
}
function pickedResource(value: unknown): ShopifyPickedResource | null {
  return isPickedResource(value) ? value : null;
}

function uid(prefix = "b") { return prefix + Math.random().toString(36).slice(2, 8); }

// Shown as initials (L / C / R, S / M / L) of the translated words.
const ALIGN_OPTS = [
  { value: "left",   label: "Left" },
  { value: "center", label: "Center" },
  { value: "right",  label: "Right" },
];
const PADDING_OPTS = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
];
const BG_OPTS = [
  { value: "surface",    label: "Default", swatch: "var(--bg-surface)",  border: "var(--border)" },
  { value: "sunken",     label: "Sunken",  swatch: "var(--bg-sunken)",   border: "var(--border)" },
  { value: "brand-soft", label: "Brand",   swatch: "var(--accent-soft)", border: "var(--accent-border)" },
  { value: "brand",      label: "Solid",   swatch: "var(--accent)",      border: "var(--accent)" },
  { value: "dark",       label: "Dark",    swatch: "var(--fg-strong)",   border: "var(--fg-strong)" },
];
const COLOR_PRESETS = ["#0B1220", "#2563EB", "#7C3AED", "#16A34A", "#D97706", "#DB2777", "#FFFFFF"];

function fontFamily(value: unknown) {
  if (typeof value === "string" && LABEL_FONTS.some(f => f.value === value)) {
    return getLabelFont(value).family;
  }
  switch (value) {
    case "display": return "var(--ff-display)";
    case "serif": return "var(--ff-serif)";
    case "mono": return "var(--ff-mono)";
    case "sans": return "var(--ff-sans)";
    default: return undefined;
  }
}
function sizePx(value: unknown, map: Record<string, number>, fallback: number) {
  return map[String(value || "md")] ?? fallback;
}
function textRoleStyle(p: Record<string, unknown>, role: "heading" | "body" | "eyebrow" | "button", fallbackSize?: number): React.CSSProperties {
  const style: React.CSSProperties = {};
  const fontId = typeof p[`${role}Font`] === "string" ? String(p[`${role}Font`]) : "";
  const spec = fontId && fontId !== "inherit" ? getLabelFont(fontId) : null;
  if (fontId && fontId !== "inherit") {
    style.fontFamily = spec?.family;
    style.letterSpacing = spec?.letterSpacing;
    style.textTransform = spec?.textTransform;
  }
  const size = Number(p[`${role}FontSize`]);
  if (Number.isFinite(size) && size > 0) style.fontSize = size;
  else if (fallbackSize) style.fontSize = fallbackSize;
  if (p[`${role}Bold`] === true) style.fontWeight = 700;
  else if (spec?.weight) style.fontWeight = spec.weight;
  if (p[`${role}Italic`] === true) style.fontStyle = "italic";
  if (p[`${role}Underline`] === true) style.textDecoration = "underline";
  if (typeof p[`${role}Align`] === "string") style.textAlign = p[`${role}Align`] as React.CSSProperties["textAlign"];
  return style;
}
function numeric(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function dateTimeLocalValue(value: unknown) {
  const raw = String(value || "");
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromDateTimeLocal(value: string) {
  return value ? new Date(value).toISOString() : "";
}
function countdownParts(value: unknown, now = Date.now()) {
  const target = new Date(String(value || "")).getTime();
  const diff = Number.isFinite(target) ? Math.max(0, target - now) : 0;
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const secs = Math.floor((diff % 60_000) / 1000);
  return [days, hours, mins, secs].map(n => String(n).padStart(2, "0"));
}
function qrRenderOpts(design?: Record<string, unknown> | null, label?: Record<string, unknown> | null, size = 220) {
  const d = design ?? {};
  const l = label ?? {};
  const labelOpts = {
    text: typeof l.text === "string" ? l.text : undefined,
    position: l.position as "none" | "top" | "bottom" | "left" | "right" | undefined,
    frame: l.frame as never,
    font: typeof l.font === "string" ? l.font : undefined,
    size: typeof l.size === "number" ? l.size : undefined,
    bold: typeof l.bold === "boolean" ? l.bold : undefined,
    italic: typeof l.italic === "boolean" ? l.italic : undefined,
    underline: typeof l.underline === "boolean" ? l.underline : undefined,
    align: l.align as "left" | "center" | "right" | undefined,
    labelColor: typeof l.labelColor === "string" ? l.labelColor : undefined,
    bandColor: typeof l.bandColor === "string" ? l.bandColor : undefined,
  };
  return {
    size,
    margin: numeric(d.margin, 8),
    fg: typeof d.fg === "string" ? d.fg : undefined,
    bg: typeof d.bg === "string" ? d.bg : undefined,
    style: d.style as "square" | "rounded" | "dot" | "classy" | undefined,
    cornerStyle: d.cornerStyle as "square" | "rounded" | "extra-rounded" | undefined,
    cornerColor: typeof d.cornerColor === "string" ? d.cornerColor : undefined,
    withLogo: Boolean(d.withLogo),
    logoDataUrl: typeof d.logoUrl === "string" ? d.logoUrl : undefined,
    logoSize: numeric(d.logoSize, 0.2),
    gradient: d.gradient as { from: string; to: string; angle?: number } | null | undefined,
    label: labelOpts.text || labelOpts.frame ? labelOpts : undefined,
  };
}
function qrBlockSize(value: unknown) {
  switch (value) {
    case "sm": return 180;
    case "lg": return 280;
    case "md":
    default: return 220;
  }
}
function bgValue(value: unknown) {
  switch (value) {
    case "sunken": return "var(--bg-sunken)";
    case "brand-soft": return "var(--accent-soft)";
    case "brand": return "var(--accent)";
    case "dark": return "#0B1220";
    case "surface":
    default: return "transparent";
  }
}
function blockStyle(p: Record<string, unknown>, layout?: { padding?: string; align?: string; bg?: string }): React.CSSProperties {
  const pad = layout?.padding === "sm" ? 16 : layout?.padding === "lg" ? 44 : 28;
  const bgImageUrl = typeof p.bgImageUrl === "string" && p.bgImageUrl ? p.bgImageUrl : "";
  const overlay = Math.max(0, Math.min(0.9, numeric(p.bgOverlay, 0.25)));
  return {
    background: typeof p.bgColor === "string" && p.bgColor ? p.bgColor : bgValue(layout?.bg),
    backgroundImage: bgImageUrl ? `linear-gradient(rgba(11,18,32,${overlay}), rgba(11,18,32,${overlay})), url("${bgImageUrl}")` : undefined,
    backgroundSize: bgImageUrl ? String(p.bgImageFit || "cover") : undefined,
    backgroundPosition: bgImageUrl ? String(p.bgImagePosition || "center") : undefined,
    backgroundRepeat: bgImageUrl ? "no-repeat" : undefined,
    color: typeof p.textColor === "string" && p.textColor ? p.textColor : undefined,
    fontFamily: fontFamily(p.font),
    textAlign: (layout?.align as React.CSSProperties["textAlign"]) || "left",
    padding: `${pad}px clamp(18px, 4vw, 56px)`,
  };
}
function headingStyle(p: Record<string, unknown>, fallback = 28): React.CSSProperties {
  return {
    color: typeof p.headingColor === "string" && p.headingColor ? p.headingColor : undefined,
    fontSize: sizePx(p.headingSize, { sm: 18, md: fallback, lg: 30, xl: 38 }, fallback),
    fontFamily: fontFamily(p.headingFont) ?? fontFamily(p.font),
    ...textRoleStyle(p, "heading"),
  };
}
function bodyStyle(p: Record<string, unknown>, fallback = 15): React.CSSProperties {
  return {
    color: typeof p.bodyColor === "string" && p.bodyColor ? p.bodyColor : undefined,
    fontSize: sizePx(p.bodySize, { sm: 12, md: fallback, lg: 17, xl: 20 }, fallback),
    fontFamily: fontFamily(p.font),
    ...textRoleStyle(p, "body"),
  };
}
function accentColor(p: Record<string, unknown>) {
  return typeof p.accentColor === "string" && p.accentColor ? p.accentColor : undefined;
}
function cssColor(p: Record<string, unknown>, key: string) {
  return typeof p[key] === "string" && p[key] ? String(p[key]) : undefined;
}
function buttonInlineStyle(p: Record<string, unknown>): React.CSSProperties | undefined {
  const style: React.CSSProperties = { ...textRoleStyle(p, "button") };
  const bg = cssColor(p, "buttonBgColor");
  const color = cssColor(p, "buttonTextColor");
  const border = cssColor(p, "buttonBorderColor");
  if (bg) style.background = bg;
  if (color) style.color = color;
  if (border) style.borderColor = border;
  return Object.keys(style).length ? style : undefined;
}
function cardInlineStyle(p: Record<string, unknown>): React.CSSProperties | undefined {
  const style: React.CSSProperties = {};
  const bg = cssColor(p, "cardBgColor");
  const color = cssColor(p, "cardTextColor");
  const border = cssColor(p, "cardBorderColor");
  if (bg) style.background = bg;
  if (color) style.color = color;
  if (border) style.borderColor = border;
  return Object.keys(style).length ? style : undefined;
}
function safeHref(value: unknown) {
  const href = String(value || "").trim();
  return href && href !== "https://" ? href : undefined;
}
function videoSrc(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const yt = raw.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = raw.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return raw;
}

const BLOCK_LIBRARY: { id: BlockType; name: string; icon: string; tone: string }[] = [
  { id: "hero",     name: "Hero section",    icon: "image",               tone: "blue"    },
  { id: "timer",    name: "Countdown timer", icon: "clock",               tone: "amber"   },
  { id: "products", name: "Product grid",    icon: "grid",                tone: "blue"    },
  { id: "capture",  name: "Email capture",   icon: "mail",                tone: "violet"  },
  { id: "promo",    name: "Promo code",      icon: "tag",                 tone: "amber"   },
  { id: "image",    name: "Image / gallery", icon: "image",               tone: "neutral" },
  { id: "video",    name: "Video",           icon: "video",               tone: "neutral" },
  { id: "text",     name: "Text block",      icon: "type",                tone: "neutral" },
  { id: "reviews",  name: "Reviews",         icon: "star",                tone: "amber"   },
  { id: "faq",      name: "FAQ",             icon: "help-circle",         tone: "neutral" },
  { id: "urgency",  name: "Urgency banner",  icon: "alert-triangle",      tone: "danger"  },
  { id: "qr",       name: "QR code block",   icon: "qr-code",             tone: "blue"    },
  { id: "button",   name: "Button",          icon: "mouse-pointer-click", tone: "neutral" },
];

function blockMeta(id: BlockType) { return BLOCK_LIBRARY.find(b => b.id === id); }

/* ── Block defaults ── */
type BlockDefaults = {
  defaults: () => Record<string, unknown>;
  layout: () => { padding: string; align: string; bg: string };
};

const BLOCK_DEFAULTS: Record<BlockType, BlockDefaults> = {
  hero:     { defaults: () => ({ eyebrow: t("Limited time"), title: t("Limited drop · 24 hours only"), subtitle: t("Aurora's spring collection — exclusive scan-to-shop access."), cta: t("Shop the drop"), ctaHref: "https://", ctaVariant: "primary", headingSize: "xl", bodySize: "lg" }), layout: () => ({ padding: "lg", align: "center", bg: "dark" }) },
  timer:    { defaults: () => ({ label: t("Drop ends in"), endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() }),                                                                    layout: () => ({ padding: "md", align: "center", bg: "sunken" }) },
  products: { defaults: () => ({ title: t("Featured pieces"), mode: "products", count: 3, products: [], collection: null, cta: t("Shop selected"), cardBgColor: "#FFFFFF" }),                         layout: () => ({ padding: "md", align: "left",   bg: "surface" }) },
  capture:  { defaults: () => ({ title: t("Get early access"), subtitle: t("Drop your email — we'll let you know when it's live."), placeholder: "you@email.com", cta: t("Notify me"), merchantEmail: "", mailSubject: t("New campaign lead"), consentEnabled: true, consentRequired: false, rewardEnabled: false, rewardPercent: 10 }),   layout: () => ({ padding: "md", align: "center", bg: "sunken" }) },
  promo:    { defaults: () => ({ eyebrow: t("Use code"), code: "AURORA15", title: t("15% off your first order"), autoApply: true, cta: t("Apply discount"), href: "" }),                                    layout: () => ({ padding: "md", align: "center", bg: "surface" }) },
  text:     { defaults: () => ({ heading: t("Why this drop is different"), body: t("Hand-cut, hand-stitched, made in batches of 200.") }),                                                               layout: () => ({ padding: "md", align: "left",   bg: "surface" }) },
  button:   { defaults: () => ({ label: t("Shop the collection"), href: "https://", variant: "primary", icon: true }),                                                                                layout: () => ({ padding: "sm", align: "center", bg: "surface" }) },
  image:    { defaults: () => ({ src: "", assetId: "", aspect: "16:9", fit: "cover", caption: "", alt: "" }),                                                                                     layout: () => ({ padding: "md", align: "center", bg: "surface" }) },
  video:    { defaults: () => ({ title: t("Watch the drop"), src: "", autoplay: false, controls: true }),                                                                                             layout: () => ({ padding: "md", align: "center", bg: "surface" }) },
  reviews:  { defaults: () => ({ title: t("What customers say"), items: [{ name: t("Customer name"), rating: 5, text: t("Paste a real customer review here."), verified: false }, { name: t("Customer name"), rating: 5, text: t("Paste another real review here."), verified: false }] }), layout: () => ({ padding: "md", align: "center", bg: "sunken" }) },
  faq:      { defaults: () => ({ title: t("Questions, answered"), expanded: false, items: [{ q: t("When will my order ship?"), a: t("Within 2 business days. You'll get tracking by email.") }, { q: t("What's the return policy?"), a: t("30 days, no questions asked. Items must be unworn.") }] }), layout: () => ({ padding: "md", align: "left", bg: "surface" }) },
  urgency:  { defaults: () => ({ label: t("Only 14 left"), message: t("Once they're gone, they're gone."), tone: "danger", icon: "alert-triangle" }),                                                    layout: () => ({ padding: "sm", align: "center", bg: "surface" }) },
  qr:       { defaults: () => ({ title: t("Scan to continue"), subtitle: t("Open this page on your phone to shop."), qrId: "", size: "md" }),                                                            layout: () => ({ padding: "md", align: "center", bg: "sunken" }) },
};

function makeBlock(type: BlockType): Block {
  const def = BLOCK_DEFAULTS[type];
  return { id: uid(), type, props: def.defaults(), layout: def.layout(), visibility: { mobile: true, desktop: true } };
}

const STARTER_BLOCKS: BlockType[] = ["hero", "timer", "products", "capture", "promo"];

/* ══════════════ Block Previews ══════════════ */


function HeroPreview({ p, layout }: { p: Record<string, unknown>; layout: Block["layout"] }) {
  const href = safeHref(p.ctaHref);
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      <div className="tqr-hero">
        {!!p.eyebrow && <div className="tqr-eyebrow" style={{ color: cssColor(p, "eyebrowColor"), ...textRoleStyle(p, "eyebrow") }}>{String(p.eyebrow)}</div>}
        <h1 style={headingStyle(p, 40)}>{String(p.title)}</h1>
        {!!p.subtitle && <p style={bodyStyle(p, 17)}>{String(p.subtitle)}</p>}
        {!!p.cta && (
          <a href={href ?? "#"} onClick={e => e.preventDefault()} className={`tqr-btn ${String(p.ctaVariant ?? "primary")}`} style={buttonInlineStyle(p)}>
            {String(p.cta)} →
          </a>
        )}
      </div>
    </div>
  );
}

function TimerPreview({ p, layout }: { p: Record<string, unknown>; layout: Block["layout"] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const parts = countdownParts(p.endsAt || p.endsIn, now);
  const labels = [t("Days"), t("Hours"), t("Min"), t("Sec")];
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      {!!p.label && <div className="tqr-eyebrow center" style={{ color: cssColor(p, "eyebrowColor"), ...textRoleStyle(p, "eyebrow") }}>{String(p.label)}</div>}
      <div className="tqr-timer" data-countdown-target={String(p.endsAt || "")}>
        {parts.map((part, i) => (
          <div key={i}>
            <div className="num" style={{ color: accentColor(p) }}>{part}</div>
            <div className="lbl">{labels[i]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductsPreview({ p, layout }: { p: Record<string, unknown>; layout: Block["layout"] }) {
  const selectedProducts = pickedResources(p.products).slice(0, Number(p.count) || 3);
  const collection = pickedResource(p.collection);
  const names  = ["Aurora Tee", "Stone Hoodie", "Drift Cap", "Pace Tote", "Linen Shirt", "Wool Beanie"];
  const prices = ["$48.00", "$128.00", "$36.00", "$58.00", "$92.00", "$28.00"];
  const products = selectedProducts.length
    ? selectedProducts
    : Array.from({ length: Number(p.count) || 3 }, (_, i) => ({ id: `sample-${i}`, title: names[i % names.length], image: "" }));
  if (collection && !selectedProducts.length) {
    return (
      <div className="tqr-section block-content" style={blockStyle(p, layout)}>
        <h2 style={headingStyle(p)}>{String(p.title)}</h2>
        <div className="tqr-collection-card" style={cardInlineStyle(p)}>
          <div className="tqr-collection-img">
            {collection.image ? <img src={collection.image} alt="" /> : null}
          </div>
          <div>
            <div className="tqr-product-name" style={{ color: cssColor(p, "cardTextColor") }}>{collection.title}</div>
            <div className="tqr-product-price" style={{ color: cssColor(p, "priceColor") }}>{t("Collection")}</div>
          </div>
        </div>
        <span className="tqr-btn secondary" style={buttonInlineStyle(p)}>{String(p.cta || t("Shop collection"))} →</span>
      </div>
    );
  }
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      <h2 style={headingStyle(p)}>{String(p.title)}</h2>
      <div className="tqr-products">
        {products.map((product, i) => (
          <div key={product.id || i} className="tqr-product" style={cardInlineStyle(p)}>
            <div className="tqr-product-img">
              {product.image ? <img src={product.image} alt="" /> : null}
            </div>
            <div className="tqr-product-name" style={{ color: cssColor(p, "cardTextColor") }}>{product.title}</div>
            <div className="tqr-product-price" style={{ color: cssColor(p, "priceColor") }}>{prices[i % prices.length]}</div>
          </div>
        ))}
      </div>
      {(collection || selectedProducts.length > 0) && <span className="tqr-btn secondary" style={buttonInlineStyle(p)}>{String(p.cta || t("Shop selected"))} →</span>}
    </div>
  );
}

function CapturePreview({ p, layout }: { p: Record<string, unknown>; layout: Block["layout"] }) {
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      <div className="tqr-capture" style={{ background: cssColor(p, "capturePanelBgColor"), borderColor: cssColor(p, "capturePanelBorderColor") }}>
        <h3 style={headingStyle(p, 22)}>{String(p.title)}</h3>
        {!!p.subtitle && <p style={bodyStyle(p)}>{String(p.subtitle)}</p>}
        <div className="tqr-capture-form">
          <input
            type="email"
            placeholder={String(p.placeholder || "you@email.com")}
            style={{
              background: cssColor(p, "inputBgColor"),
              color: cssColor(p, "inputTextColor"),
              borderColor: cssColor(p, "inputBorderColor"),
              "--placeholder-color": cssColor(p, "placeholderColor"),
            } as React.CSSProperties}
          />
          <button type="button" className="tqr-btn primary" style={buttonInlineStyle(p)}>{String(p.cta || t("Notify me"))}</button>
        </div>
        {p.consentEnabled !== false && (
          <div className="capture-consent-preview">
            <span className="capture-consent-box" aria-hidden="true" />
            <span>{String(p.consentText || t("I agree to receive emails from the store. I can unsubscribe at any time."))}</span>
          </div>
        )}
        {p.rewardEnabled === true && (
          <div className="capture-reward-preview">
            <Icon name="gift" size={12} /> {t("{value}% off code revealed after sign-up", { value: Number(p.rewardPercent) || 10 })}
          </div>
        )}
      </div>
    </div>
  );
}

function PromoPreview({ p, layout }: { p: Record<string, unknown>; layout: Block["layout"] }) {
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      {!!p.eyebrow && <div className="tqr-eyebrow" style={{ color: cssColor(p, "eyebrowColor"), ...textRoleStyle(p, "eyebrow") }}>{String(p.eyebrow)}</div>}
      <div className="tqr-promo" style={{ color: accentColor(p), borderColor: accentColor(p) }}>{String(p.code)}</div>
      <p style={bodyStyle(p)}>{String(p.title)}</p>
      {!!p.cta && <span className="tqr-btn secondary" style={buttonInlineStyle(p)}>{String(p.cta)}</span>}
    </div>
  );
}

function TextPreview({ p, layout }: { p: Record<string, unknown>; layout: { align: string } }) {
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      {!!p.heading && <h2 style={headingStyle(p, 28)}>{String(p.heading)}</h2>}
      {!!p.body && <p style={{ whiteSpace: "pre-line", ...bodyStyle(p) }}>{String(p.body)}</p>}
    </div>
  );
}

function ButtonPreview({ p, layout }: { p: Record<string, unknown>; layout: { align: string } }) {
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      <div className={layout?.align === "left" ? "" : layout?.align === "right" ? "right" : "center"}>
        <span className={`tqr-btn ${String(p.variant ?? "primary")}`} style={buttonInlineStyle(p)}>
          {String(p.label || t("Click me"))}{p.icon ? " →" : ""}
        </span>
      </div>
    </div>
  );
}

function ImagePreview({ p, layout }: { p: Record<string, unknown>; layout: Block["layout"] }) {
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      {safeHref(p.src) ? (
        <div className="tqr-media" data-aspect={String(p.aspect || "16:9")}>
          <img src={String(p.src)} alt={String(p.alt || "")} style={{ objectFit: (p.fit as "cover" | "contain") || "cover" }} />
        </div>
      ) : (
        <div className="tqr-placeholder" data-aspect={String(p.aspect || "16:9")}>{t("Image placeholder")}</div>
      )}
      {!!p.caption && <div className="tqr-caption">{String(p.caption)}</div>}
    </div>
  );
}

function VideoPreview({ p, layout }: { p: Record<string, unknown>; layout: Block["layout"] }) {
  const src = videoSrc(p.src);
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      {!!p.title && <h3>{String(p.title)}</h3>}
      {src ? (
        src.match(/\.(mp4|webm|ogg)(\?.*)?$/i)
          ? <video src={src} controls={p.controls !== false} muted autoPlay={!!p.autoplay} style={{ width: "100%", aspectRatio: "16/9", borderRadius: 8 }} />
          : <iframe src={src} title={String(p.title || t("Video"))} style={{ width: "100%", aspectRatio: "16/9", border: 0, borderRadius: 8 }} allowFullScreen />
      ) : <div className="tqr-placeholder">{t("Video placeholder")}</div>}
    </div>
  );
}

function ReviewsPreview({ p, layout }: { p: Record<string, unknown>; layout: { align: string } }) {
  const items = (p.items as Array<{ rating: number; name: string; text: string; verified?: boolean }>) || [];
  const avg = items.reduce((s, r) => s + (r.rating || 5), 0) / Math.max(items.length, 1);
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      <h2 style={{ textAlign: "center", ...headingStyle(p) }}>{String(p.title || t("What customers say"))}</h2>
      <div className="tqr-reviews-meta">
        <span className="stars" style={{ color: accentColor(p) }}>{"★".repeat(Math.round(avg))}</span>
          <span>{formatNumber(avg, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} · {tp(items.length, "{count} review", "{count} reviews")}</span>
      </div>
      <div className="tqr-reviews">
        {items.slice(0, 3).map((r, i) => (
          <div key={i} className="tqr-review" style={cardInlineStyle(p)}>
            <div className="stars" style={{ color: accentColor(p) }}>{"★".repeat(r.rating || 5)}</div>
            <p style={{ color: cssColor(p, "cardTextColor") }}>&quot;{r.text}&quot;</p>
            <div className="name">— {r.name}{r.verified ? t(" · ✓ Verified") : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FaqPreview({ p, layout }: { p: Record<string, unknown>; layout: Block["layout"] }) {
  const items = (p.items as Array<{ q: string; a: string }>) || [];
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      {!!p.title && <h2 style={headingStyle(p, 28)}>{String(p.title)}</h2>}
      {items.map((it, i) => (
        <details key={i} open={!!p.expanded || i === 0}>
          <summary>{it.q}</summary>
          <p style={bodyStyle(p)}>{it.a}</p>
        </details>
      ))}
    </div>
  );
}

function UrgencyPreview({ p, layout }: { p: Record<string, unknown>; layout: Block["layout"] }) {
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      <div className={`tqr-urgency ${String(p.tone ?? "danger")}`}>
        <b>{String(p.label || t("Hurry"))}</b> {String(p.message)}
      </div>
    </div>
  );
}

function QrPreview({ p, layout, qrChoices }: { p: Record<string, unknown>; layout: Block["layout"]; qrChoices: MerchantQrChoice[] }) {
  const selected = qrChoices.find(q => q.id === p.qrId);
  const svg = selected ? renderQrSvg(selected.scanUrl, qrRenderOpts(selected.design, selected.label, qrBlockSize(p.size))) : "";
  return (
    <div className="tqr-section block-content" style={blockStyle(p, layout)}>
      <div className="center">
        {!!p.title && <h3 style={headingStyle(p, 22)}>{String(p.title || t("Scan to continue"))}</h3>}
        {!!p.subtitle && <p style={bodyStyle(p)}>{String(p.subtitle)}</p>}
        {selected ? (
          <div className={`qr-render-output tqr-qr ${String(p.size || "md")}`} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="lp-empty-state">
            <Icon name="qr-code" size={20} />
            <span>{qrChoices.length ? t("Select a QR code in the properties panel.") : t("Create a QR code first, then select it here.")}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── renderBlock dispatcher ── */
function renderBlock(b: Block, qrChoices: MerchantQrChoice[]) {
  const p = b.props;
  const l = b.layout;
  switch (b.type) {
    case "hero":     return <HeroPreview p={p} layout={l} />;
    case "timer":    return <TimerPreview p={p} layout={l} />;
    case "products": return <ProductsPreview p={p} layout={l} />;
    case "capture":  return <CapturePreview p={p} layout={l} />;
    case "promo":    return <PromoPreview p={p} layout={l} />;
    case "text":     return <TextPreview p={p} layout={l} />;
    case "button":   return <ButtonPreview p={p} layout={l} />;
    case "image":    return <ImagePreview p={p} layout={l} />;
    case "video":    return <VideoPreview p={p} layout={l} />;
    case "reviews":  return <ReviewsPreview p={p} layout={l} />;
    case "faq":      return <FaqPreview p={p} layout={l} />;
    case "urgency":  return <UrgencyPreview p={p} layout={l} />;
    case "qr":       return <QrPreview p={p} layout={l} qrChoices={qrChoices} />;
    default:         return <div style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)" }}>{t("Unknown block")}</div>;
  }
}

function socialLinks(settings: CampaignPageSettings) {
  return [
    { key: "instagram", label: "Instagram", path: siInstagram.path, color: `#${siInstagram.hex}`, href: settings.instagramUrl },
    { key: "tiktok", label: "TikTok", path: siTiktok.path, color: `#${siTiktok.hex}`, href: settings.tiktokUrl },
    { key: "facebook", label: "Facebook", path: siFacebook.path, color: `#${siFacebook.hex}`, href: settings.facebookUrl },
    { key: "x", label: "X", path: siX.path, color: `#${siX.hex}`, href: settings.xUrl },
    { key: "website", label: "Website", path: "M10.5 13.5a4.5 4.5 0 0 1 0-6.36l2.12-2.12a4.5 4.5 0 1 1 6.36 6.36l-1.06 1.06-1.41-1.41 1.06-1.06a2.5 2.5 0 0 0-3.54-3.54l-2.12 2.12a2.5 2.5 0 0 0 0 3.54l-1.41 1.41Zm3 3a4.5 4.5 0 0 1 0-6.36l1.06-1.06 1.41 1.41-1.06 1.06a2.5 2.5 0 0 0 3.54 3.54l2.12-2.12a2.5 2.5 0 0 0 0-3.54l1.41-1.41a4.5 4.5 0 0 1 0 6.36l-2.12 2.12a4.5 4.5 0 0 1-6.36 0Z", color: settings.socialIconColor || "currentColor", href: settings.websiteUrl },
  ].filter(item => item.href.trim());
}

function SocialIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function footerStyle(settings: CampaignPageSettings): React.CSSProperties {
  return {
    "--tqr-footer-bg": settings.footerBgColor || "transparent",
    "--tqr-footer-text": settings.footerTextColor || "var(--tqr-page-text, #E2E8F0)",
    "--tqr-footer-credit": settings.footerCreditColor || "color-mix(in srgb, var(--tqr-page-text, #E2E8F0) 54%, transparent)",
    "--tqr-footer-border": settings.footerBorderColor || "color-mix(in srgb, var(--tqr-page-text, #E2E8F0) 12%, transparent)",
    "--tqr-footer-icon": settings.socialIconColor || "var(--tqr-page-text, #E2E8F0)",
    "--tqr-powered-text": settings.poweredTextColor || "color-mix(in srgb, var(--tqr-page-text, #E2E8F0) 62%, transparent)",
    "--tqr-powered-mark-bg": settings.poweredMarkBgColor || "var(--tqr-accent, #2563EB)",
  } as React.CSSProperties;
}

function CampaignBrandBar({ settings, fallbackName }: { settings: CampaignPageSettings; fallbackName: string }) {
  if (!settings.logoImageUrl && !settings.logoText) return null;
  return (
    <div className="tqr-brand-bar" data-align={settings.logoPosition}>
      <div className="tqr-brand-lockup">
        {settings.logoImageUrl ? <img src={settings.logoImageUrl} alt="" /> : null}
        <span>{settings.logoText || fallbackName}</span>
      </div>
    </div>
  );
}

function TrackQrWatermark() {
  return (
    <div className="tqr-powered">
      <img className="tqr-powered-logo" src="/TrackQr.png" alt="" />
      <span>{t("Powered by")} <b>TrackQR</b></span>
    </div>
  );
}

function CampaignFooterPreview({ settings }: { settings: CampaignPageSettings }) {
  const links = socialLinks(settings);
  const hasMerchantFooter = settings.footerEnabled && (settings.footerText || settings.creditText || links.length);
  if (!hasMerchantFooter && !settings.showPoweredBy) return null;
  return (
    <footer className="tqr-campaign-footer" style={footerStyle(settings)}>
      {hasMerchantFooter && (
        <div className="tqr-footer-inner">
          <div className="tqr-footer-copy">
            {settings.footerText ? <p>{settings.footerText}</p> : null}
            {settings.creditText ? <span className="tqr-credit">{settings.creditText}</span> : null}
          </div>
          {links.length ? (
            <div className="tqr-socials">
              {links.map(link => (
                <span
                  key={link.key}
                  className="tqr-social-link"
                  title={t(link.label)}
                  style={{ color: settings.socialIconColorMode === "brand" ? link.color : undefined }}
                >
                  <SocialIcon path={link.path} />
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {settings.showPoweredBy && <TrackQrWatermark />}
    </footer>
  );
}

/* ══════════════ Repeater ══════════════ */
function Repeater<T extends Record<string, unknown>>({ items, onChange, addLabel, render, defaultItem }: {
  items: T[];
  onChange: (items: T[]) => void;
  addLabel: string;
  render: (item: T, set: (k: string, v: unknown) => void) => React.ReactNode;
  defaultItem: T;
}) {
  const set = (i: number, key: string, value: unknown) => {
    const next = items.map((it, idx) => idx === i ? { ...it, [key]: value } : it);
    onChange(next);
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, { ...defaultItem }]);
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="prop-repeater-item">
          <div className="prop-repeater-head">
            <span className="prop-repeater-num">{t("Item {n}", { n: i + 1 })}</span>
            <button className="prop-repeater-remove" onClick={() => remove(i)} disabled={items.length <= 1} title={t("Remove")}>
              <Icon name="trash" size={11} />
            </button>
          </div>
          {render(it, (k, v) => set(i, k, v))}
        </div>
      ))}
      <button className="prop-repeater-add" onClick={add}>
        <Icon name="plus" size={12} /> {addLabel}
      </button>
    </div>
  );
}

/* ══════════════ EditorToggle ══════════════ */
function EditorToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} style={{ width: 32, height: 18, background: on ? "var(--accent)" : "var(--border-strong)", borderRadius: 9, position: "relative", transition: "all .14s var(--ease)", cursor: "default", flexShrink: 0, border: 0, padding: 0 }}>
      <div style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 14, height: 14, background: "#fff", borderRadius: "50%", transition: "all .14s var(--ease)", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
    </button>
  );
}

/* ══════════════ Block field editors ══════════════ */

function HeroFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label={t("Eyebrow")}><Input value={String(p.eyebrow || "")} onChange={e => set("eyebrow", e.target.value)} placeholder={t("Limited time")} /></Field>
    <Field label={t("Title")} required><Input value={String(p.title)} onChange={e => set("title", e.target.value)} /></Field>
    <Field label={t("Subtitle")}><Textarea value={String(p.subtitle || "")} onChange={e => set("subtitle", e.target.value)} rows={2} /></Field>
    <Field label={t("Call to action")}><Input value={String(p.cta)} onChange={e => set("cta", e.target.value)} /></Field>
    <Field label={t("CTA URL")} hint={t("Where the hero button sends visitors.")}><Input value={String(p.ctaHref || "")} onChange={e => set("ctaHref", e.target.value)} placeholder="https://" icon="link" /></Field>
    <Field label={t("CTA style")}>
      <Select value={String(p.ctaVariant || "primary")} onChange={e => set("ctaVariant", e.target.value)}>
        <option value="primary">{t("Primary")}</option>
        <option value="secondary">{t("Secondary")}</option>
        <option value="outline">{t("Outline")}</option>
        <option value="ghost">{t("Ghost")}</option>
      </Select>
    </Field>
  </>);
}
function TimerFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label={t("Label (optional)")}><Input value={String(p.label || "")} onChange={e => set("label", e.target.value)} placeholder={t("Drop ends in")} /></Field>
    <Field label={t("End date and time")} hint={t("The countdown calculates DD · HH · MM · SS automatically.")}>
      <Input type="datetime-local" value={dateTimeLocalValue(p.endsAt || p.endsIn)} onChange={e => set("endsAt", fromDateTimeLocal(e.target.value))} />
    </Field>
  </>);
}
function ProductsFields({ p, set, actions }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void; actions: BlockEditorActions }) {
  const products = pickedResources(p.products);
  const collection = pickedResource(p.collection);
  const mode = String(p.mode || "products");
  return (<>
    <Field label={t("Section title")}><Input value={String(p.title)} onChange={e => set("title", e.target.value)} /></Field>
    <Field label={t("Source")} hint={t("Choose real Shopify resources from this merchant store.")}>
      <Segmented value={mode} onChange={v => set("mode", v)} options={[{ value: "products", label: t("Products") }, { value: "collection", label: t("Collection") }]} />
    </Field>
    <Field label={t("Number of products · {count}", { count: Math.max(1, Math.min(10, numeric(p.count, 3))) })} hint={t("Preview can show 1 to 10 products.")}>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        className="range-slider"
        style={{ "--val": `${((Math.max(1, Math.min(10, numeric(p.count, 3))) - 1) / 9) * 100}%` } as React.CSSProperties}
        value={Math.max(1, Math.min(10, numeric(p.count, 3)))}
        onChange={e => set("count", Number(e.target.value))}
      />
    </Field>
    {mode === "products" ? (
      <Field label={t("Products")} hint={t("Visitors see the products you choose here.")}>
        <ResourcePickButton
          icon="package"
          emptyLabel={t("Select products")}
          items={products}
          onPick={() => actions.pickProducts(items => set("products", items))}
          onClear={() => set("products", [])}
        />
      </Field>
    ) : (
      <Field label={t("Collection")} hint={t("The collection controls the shop destination and preview label.")}>
        <ResourcePickButton
          icon="grid"
          emptyLabel={t("Select collection")}
          items={collection ? [collection] : []}
          onPick={() => actions.pickCollection(item => set("collection", item))}
          onClear={() => set("collection", null)}
        />
      </Field>
    )}
    <Field label={t("Button label")}><Input value={String(p.cta || "")} onChange={e => set("cta", e.target.value)} placeholder={mode === "collection" ? t("Shop collection") : t("Shop selected")} /></Field>
  </>);
}
/** Plan features the editor needs deep in the block field components. */
const EditorPlanContext = React.createContext({ leadRewards: false, campaignPixels: false, customerSync: false });

function CaptureFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  const plan = React.useContext(EditorPlanContext);
  const consentEnabled = p.consentEnabled !== false;
  const rewardPercent = Number(p.rewardPercent) || 10;
  return (<>
    <Field label={t("Title")}><Input value={String(p.title)} onChange={e => set("title", e.target.value)} /></Field>
    <Field label={t("Subtitle")}><Input value={String(p.subtitle || "")} onChange={e => set("subtitle", e.target.value)} /></Field>
    <Field label={t("Placeholder")}><Input value={String(p.placeholder || "")} onChange={e => set("placeholder", e.target.value)} placeholder="you@email.com" /></Field>
    <Field label={t("Button label")}><Input value={String(p.cta || "")} onChange={e => set("cta", e.target.value)} placeholder={t("Notify me")} /></Field>
    <Field label={t("Success message")}><Input value={String(p.successMessage || "")} onChange={e => set("successMessage", e.target.value)} placeholder={t("Thanks, you're on the list.")} /></Field>
    <Field label={t("Notification email")} hint={t("Receives each sign-up by email. Leave empty to use the default of Settings. Never shown on the page.")}>
      <Input type="email" icon="mail" value={String(p.merchantEmail || p.notifyEmail || "")} onChange={e => set("merchantEmail", e.target.value)} placeholder="merchant@example.com" />
    </Field>
    <Field label={t("Email subject")}>
      <Input value={String(p.mailSubject || "")} onChange={e => set("mailSubject", e.target.value)} placeholder={t("New campaign lead")} />
    </Field>

    <div className="prop-subhead">{t("Privacy & consent")}</div>
    <div className="prop-row prop-row-h">
      <span className="prop-label">{t("Marketing consent checkbox")}</span>
      <EditorToggle on={consentEnabled} onChange={v => set("consentEnabled", v)} />
    </div>
    {consentEnabled && (<>
      <div className="prop-row prop-row-h">
        <span className="prop-label">{t("Required to sign up")}</span>
        <EditorToggle on={p.consentRequired === true} onChange={v => set("consentRequired", v)} />
      </div>
      <Field label={t("Consent text")} hint={t("Never pre-ticked. Visitors who tick it are saved with marketing consent.")}>
        <Textarea value={String(p.consentText || "")} onChange={e => set("consentText", e.target.value)} rows={2} placeholder={t("I agree to receive emails from the store. I can unsubscribe at any time.")} />
      </Field>
    </>)}
    <Field label={t("Privacy policy URL")} hint={t("Linked next to the form — required in the EU (GDPR).")}>
      <Input icon="link" value={String(p.privacyUrl || "")} onChange={e => set("privacyUrl", e.target.value)} placeholder="https://your-store.com/policies/privacy-policy" />
    </Field>

    <div className="prop-subhead">{t("Reward")}</div>
    {plan.leadRewards ? (<>
      <div className="prop-row prop-row-h">
        <span className="prop-label">{t("Unique discount code for each sign-up")}</span>
        <EditorToggle on={p.rewardEnabled === true} onChange={v => set("rewardEnabled", v)} />
      </div>
      {p.rewardEnabled === true && (<>
        <Field label={t("Discount · {rewardPercent}% off", { rewardPercent })} hint={t("Single-use code created in Shopify Discounts and shown right after sign-up.")}>
          <RangeSlider min={5} max={50} step={5} value={rewardPercent} onChange={v => set("rewardPercent", v)} aria-label={t("Reward discount")} />
        </Field>
        <Field label={t("Code prefix")}><Input value={String(p.rewardPrefix || "")} onChange={e => set("rewardPrefix", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} placeholder="WELCOME" /></Field>
      </>)}
    </>) : (
      <FeatureLock compact title={t("Unique discount codes")} desc={t("Reward every sign-up with a single-use code — no sharing, no leaks.")} plan="Growth" />
    )}
  </>);
}
function PromoFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label={t("Eyebrow")}><Input value={String(p.eyebrow || "")} onChange={e => set("eyebrow", e.target.value)} placeholder={t("Use code")} /></Field>
    <Field label={t("Discount code")}><Input value={String(p.code)} onChange={e => set("code", e.target.value)} style={{ fontFamily: "var(--ff-mono)", letterSpacing: "0.04em" }} /></Field>
    <Field label={t("Description")}><Input value={String(p.title)} onChange={e => set("title", e.target.value)} /></Field>
    <Field label={t("Auto-apply at checkout")}>
      <Select value={p.autoApply ? "on" : "off"} onChange={e => set("autoApply", e.target.value === "on")}>
        <option value="on">{t("Yes — apply automatically")}</option>
        <option value="off">{t("No — visitor must enter manually")}</option>
      </Select>
    </Field>
    <Field label={t("Button label")}><Input value={String(p.cta || "")} onChange={e => set("cta", e.target.value)} placeholder={t("Apply discount")} /></Field>
    <Field label={t("Override URL")} hint={t("Optional. Leave empty to use the shop discount URL when auto-apply is on.")}><Input value={String(p.href || "")} onChange={e => set("href", e.target.value)} placeholder="https://" icon="link" /></Field>
  </>);
}
function TextFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label={t("Heading")}><Input value={String(p.heading || "")} onChange={e => set("heading", e.target.value)} /></Field>
    <Field label={t("Body")} hint={t("Plain text — line breaks preserved.")}><Textarea value={String(p.body || "")} onChange={e => set("body", e.target.value)} rows={4} /></Field>
  </>);
}
function ButtonFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label={t("Label")}><Input value={String(p.label)} onChange={e => set("label", e.target.value)} /></Field>
    <Field label="URL"><Input value={String(p.href || "")} onChange={e => set("href", e.target.value)} placeholder="https://" icon="link" /></Field>
    <Field label={t("Style")}>
      <Select value={String(p.variant || "primary")} onChange={e => set("variant", e.target.value)}>
        <option value="primary">{t("Primary (filled)")}</option>
        <option value="secondary">{t("Secondary (outline)")}</option>
        <option value="outline">{t("Outline (light)")}</option>
        <option value="ghost">{t("Ghost (text only)")}</option>
      </Select>
    </Field>
    <div className="prop-row prop-row-h">
      <span className="prop-label">{t("Show arrow icon")}</span>
      <EditorToggle on={!!p.icon} onChange={v => set("icon", v)} />
    </div>
  </>);
}
function ImageFields({ p, set, setMany, actions }: { p: Record<string, unknown>; set: BlockPropSetter; setMany: BlockPropsSetter; actions: BlockEditorActions }) {
  return (<>
    <Field label={t("Image")} hint={t("Uploads to Cloudinary and uses the hosted asset in the campaign.")}>
      <ImageUploadControl
        value={String(p.src || "")}
        onUploaded={asset => {
          setMany({ src: asset.url, assetId: asset.assetId });
        }}
        onClear={() => {
          setMany({ src: "", assetId: "" });
        }}
        actions={actions}
      />
    </Field>
    <Field label={t("Aspect ratio")}>
      <Segmented value={String(p.aspect || "16:9")} onChange={v => set("aspect", v)} options={[{ value: "16:9", label: "16:9" }, { value: "1:1", label: "1:1" }, { value: "4:5", label: "4:5" }, { value: "3:1", label: t("Wide") }]} />
    </Field>
    <Field label={t("Image fit")}>
      <Select value={String(p.fit || "cover")} onChange={e => set("fit", e.target.value)}>
        <option value="cover">{t("Cover frame")}</option>
        <option value="contain">{t("Contain full image")}</option>
      </Select>
    </Field>
    <Field label={t("Caption (optional)")}><Input value={String(p.caption || "")} onChange={e => set("caption", e.target.value)} /></Field>
    <Field label={t("Alt text")} hint={t("Important for accessibility & SEO.")}><Input value={String(p.alt || "")} onChange={e => set("alt", e.target.value)} /></Field>
  </>);
}
function VideoFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label={t("Title (optional)")}><Input value={String(p.title || "")} onChange={e => set("title", e.target.value)} placeholder={t("Watch the drop")} /></Field>
    <Field label={t("Video URL")} hint={t("YouTube, Vimeo, or direct mp4.")}><Input value={String(p.src || "")} onChange={e => set("src", e.target.value)} placeholder="https://youtube.com/..." icon="link" /></Field>
    <div className="prop-row prop-row-h"><span className="prop-label">{t("Autoplay (muted)")}</span><EditorToggle on={!!p.autoplay} onChange={v => set("autoplay", v)} /></div>
    <div className="prop-row prop-row-h"><span className="prop-label">{t("Show controls")}</span><EditorToggle on={p.controls !== false} onChange={v => set("controls", v)} /></div>
  </>);
}
function ReviewsFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  type ReviewItem = { name: string; rating: number; text: string; verified: boolean };
  const items = (p.items as ReviewItem[]) || [];
  return (<>
    <Field label={t("Section title")}><Input value={String(p.title || "")} onChange={e => set("title", e.target.value)} /></Field>
    <div className="text-xs muted" style={{ lineHeight: 1.45 }}>
      {t("Publish genuine customer reviews only, and mark a review as verified only when it comes from a real buyer — fake reviews are illegal in the US (FTC) and the EU.")}
    </div>
    <Field label={t("Reviews")}>
      <Repeater items={items} onChange={v => set("items", v)} addLabel={t("Add review")}
        defaultItem={{ name: "", rating: 5, text: "", verified: false }}
        render={(it, setKey) => (<>
          <div className="prop-row"><span className="prop-label">{t("Name")}</span><Input value={it.name} onChange={e => setKey("name", e.target.value)} /></div>
          <div className="prop-row"><span className="prop-label">{t("Rating")}</span>
            <Select value={String(it.rating)} onChange={e => setKey("rating", +e.target.value)}>
              <option value="5">★★★★★</option><option value="4">★★★★☆</option>
              <option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option>
            </Select>
          </div>
          <div className="prop-row"><span className="prop-label">{t("Quote")}</span><Textarea value={it.text} onChange={e => setKey("text", e.target.value)} rows={2} /></div>
          <div className="prop-row prop-row-h"><span className="prop-label">{t("Verified buyer")}</span><EditorToggle on={!!it.verified} onChange={v => setKey("verified", v)} /></div>
        </>)}
      />
    </Field>
  </>);
}
function FaqFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  type FaqItem = { q: string; a: string };
  const items = (p.items as FaqItem[]) || [];
  return (<>
    <Field label={t("Section title")}><Input value={String(p.title || "")} onChange={e => set("title", e.target.value)} /></Field>
    <div className="prop-row prop-row-h"><span className="prop-label">{t("Expand all by default")}</span><EditorToggle on={!!p.expanded} onChange={v => set("expanded", v)} /></div>
    <Field label={t("Questions")}>
      <Repeater items={items} onChange={v => set("items", v)} addLabel={t("Add question")}
        defaultItem={{ q: t("New question?"), a: t("Helpful answer here.") }}
        render={(it, setKey) => (<>
          <div className="prop-row"><span className="prop-label">{t("Question")}</span><Input value={it.q} onChange={e => setKey("q", e.target.value)} /></div>
          <div className="prop-row"><span className="prop-label">{t("Answer")}</span><Textarea value={it.a} onChange={e => setKey("a", e.target.value)} rows={2} /></div>
        </>)}
      />
    </Field>
  </>);
}
function UrgencyFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label={t("Prefix")}><Input value={String(p.label || "")} onChange={e => set("label", e.target.value)} placeholder={t("Hurry")} /></Field>
    <Field label={t("Message")}><Input value={String(p.message || "")} onChange={e => set("message", e.target.value)} /></Field>
    <Field label={t("Tone")}>
      <Select value={String(p.tone || "danger")} onChange={e => set("tone", e.target.value)}>
        <option value="danger">{t("Red · Danger")}</option><option value="warning">{t("Amber · Warning")}</option>
        <option value="info">{t("Blue · Info")}</option><option value="dark">{t("Dark · Neutral")}</option>
      </Select>
    </Field>
    <Field label={t("Icon")}>
      <Select value={String(p.icon || "alert-triangle")} onChange={e => set("icon", e.target.value)}>
        <option value="alert-triangle">{t("Warning triangle")}</option><option value="clock">{t("Clock")}</option>
        <option value="zap">{t("Lightning")}</option><option value="bell">{t("Bell")}</option><option value="info">{t("Info")}</option>
      </Select>
    </Field>
  </>);
}
function QrFields({ p, set, qrChoices }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void; qrChoices: MerchantQrChoice[] }) {
  const selected = qrChoices.find(q => q.id === p.qrId);
  return (<>
    <Field label={t("Title")}><Input value={String(p.title || "")} onChange={e => set("title", e.target.value)} /></Field>
    <Field label={t("Subtitle")}><Input value={String(p.subtitle || "")} onChange={e => set("subtitle", e.target.value)} /></Field>
    <Field label={t("QR code")} hint={t("Select one of the merchant QR codes. The campaign's primary QR is excluded.")}>
      {qrChoices.length ? (
        <>
          <Select value={String(p.qrId || "")} onChange={e => set("qrId", e.target.value)}>
            <option value="">{t("Select a QR code")}</option>
            {qrChoices.map(q => <option key={q.id} value={q.id}>{q.name} · {q.type}</option>)}
          </Select>
          {selected && <div className="field-hint">{t("Scans through {path}", { path: `/s/${selected.slug}` })}</div>}
        </>
      ) : (
        <div className="lp-empty-state">
          <Icon name="qr-code" size={18} />
          <span>{t("No available QR code. Create a QR code first, or unlink the campaign QR if you want to reuse it elsewhere.")}</span>
        </div>
      )}
    </Field>
    <Field label={t("Size")}>
      <Segmented value={String(p.size || "md")} onChange={v => set("size", v)} options={[{ value: "sm", label: t("Small") }, { value: "md", label: t("Medium") }, { value: "lg", label: t("Large") }]} />
    </Field>
  </>);
}

function ColorPicker({ value, onChange, allowEmpty = true }: { value?: string; onChange: (v: string | undefined) => void; allowEmpty?: boolean }) {
  const current = value || "#0B1220";
  return (
    <div>
      <div className="swatch-row">
        {COLOR_PRESETS.map(c => (
          <button
            key={c}
            type="button"
            className={`swatch ${value === c ? "active" : ""}`}
            style={{ background: c }}
            title={c}
            onClick={() => onChange(c)}
          />
        ))}
        <label className={`swatch swatch-picker ${value && !COLOR_PRESETS.includes(value) ? "active" : ""}`} title={t("Custom color")}>
          <input type="color" value={current} onChange={e => onChange(e.target.value)} />
          <span className="picker-icon"><Icon name="edit" size={11} /></span>
        </label>
        {allowEmpty && (
          <button type="button" className="filter-clear" onClick={() => onChange(undefined)} style={{ marginLeft: 4 }}>
            {t("Default")}
          </button>
        )}
      </div>
      {value && <div className="field-hint" style={{ fontFamily: "var(--ff-mono)" }}>{value.toUpperCase()}</div>}
    </div>
  );
}

function RichTypographyControl({ p, textRole, set }: {
  p: Record<string, unknown>;
  textRole: "heading" | "body" | "eyebrow" | "button";
  set: (k: string, v: unknown) => void;
}) {
  const fontKey = `${textRole}Font`;
  const sizeKey = `${textRole}FontSize`;
  const boldKey = `${textRole}Bold`;
  const italicKey = `${textRole}Italic`;
  const underlineKey = `${textRole}Underline`;
  const alignKey = `${textRole}Align`;
  const fontValue = String(p[fontKey] || DEFAULT_FONT);
  const fontSpec = getLabelFont(fontValue);
  const defaultSize = textRole === "heading" ? 20 : textRole === "eyebrow" ? 12 : 14;
  const sizeValue = Number(p[sizeKey]) || defaultSize;
  const alignValue = (p[alignKey] as "left" | "center" | "right" | undefined) || "center";

  return (
    <div className="rte-bar" role="toolbar" aria-label={t("{textRole} formatting", { textRole: t(textRole) })}>
      <select
        className="rte-select"
        value={fontValue}
        onChange={e => set(fontKey, e.target.value)}
        title={t("Font")}
        style={{
          fontFamily: fontSpec.family,
          fontWeight: fontSpec.weight,
          letterSpacing: fontSpec.letterSpacing,
          textTransform: fontSpec.textTransform,
          minWidth: 150,
        }}
      >
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
        value={sizeValue}
        onChange={e => set(sizeKey, Number(e.target.value))}
        title={t("Size")}
        style={{ minWidth: 64 }}
      >
        {[10, 12, 14, 16, 18, 20, 24, 28, 32].map(s => (
          <option key={s} value={s}>{s}px</option>
        ))}
      </select>

      <div className="rte-sep" />

      <div className="rte-group">
        <button type="button" className={`rte-btn ${p[boldKey] ? "active" : ""}`} aria-pressed={!!p[boldKey]} title={t("Bold")} onClick={() => set(boldKey, !p[boldKey])}>
          <Icon name="bold" size={14} />
        </button>
        <button type="button" className={`rte-btn ${p[italicKey] ? "active" : ""}`} aria-pressed={!!p[italicKey]} title={t("Italic")} onClick={() => set(italicKey, !p[italicKey])}>
          <Icon name="italic" size={14} />
        </button>
        <button type="button" className={`rte-btn ${p[underlineKey] ? "active" : ""}`} aria-pressed={!!p[underlineKey]} title={t("Underline")} onClick={() => set(underlineKey, !p[underlineKey])}>
          <Icon name="underline" size={14} />
        </button>
      </div>

      <div className="rte-sep" />

      <div className="rte-group" role="radiogroup" aria-label={t("Text alignment")}>
        <button type="button"
          className={`rte-btn ${alignValue === "left" ? "active" : ""}`}
          aria-pressed={alignValue === "left"}
          title={t("Align left")}
          onClick={() => set(alignKey, "left")}>
          <Icon name="align-left" size={14} />
        </button>
        <button type="button"
          className={`rte-btn ${alignValue === "center" ? "active" : ""}`}
          aria-pressed={alignValue === "center"}
          title={t("Align center")}
          onClick={() => set(alignKey, "center")}>
          <Icon name="align-center" size={14} />
        </button>
        <button type="button"
          className={`rte-btn ${alignValue === "right" ? "active" : ""}`}
          aria-pressed={alignValue === "right"}
          title={t("Align right")}
          onClick={() => set(alignKey, "right")}>
          <Icon name="align-right" size={14} />
        </button>
      </div>
    </div>
  );
}

function ResourcePickButton({ icon, emptyLabel, items, onPick, onClear }: {
  icon: string;
  emptyLabel: string;
  items: ShopifyPickedResource[];
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="resource-picker">
      <div className="resource-picker-actions">
        <Button variant="secondary" icon="search" onClick={onPick}>{items.length ? t("Change") : emptyLabel}</Button>
        {!!items.length && <Button variant="ghost" icon="x" onClick={onClear}>{t("Clear")}</Button>}
      </div>
      {items.length ? (
        <div className="resource-list">
          {items.map(item => (
            <div key={item.id} className="resource-chip">
              {item.image ? <img src={item.image} alt="" /> : <span className="resource-chip-icon"><Icon name={icon} size={13} /></span>}
              <span>{item.title}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="field-hint">{t("Nothing selected yet.")}</div>
      )}
    </div>
  );
}

function ImageUploadControl({ value, onUploaded, actions, onClear }: {
  value?: string;
  onUploaded: (asset: UploadedImageAsset) => void;
  actions: BlockEditorActions;
  onClear?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      await actions.uploadImage(file, onUploaded);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <div className="image-upload-control">
      {value ? (
        <div className="image-upload-preview">
          <img src={value} alt="" />
        </div>
      ) : (
        <div className="image-upload-empty">
          <Icon name="image" size={18} />
          <span>{t("No image selected")}</span>
        </div>
      )}
      <div className="resource-picker-actions">
        <Button variant="secondary" icon="image" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? t("Uploading…") : value ? t("Replace image") : t("Upload image")}
        </Button>
        {!!value && onClear && <Button variant="ghost" icon="x" disabled={busy} onClick={onClear}>{t("Remove")}</Button>}
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden onChange={e => upload(e.currentTarget.files?.[0])} />
    </div>
  );
}

function BlockStyleFields({ block, set, setMany, actions }: { block: Block; set: BlockPropSetter; setMany: BlockPropsSetter; actions: BlockEditorActions }) {
  const p = block.props;
  const showHeading = ["hero", "products", "capture", "text", "faq", "reviews", "qr"].includes(block.type);
  const showBody = ["hero", "capture", "promo", "text", "qr"].includes(block.type);
  const showButton = ["hero", "products", "capture", "promo", "button"].includes(block.type);
  const showCards = ["products", "reviews"].includes(block.type);
  return (
    <>
      {showHeading && <Field label={block.type === "hero" ? t("Title typography") : t("Heading typography")}><RichTypographyControl p={p} textRole="heading" set={set} /></Field>}
      {showBody && <Field label={block.type === "hero" ? t("Subtitle typography") : t("Body typography")}><RichTypographyControl p={p} textRole="body" set={set} /></Field>}
      {["hero", "promo", "timer"].includes(block.type) && <Field label={t("Eyebrow / label typography")}><RichTypographyControl p={p} textRole="eyebrow" set={set} /></Field>}
      {showButton && <Field label={t("Button typography")}><RichTypographyControl p={p} textRole="button" set={set} /></Field>}
      {showHeading && <Field label={block.type === "hero" ? t("Title color") : t("Heading color")}><ColorPicker value={p.headingColor as string | undefined} onChange={v => set("headingColor", v)} /></Field>}
      {showBody && <Field label={block.type === "hero" ? t("Subtitle color") : t("Body text color")}><ColorPicker value={p.bodyColor as string | undefined} onChange={v => set("bodyColor", v)} /></Field>}
      {["hero", "promo", "timer"].includes(block.type) && <Field label={t("Eyebrow / label color")}><ColorPicker value={p.eyebrowColor as string | undefined} onChange={v => set("eyebrowColor", v)} /></Field>}
      {showButton && (
        <>
          <Field label={t("Button background")}><ColorPicker value={p.buttonBgColor as string | undefined} onChange={v => set("buttonBgColor", v)} /></Field>
          <Field label={t("Button text")}><ColorPicker value={p.buttonTextColor as string | undefined} onChange={v => set("buttonTextColor", v)} /></Field>
          <Field label={t("Button border")}><ColorPicker value={p.buttonBorderColor as string | undefined} onChange={v => set("buttonBorderColor", v)} /></Field>
        </>
      )}
      {showCards && (
        <>
          <Field label={block.type === "products" ? t("Product card background") : t("Review card background")}><ColorPicker value={p.cardBgColor as string | undefined} onChange={v => set("cardBgColor", v)} /></Field>
          <Field label={block.type === "products" ? t("Product title color") : t("Review text color")}><ColorPicker value={p.cardTextColor as string | undefined} onChange={v => set("cardTextColor", v)} /></Field>
          <Field label={t("Card border")}><ColorPicker value={p.cardBorderColor as string | undefined} onChange={v => set("cardBorderColor", v)} /></Field>
        </>
      )}
      {block.type === "products" && <Field label={t("Product price color")}><ColorPicker value={p.priceColor as string | undefined} onChange={v => set("priceColor", v)} /></Field>}
      {block.type === "capture" && (
        <>
          <Field label={t("Capture panel background")}><ColorPicker value={p.capturePanelBgColor as string | undefined} onChange={v => set("capturePanelBgColor", v)} /></Field>
          <Field label={t("Input background")}><ColorPicker value={p.inputBgColor as string | undefined} onChange={v => set("inputBgColor", v)} /></Field>
          <Field label={t("Input text")}><ColorPicker value={p.inputTextColor as string | undefined} onChange={v => set("inputTextColor", v)} /></Field>
          <Field label={t("Placeholder")}><ColorPicker value={p.placeholderColor as string | undefined} onChange={v => set("placeholderColor", v)} /></Field>
          <Field label={t("Input border")}><ColorPicker value={p.inputBorderColor as string | undefined} onChange={v => set("inputBorderColor", v)} /></Field>
        </>
      )}
      {["timer", "promo", "reviews"].includes(block.type) && (
        <Field label={block.type === "timer" ? t("Number color") : block.type === "reviews" ? t("Stars color") : t("Code color")}>
          <ColorPicker value={p.accentColor as string | undefined} onChange={v => set("accentColor", v)} />
        </Field>
      )}
      <Field label={t("Section background color")}><ColorPicker value={p.bgColor as string | undefined} onChange={v => set("bgColor", v)} /></Field>
      <Field label={t("Background image")} hint={t("Optional Cloudinary-hosted background for this block.")}>
        <ImageUploadControl
          value={String(p.bgImageUrl || "")}
          onUploaded={asset => {
            setMany({ bgImageUrl: asset.url, bgImageAssetId: asset.assetId });
          }}
          onClear={() => {
            setMany({ bgImageUrl: "", bgImageAssetId: "" });
          }}
          actions={actions}
        />
      </Field>
      {p.bgImageUrl && (
        <div className="grid grid-2">
          <Field label={t("Image fit")}>
            <Select value={String(p.bgImageFit || "cover")} onChange={e => set("bgImageFit", e.target.value)}>
              <option value="cover">{t("Cover")}</option>
              <option value="contain">{t("Contain")}</option>
            </Select>
          </Field>
          <Field label={t("Overlay")}>
            <Select value={String(p.bgOverlay ?? 0.25)} onChange={e => set("bgOverlay", Number(e.target.value))}>
              <option value="0">{t("None")}</option>
              <option value="0.15">{t("Light")}</option>
              <option value="0.35">{t("Medium")}</option>
              <option value="0.55">{t("Strong")}</option>
            </Select>
          </Field>
        </div>
      )}
    </>
  );
}

function BlockFields({ block, set, setMany, actions, qrChoices }: { block: Block; set: BlockPropSetter; setMany: BlockPropsSetter; actions: BlockEditorActions; qrChoices: MerchantQrChoice[] }) {
  const p = block.props;
  switch (block.type) {
    case "hero":     return <HeroFields p={p} set={set} />;
    case "timer":    return <TimerFields p={p} set={set} />;
    case "products": return <ProductsFields p={p} set={set} actions={actions} />;
    case "capture":  return <CaptureFields p={p} set={set} />;
    case "promo":    return <PromoFields p={p} set={set} />;
    case "text":     return <TextFields p={p} set={set} />;
    case "button":   return <ButtonFields p={p} set={set} />;
    case "image":    return <ImageFields p={p} set={set} setMany={setMany} actions={actions} />;
    case "video":    return <VideoFields p={p} set={set} />;
    case "reviews":  return <ReviewsFields p={p} set={set} />;
    case "faq":      return <FaqFields p={p} set={set} />;
    case "urgency":  return <UrgencyFields p={p} set={set} />;
    case "qr":       return <QrFields p={p} set={set} qrChoices={qrChoices} />;
    default:         return null;
  }
}

function PageSettingsPanel({ settings, update, actions, isFreePlan, canPixels }: {
  settings: CampaignPageSettings;
  update: <K extends keyof CampaignPageSettings>(key: K, value: CampaignPageSettings[K]) => void;
  actions: BlockEditorActions;
  isFreePlan: boolean;
  canPixels: boolean;
}) {
  return (
    <>
      <div className="prop-section">
        <div className="flex items-center gap-3">
          <div className="block-item-icon" style={{
            background: "var(--accent-soft)",
            color: "var(--accent)",
            borderColor: "var(--accent-border)",
            width: 32,
            height: 32,
          }}>
            <Icon name="settings" size={15} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="strong text-sm">{t("Page settings")}</div>
            <div className="text-xs muted">{t("Global layout, brand and footer for this campaign.")}</div>
          </div>
        </div>
      </div>

      <div className="prop-section">
        <div className="prop-section-label">{t("Layout")}</div>
        <Field label={t("Desktop width")}>
          <Segmented
            value={settings.layout}
            onChange={v => update("layout", v as CampaignPageSettings["layout"])}
            options={[
              { value: "contained", label: t("Contained") },
              { value: "wide", label: t("Wide") },
              { value: "full", label: t("Full") },
            ]}
          />
        </Field>
        <Field label={t("Theme")}>
          <Segmented
            value={settings.theme}
            onChange={v => update("theme", v as CampaignPageSettings["theme"])}
            options={[
              { value: "dark", label: t("Dark") },
              { value: "light", label: t("Light") },
            ]}
          />
        </Field>
      </div>

      <div className="prop-section">
        <div className="prop-section-label">{t("Colors")}</div>
        <Field label={t("Accent color")}>
          <ColorPicker value={settings.accentColor} onChange={v => update("accentColor", v || DEFAULT_CAMPAIGN_PAGE_SETTINGS.accentColor)} allowEmpty={false} />
        </Field>
        <Field label={t("Page background")}>
          <ColorPicker value={settings.pageBgColor || undefined} onChange={v => update("pageBgColor", v || "")} />
        </Field>
        <Field label={t("Default text color")}>
          <ColorPicker value={settings.textColor || undefined} onChange={v => update("textColor", v || "")} />
        </Field>
      </div>

      <div className="prop-section">
        <div className="prop-section-label">{t("Campaign logo")}</div>
        <Field label={t("Logo image")}>
          <ImageUploadControl
            value={settings.logoImageUrl}
            onUploaded={asset => update("logoImageUrl", asset.url)}
            onClear={() => update("logoImageUrl", "")}
            actions={actions}
          />
        </Field>
        <Field label={t("Logo text")} hint={t("Used beside the image, or alone when no image is uploaded.")}>
          <Input value={settings.logoText} onChange={e => update("logoText", e.target.value)} placeholder={t("Aurora Studio")} />
        </Field>
        <Field label={t("Logo position")}>
          <Segmented
            value={settings.logoPosition}
            onChange={v => update("logoPosition", v as CampaignPageSettings["logoPosition"])}
            options={[
              { value: "left", label: t("Left") },
              { value: "center", label: t("Center") },
              { value: "right", label: t("Right") },
            ]}
          />
        </Field>
      </div>

      <div className="prop-section">
        <div className="prop-section-label">{t("Tracking pixels")}</div>
        {canPixels ? (<>
          <Field label={t("Google Analytics 4")} hint={t("Measurement ID — page views and a generate_lead event on each sign-up.")}>
            <Input value={settings.ga4MeasurementId} onChange={e => update("ga4MeasurementId", e.target.value.trim().toUpperCase())} placeholder="G-XXXXXXXXXX" />
          </Field>
          <Field label={t("Meta Pixel")} hint={t("Pixel ID — PageView and a Lead event on each sign-up, ready for retargeting.")}>
            <Input value={settings.metaPixelId} onChange={e => update("metaPixelId", e.target.value.replace(/\D/g, ""))} placeholder="123456789012345" />
          </Field>
          <div className="text-xs muted" style={{ lineHeight: 1.45 }}>
            {t("Pixels load on the published page only (not in previews). You are responsible for visitor consent where the law requires it.")}
          </div>
        </>) : (
          <FeatureLock compact title={t("GA4 & Meta Pixel")} desc={t("Measure campaign traffic and build retargeting audiences from every scan.")} plan="Growth" />
        )}
      </div>

      <div className="prop-section" style={{ borderBottom: 0 }}>
        <div className="prop-section-label">{t("Footer")}</div>
        <div className="prop-row prop-row-h">
          <span className="prop-label">{t("Show campaign footer")}</span>
          <EditorToggle on={settings.footerEnabled} onChange={v => update("footerEnabled", v)} />
        </div>
        <Field label={t("Footer text")}>
          <Input value={settings.footerText} onChange={e => update("footerText", e.target.value)} placeholder={t("Join the drop before it closes.")} />
        </Field>
        <Field label={t("Merchant credit")}>
          <Input value={settings.creditText} onChange={e => update("creditText", e.target.value)} placeholder={t("© 2026 Aurora Studio")} />
        </Field>
        <div className="grid grid-2">
          <Field label={t("Footer background")}>
            <ColorPicker value={settings.footerBgColor || undefined} onChange={v => update("footerBgColor", v || "")} />
          </Field>
          <Field label={t("Footer border")}>
            <ColorPicker value={settings.footerBorderColor || undefined} onChange={v => update("footerBorderColor", v || "")} />
          </Field>
          <Field label={t("Footer text color")}>
            <ColorPicker value={settings.footerTextColor || undefined} onChange={v => update("footerTextColor", v || "")} />
          </Field>
          <Field label={t("Credit color")}>
            <ColorPicker value={settings.footerCreditColor || undefined} onChange={v => update("footerCreditColor", v || "")} />
          </Field>
        </div>
        <Field label={t("Social icon colors")}>
          <Segmented
            value={settings.socialIconColorMode}
            onChange={v => update("socialIconColorMode", v as CampaignPageSettings["socialIconColorMode"])}
            options={[
              { value: "custom", label: t("Custom") },
              { value: "brand", label: t("Original") },
            ]}
          />
        </Field>
        {settings.socialIconColorMode === "custom" && (
          <Field label={t("Social icon color")}>
            <ColorPicker value={settings.socialIconColor || undefined} onChange={v => update("socialIconColor", v || "")} />
          </Field>
        )}
        <div className="grid grid-2">
          <Field label={t("Instagram")}>
            <Input value={settings.instagramUrl} onChange={e => update("instagramUrl", e.target.value)} placeholder="https://instagram.com/..." />
          </Field>
          <Field label={t("TikTok")}>
            <Input value={settings.tiktokUrl} onChange={e => update("tiktokUrl", e.target.value)} placeholder="https://tiktok.com/..." />
          </Field>
          <Field label={t("Facebook")}>
            <Input value={settings.facebookUrl} onChange={e => update("facebookUrl", e.target.value)} placeholder="https://facebook.com/..." />
          </Field>
          <Field label={t("X / Twitter")}>
            <Input value={settings.xUrl} onChange={e => update("xUrl", e.target.value)} placeholder="https://x.com/..." />
          </Field>
        </div>
        <Field label={t("Website")}>
          <Input value={settings.websiteUrl} onChange={e => update("websiteUrl", e.target.value)} placeholder="https://your-store.com" />
        </Field>
        <Field label={t("Watermark text")}>
          <ColorPicker value={settings.poweredTextColor || undefined} onChange={v => update("poweredTextColor", v || "")} />
        </Field>
        <div className="prop-row prop-row-h">
          <span className="prop-label">{t("Powered by TrackQR watermark")}</span>
          <Badge>{isFreePlan ? t("Visible on the Free plan") : t("Hidden on paid plans")}</Badge>
        </div>
      </div>
    </>
  );
}

/* ══════════════ PropSection ══════════════ */
function PropSection({ label, k, collapsed, setCollapsed, children, defaultOpen = true }: {
  label: string; k: string; collapsed: Record<string, boolean>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const isCollapsed = collapsed[k] ?? !defaultOpen;
  const toggle = () => setCollapsed(c => ({ ...c, [k]: !isCollapsed }));
  return (
    <div className="prop-section" data-collapsed={isCollapsed ? "true" : "false"}>
      <button type="button" className="prop-section-toggle" onClick={toggle} aria-expanded={!isCollapsed}>
        <span className="prop-section-label" style={{ marginBottom: 0 }}>{label}</span>
        <Icon name="chevron-down" size={13} />
      </button>
      <div className="prop-section-body">{children}</div>
    </div>
  );
}

/* ══════════════ BgSwatchPicker ══════════════ */
function BgSwatchPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="swatch-row">
      {BG_OPTS.map(o => (
        <button type="button" key={o.value}
          className={`swatch ${value === o.value ? "active" : ""}`}
          style={{ background: o.swatch, boxShadow: value === o.value ? `0 0 0 2px var(--accent)` : `0 0 0 1px ${o.border}` }}
          title={t(o.label)}
          aria-label={t("Background {label}", { label: t(o.label) })}
          onClick={() => onChange(o.value)} />
      ))}
    </div>
  );
}

/* ══════════════ PropertiesPanel ══════════════ */
function PropertiesPanel({ block, updateProp, updateProps, updateLayout, updateVisibility, onDelete, onDuplicate, collapsed, setCollapsed, actions, qrChoices }: {
  block: Block;
  updateProp: BlockPropSetter;
  updateProps: BlockPropsSetter;
  updateLayout: (k: string, v: unknown) => void;
  updateVisibility: (k: string, v: unknown) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  collapsed: Record<string, boolean>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  actions: BlockEditorActions;
  qrChoices: MerchantQrChoice[];
}) {
  const meta     = blockMeta(block.type);

  return (<>
    {/* Header */}
    <div className="prop-section">
      <div className="flex items-center gap-3">
        <div className="block-item-icon" style={{
          background: meta?.tone === "blue" ? "var(--accent-soft)" : meta?.tone === "violet" ? "var(--violet-soft)" : meta?.tone === "amber" ? "var(--amber-soft)" : meta?.tone === "danger" ? "var(--red-soft)" : "var(--bg-sunken)",
          color: meta?.tone === "blue" ? "var(--accent)" : meta?.tone === "violet" ? "var(--violet)" : meta?.tone === "amber" ? "var(--amber)" : meta?.tone === "danger" ? "var(--red)" : "var(--fg-muted)",
          borderColor: meta?.tone === "blue" ? "var(--accent-border)" : meta?.tone === "violet" ? "var(--violet-border)" : meta?.tone === "amber" ? "var(--amber-border)" : meta?.tone === "danger" ? "var(--red-border)" : "var(--border)",
          width: 32, height: 32,
        }}>
          <Icon name={meta?.icon || "type"} size={15} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="strong text-sm">{meta ? t(meta.name) : ""}</div>
          <div className="text-xs muted" style={{ fontFamily: "var(--ff-mono)" }}>{t("id · {id}", { id: block.id })}</div>
        </div>
      </div>
    </div>

    {/* Content */}
    <PropSection label={t("Content")} k="content" collapsed={collapsed} setCollapsed={setCollapsed}>
      <BlockFields block={block} set={updateProp} setMany={updateProps} actions={actions} qrChoices={qrChoices} />
    </PropSection>

    {/* Layout */}
    <PropSection label={t("Layout")} k="layout" collapsed={collapsed} setCollapsed={setCollapsed}>
      <Field label={t("Alignment")}>
        <Segmented
          value={block.layout?.align || "left"}
          onChange={v => updateLayout("align", v)}
          options={ALIGN_OPTS.map(o => ({ ...o, label: t(o.label).charAt(0) }))}
        />
      </Field>
      <Field label={t("Spacing")}>
        <Segmented
          value={block.layout?.padding || "md"}
          onChange={v => updateLayout("padding", v)}
          options={PADDING_OPTS.map(o => ({ ...o, label: t(o.label).charAt(0) }))}
        />
      </Field>
      <Field label={t("Background preset")}>
        <BgSwatchPicker value={block.layout?.bg || "surface"} onChange={v => updateLayout("bg", v)} />
      </Field>
    </PropSection>

    {/* Style */}
    <PropSection label={t("Style")} k="style" collapsed={collapsed} setCollapsed={setCollapsed}>
      <BlockStyleFields block={block} set={updateProp} setMany={updateProps} actions={actions} />
    </PropSection>

    {/* Visibility */}
    <PropSection label={t("Visibility")} k="visibility" collapsed={collapsed} setCollapsed={setCollapsed} defaultOpen={false}>
      <div className="prop-row prop-row-h">
        <span className="prop-label"><Icon name="monitor" size={12} style={{ marginRight: 6, color: "var(--fg-subtle)", verticalAlign: "-2px" }} />{t("Show on desktop")}</span>
        <EditorToggle on={block.visibility?.desktop !== false} onChange={v => updateVisibility("desktop", v)} />
      </div>
      <div className="prop-row prop-row-h">
        <span className="prop-label"><Icon name="smartphone" size={12} style={{ marginRight: 6, color: "var(--fg-subtle)", verticalAlign: "-2px" }} />{t("Show on mobile")}</span>
        <EditorToggle on={block.visibility?.mobile !== false} onChange={v => updateVisibility("mobile", v)} />
      </div>
      <div className="field-hint" style={{ marginTop: 8 }}>{t("Hidden blocks render as placeholders in the editor.")}</div>
    </PropSection>

    {/* Actions */}
    <div className="prop-section" style={{ borderBottom: 0 }}>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" icon="copy" onClick={onDuplicate} style={{ flex: 1 }}>{t("Duplicate")}</Button>
        <Button size="sm" variant="ghost" icon="trash" onClick={onDelete}
          style={{ color: "var(--red-fg)", flex: 1, border: "1px solid var(--red-border)", background: "var(--red-soft)" }}>
          {t("Delete")}
        </Button>
      </div>
      <div className="text-xs muted mt-4" style={{ textAlign: "center", fontFamily: "var(--ff-mono)" }}>
        {t("⌘D duplicate · ⌫ delete · ⌘↑↓ move")}
      </div>
    </div>
  </>);
}

/* ══════════════ BlockToolbar ══════════════ */
function BlockToolbar({ block, canUp, canDown, onMoveUp, onMoveDown, onDuplicate, onDelete }: {
  block: Block; canUp: boolean; canDown: boolean;
  onMoveUp: () => void; onMoveDown: () => void;
  onDuplicate: () => void; onDelete: () => void;
}) {
  const meta = blockMeta(block.type);
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <div className="block-toolbar">
      <span className="block-toolbar-label"><Icon name={meta?.icon || "type"} size={10} />{meta ? t(meta.name) : block.type}</span>
      <button className="block-toolbar-btn" disabled={!canUp} onClick={stop(onMoveUp)} title={t("Move up")}><Icon name="arrow-up" size={11} /></button>
      <button className="block-toolbar-btn" disabled={!canDown} onClick={stop(onMoveDown)} title={t("Move down")}><Icon name="arrow-down" size={11} /></button>
      <button className="block-toolbar-btn" onClick={stop(onDuplicate)} title={t("Duplicate")}><Icon name="copy" size={11} /></button>
      <button className="block-toolbar-btn danger" onClick={stop(onDelete)} title={t("Delete")} style={{ marginRight: 4 }}><Icon name="trash" size={11} /></button>
    </div>
  );
}

/* ══════════════ EditorTopBar ══════════════ */
function EditorTopBar({ campaignName, setCampaignName, device, setDevice, onNavigate, onUndo, onRedo, canUndo, canRedo, status, saveState, onSave, onPublish, onPause, previewPath }: {
  campaignName: string; setCampaignName: (v: string) => void;
  device: DeviceType; setDevice: (v: DeviceType) => void;
  onNavigate: () => void;
  onUndo: () => void; onRedo: () => void;
  canUndo: boolean; canRedo: boolean;
  status: CampaignStatus;
  saveState: "idle" | "saving" | "saved" | "error";
  onSave: () => void;
  onPublish: () => void;
  onPause: () => void;
  previewPath: string;
}) {
  const statusTone: Record<CampaignStatus, "success" | "warning" | "neutral" | "danger"> = {
    ACTIVE: "success", PAUSED: "warning", DRAFT: "neutral", ENDED: "danger",
  };
  const statusLabel: Record<CampaignStatus, string> = {
    ACTIVE: "Active", PAUSED: "Paused", DRAFT: "Draft", ENDED: "Ended",
  };

  const indicator =
    saveState === "saving" ? <span className="text-xs muted" style={{ fontFamily: "var(--ff-mono)" }}>{t("Saving…")}</span> :
    saveState === "saved"  ? <span className="text-xs muted" style={{ fontFamily: "var(--ff-mono)", color: "var(--green-fg)" }}>{t("Saved ✓")}</span> :
    saveState === "error"  ? <span className="text-xs muted" style={{ fontFamily: "var(--ff-mono)", color: "var(--red-fg)" }}>{t("Save failed")}</span> :
    null;

  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" icon="chevron-left" onClick={onNavigate}>{t("Campaigns")}</Button>
        <span className="muted">/</span>
        <input
          value={campaignName}
          onChange={e => setCampaignName(e.target.value)}
          style={{ border: "1px solid transparent", background: "transparent", fontFamily: "var(--ff-display)", fontWeight: 600, fontSize: 18, letterSpacing: "-0.018em", color: "var(--fg-strong)", padding: "4px 8px", borderRadius: 6, outline: "none", width: 320 }}
          onFocus={e => { (e.target as HTMLInputElement).style.background = "var(--bg-sunken)"; }}
          onBlur={e => { (e.target as HTMLInputElement).style.background = "transparent"; }}
        />
        <Badge tone={statusTone[status]} dot>{t(statusLabel[status])}</Badge>
        {indicator}
      </div>
      <div className="flex gap-2 items-center">
        <Button size="sm" variant="ghost" disabled={!canUndo} onClick={onUndo} title={t("Undo (⌘Z)")}><Icon name="undo" size={13} /></Button>
        <Button size="sm" variant="ghost" disabled={!canRedo} onClick={onRedo} title={t("Redo (⌘⇧Z)")}><Icon name="redo" size={13} /></Button>
        <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />
        <Segmented value={device} onChange={v => setDevice(v as DeviceType)}
          options={[{ value: "desktop", label: "", icon: "monitor" }, { value: "tablet", label: "", icon: "tablet" }, { value: "mobile", label: "", icon: "smartphone" }]} />
        <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />
        <Button
          size="sm"
          variant="secondary"
          icon="eye"
          onClick={() => window.open(`${window.location.origin}${previewPath}`, "_blank", "noopener,noreferrer")}
        >
          {t("Preview")}
        </Button>
        <Button size="sm" variant="secondary" icon="save" onClick={onSave} disabled={saveState === "saving"}>{t("Save")}</Button>
        {status === "ACTIVE" ? (
          <Button size="sm" variant="secondary" icon="pause" onClick={onPause}>{t("Pause")}</Button>
        ) : (
          <Button size="sm" variant="success" icon="rocket" onClick={onPublish}>{t("Activate")}</Button>
        )}
      </div>
    </div>
  );
}

/* ══════════════ Main page ══════════════ */

export default function CampaignEditor() {
  const navigate = useNavigate();
  const toast    = useToast();
  const requestReview = useReviewRequest();
  const { campaign, qrChoices, isFreePlan, planFeatures, previewPath } = useLoaderData<typeof loader>();
  const canPixels = planFeatures.campaignPixels;
  const fetcher = useFetcher<typeof action>();

  const initialBlocks: Block[] = (campaign.blocks?.length ? campaign.blocks : STARTER_BLOCKS.map(makeBlock)) as Block[];
  const initialPageSettings = normalizeCampaignPageSettings(campaign.settings);

  const [blocks,       setBlocks]       = useState<Block[]>(initialBlocks);
  const [pageSettings, setPageSettings] = useState<CampaignPageSettings>(initialPageSettings);
  const [device,       setDevice]       = useState<DeviceType>("desktop");
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState(campaign.name);
  const [status,       setStatus]       = useState<CampaignStatus>(campaign.status);
  const [search,       setSearch]       = useState("");
  const [dropIdx,      setDropIdx]      = useState<number | null>(null);
  const [dropEndZone,  setDropEndZone]  = useState(false);
  const [collapsed,    setCollapsed]    = useState<Record<string, boolean>>({});
  const [history,      setHistory]      = useState<{ past: Block[][]; future: Block[][] }>({ past: [], future: [] });
  const [saveState,    setSaveState]    = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dragRef = useRef<{ source: "library"; type: BlockType } | { source: "block"; id: string } | null>(null);
  const lastSavedJson = useRef<string>(JSON.stringify(initialBlocks));
  const lastSavedSettingsJson = useRef<string>(JSON.stringify(initialPageSettings));
  const lastSavedName = useRef<string>(campaign.name);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const merchantQrChoices = qrChoices as MerchantQrChoice[];

  // Initial selection
  useEffect(() => {
    if (!selectedId && blocks.length) setSelectedId(blocks[0].id);
  }, []);

  // Debounced autosave (1.2s)
  useEffect(() => {
    const json = JSON.stringify(blocks);
    const settingsJson = JSON.stringify(pageSettings);
    if (json === lastSavedJson.current && settingsJson === lastSavedSettingsJson.current && campaignName === lastSavedName.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("idle");
    saveTimer.current = setTimeout(() => {
      doSave(blocks, campaignName, pageSettings);
    }, 1200);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [blocks, pageSettings, campaignName]);

  function doSave(nextBlocks: Block[], nextName: string, nextSettings: CampaignPageSettings) {
    setSaveState("saving");
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("blocks", JSON.stringify(nextBlocks));
    fd.set("settings", JSON.stringify(nextSettings));
    fd.set("name", nextName);
    fetcher.submit(fd, { method: "post" });
    lastSavedJson.current = JSON.stringify(nextBlocks);
    lastSavedSettingsJson.current = JSON.stringify(nextSettings);
    lastSavedName.current = nextName;
  }

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      setSaveState("saved");
      if ("status" in fetcher.data && fetcher.data.status) {
        setStatus(fetcher.data.status);
        // Only the publish intent answers with ACTIVE: the page just went live.
        if (fetcher.data.status === "ACTIVE") void requestReview("campaign-published");
      }
    } else {
      setSaveState("error");
      toast({
        type: "error",
        title: fetcher.data.error === "quota" ? t("Plan limit reached") : t("Save failed"),
        desc: tm(fetcher.data.message) ?? t("Try again."),
      });
    }
  }, [fetcher.state, fetcher.data]);

  function publish() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const fd = new FormData();
    fd.set("intent", "publish");
    fd.set("blocks", JSON.stringify(blocks));
    fd.set("settings", JSON.stringify(pageSettings));
    fd.set("name", campaignName);
    fetcher.submit(fd, { method: "post" });
    lastSavedJson.current = JSON.stringify(blocks);
    lastSavedSettingsJson.current = JSON.stringify(pageSettings);
    lastSavedName.current = campaignName;
    toast({ title: t("Activating…"), desc: t("Your campaign page is going live.") });
  }

  function pause() {
    const fd = new FormData();
    fd.set("intent", "pause");
    fetcher.submit(fd, { method: "post" });
    toast({ type: "warning", title: t("Paused") });
  }

  function manualSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    doSave(blocks, campaignName, pageSettings);
  }

  function resourceToPicked(item: Record<string, unknown>): ShopifyPickedResource {
    const images = item.images as Array<Record<string, unknown>> | undefined;
    const image = item.image as Record<string, unknown> | undefined;
    const featuredImage = item.featuredImage as Record<string, unknown> | undefined;
    return {
      id: String(item.id || ""),
      title: String(item.title || t("Untitled")),
      handle: typeof item.handle === "string" ? item.handle : undefined,
      onlineStoreUrl: typeof item.onlineStoreUrl === "string" ? item.onlineStoreUrl : undefined,
      image:
        (typeof featuredImage?.url === "string" && featuredImage.url) ||
        (typeof image?.url === "string" && image.url) ||
        (typeof image?.originalSrc === "string" && image.originalSrc) ||
        (typeof images?.[0]?.url === "string" && images[0].url) ||
        (typeof images?.[0]?.originalSrc === "string" && images[0].originalSrc) ||
        "",
    };
  }

  const actions: BlockEditorActions = {
    async uploadImage(file, apply) {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/files/upload", { method: "post", body: fd });
      const json = await res.json() as { ok?: boolean; asset?: UploadedImageAsset; message?: string };
      if (!res.ok || !json.ok || !json.asset?.url) {
        toast({ type: "error", title: t("Upload failed"), desc: tm(json.message) ?? t("Try a smaller PNG, JPG, WebP, GIF or SVG.") });
        return;
      }
      apply(json.asset);
      toast({ title: t("Image uploaded"), desc: t("Stored in Cloudinary.") });
    },
    async pickProducts(apply) {
      try {
        const bridge = (window as unknown as { shopify?: { resourcePicker: (opts: { type: string; multiple: boolean; filter?: { variants?: boolean } }) => Promise<unknown> } }).shopify;
        const result = await bridge?.resourcePicker({ type: "product", multiple: true, filter: { variants: false } });
        const items = (result as Record<string, unknown>[] | undefined)?.map(resourceToPicked).filter(item => item.id) ?? [];
        if (items.length) apply(items);
      } catch (err) {
        console.error("product resourcePicker failed", err);
        toast({ type: "error", title: t("Picker unavailable"), desc: t("Open the app inside Shopify admin to select products.") });
      }
    },
    async pickCollection(apply) {
      try {
        const bridge = (window as unknown as { shopify?: { resourcePicker: (opts: { type: string; multiple: boolean }) => Promise<unknown> } }).shopify;
        const result = await bridge?.resourcePicker({ type: "collection", multiple: false });
        const item = ((result as Record<string, unknown>[] | undefined)?.map(resourceToPicked).filter(r => r.id) ?? [])[0];
        if (item) apply(item);
      } catch (err) {
        console.error("collection resourcePicker failed", err);
        toast({ type: "error", title: t("Picker unavailable"), desc: t("Open the app inside Shopify admin to select collections.") });
      }
    },
  };

  const selected    = blocks.find(b => b.id === selectedId) ?? null;
  const pageSelected = selectedId === PAGE_SETTINGS_ID;
  const effectivePageSettings = campaignPageSettingsForPlan(pageSettings, { forcePoweredBy: isFreePlan, pixels: canPixels });
  const pageCanvasStyle = {
    "--editor-page-accent": effectivePageSettings.accentColor,
    background: effectivePageSettings.pageBgColor || (effectivePageSettings.theme === "light" ? "#F8FAFC" : "#0B1220"),
    color: effectivePageSettings.textColor || (effectivePageSettings.theme === "light" ? "#0B1220" : "#E2E8F0"),
  } as React.CSSProperties;

  /* ── History helpers ── */
  const commit = (next: Block[]) => {
    setHistory(h => ({ past: [...h.past, blocks].slice(-30), future: [] }));
    setBlocks(next);
  };
  const undo = () => {
    setHistory(h => {
      if (!h.past.length) return h;
      const prev = h.past[h.past.length - 1];
      setBlocks(prev);
      return { past: h.past.slice(0, -1), future: [blocks, ...h.future].slice(0, 30) };
    });
  };
  const redo = () => {
    setHistory(h => {
      if (!h.future.length) return h;
      const next = h.future[0];
      setBlocks(next);
      return { past: [...h.past, blocks].slice(-30), future: h.future.slice(1) };
    });
  };

  /* ── Mutators ── */
  const updateProp = (key: string, value: unknown) => {
    if (!selected) return;
    commit(blocks.map(b => b.id === selectedId ? { ...b, props: { ...b.props, [key]: value } } : b));
  };
  const updateProps = (values: Record<string, unknown>) => {
    if (!selected) return;
    commit(blocks.map(b => b.id === selectedId ? { ...b, props: { ...b.props, ...values } } : b));
  };
  const updateLayout = (key: string, value: unknown) => {
    if (!selected) return;
    commit(blocks.map(b => b.id === selectedId ? { ...b, layout: { ...b.layout, [key]: value } } : b));
  };
  const updateVisibility = (key: string, value: unknown) => {
    if (!selected) return;
    commit(blocks.map(b => b.id === selectedId ? { ...b, visibility: { ...b.visibility, [key]: value } } : b));
  };
  const updatePageSetting = <K extends keyof CampaignPageSettings>(key: K, value: CampaignPageSettings[K]) => {
    setPageSettings(current => ({ ...current, [key]: value }));
  };

  const moveBlock = (id: string, dir: number) => {
    const i = blocks.findIndex(b => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const duplicateBlock = (id: string) => {
    const i = blocks.findIndex(b => b.id === id);
    if (i < 0) return;
    const copy = { ...blocks[i], id: uid() };
    const next = [...blocks];
    next.splice(i + 1, 0, copy);
    commit(next);
    setSelectedId(copy.id);
    toast?.({ title: t("Block duplicated") });
  };
  const deleteBlock = (id: string) => {
    const i = blocks.findIndex(b => b.id === id);
    commit(blocks.filter(b => b.id !== id));
    if (selectedId === id) {
      const nextSel = blocks[i + 1] || blocks[i - 1];
      setSelectedId(nextSel?.id ?? null);
    }
  };
  const addBlock = (type: BlockType, atIdx?: number) => {
    const newBlock = makeBlock(type);
    const next = [...blocks];
    next.splice(atIdx ?? blocks.length, 0, newBlock);
    commit(next);
    setSelectedId(newBlock.id);
    toast?.({ title: t("{block} added", { block: t(blockMeta(type)?.name ?? type) }) });
  };

  /* ── Drag handlers ── */
  const onLibraryDragStart = (e: React.DragEvent, type: BlockType) => {
    dragRef.current = { source: "library", type };
    e.dataTransfer.effectAllowed = "copy";
  };
  const onBlockDragStart = (e: React.DragEvent, id: string) => {
    dragRef.current = { source: "block", id };
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOverGap = (e: React.DragEvent, idx: number) => {
    e.preventDefault(); setDropIdx(idx); setDropEndZone(false);
  };
  const onDragOverEndZone = (e: React.DragEvent) => {
    e.preventDefault(); setDropEndZone(true); setDropIdx(null);
  };
  const onDropAt = (idx: number) => {
    const d = dragRef.current;
    setDropIdx(null); setDropEndZone(false);
    if (!d) return;
    if (d.source === "library") {
      addBlock(d.type, idx);
    } else if (d.source === "block") {
      const fromIdx = blocks.findIndex(b => b.id === d.id);
      if (fromIdx === -1) return;
      const next = [...blocks];
      const [moved] = next.splice(fromIdx, 1);
      const adjusted = fromIdx < idx ? idx - 1 : idx;
      next.splice(adjusted, 0, moved);
      commit(next);
    }
    dragRef.current = null;
  };

  const filteredLibrary = useMemo(() => {
    if (!search.trim()) return BLOCK_LIBRARY;
    const q = search.toLowerCase();
    return BLOCK_LIBRARY.filter(b => t(b.name).toLowerCase().includes(q) || b.name.toLowerCase().includes(q));
  }, [search]);

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT")) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "d" && selected) { e.preventDefault(); duplicateBlock(selectedId!); }
      else if (e.key === "Backspace" && selected) { e.preventDefault(); deleteBlock(selectedId!); }
      else if (e.key === "ArrowUp" && (e.metaKey || e.ctrlKey) && selected) { e.preventDefault(); moveBlock(selectedId!, -1); }
      else if (e.key === "ArrowDown" && (e.metaKey || e.ctrlKey) && selected) { e.preventDefault(); moveBlock(selectedId!, 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, selectedId, blocks, history]);

  return (
    <EditorPlanContext.Provider value={planFeatures}>
    <div className="campaign-editor-page">
      <EditorTopBar
        campaignName={campaignName}
        setCampaignName={setCampaignName}
        device={device}
        setDevice={setDevice}
        onNavigate={() => navigate("/app/campaigns")}
        onUndo={undo}
        onRedo={redo}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        status={status}
        saveState={saveState}
        onSave={manualSave}
        onPublish={publish}
        onPause={pause}
        previewPath={previewPath}
      />

      <div className="editor-shell">

        {/* ══ LEFT — Block library ══ */}
        <div className="editor-col">
          <div className="editor-col-head">
            <span>{t("Blocks · Drag onto canvas")}</span>
          </div>
          <div style={{ padding: "10px 12px 0" }}>
            <div className="block-search">
              <Input icon="search" placeholder={t("Search blocks…")} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="editor-blocks scroll">
            <button
              type="button"
              className={`block-item ${pageSelected ? "selected" : ""}`}
              onClick={() => setSelectedId(PAGE_SETTINGS_ID)}
              title={t("Edit page settings")}
            >
              <div className="block-item-icon"><Icon name="settings" /></div>
              <span style={{ flex: 1 }}>{t("Page settings")}</span>
              <span className="tone-pill blue" />
            </button>
            <div className="block-library-divider" />
            {filteredLibrary.length === 0 ? (
              <div className="block-palette-empty">{t("No blocks match “{search}”", { search })}</div>
            ) : filteredLibrary.map(b => (
              <button key={b.id}
                type="button"
                className="block-item"
                draggable
                onDragStart={e => onLibraryDragStart(e, b.id)}
                onClick={() => addBlock(b.id)}
                title={t("Click or drag to add {name}", { name: b.name })}>
                <div className="block-item-icon"><Icon name={b.icon} /></div>
                <span style={{ flex: 1 }}>{t(b.name)}</span>
                <span className={`tone-pill ${b.tone || "neutral"}`} />
              </button>
            ))}
          </div>
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border-soft)", fontSize: 10.5, color: "var(--fg-subtle)", fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: ".06em" }}>
            {tp(blocks.length, "{count} block on page", "{count} blocks on page")}
          </div>
        </div>

        {/* ══ CENTER — Canvas ══ */}
        <div className="editor-canvas scroll">
          <div className="editor-frame" data-device={device} data-page-layout={effectivePageSettings.layout} data-page-theme={effectivePageSettings.theme} style={pageCanvasStyle}>
            <CampaignBrandBar settings={effectivePageSettings} fallbackName={campaignName} />
            {blocks.length === 0 && (
              <div className="canvas-empty">
                <Icon name="layers" size={28} />
                <div className="mt-2 strong">{t("Empty canvas")}</div>
                <div className="text-sm mt-2">{t("Drag blocks from the left to start composing your landing page.")}</div>
              </div>
            )}

            {blocks.length > 0 && (
              <div
                className={`drop-indicator ${dropIdx === 0 ? "active" : ""}`}
                onDragOver={e => onDragOverGap(e, 0)}
                onDrop={e => { e.preventDefault(); onDropAt(0); }}
                onDragLeave={() => setDropIdx(null)}
                style={{ height: 14 }}
              />
            )}

            {blocks.map((b, idx) => {
              const isSelected = selectedId === b.id;
              const hiddenOnThisDevice =
                (device === "mobile"  && b.visibility?.mobile  === false) ||
                (device !== "mobile"  && b.visibility?.desktop === false);
              return (
                <React.Fragment key={b.id}>
                  <div
                    className={["canvas-block", isSelected && "selected", hiddenOnThisDevice && "hidden-on-device"].filter(Boolean).join(" ")}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={e => onBlockDragStart(e, b.id)}
                    onClick={() => setSelectedId(b.id)}
                    onKeyDown={e => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(b.id);
                      }
                    }}
                    data-padding={b.layout?.padding}
                    data-align={b.layout?.align}
                    data-bg={b.layout?.bg}
                    data-type={b.type}
                  >
                    {hiddenOnThisDevice && (
                      <div className="hidden-badge">
                        <Icon name="eye-off" size={10} /> {t("Hidden")}
                      </div>
                    )}
                    {isSelected && (
                      <BlockToolbar
                        block={b}
                        canUp={idx > 0}
                        canDown={idx < blocks.length - 1}
                        onMoveUp={() => moveBlock(b.id, -1)}
                        onMoveDown={() => moveBlock(b.id, 1)}
                        onDuplicate={() => duplicateBlock(b.id)}
                        onDelete={() => deleteBlock(b.id)}
                      />
                    )}
                    {renderBlock(b, merchantQrChoices)}
                  </div>
                  <div
                    className={`drop-indicator ${dropIdx === idx + 1 ? "active" : ""}`}
                    onDragOver={e => onDragOverGap(e, idx + 1)}
                    onDrop={e => { e.preventDefault(); onDropAt(idx + 1); }}
                    onDragLeave={() => setDropIdx(null)}
                    style={{ height: 14 }}
                  />
                </React.Fragment>
              );
            })}

            {blocks.length > 0 && <CampaignFooterPreview settings={effectivePageSettings} />}

            <div
              className={`canvas-add-zone ${dropEndZone ? "dropping" : ""}`}
              onDragOver={onDragOverEndZone}
              onDrop={e => { e.preventDefault(); onDropAt(blocks.length); }}
              onDragLeave={() => setDropEndZone(false)}
            >
              <Icon name="plus" size={14} />
              {dropEndZone ? t("Drop to add here") : t("Drag a block here, or click one on the left")}
            </div>
          </div>
        </div>

        {/* ══ RIGHT — Properties ══ */}
        <div className="editor-col">
          <div className="editor-col-head">
            {pageSelected ? <span>{t("Page · Settings")}</span> : selected ? <span>{t("{block} · Properties", { block: t(blockMeta(selected.type)?.name ?? selected.type) })}</span> : <span>{t("Properties")}</span>}
          </div>
          <div className="scroll" style={{ overflow: "auto", flex: 1 }}>
            {pageSelected ? (
              <PageSettingsPanel settings={pageSettings} update={updatePageSetting} actions={actions} isFreePlan={isFreePlan} canPixels={canPixels} />
            ) : !selected ? (
              <div className="empty">
                <div className="empty-icon"><Icon name="panel-left" /></div>
                <div className="empty-title">{t("Nothing selected")}</div>
                <div className="empty-desc">{t("Click a block in the canvas to edit its content, style, and visibility.")}</div>
              </div>
            ) : (
              <PropertiesPanel
                block={selected}
                updateProp={updateProp}
                updateProps={updateProps}
                updateLayout={updateLayout}
                updateVisibility={updateVisibility}
                onDelete={() => deleteBlock(selected.id)}
                onDuplicate={() => duplicateBlock(selected.id)}
                collapsed={collapsed}
                setCollapsed={setCollapsed}
                actions={actions}
                qrChoices={merchantQrChoices}
              />
            )}
          </div>
        </div>
      </div>
    </div>
    </EditorPlanContext.Provider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
