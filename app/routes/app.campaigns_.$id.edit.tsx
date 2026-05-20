import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../lib/shop.server";
import { getCampaign, saveBlocks, setCampaignStatus } from "../lib/campaign.server";
import type { CampaignStatus } from "@prisma/client";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { Segmented } from "../components/ui/Segmented";
import { useToast } from "../components/ui/Toast";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  if (!params.id) throw new Response("Missing id", { status: 400 });
  const campaign = await getCampaign(shop.id, params.id);
  if (!campaign) throw new Response("Not found", { status: 404 });
  return {
    campaign: {
      id: campaign.id,
      slug: campaign.slug,
      name: campaign.name,
      status: campaign.status,
      blocks: (campaign.blocks as unknown) as Array<{ id: string; type: string; props: Record<string, unknown>; layout: { padding: string; align: string; bg: string }; visibility: { mobile: boolean; desktop: boolean } }>,
    },
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
      const name = (form.get("name") as string | null) ?? undefined;
      await saveBlocks(shop.id, params.id, blocks, name);
      return { ok: true, savedAt: new Date().toISOString() } as const;
    }
    if (intent === "publish") {
      await setCampaignStatus(shop.id, params.id, "ACTIVE");
      return { ok: true, status: "ACTIVE" as CampaignStatus } as const;
    }
    if (intent === "pause") {
      await setCampaignStatus(shop.id, params.id, "PAUSED");
      return { ok: true, status: "PAUSED" as CampaignStatus } as const;
    }
    if (intent === "draft") {
      await setCampaignStatus(shop.id, params.id, "DRAFT");
      return { ok: true, status: "DRAFT" as CampaignStatus } as const;
    }
    return { ok: false, error: "unknown" } as const;
  } catch (err) {
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

function uid(prefix = "b") { return prefix + Math.random().toString(36).slice(2, 8); }

const THEMED_BLOCKS = new Set<BlockType>(["hero", "timer", "products", "promo", "capture"]);

const ALIGN_OPTS = [
  { value: "left",   label: "L" },
  { value: "center", label: "C" },
  { value: "right",  label: "R" },
];
const PADDING_OPTS = [
  { value: "sm", label: "S" },
  { value: "md", label: "M" },
  { value: "lg", label: "L" },
];
const BG_OPTS = [
  { value: "surface",    label: "Default", swatch: "var(--bg-surface)",  border: "var(--border)" },
  { value: "sunken",     label: "Sunken",  swatch: "var(--bg-sunken)",   border: "var(--border)" },
  { value: "brand-soft", label: "Brand",   swatch: "var(--accent-soft)", border: "var(--accent-border)" },
  { value: "brand",      label: "Solid",   swatch: "var(--accent)",      border: "var(--accent)" },
  { value: "dark",       label: "Dark",    swatch: "var(--fg-strong)",   border: "var(--fg-strong)" },
];

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
  hero:     { defaults: () => ({ eyebrow: "Limited time", title: "Limited drop · 24 hours only", subtitle: "Aurora's spring collection — exclusive scan-to-shop access.", cta: "Shop the drop" }), layout: () => ({ padding: "lg", align: "center", bg: "dark" }) },
  timer:    { defaults: () => ({ label: "Drop ends in", endsIn: "01 · 14 · 32 · 06" }),                                                                                                           layout: () => ({ padding: "md", align: "center", bg: "sunken" }) },
  products: { defaults: () => ({ title: "Featured pieces", count: 3, collection: "featured" }),                                                                                                    layout: () => ({ padding: "md", align: "left",   bg: "surface" }) },
  capture:  { defaults: () => ({ title: "Get early access", subtitle: "Drop your email — we'll text you when it's live.", placeholder: "you@email.com", cta: "Notify me", destination: "db" }),   layout: () => ({ padding: "md", align: "center", bg: "sunken" }) },
  promo:    { defaults: () => ({ eyebrow: "Use code", code: "AURORA15", title: "15% off your first order", autoApply: true }),                                                                     layout: () => ({ padding: "md", align: "center", bg: "surface" }) },
  text:     { defaults: () => ({ heading: "Why this drop is different", body: "Hand-cut, hand-stitched, made in batches of 200." }),                                                               layout: () => ({ padding: "md", align: "left",   bg: "surface" }) },
  button:   { defaults: () => ({ label: "Shop the collection", href: "https://", variant: "primary", icon: true }),                                                                                layout: () => ({ padding: "sm", align: "center", bg: "surface" }) },
  image:    { defaults: () => ({ src: "", aspect: "16:9", caption: "", alt: "" }),                                                                                                                 layout: () => ({ padding: "md", align: "center", bg: "surface" }) },
  video:    { defaults: () => ({ title: "Watch the drop", src: "", autoplay: false, controls: true }),                                                                                             layout: () => ({ padding: "md", align: "center", bg: "surface" }) },
  reviews:  { defaults: () => ({ title: "What customers say", items: [{ name: "Anna L.", rating: 5, text: "Fits like a glove. Better quality than expected.", verified: true }, { name: "Marcus T.", rating: 5, text: "The fabric is unreal. Already ordered a second.", verified: true }, { name: "Priya S.", rating: 4, text: "Beautiful piece. Shipping took a little while.", verified: false }] }), layout: () => ({ padding: "md", align: "center", bg: "sunken" }) },
  faq:      { defaults: () => ({ title: "Questions, answered", expanded: false, items: [{ q: "When will my order ship?", a: "Within 2 business days. You'll get tracking by email." }, { q: "What's the return policy?", a: "30 days, no questions asked. Items must be unworn." }] }), layout: () => ({ padding: "md", align: "left", bg: "surface" }) },
  urgency:  { defaults: () => ({ label: "Only 14 left", message: "Once they're gone, they're gone.", tone: "danger", icon: "alert-triangle" }),                                                    layout: () => ({ padding: "sm", align: "center", bg: "surface" }) },
  qr:       { defaults: () => ({ title: "Scan to continue", subtitle: "Open this page on your phone to shop.", data: "https://trackqr.app/c/aurora/spring", size: "md" }),                         layout: () => ({ padding: "md", align: "center", bg: "sunken" }) },
};

function makeBlock(type: BlockType): Block {
  const def = BLOCK_DEFAULTS[type];
  return { id: uid(), type, props: def.defaults(), layout: def.layout(), visibility: { mobile: true, desktop: true } };
}

const STARTER_BLOCKS: BlockType[] = ["hero", "timer", "products", "capture", "promo"];

/* ══════════════ Block Previews ══════════════ */

function Stars({ value = 5, size = 14 }: { value?: number; size?: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 1 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} viewBox="0 0 24 24" width={size} height={size}
          fill={i < value ? "currentColor" : "transparent"}
          stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </span>
  );
}

function HeroPreview({ p }: { p: Record<string, unknown> }) {
  return (
    <div className="lp-hero">
      <Badge tone="brand" style={{ marginBottom: 14 }}><span className="dot" />{String(p.eyebrow || "Limited time")}</Badge>
      <h1>{String(p.title)}</h1>
      {!!p.subtitle && <p>{String(p.subtitle)}</p>}
      <Button variant="primary" size="lg">{String(p.cta)} <Icon name="arrow-right" /></Button>
    </div>
  );
}

function TimerPreview({ p }: { p: Record<string, unknown> }) {
  const parts = String(p.endsIn || "00 · 00 · 00 · 00").split("·").map(s => s.trim());
  const labels = ["Days", "Hours", "Min", "Sec"];
  return (
    <div>
      {!!p.label && <div className="text-xs muted" style={{ textAlign: "center", padding: "16px 16px 0", fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: ".1em", fontSize: 10.5 }}>{String(p.label)}</div>}
      <div className="lp-timer">
        {parts.map((part, i) => (
          <div key={i} className="lp-timer-unit">
            <div className="lp-timer-num">{part}</div>
            <div className="lp-timer-lbl">{labels[i]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductsPreview({ p }: { p: Record<string, unknown> }) {
  const names  = ["Aurora Tee", "Stone Hoodie", "Drift Cap", "Pace Tote", "Linen Shirt", "Wool Beanie"];
  const prices = ["$48.00", "$128.00", "$36.00", "$58.00", "$92.00", "$28.00"];
  const cols   = Math.min(Number(p.count) || 3, 4);
  return (
    <div>
      <div style={{ padding: "16px 24px 12px", fontFamily: "var(--ff-display)", fontWeight: 600, fontSize: 16, letterSpacing: "-0.012em" }}>{String(p.title)}</div>
      <div className="lp-products" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: Number(p.count) || 3 }, (_, i) => (
          <div key={i} className="lp-product">
            <div className="lp-product-img"><Icon name="image" size={24} /></div>
            <div className="lp-product-info">
              <div className="lp-product-name">{names[i % names.length]}</div>
              <div className="lp-product-price">{prices[i % prices.length]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CapturePreview({ p }: { p: Record<string, unknown> }) {
  return (
    <div className="lp-capture">
      <h3>{String(p.title)}</h3>
      {!!p.subtitle && <p>{String(p.subtitle)}</p>}
      <div className="lp-capture-form">
        <Input placeholder={String(p.placeholder || "you@email.com")} />
        <Button variant="primary">{String(p.cta || "Notify me")}</Button>
      </div>
    </div>
  );
}

function PromoPreview({ p }: { p: Record<string, unknown> }) {
  return (
    <div className="lp-promo">
      <div className="text-xs strong" style={{ fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6, color: "var(--amber-fg)" }}>{String(p.eyebrow || "Use code")}</div>
      <div className="lp-promo-code">{String(p.code)}</div>
      <div className="text-sm" style={{ marginTop: 6 }}>{String(p.title)}</div>
    </div>
  );
}

function TextPreview({ p, layout }: { p: Record<string, unknown>; layout: { align: string } }) {
  return (
    <div className="lp-text block-content" data-align={layout?.align || "left"}>
      {!!p.heading && <h2>{String(p.heading)}</h2>}
      {!!p.body && <p>{String(p.body)}</p>}
    </div>
  );
}

function ButtonPreview({ p, layout }: { p: Record<string, unknown>; layout: { align: string } }) {
  return (
    <div className="lp-button-block block-content" data-align={layout?.align || "center"}>
      <Button variant={(p.variant as "primary" | "secondary" | "ghost" | "outline") || "primary"} size="lg"
        iconRight={p.icon ? "arrow-right" : undefined}>
        {String(p.label || "Click me")}
      </Button>
    </div>
  );
}

function ImagePreview({ p }: { p: Record<string, unknown> }) {
  return (
    <div className="lp-image block-content">
      <div className="lp-image-frame" data-aspect={String(p.aspect || "16:9")}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, position: "relative" }}>
          <Icon name="image" size={36} />
          <div style={{ fontSize: 10.5, fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: ".08em" }}>
            {String(p.aspect || "16:9")} · placeholder
          </div>
        </div>
      </div>
      {!!p.caption && <div className="lp-image-caption">{String(p.caption)}</div>}
    </div>
  );
}

function VideoPreview({ p }: { p: Record<string, unknown> }) {
  return (
    <div className="lp-video block-content">
      {!!p.title && <div className="lp-video-title"><Icon name="video" size={13} /> {String(p.title)}</div>}
      <div className="lp-video-frame">
        <div className="lp-video-play"><Icon name="play" size={20} /></div>
      </div>
    </div>
  );
}

function ReviewsPreview({ p, layout }: { p: Record<string, unknown>; layout: { align: string } }) {
  const items = (p.items as Array<{ rating: number; name: string; text: string; verified?: boolean }>) || [];
  const avg = items.reduce((s, r) => s + (r.rating || 5), 0) / Math.max(items.length, 1);
  return (
    <div className="lp-reviews block-content" data-align={layout?.align || "center"}>
      <div className="lp-reviews-head">
        <h2>{String(p.title || "What customers say")}</h2>
        <div className="lp-reviews-rating">
          <span className="lp-reviews-stars"><Stars value={Math.round(avg)} /></span>
          <span>{avg.toFixed(1)} · {items.length} reviews</span>
        </div>
      </div>
      <div className="lp-reviews-grid" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 3)}, 1fr)` }}>
        {items.slice(0, 3).map((r, i) => (
          <div key={i} className="lp-review-card">
            <div className="stars"><Stars value={r.rating || 5} size={12} /></div>
            <p>"{r.text}"</p>
            <div className="name">— {r.name}{r.verified && <span className="verified">✓ Verified</span>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FaqPreview({ p }: { p: Record<string, unknown> }) {
  const items = (p.items as Array<{ q: string; a: string }>) || [];
  return (
    <div className="lp-faq block-content">
      {!!p.title && <h2>{String(p.title)}</h2>}
      {items.map((it, i) => (
        <div key={i} className="lp-faq-item">
          <div className="lp-faq-q"><span>{it.q}</span><Icon name="chevron-down" size={14} /></div>
          {(p.expanded || i === 0) && it.a && <div className="lp-faq-a">{it.a}</div>}
        </div>
      ))}
    </div>
  );
}

function UrgencyPreview({ p }: { p: Record<string, unknown> }) {
  return (
    <div className="lp-urgency block-content" data-tone={String(p.tone || "danger")}>
      <Icon name={String(p.icon || "alert-triangle")} size={15} />
      <span><b>{String(p.label || "Hurry")}</b> · {String(p.message)}</span>
    </div>
  );
}

function QrPreview({ p }: { p: Record<string, unknown> }) {
  return (
    <div className="lp-qr-block block-content">
      <h3>{String(p.title || "Scan to continue")}</h3>
      {!!p.subtitle && <div className="sub">{String(p.subtitle)}</div>}
      <div className="lp-qr-block-canvas" data-size={String(p.size || "md")} style={{ display: "grid", placeItems: "center", color: "var(--fg-subtle)" }}>
        <Icon name="qr-code" size={48} />
      </div>
    </div>
  );
}

/* ── renderBlock dispatcher ── */
function renderBlock(b: Block, device: DeviceType) {
  const p = b.props;
  const l = b.layout;
  switch (b.type) {
    case "hero":     return <HeroPreview p={p} />;
    case "timer":    return <TimerPreview p={p} />;
    case "products": return <ProductsPreview p={p} />;
    case "capture":  return <CapturePreview p={p} />;
    case "promo":    return <PromoPreview p={p} />;
    case "text":     return <TextPreview p={p} layout={l} />;
    case "button":   return <ButtonPreview p={p} layout={l} />;
    case "image":    return <ImagePreview p={p} />;
    case "video":    return <VideoPreview p={p} />;
    case "reviews":  return <ReviewsPreview p={p} layout={l} />;
    case "faq":      return <FaqPreview p={p} />;
    case "urgency":  return <UrgencyPreview p={p} />;
    case "qr":       return <QrPreview p={p} />;
    default:         return <div style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)" }}>Unknown block</div>;
  }
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
            <span className="prop-repeater-num">Item {i + 1}</span>
            <button className="prop-repeater-remove" onClick={() => remove(i)} disabled={items.length <= 1} title="Remove">
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
    <div onClick={() => onChange(!on)} style={{ width: 32, height: 18, background: on ? "var(--accent)" : "var(--border-strong)", borderRadius: 9, position: "relative", transition: "all .14s var(--ease)", cursor: "default", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 14, height: 14, background: "#fff", borderRadius: "50%", transition: "all .14s var(--ease)", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
    </div>
  );
}

/* ══════════════ Block field editors ══════════════ */

function HeroFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label="Eyebrow"><Input value={String(p.eyebrow || "")} onChange={e => set("eyebrow", e.target.value)} placeholder="Limited time" /></Field>
    <Field label="Title" required><Input value={String(p.title)} onChange={e => set("title", e.target.value)} /></Field>
    <Field label="Subtitle"><Textarea value={String(p.subtitle || "")} onChange={e => set("subtitle", e.target.value)} rows={2} /></Field>
    <Field label="Call to action"><Input value={String(p.cta)} onChange={e => set("cta", e.target.value)} /></Field>
  </>);
}
function TimerFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label="Label (optional)"><Input value={String(p.label || "")} onChange={e => set("label", e.target.value)} placeholder="Drop ends in" /></Field>
    <Field label="Ends in" hint="DD · HH · MM · SS"><Input value={String(p.endsIn)} onChange={e => set("endsIn", e.target.value)} placeholder="01 · 14 · 32 · 06" /></Field>
  </>);
}
function ProductsFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label="Section title"><Input value={String(p.title)} onChange={e => set("title", e.target.value)} /></Field>
    <Field label="Number of products">
      <Select value={String(p.count)} onChange={e => set("count", +e.target.value)}>
        <option value="2">2 products</option>
        <option value="3">3 products</option>
        <option value="4">4 products</option>
        <option value="6">6 products</option>
      </Select>
    </Field>
    <Field label="Collection" hint="Pulls live from your Shopify store">
      <Select value={String(p.collection || "featured")} onChange={e => set("collection", e.target.value)}>
        <option value="featured">Featured</option>
        <option value="bestsellers">Bestsellers</option>
        <option value="new">New arrivals</option>
        <option value="sale">On sale</option>
        <option value="custom">Custom selection…</option>
      </Select>
    </Field>
  </>);
}
function CaptureFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label="Title"><Input value={String(p.title)} onChange={e => set("title", e.target.value)} /></Field>
    <Field label="Subtitle"><Input value={String(p.subtitle || "")} onChange={e => set("subtitle", e.target.value)} /></Field>
    <Field label="Placeholder"><Input value={String(p.placeholder || "")} onChange={e => set("placeholder", e.target.value)} placeholder="you@email.com" /></Field>
    <Field label="Button label"><Input value={String(p.cta || "")} onChange={e => set("cta", e.target.value)} placeholder="Notify me" /></Field>
    <Field label="Send leads to">
      <Select value={String(p.destination || "db")} onChange={e => set("destination", e.target.value)}>
        <option value="db">TrackQr database</option>
        <option value="klaviyo">Klaviyo</option>
        <option value="mailchimp">Mailchimp</option>
        <option value="hubspot">HubSpot</option>
        <option value="csv">CSV export only</option>
      </Select>
    </Field>
  </>);
}
function PromoFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label="Eyebrow"><Input value={String(p.eyebrow || "")} onChange={e => set("eyebrow", e.target.value)} placeholder="Use code" /></Field>
    <Field label="Discount code"><Input value={String(p.code)} onChange={e => set("code", e.target.value)} style={{ fontFamily: "var(--ff-mono)", letterSpacing: "0.04em" }} /></Field>
    <Field label="Description"><Input value={String(p.title)} onChange={e => set("title", e.target.value)} /></Field>
    <Field label="Auto-apply at checkout">
      <Select value={p.autoApply ? "on" : "off"} onChange={e => set("autoApply", e.target.value === "on")}>
        <option value="on">Yes — apply automatically</option>
        <option value="off">No — visitor must enter manually</option>
      </Select>
    </Field>
  </>);
}
function TextFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label="Heading"><Input value={String(p.heading || "")} onChange={e => set("heading", e.target.value)} /></Field>
    <Field label="Body" hint="Plain text — line breaks preserved."><Textarea value={String(p.body || "")} onChange={e => set("body", e.target.value)} rows={4} /></Field>
  </>);
}
function ButtonFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label="Label"><Input value={String(p.label)} onChange={e => set("label", e.target.value)} /></Field>
    <Field label="URL"><Input value={String(p.href || "")} onChange={e => set("href", e.target.value)} placeholder="https://" icon="link" /></Field>
    <Field label="Style">
      <Select value={String(p.variant || "primary")} onChange={e => set("variant", e.target.value)}>
        <option value="primary">Primary (filled)</option>
        <option value="secondary">Secondary (outline)</option>
        <option value="outline">Outline (light)</option>
        <option value="ghost">Ghost (text only)</option>
      </Select>
    </Field>
    <div className="prop-row prop-row-h">
      <label>Show arrow icon</label>
      <EditorToggle on={!!p.icon} onChange={v => set("icon", v)} />
    </div>
  </>);
}
function ImageFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label="Source" hint="Drop a file here or paste a URL."><Input value={String(p.src || "")} onChange={e => set("src", e.target.value)} placeholder="image.jpg or https://…" icon="image" /></Field>
    <Field label="Aspect ratio">
      <Segmented value={String(p.aspect || "16:9")} onChange={v => set("aspect", v)} options={[{ value: "16:9", label: "16:9" }, { value: "1:1", label: "1:1" }, { value: "4:5", label: "4:5" }, { value: "3:1", label: "Wide" }]} />
    </Field>
    <Field label="Caption (optional)"><Input value={String(p.caption || "")} onChange={e => set("caption", e.target.value)} /></Field>
    <Field label="Alt text" hint="Important for accessibility & SEO."><Input value={String(p.alt || "")} onChange={e => set("alt", e.target.value)} /></Field>
  </>);
}
function VideoFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label="Title (optional)"><Input value={String(p.title || "")} onChange={e => set("title", e.target.value)} placeholder="Watch the drop" /></Field>
    <Field label="Video URL" hint="YouTube, Vimeo, or direct mp4."><Input value={String(p.src || "")} onChange={e => set("src", e.target.value)} placeholder="https://youtube.com/..." icon="link" /></Field>
    <div className="prop-row prop-row-h"><label>Autoplay (muted)</label><EditorToggle on={!!p.autoplay} onChange={v => set("autoplay", v)} /></div>
    <div className="prop-row prop-row-h"><label>Show controls</label><EditorToggle on={p.controls !== false} onChange={v => set("controls", v)} /></div>
  </>);
}
function ReviewsFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  type ReviewItem = { name: string; rating: number; text: string; verified: boolean };
  const items = (p.items as ReviewItem[]) || [];
  return (<>
    <Field label="Section title"><Input value={String(p.title || "")} onChange={e => set("title", e.target.value)} /></Field>
    <Field label="Reviews">
      <Repeater items={items} onChange={v => set("items", v)} addLabel="Add review"
        defaultItem={{ name: "Anna L.", rating: 5, text: "Loved it. Fits perfectly.", verified: true }}
        render={(it, setKey) => (<>
          <div className="prop-row"><label>Name</label><Input value={it.name} onChange={e => setKey("name", e.target.value)} /></div>
          <div className="prop-row"><label>Rating</label>
            <Select value={String(it.rating)} onChange={e => setKey("rating", +e.target.value)}>
              <option value="5">★★★★★</option><option value="4">★★★★☆</option>
              <option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option>
            </Select>
          </div>
          <div className="prop-row"><label>Quote</label><Textarea value={it.text} onChange={e => setKey("text", e.target.value)} rows={2} /></div>
          <div className="prop-row prop-row-h"><label>Verified buyer</label><EditorToggle on={!!it.verified} onChange={v => setKey("verified", v)} /></div>
        </>)}
      />
    </Field>
  </>);
}
function FaqFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  type FaqItem = { q: string; a: string };
  const items = (p.items as FaqItem[]) || [];
  return (<>
    <Field label="Section title"><Input value={String(p.title || "")} onChange={e => set("title", e.target.value)} /></Field>
    <div className="prop-row prop-row-h"><label>Expand all by default</label><EditorToggle on={!!p.expanded} onChange={v => set("expanded", v)} /></div>
    <Field label="Questions">
      <Repeater items={items} onChange={v => set("items", v)} addLabel="Add question"
        defaultItem={{ q: "New question?", a: "Helpful answer here." }}
        render={(it, setKey) => (<>
          <div className="prop-row"><label>Question</label><Input value={it.q} onChange={e => setKey("q", e.target.value)} /></div>
          <div className="prop-row"><label>Answer</label><Textarea value={it.a} onChange={e => setKey("a", e.target.value)} rows={2} /></div>
        </>)}
      />
    </Field>
  </>);
}
function UrgencyFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label="Prefix"><Input value={String(p.label || "")} onChange={e => set("label", e.target.value)} placeholder="Hurry" /></Field>
    <Field label="Message"><Input value={String(p.message || "")} onChange={e => set("message", e.target.value)} /></Field>
    <Field label="Tone">
      <Select value={String(p.tone || "danger")} onChange={e => set("tone", e.target.value)}>
        <option value="danger">Red · Danger</option><option value="warning">Amber · Warning</option>
        <option value="info">Blue · Info</option><option value="dark">Dark · Neutral</option>
      </Select>
    </Field>
    <Field label="Icon">
      <Select value={String(p.icon || "alert-triangle")} onChange={e => set("icon", e.target.value)}>
        <option value="alert-triangle">Warning triangle</option><option value="clock">Clock</option>
        <option value="zap">Lightning</option><option value="bell">Bell</option><option value="info">Info</option>
      </Select>
    </Field>
  </>);
}
function QrFields({ p, set }: { p: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (<>
    <Field label="Title"><Input value={String(p.title || "")} onChange={e => set("title", e.target.value)} /></Field>
    <Field label="Subtitle"><Input value={String(p.subtitle || "")} onChange={e => set("subtitle", e.target.value)} /></Field>
    <Field label="Encodes" hint="URL or text the QR points to."><Input value={String(p.data || "")} onChange={e => set("data", e.target.value)} placeholder="https://" icon="link" /></Field>
    <Field label="Size">
      <Segmented value={String(p.size || "md")} onChange={v => set("size", v)} options={[{ value: "sm", label: "Small" }, { value: "md", label: "Medium" }, { value: "lg", label: "Large" }]} />
    </Field>
  </>);
}

function BlockFields({ block, set }: { block: Block; set: (k: string, v: unknown) => void }) {
  const p = block.props;
  switch (block.type) {
    case "hero":     return <HeroFields p={p} set={set} />;
    case "timer":    return <TimerFields p={p} set={set} />;
    case "products": return <ProductsFields p={p} set={set} />;
    case "capture":  return <CaptureFields p={p} set={set} />;
    case "promo":    return <PromoFields p={p} set={set} />;
    case "text":     return <TextFields p={p} set={set} />;
    case "button":   return <ButtonFields p={p} set={set} />;
    case "image":    return <ImageFields p={p} set={set} />;
    case "video":    return <VideoFields p={p} set={set} />;
    case "reviews":  return <ReviewsFields p={p} set={set} />;
    case "faq":      return <FaqFields p={p} set={set} />;
    case "urgency":  return <UrgencyFields p={p} set={set} />;
    case "qr":       return <QrFields p={p} set={set} />;
    default:         return null;
  }
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
      <div className="prop-section-toggle" onClick={toggle}>
        <span className="prop-section-label" style={{ marginBottom: 0 }}>{label}</span>
        <Icon name="chevron-down" size={13} />
      </div>
      <div className="prop-section-body">{children}</div>
    </div>
  );
}

/* ══════════════ BgSwatchPicker ══════════════ */
function BgSwatchPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="swatch-row">
      {BG_OPTS.map(o => (
        <div key={o.value}
          className={`swatch ${value === o.value ? "active" : ""}`}
          style={{ background: o.swatch, boxShadow: value === o.value ? `0 0 0 2px var(--accent)` : `0 0 0 1px ${o.border}` }}
          title={o.label}
          onClick={() => onChange(o.value)} />
      ))}
    </div>
  );
}

/* ══════════════ PropertiesPanel ══════════════ */
function PropertiesPanel({ block, updateProp, updateLayout, updateVisibility, onDelete, onDuplicate, collapsed, setCollapsed }: {
  block: Block;
  updateProp: (k: string, v: unknown) => void;
  updateLayout: (k: string, v: unknown) => void;
  updateVisibility: (k: string, v: unknown) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  collapsed: Record<string, boolean>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const meta     = blockMeta(block.type);
  const isThemed = THEMED_BLOCKS.has(block.type);

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
          <div className="strong text-sm">{meta?.name}</div>
          <div className="text-xs muted" style={{ fontFamily: "var(--ff-mono)" }}>id · {block.id}</div>
        </div>
      </div>
    </div>

    {/* Content */}
    <PropSection label="Content" k="content" collapsed={collapsed} setCollapsed={setCollapsed}>
      <BlockFields block={block} set={updateProp} />
    </PropSection>

    {/* Layout */}
    {!isThemed && (
      <PropSection label="Layout" k="layout" collapsed={collapsed} setCollapsed={setCollapsed}>
        <div className="prop-row prop-row-h">
          <label>Padding</label>
          <Segmented value={block.layout?.padding || "md"} onChange={v => updateLayout("padding", v)} options={PADDING_OPTS} />
        </div>
        <div className="prop-row prop-row-h">
          <label>Alignment</label>
          <Segmented value={block.layout?.align || "center"} onChange={v => updateLayout("align", v)} options={ALIGN_OPTS} />
        </div>
        <div className="prop-row">
          <label>Background</label>
          <BgSwatchPicker value={block.layout?.bg || "surface"} onChange={v => updateLayout("bg", v)} />
          <div className="field-hint">{BG_OPTS.find(o => o.value === (block.layout?.bg || "surface"))?.label}</div>
        </div>
      </PropSection>
    )}

    {/* Visibility */}
    <PropSection label="Visibility" k="visibility" collapsed={collapsed} setCollapsed={setCollapsed} defaultOpen={false}>
      <div className="prop-row prop-row-h">
        <label><Icon name="monitor" size={12} style={{ marginRight: 6, color: "var(--fg-subtle)", verticalAlign: "-2px" }} />Show on desktop</label>
        <EditorToggle on={block.visibility?.desktop !== false} onChange={v => updateVisibility("desktop", v)} />
      </div>
      <div className="prop-row prop-row-h">
        <label><Icon name="smartphone" size={12} style={{ marginRight: 6, color: "var(--fg-subtle)", verticalAlign: "-2px" }} />Show on mobile</label>
        <EditorToggle on={block.visibility?.mobile !== false} onChange={v => updateVisibility("mobile", v)} />
      </div>
      <div className="field-hint" style={{ marginTop: 8 }}>Hidden blocks render as placeholders in the editor.</div>
    </PropSection>

    {/* Actions */}
    <div className="prop-section" style={{ borderBottom: 0 }}>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" icon="copy" onClick={onDuplicate} style={{ flex: 1 }}>Duplicate</Button>
        <Button size="sm" variant="ghost" icon="trash" onClick={onDelete}
          style={{ color: "var(--red-fg)", flex: 1, border: "1px solid var(--red-border)", background: "var(--red-soft)" }}>
          Delete
        </Button>
      </div>
      <div className="text-xs muted mt-4" style={{ textAlign: "center", fontFamily: "var(--ff-mono)" }}>
        ⌘D duplicate · ⌫ delete · ⌘↑↓ move
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
    <div className="block-toolbar" onClick={e => e.stopPropagation()}>
      <span className="block-toolbar-label"><Icon name={meta?.icon || "type"} size={10} />{meta?.name || block.type}</span>
      <button className="block-toolbar-btn" disabled={!canUp} onClick={stop(onMoveUp)} title="Move up"><Icon name="arrow-up" size={11} /></button>
      <button className="block-toolbar-btn" disabled={!canDown} onClick={stop(onMoveDown)} title="Move down"><Icon name="arrow-down" size={11} /></button>
      <button className="block-toolbar-btn" onClick={stop(onDuplicate)} title="Duplicate"><Icon name="copy" size={11} /></button>
      <button className="block-toolbar-btn danger" onClick={stop(onDelete)} title="Delete" style={{ marginRight: 4 }}><Icon name="trash" size={11} /></button>
    </div>
  );
}

/* ══════════════ EditorTopBar ══════════════ */
function EditorTopBar({ campaignName, setCampaignName, device, setDevice, onNavigate, onUndo, onRedo, canUndo, canRedo, status, saveState, onSave, onPublish, onPause, slug }: {
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
  slug: string;
}) {
  const statusTone: Record<CampaignStatus, "success" | "warning" | "neutral" | "danger"> = {
    ACTIVE: "success", PAUSED: "warning", DRAFT: "neutral", ENDED: "danger",
  };
  const statusLabel: Record<CampaignStatus, string> = {
    ACTIVE: "Active", PAUSED: "Paused", DRAFT: "Draft", ENDED: "Ended",
  };

  const indicator =
    saveState === "saving" ? <span className="text-xs muted" style={{ fontFamily: "var(--ff-mono)" }}>Saving…</span> :
    saveState === "saved"  ? <span className="text-xs muted" style={{ fontFamily: "var(--ff-mono)", color: "var(--green-fg)" }}>Saved ✓</span> :
    saveState === "error"  ? <span className="text-xs muted" style={{ fontFamily: "var(--ff-mono)", color: "var(--red-fg)" }}>Save failed</span> :
    null;

  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" icon="chevron-left" onClick={onNavigate}>Campaigns</Button>
        <span className="muted">/</span>
        <input
          value={campaignName}
          onChange={e => setCampaignName(e.target.value)}
          style={{ border: "1px solid transparent", background: "transparent", fontFamily: "var(--ff-display)", fontWeight: 600, fontSize: 18, letterSpacing: "-0.018em", color: "var(--fg-strong)", padding: "4px 8px", borderRadius: 6, outline: "none", width: 320 }}
          onFocus={e => { (e.target as HTMLInputElement).style.background = "var(--bg-sunken)"; }}
          onBlur={e => { (e.target as HTMLInputElement).style.background = "transparent"; }}
        />
        <Badge tone={statusTone[status]} dot>{statusLabel[status]}</Badge>
        {indicator}
      </div>
      <div className="flex gap-2 items-center">
        <Button size="sm" variant="ghost" disabled={!canUndo} onClick={onUndo} title="Undo (⌘Z)"><Icon name="undo" size={13} /></Button>
        <Button size="sm" variant="ghost" disabled={!canRedo} onClick={onRedo} title="Redo (⌘⇧Z)"><Icon name="redo" size={13} /></Button>
        <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />
        <Segmented value={device} onChange={v => setDevice(v as DeviceType)}
          options={[{ value: "desktop", label: "", icon: "monitor" }, { value: "tablet", label: "", icon: "tablet" }, { value: "mobile", label: "", icon: "smartphone" }]} />
        <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />
        <a href={`/c/${slug}`} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="secondary" icon="eye">Preview</Button>
        </a>
        <Button size="sm" variant="secondary" icon="save" onClick={onSave} disabled={saveState === "saving"}>Save</Button>
        {status === "ACTIVE" ? (
          <Button size="sm" variant="secondary" icon="pause" onClick={onPause}>Pause</Button>
        ) : (
          <Button size="sm" variant="success" icon="rocket" onClick={onPublish}>Publish</Button>
        )}
      </div>
    </div>
  );
}

/* ══════════════ Main page ══════════════ */

export default function CampaignEditor() {
  const navigate = useNavigate();
  const toast    = useToast();
  const { campaign } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const initialBlocks: Block[] = (campaign.blocks?.length ? campaign.blocks : STARTER_BLOCKS.map(makeBlock)) as Block[];

  const [blocks,       setBlocks]       = useState<Block[]>(initialBlocks);
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial selection
  useEffect(() => {
    if (!selectedId && blocks.length) setSelectedId(blocks[0].id);
  }, []);

  // Debounced autosave (1.2s)
  useEffect(() => {
    const json = JSON.stringify(blocks);
    if (json === lastSavedJson.current && campaignName === campaign.name) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("idle");
    saveTimer.current = setTimeout(() => {
      doSave(blocks, campaignName);
    }, 1200);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [blocks, campaignName]);

  function doSave(nextBlocks: Block[], nextName: string) {
    setSaveState("saving");
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("blocks", JSON.stringify(nextBlocks));
    fd.set("name", nextName);
    fetcher.submit(fd, { method: "post" });
    lastSavedJson.current = JSON.stringify(nextBlocks);
  }

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      setSaveState("saved");
      if ("status" in fetcher.data && fetcher.data.status) setStatus(fetcher.data.status);
    } else {
      setSaveState("error");
      toast({ type: "error", title: "Save failed", desc: fetcher.data.message ?? "Try again." });
    }
  }, [fetcher.state, fetcher.data]);

  function publish() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    doSave(blocks, campaignName);
    const fd = new FormData();
    fd.set("intent", "publish");
    fetcher.submit(fd, { method: "post" });
    toast({ title: "Publishing…", desc: "Your page is going live." });
  }

  function pause() {
    const fd = new FormData();
    fd.set("intent", "pause");
    fetcher.submit(fd, { method: "post" });
    toast({ type: "warning", title: "Paused" });
  }

  function manualSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    doSave(blocks, campaignName);
  }

  const selected    = blocks.find(b => b.id === selectedId) ?? null;
  const selectedIdx = blocks.findIndex(b => b.id === selectedId);

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
  const updateLayout = (key: string, value: unknown) => {
    if (!selected) return;
    commit(blocks.map(b => b.id === selectedId ? { ...b, layout: { ...b.layout, [key]: value } } : b));
  };
  const updateVisibility = (key: string, value: unknown) => {
    if (!selected) return;
    commit(blocks.map(b => b.id === selectedId ? { ...b, visibility: { ...b.visibility, [key]: value } } : b));
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
    toast?.({ title: "Block duplicated" });
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
    toast?.({ title: `${blockMeta(type)?.name || type} added` });
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
    return BLOCK_LIBRARY.filter(b => b.name.toLowerCase().includes(q));
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
    <div style={{ padding: "20px 24px 32px" }}>
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
        slug={campaign.slug}
      />

      <div className="editor-shell">

        {/* ══ LEFT — Block library ══ */}
        <div className="editor-col">
          <div className="editor-col-head">
            <span>Blocks · Drag onto canvas</span>
          </div>
          <div style={{ padding: "10px 12px 0" }}>
            <div className="block-search">
              <Input icon="search" placeholder="Search blocks…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="editor-blocks scroll">
            {filteredLibrary.length === 0 ? (
              <div className="block-palette-empty">No blocks match "{search}"</div>
            ) : filteredLibrary.map(b => (
              <div key={b.id}
                className="block-item"
                draggable
                onDragStart={e => onLibraryDragStart(e, b.id)}
                onClick={() => addBlock(b.id)}
                title={`Click or drag to add ${b.name}`}>
                <div className="block-item-icon"><Icon name={b.icon} /></div>
                <span style={{ flex: 1 }}>{b.name}</span>
                <span className={`tone-pill ${b.tone || "neutral"}`} />
              </div>
            ))}
          </div>
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border-soft)", fontSize: 10.5, color: "var(--fg-subtle)", fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: ".06em" }}>
            {blocks.length} block{blocks.length !== 1 ? "s" : ""} on page
          </div>
        </div>

        {/* ══ CENTER — Canvas ══ */}
        <div className="editor-canvas scroll">
          <div className="editor-frame" data-device={device}>
            {blocks.length === 0 && (
              <div className="canvas-empty">
                <Icon name="layers" size={28} />
                <div className="mt-2 strong">Empty canvas</div>
                <div className="text-sm mt-2">Drag blocks from the left to start composing your landing page.</div>
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
                    draggable
                    onDragStart={e => onBlockDragStart(e, b.id)}
                    onClick={() => setSelectedId(b.id)}
                    data-padding={!THEMED_BLOCKS.has(b.type) ? b.layout?.padding : undefined}
                    data-align={!THEMED_BLOCKS.has(b.type) ? b.layout?.align : undefined}
                    data-bg={!THEMED_BLOCKS.has(b.type) ? b.layout?.bg : undefined}
                  >
                    {hiddenOnThisDevice && (
                      <div className="hidden-badge">
                        <Icon name="eye-off" size={10} /> Hidden
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
                    {renderBlock(b, device)}
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

            <div
              className={`canvas-add-zone ${dropEndZone ? "dropping" : ""}`}
              onDragOver={onDragOverEndZone}
              onDrop={e => { e.preventDefault(); onDropAt(blocks.length); }}
              onDragLeave={() => setDropEndZone(false)}
            >
              <Icon name="plus" size={14} />
              {dropEndZone ? "Drop to add here" : "Drag a block here, or click one on the left"}
            </div>
          </div>

          <div className="text-xs muted mt-4" style={{ textAlign: "center" }}>
            URL: <span style={{ fontFamily: "var(--ff-mono)" }}>/c/{campaign.slug}</span>
          </div>
        </div>

        {/* ══ RIGHT — Properties ══ */}
        <div className="editor-col">
          <div className="editor-col-head">
            {selected ? <span>{blockMeta(selected.type)?.name || selected.type} · Properties</span> : <span>Properties</span>}
          </div>
          <div className="scroll" style={{ overflow: "auto", flex: 1 }}>
            {!selected ? (
              <div className="empty">
                <div className="empty-icon"><Icon name="panel-left" /></div>
                <div className="empty-title">Nothing selected</div>
                <div className="empty-desc">Click a block in the canvas to edit its content, style, and visibility.</div>
              </div>
            ) : (
              <PropertiesPanel
                block={selected}
                updateProp={updateProp}
                updateLayout={updateLayout}
                updateVisibility={updateVisibility}
                onDelete={() => deleteBlock(selected.id)}
                onDuplicate={() => duplicateBlock(selected.id)}
                collapsed={collapsed}
                setCollapsed={setCollapsed}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
