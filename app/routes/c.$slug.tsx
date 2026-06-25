import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import type { CSSProperties, ReactNode } from "react";
import { renderQrSvg } from "../lib/qr-render";
import { LABEL_FONTS, DEFAULT_FONT, getLabelFont } from "../lib/label-fonts";

type CampaignLandingData = {
  name: string;
  slug: string;
  isPreview: boolean;
  status: string;
  shopDomain: string;
  blocks: Array<{ id?: string; type: string; props: Record<string, unknown>; layout?: { padding: string; align: string; bg: string }; visibility?: { mobile: boolean; desktop: boolean } }>;
  qrById: Record<string, PublicQr>;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  if (!params.slug) throw new Response("Not found", { status: 404 });
  const { getCampaignBySlug } = await import("../lib/campaign.server");
  const campaign = await getCampaignBySlug(params.slug);
  if (!campaign) throw new Response("Not found", { status: 404 });
  const canPreview = new URL(request.url).searchParams.get("preview") === "1"
    ? await canPreviewCampaign(request, campaign.shopId)
    : false;

  if (campaign.status === "DRAFT" && !canPreview) {
    throw new Response("This campaign is not published yet.", { status: 423 });
  }
  if (campaign.status === "PAUSED" && !canPreview) {
    throw new Response("This campaign is paused.", { status: 423 });
  }
  if (campaign.status === "ENDED" && !canPreview) {
    throw new Response("This campaign has ended.", { status: 410 });
  }

  const { campaignLandingData } = await import("../lib/campaign-landing.server");
  return campaignLandingData(campaign, canPreview);
};

async function canPreviewCampaign(request: Request, shopId: string) {
  try {
    const { requireShop } = await import("../lib/shop.server");
    const { shop } = await requireShop(request);
    return shop.id === shopId;
  } catch {
    return false;
  }
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (!params.slug) return { ok: false, error: "missing-slug" } as const;
  const [{ getCampaignBySlug }, { captureLead }] = await Promise.all([
    import("../lib/campaign.server"),
    import("../lib/leads.server"),
  ]);
  const campaign = await getCampaignBySlug(params.slug);
  if (!campaign) return { ok: false, error: "not-found" } as const;
  if (campaign.status !== "ACTIVE") return { ok: false, error: "inactive" } as const;

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const blockId = String(form.get("blockId") ?? "");
  const extra: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (k === "email" || k === "blockId") continue;
    extra[k] = String(v);
  }
  const blocks = (campaign.blocks as CampaignLandingData["blocks"]) || [];
  const sourceBlock = blocks.find(block => block.id === blockId && block.type === "capture");
  const sourceProps = sourceBlock?.props ?? {};
  if (sourceBlock?.id) extra.blockId = sourceBlock.id;
  if (sourceProps.title) extra.blockTitle = String(sourceProps.title);

  try {
    await captureLead({
      campaign,
      shopId: campaign.shopId,
      email,
      recipientEmail: String(sourceProps.merchantEmail || sourceProps.notifyEmail || ""),
      mailSubject: String(sourceProps.mailSubject || ""),
      extra,
      sourceIp: request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For") ?? null,
      sourceUa: request.headers.get("User-Agent") ?? null,
    });
    return { ok: true } as const;
  } catch (err) {
    return { ok: false, error: "save-failed", message: err instanceof Error ? err.message : "" } as const;
  }
};

/* ──────────── SSR rendering ──────────── */

function fontFamily(value: unknown) {
  if (typeof value === "string" && LABEL_FONTS.some(f => f.value === value)) {
    return getLabelFont(value).family;
  }
  switch (value) {
    case "display": return '"Instrument Serif", serif';
    case "serif": return 'Georgia, "Times New Roman", serif';
    case "mono": return "ui-monospace, SFMono-Regular, Menlo, monospace";
    case "sans": return '-apple-system, system-ui, "Inter", sans-serif';
    default: return undefined;
  }
}
function sizePx(value: unknown, map: Record<string, number>, fallback: number) {
  return map[String(value || "md")] ?? fallback;
}
function textRoleStyle(p: Record<string, unknown>, role: "heading" | "body" | "eyebrow" | "button", fallbackSize?: number): CSSProperties {
  const style: CSSProperties = {};
  const fontId = typeof p[`${role}Font`] === "string" ? String(p[`${role}Font`]) : "";
  const spec = fontId && fontId !== "inherit" ? getLabelFont(fontId || DEFAULT_FONT) : null;
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
  if (typeof p[`${role}Align`] === "string") style.textAlign = p[`${role}Align`] as CSSProperties["textAlign"];
  return style;
}
function numeric(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
    case "sunken": return "rgba(255,255,255,0.04)";
    case "brand-soft": return "rgba(37,99,235,0.18)";
    case "brand": return "#2563EB";
    case "surface": return "transparent";
    case "dark":
    default: return "transparent";
  }
}
function blockStyle(p: Record<string, unknown>, layout?: { padding?: string; align?: string; bg?: string }): CSSProperties {
  const pad = layout?.padding === "sm" ? 16 : layout?.padding === "lg" ? 44 : 28;
  const bgImageUrl = typeof p.bgImageUrl === "string" && p.bgImageUrl ? p.bgImageUrl : "";
  const overlay = Math.max(0, Math.min(0.9, numeric(p.bgOverlay, 0.25)));
  return {
    padding: `${pad}px 0`,
    textAlign: (layout?.align as CSSProperties["textAlign"]) || "left",
    background: typeof p.bgColor === "string" && p.bgColor ? p.bgColor : bgValue(layout?.bg),
    backgroundImage: bgImageUrl ? `linear-gradient(rgba(11,18,32,${overlay}), rgba(11,18,32,${overlay})), url("${bgImageUrl}")` : undefined,
    backgroundSize: bgImageUrl ? String(p.bgImageFit || "cover") : undefined,
    backgroundPosition: bgImageUrl ? String(p.bgImagePosition || "center") : undefined,
    backgroundRepeat: bgImageUrl ? "no-repeat" : undefined,
    color: typeof p.textColor === "string" && p.textColor ? p.textColor : undefined,
    fontFamily: fontFamily(p.font),
  };
}
function headingStyle(p: Record<string, unknown>, fallback = 28): CSSProperties {
  return {
    color: typeof p.headingColor === "string" && p.headingColor ? p.headingColor : undefined,
    fontSize: sizePx(p.headingSize, { sm: 22, md: fallback, lg: 34, xl: 42 }, fallback),
    fontFamily: fontFamily(p.headingFont) ?? fontFamily(p.font),
    ...textRoleStyle(p, "heading"),
  };
}
function bodyStyle(p: Record<string, unknown>, fallback = 15): CSSProperties {
  return {
    color: typeof p.bodyColor === "string" && p.bodyColor ? p.bodyColor : undefined,
    fontSize: sizePx(p.bodySize, { sm: 13, md: fallback, lg: 18, xl: 21 }, fallback),
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
function buttonInlineStyle(p: Record<string, unknown>): CSSProperties | undefined {
  const style: CSSProperties = { ...textRoleStyle(p, "button") };
  const bg = cssColor(p, "buttonBgColor");
  const color = cssColor(p, "buttonTextColor");
  const border = cssColor(p, "buttonBorderColor");
  if (bg) style.background = bg;
  if (color) style.color = color;
  if (border) style.borderColor = border;
  return Object.keys(style).length ? style : undefined;
}
function cardInlineStyle(p: Record<string, unknown>): CSSProperties | undefined {
  const style: CSSProperties = {};
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
function shopifyResourceUrl(resource: { handle?: string; onlineStoreUrl?: string }, type: "products" | "collections", shopDomain: string) {
  if (resource.onlineStoreUrl) return resource.onlineStoreUrl;
  if (!resource.handle) return "#";
  return `https://${shopDomain}/${type}/${resource.handle}`;
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
function productSamples(count: number) {
  const names = ["Aurora Tee", "Stone Hoodie", "Drift Cap", "Pace Tote", "Linen Shirt", "Wool Beanie"];
  const prices = ["$48.00", "$128.00", "$36.00", "$58.00", "$92.00", "$28.00"];
  return Array.from({ length: count }, (_, i): ShopifyPickedResource => ({ id: `sample-${i}`, title: names[i % names.length], price: prices[i % prices.length], image: "" }));
}
type PublicQr = { id: string; name: string; slug: string; scanUrl: string; design?: Record<string, unknown>; label?: Record<string, unknown> };
type ShopifyPickedResource = { id: string; title: string; handle?: string; onlineStoreUrl?: string; image?: string; price?: string };
function isPickedResource(value: unknown): value is ShopifyPickedResource {
  return !!value && typeof value === "object" && typeof (value as ShopifyPickedResource).id === "string" && typeof (value as ShopifyPickedResource).title === "string";
}
function pickedResources(value: unknown): ShopifyPickedResource[] {
  return Array.isArray(value) ? value.filter(isPickedResource) : [];
}
function pickedResource(value: unknown): ShopifyPickedResource | null {
  return isPickedResource(value) ? value : null;
}

function renderBlock(
  b: { id?: string; type: string; props: Record<string, unknown>; layout?: { padding: string; align: string; bg: string }; visibility?: { mobile: boolean; desktop: boolean } },
  slug: string,
  shopDomain: string,
  qrById: Record<string, PublicQr>,
  fetcher: ReturnType<typeof useFetcher>,
) {
  const p = b.props ?? {};
  const sectionClass = [
    "tqr-section",
    b.visibility?.mobile === false ? "hide-mobile" : "",
    b.visibility?.desktop === false ? "hide-desktop" : "",
  ].filter(Boolean).join(" ");
  const wrap = (content: ReactNode) => (
    <section className={sectionClass} style={blockStyle(p, b.layout)}>
      {content}
    </section>
  );
  switch (b.type) {
    case "hero":
      return wrap(
        <div className="tqr-hero">
          {!!p.eyebrow &&<div className="tqr-eyebrow" style={{ color: cssColor(p, "eyebrowColor"), ...textRoleStyle(p, "eyebrow") }}>{String(p.eyebrow)}</div>}
          <h1 style={headingStyle(p, 40)}>{String(p.title ?? "")}</h1>
          {!!p.subtitle &&<p style={bodyStyle(p, 17)}>{String(p.subtitle)}</p>}
          {!!p.cta &&<a href={safeHref(p.ctaHref) ?? "#"} className={`tqr-btn ${String(p.ctaVariant ?? "primary")}`} style={buttonInlineStyle(p)}>{String(p.cta)} →</a>}
        </div>
      );
    case "timer": {
      const parts = countdownParts(p.endsAt || p.endsIn);
      const labels = ["Days", "Hours", "Min", "Sec"];
      return wrap(
        <>
          {!!p.label &&<div className="tqr-eyebrow center" style={{ color: cssColor(p, "eyebrowColor"), ...textRoleStyle(p, "eyebrow") }}>{String(p.label)}</div>}
          <div className="tqr-timer" data-countdown-target={String(p.endsAt || "")}>
            {parts.map((part, i) => (
              <div key={i}><div className="num" style={{ color: accentColor(p) }}>{part}</div><div className="lbl">{labels[i]}</div></div>
            ))}
          </div>
        </>
      );
    }
    case "promo":
      return wrap(
        <>
          {!!p.eyebrow &&<div className="tqr-eyebrow" style={{ color: cssColor(p, "eyebrowColor"), ...textRoleStyle(p, "eyebrow") }}>{String(p.eyebrow)}</div>}
          <div className="tqr-promo" style={{ color: accentColor(p) }}>{String(p.code ?? "")}</div>
          <p style={bodyStyle(p)}>{String(p.title ?? "")}</p>
          {!!p.cta && (
            <a
              href={safeHref(p.href) ?? (p.autoApply && p.code ? `https://${shopDomain}/discount/${encodeURIComponent(String(p.code))}` : "#")}
              className="tqr-btn secondary"
              style={buttonInlineStyle(p)}
            >
              {String(p.cta)}
            </a>
          )}
        </>
      );
    case "capture":
      return wrap(
        <div className="tqr-capture" style={{ background: cssColor(p, "capturePanelBgColor"), borderColor: cssColor(p, "capturePanelBorderColor") }}>
          <h3 style={headingStyle(p, 22)}>{String(p.title ?? "Get on the list")}</h3>
          {!!p.subtitle &&<p style={bodyStyle(p)}>{String(p.subtitle)}</p>}
          <fetcher.Form method="post">
            <input type="hidden" name="blockId" value={String(b.id ?? "")} />
            <input
              type="email"
              name="email"
              required
              placeholder={String(p.placeholder ?? "you@email.com")}
              style={{
                background: cssColor(p, "inputBgColor"),
                color: cssColor(p, "inputTextColor"),
                borderColor: cssColor(p, "inputBorderColor"),
                "--placeholder-color": cssColor(p, "placeholderColor"),
              } as CSSProperties}
            />
            <button type="submit" className="tqr-btn primary" disabled={fetcher.state !== "idle"} style={buttonInlineStyle(p)}>
              {fetcher.state !== "idle" ? "…" : String(p.cta ?? "Notify me")}
            </button>
          </fetcher.Form>
          {!!(fetcher.data && (fetcher.data as { ok?: boolean }).ok) && <div className="tqr-success">Thanks, you&apos;re on the list.</div>}
        </div>
      );
    case "text":
      return wrap(
        <>
          {!!p.heading &&<h2 style={headingStyle(p)}>{String(p.heading)}</h2>}
          {!!p.body &&<p style={{ whiteSpace: "pre-line", ...bodyStyle(p) }}>{String(p.body)}</p>}
        </>
      );
    case "button":
      return wrap(
        <div className={b.layout?.align === "left" ? "" : b.layout?.align === "right" ? "right" : "center"}>
          <a href={safeHref(p.href) ?? "#"} className={`tqr-btn ${String(p.variant ?? "primary")}`} style={buttonInlineStyle(p)}>{String(p.label ?? "")}{p.icon ? " →" : ""}</a>
        </div>
      );
    case "image":
      return wrap(
        <>
          {p.src ? <div className="tqr-media" data-aspect={String(p.aspect || "16:9")}><img src={String(p.src)} alt={String(p.alt ?? "")} style={{ objectFit: (p.fit as "cover" | "contain") || "cover" }} /></div> :
            <div className="tqr-placeholder" data-aspect={String(p.aspect || "16:9")}>Image placeholder</div>}
          {!!p.caption &&<div className="tqr-caption">{String(p.caption)}</div>}
        </>
      );
    case "video": {
      const src = videoSrc(p.src);
      return wrap(
        <>
          {!!p.title &&<h3>{String(p.title)}</h3>}
          {src ? (
            src.match(/\.(mp4|webm|ogg)(\?.*)?$/i)
              ? <video src={src} controls={p.controls !== false} muted autoPlay={!!p.autoplay} style={{ width: "100%", aspectRatio: "16/9", borderRadius: 8 }} />
              : <iframe src={src} title={String(p.title || "Video")} style={{ width: "100%", aspectRatio: "16/9", border: 0, borderRadius: 8 }} allowFullScreen />
          ) : <div className="tqr-placeholder">Video placeholder</div>}
        </>
      );
    }
    case "urgency":
      return wrap(<div className={`tqr-urgency ${String(p.tone ?? "danger")}`}><b>{String(p.label ?? "")}</b> {String(p.message ?? "")}</div>);
    case "faq": {
      const items = (p.items as Array<{ q: string; a: string }>) ?? [];
      return wrap(
        <>
          {!!p.title &&<h2 style={headingStyle(p)}>{String(p.title)}</h2>}
          {items.map((it, i) => (
            <details key={i} open={!!p.expanded || i === 0}>
              <summary>{it.q}</summary>
              <p>{it.a}</p>
            </details>
          ))}
        </>
      );
    }
    case "reviews": {
      const items = (p.items as Array<{ name: string; rating: number; text: string; verified?: boolean }>) ?? [];
      return wrap(
        <>
          {!!p.title &&<h2 style={{ textAlign: "center", ...headingStyle(p) }}>{String(p.title)}</h2>}
          <div className="tqr-reviews">
            {items.map((r, i) => (
              <div key={i} className="tqr-review" style={cardInlineStyle(p)}>
                <div className="stars" style={{ color: accentColor(p) }}>{"★".repeat(r.rating || 5)}</div>
                <p style={{ color: cssColor(p, "cardTextColor") }}>&quot;{r.text}&quot;</p>
                <div className="name">— {r.name}{r.verified ? " · ✓ Verified" : ""}</div>
              </div>
            ))}
          </div>
        </>
      );
    }
    case "qr": {
      const selected = qrById[String(p.qrId || "")];
      const svg = selected ? renderQrSvg(selected.scanUrl, qrRenderOpts(selected.design, selected.label, qrBlockSize(p.size))) : "";
      return wrap(
        <div className="center">
          {!!p.title &&<h3 style={headingStyle(p, 22)}>{String(p.title)}</h3>}
          {!!p.subtitle &&<p style={bodyStyle(p)}>{String(p.subtitle)}</p>}
          {selected ? <div className={`qr-render-output tqr-qr ${String(p.size || "md")}`} dangerouslySetInnerHTML={{ __html: svg }} /> : null}
        </div>
      );
    }
    case "products": {
      const selectedProducts = pickedResources(p.products).slice(0, Number(p.count) || 3);
      const collection = pickedResource(p.collection);
      const products = selectedProducts.length ? selectedProducts : productSamples(Math.max(1, Number(p.count) || 3));
      const href = collection
        ? shopifyResourceUrl(collection, "collections", shopDomain)
        : selectedProducts[0]
          ? shopifyResourceUrl(selectedProducts[0], "products", shopDomain)
          : "#";
      return wrap(
        <>
          <h2 style={headingStyle(p)}>{String(p.title ?? "Featured")}</h2>
          <div className="tqr-products">
            {products.map((product, i) => (
              <a key={product.id || i} className="tqr-product" href={product.handle ? shopifyResourceUrl(product, "products", shopDomain) : href} style={cardInlineStyle(p)}>
                <div className="tqr-product-img">{product.image ? <img src={product.image} alt="" /> : null}</div>
                <div className="tqr-product-name" style={{ color: cssColor(p, "cardTextColor") }}>{product.title}</div>
                <div className="tqr-product-price" style={{ color: cssColor(p, "priceColor") }}>{product.price}</div>
              </a>
            ))}
          </div>
          {href !== "#" && <a href={href} className="tqr-btn secondary" style={buttonInlineStyle(p)}>{String(p.cta || "Shop selected")} →</a>}
        </>
      );
    }
    default:
      return null;
  }
}

export function CampaignLandingView({ data, fullDocument = true }: { data: CampaignLandingData; fullDocument?: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const content = (
    <>
      <style>{css}</style>
      <main className="tqr-page">
        {data.isPreview && (
          <div className="tqr-preview-banner">
            Preview mode · {data.status}
          </div>
        )}
        {data.blocks.length === 0 ? (
          <section className="tqr-block center">
            <h1>{data.name}</h1>
            <p>This campaign has no blocks yet.</p>
          </section>
        ) : data.blocks.map(b => (
          <div key={b.id}>{renderBlock(b, data.slug, data.shopDomain, data.qrById, fetcher)}</div>
        ))}
        <footer className="tqr-foot">
          <span>Powered by <a href="https://trackqr.app">TrackQr</a></span>
        </footer>
      </main>
      <script dangerouslySetInnerHTML={{ __html: countdownScript }} />
    </>
  );

  if (!fullDocument) {
    return <div className="tqr-preview-root">{content}</div>;
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{data.name} · TrackQr</title>
        <style>{css}</style>
      </head>
      <body>
        {content}
      </body>
    </html>
  );
}

export default function CampaignLanding() {
  const data = useLoaderData<typeof loader>();
  return <CampaignLandingView data={data} />;
}

const countdownScript = `
(() => {
  const pad = n => String(n).padStart(2, "0");
  function parts(target) {
    const end = new Date(target).getTime();
    const diff = Number.isFinite(end) ? Math.max(0, end - Date.now()) : 0;
    return [
      Math.floor(diff / 86400000),
      Math.floor((diff % 86400000) / 3600000),
      Math.floor((diff % 3600000) / 60000),
      Math.floor((diff % 60000) / 1000),
    ].map(pad);
  }
  function tick() {
    document.querySelectorAll("[data-countdown-target]").forEach(el => {
      const values = parts(el.getAttribute("data-countdown-target"));
      el.querySelectorAll(".num").forEach((node, i) => { node.textContent = values[i] || "00"; });
    });
  }
  tick();
  window.setInterval(tick, 1000);
})();
`;

const css = `
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, "Inter", sans-serif; margin: 0; background: #0B1220; color: #E2E8F0; line-height: 1.5; }
  .tqr-preview-root { min-height: 100vh; margin: -16px; padding: 0; background: #0B1220; color: #E2E8F0; line-height: 1.5; }
  .tqr-page { max-width: 640px; margin: 0 auto; padding: 0 16px 48px; }
  .tqr-preview-banner { position: sticky; top: 0; z-index: 20; margin: 0 -16px 18px; padding: 9px 16px; background: #FBBF24; color: #0B1220; font: 700 11px ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; text-align: center; }
  .tqr-section { border-radius: 12px; margin: 0; }
  .hide-desktop { display: none; }
  @media (max-width: 767px) {
    .hide-mobile { display: none; }
    .hide-desktop { display: block; }
  }
  .tqr-block { padding: 28px 0; }
  .tqr-block.center { text-align: center; }
  .center { text-align: center; }
  .right { text-align: right; }
  .tqr-eyebrow { display: inline-block; font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #8B92A8; margin-bottom: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); }
  .tqr-eyebrow.center { text-align: center; }
  .tqr-hero { padding: 48px 0 32px; text-align: center; }
  .tqr-hero h1 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 40px; letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 12px; color: #fff; }
  .tqr-hero p { color: #9DA4B8; font-size: 17px; max-width: 480px; margin: 0 auto 24px; }
  h2 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 28px; letter-spacing: -0.018em; margin: 0 0 14px; color: #fff; }
  h3 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 22px; margin: 0 0 10px; color: #fff; }
  p  { margin: 0 0 14px; }
  a  { color: #93C5FD; }
  .tqr-btn { display: inline-block; padding: 12px 22px; border-radius: 10px; font-weight: 500; font-size: 14px; cursor: pointer; border: 0; text-decoration: none; }
  .tqr-btn.primary { background: linear-gradient(135deg, #2563EB, #7C3AED); color: #fff; }
  .tqr-btn.secondary { background: rgba(255,255,255,0.10); color: #fff; border: 1px solid rgba(255,255,255,0.18); }
  .tqr-btn.outline { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.24); }
  .tqr-btn.ghost { background: transparent; color: #93C5FD; }
  .tqr-timer { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .tqr-timer > div { background: rgba(255,255,255,0.06); padding: 14px 10px; border-radius: 10px; text-align: center; }
  .tqr-timer .num { font-family: "Instrument Serif", serif; font-size: 32px; color: #fff; }
  .tqr-timer .lbl { font-size: 10px; color: #8B92A8; text-transform: uppercase; letter-spacing: 0.08em; font-family: ui-monospace, monospace; }
  .tqr-promo { font-family: ui-monospace, monospace; letter-spacing: 0.08em; font-size: 28px; background: rgba(255,255,255,0.06); border: 1px dashed rgba(255,255,255,0.2); padding: 18px; border-radius: 10px; text-align: center; }
  .tqr-capture { padding: 18px; border-radius: 12px; border: 1px solid transparent; }
  .tqr-capture form { display: flex; gap: 8px; margin-top: 14px; }
  .tqr-capture input { flex: 1; padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color: #fff; font-size: 14px; }
  .tqr-capture input::placeholder { color: var(--placeholder-color, rgba(255,255,255,0.45)); }
  .tqr-success { color: #4ADE80; margin-top: 10px; font-size: 13px; }
  .tqr-urgency { background: rgba(220,38,38,0.18); border: 1px solid rgba(220,38,38,0.3); padding: 10px 14px; border-radius: 10px; font-size: 13px; }
  .tqr-urgency.warning { background: rgba(245,158,11,0.18); border-color: rgba(245,158,11,0.3); }
  .tqr-urgency.info    { background: rgba(37,99,235,0.18); border-color: rgba(37,99,235,0.3); }
  .tqr-placeholder { background: rgba(255,255,255,0.05); border: 1px dashed rgba(255,255,255,0.2); border-radius: 8px; aspect-ratio: 16/9; display: grid; place-items: center; color: #8B92A8; font-size: 13px; }
  .tqr-placeholder[data-aspect="1:1"] { aspect-ratio: 1 / 1; }
  .tqr-placeholder[data-aspect="4:5"] { aspect-ratio: 4 / 5; }
  .tqr-placeholder[data-aspect="3:1"] { aspect-ratio: 3 / 1; }
  .tqr-media { overflow: hidden; border-radius: 8px; background: rgba(255,255,255,0.05); }
  .tqr-media[data-aspect="16:9"] { aspect-ratio: 16 / 9; }
  .tqr-media[data-aspect="1:1"] { aspect-ratio: 1 / 1; }
  .tqr-media[data-aspect="4:5"] { aspect-ratio: 4 / 5; }
  .tqr-media[data-aspect="3:1"] { aspect-ratio: 3 / 1; }
  .tqr-media img { width: 100%; height: 100%; display: block; }
  .tqr-caption { color: #8B92A8; font-size: 12px; text-align: center; margin-top: 6px; }
  .tqr-products { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 16px 0; }
  .tqr-product { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10); border-radius: 10px; overflow: hidden; color: inherit; text-decoration: none; }
  .tqr-product-img { aspect-ratio: 1 / 1; background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03)); }
  .tqr-product-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tqr-product-name { font-size: 12px; font-weight: 600; padding: 8px 8px 2px; color: #fff; }
  .tqr-product-price { font-size: 11px; color: #8B92A8; padding: 0 8px 8px; font-family: ui-monospace, monospace; }
  .qr-render-output { display: inline-grid; place-items: center; width: max-content; max-width: 100%; margin: 14px auto 0; background: transparent; border: 0; padding: 0; box-shadow: none; overflow: visible; }
  .qr-render-output svg { display: block; width: auto; height: auto; max-width: 100%; }
  .tqr-qr { min-width: 0; }
  .tqr-reviews { display: grid; gap: 12px; }
  .tqr-review { background: rgba(255,255,255,0.04); border-radius: 12px; padding: 16px; }
  .tqr-review .stars { color: #FBBF24; }
  .tqr-review .name { color: #8B92A8; font-size: 12px; margin-top: 8px; }
  details { background: rgba(255,255,255,0.04); border-radius: 10px; padding: 12px 16px; margin-bottom: 8px; }
  details summary { cursor: pointer; font-weight: 500; }
  details p { color: #9DA4B8; margin: 8px 0 0; }
  .tqr-foot { text-align: center; color: #5B6172; font-size: 12px; padding: 32px 0 12px; border-top: 1px solid rgba(255,255,255,0.08); margin-top: 32px; }
  @media (max-width: 767px) {
    body { padding: 0; }
    .tqr-page { width: 100%; max-width: none; padding: 0 12px 36px; }
    .tqr-section { border-radius: 10px; }
    .tqr-hero { padding: 38px 0 26px; }
    .tqr-hero h1 { font-size: clamp(30px, 10vw, 40px); }
    .tqr-hero p { font-size: 15px; max-width: 34rem; }
    .tqr-timer { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .tqr-capture form { flex-direction: column; }
    .tqr-capture input, .tqr-capture button { width: 100%; }
    .tqr-products { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .tqr-reviews { grid-template-columns: 1fr; }
    .tqr-btn { width: 100%; text-align: center; }
  }
  @media (max-width: 420px) {
    .tqr-page { padding-inline: 10px; }
    .tqr-products { grid-template-columns: 1fr; }
    .tqr-timer { gap: 6px; }
    .tqr-timer > div { padding: 12px 8px; }
  }
`;
