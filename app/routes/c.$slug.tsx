import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import type { CSSProperties, ReactNode } from "react";
import { siFacebook, siInstagram, siTiktok, siX } from "simple-icons";
import { renderQrSvg } from "../lib/qr-render";
import { LABEL_FONTS, DEFAULT_FONT, getLabelFont } from "../lib/label-fonts";
import { normalizeCampaignPageSettings, type CampaignPageSettings } from "../lib/campaign-settings";

type CampaignLandingData = {
  name: string;
  slug: string;
  isPreview: boolean;
  status: string;
  shopDomain: string;
  settings: CampaignPageSettings;
  blocks: Array<{ id?: string; type: string; props: Record<string, unknown>; layout?: { padding: string; align: string; bg: string }; visibility?: { mobile: boolean; desktop: boolean } }>;
  qrById: Record<string, PublicQr>;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  if (!params.slug) throw new Response("Not found", { status: 404 });
  const { getCampaignBySlug } = await import("../lib/campaign.server");
  const { isShopAccessActive, pauseShopPublicSurfaces } = await import("../lib/plan.server");
  const campaign = await getCampaignBySlug(params.slug);
  if (!campaign) throw new Response("Not found", { status: 404 });
  if (!(await isShopAccessActive(campaign.shop))) {
    await pauseShopPublicSurfaces(campaign.shopId);
    throw new Response("This campaign is unavailable until the merchant reactivates TrackQr billing.", { status: 402 });
  }
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
  const { isShopAccessActive, pauseShopPublicSurfaces } = await import("../lib/plan.server");
  if (!(await isShopAccessActive(campaign.shop))) {
    await pauseShopPublicSurfaces(campaign.shopId);
    return { ok: false, error: "billing-required" } as const;
  }
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
    case "brand": return "var(--tqr-accent, #2563EB)";
    case "dark": return "#0B1220";
    case "surface":
    default: return "transparent";
  }
}
function blockStyle(p: Record<string, unknown>, layout?: { padding?: string; align?: string; bg?: string }): CSSProperties {
  const pad = layout?.padding === "sm" ? 16 : layout?.padding === "lg" ? 44 : 28;
  const bgImageUrl = typeof p.bgImageUrl === "string" && p.bgImageUrl ? p.bgImageUrl : "";
  const overlay = Math.max(0, Math.min(0.9, numeric(p.bgOverlay, 0.25)));
  return {
    padding: `${pad}px clamp(18px, 4vw, 56px)`,
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
function pageStyle(settingsInput: CampaignPageSettings): CSSProperties {
  const settings = normalizeCampaignPageSettings(settingsInput);
  const bg = settings.pageBgColor || (settings.theme === "light" ? "#F8FAFC" : "#0B1220");
  const text = settings.textColor || (settings.theme === "light" ? "#0F172A" : "#E2E8F0");
  return {
    "--tqr-accent": settings.accentColor,
    "--tqr-page-bg": bg,
    "--tqr-page-text": text,
  } as CSSProperties;
}
function socialLinks(settings: CampaignPageSettings) {
  const links = [
    { key: "instagram", label: "Instagram", path: siInstagram.path, color: `#${siInstagram.hex}`, href: settings.instagramUrl },
    { key: "tiktok", label: "TikTok", path: siTiktok.path, color: `#${siTiktok.hex}`, href: settings.tiktokUrl },
    { key: "facebook", label: "Facebook", path: siFacebook.path, color: `#${siFacebook.hex}`, href: settings.facebookUrl },
    { key: "x", label: "X", path: siX.path, color: `#${siX.hex}`, href: settings.xUrl },
    { key: "website", label: "Website", path: "M10.5 13.5a4.5 4.5 0 0 1 0-6.36l2.12-2.12a4.5 4.5 0 1 1 6.36 6.36l-1.06 1.06-1.41-1.41 1.06-1.06a2.5 2.5 0 0 0-3.54-3.54l-2.12 2.12a2.5 2.5 0 0 0 0 3.54l-1.41 1.41Zm3 3a4.5 4.5 0 0 1 0-6.36l1.06-1.06 1.41 1.41-1.06 1.06a2.5 2.5 0 0 0 3.54 3.54l2.12-2.12a2.5 2.5 0 0 0 0-3.54l1.41-1.41a4.5 4.5 0 0 1 0 6.36l-2.12 2.12a4.5 4.5 0 0 1-6.36 0Z", color: settings.socialIconColor || "currentColor", href: settings.websiteUrl },
  ]
    .map(item => ({ ...item, href: safeHref(item.href) }))
    .filter(item => item.href);
  return links as Array<{ key: string; label: string; path: string; color: string; href: string }>;
}
function SocialIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}
function footerStyle(settings: CampaignPageSettings): CSSProperties {
  return {
    "--tqr-footer-bg": settings.footerBgColor || "transparent",
    "--tqr-footer-text": settings.footerTextColor || "var(--tqr-page-text, #E2E8F0)",
    "--tqr-footer-credit": settings.footerCreditColor || "color-mix(in srgb, var(--tqr-page-text, #E2E8F0) 54%, transparent)",
    "--tqr-footer-border": settings.footerBorderColor || "color-mix(in srgb, var(--tqr-page-text, #E2E8F0) 12%, transparent)",
    "--tqr-footer-icon": settings.socialIconColor || "var(--tqr-page-text, #E2E8F0)",
    "--tqr-powered-text": settings.poweredTextColor || "color-mix(in srgb, var(--tqr-page-text, #E2E8F0) 62%, transparent)",
    "--tqr-powered-mark-bg": settings.poweredMarkBgColor || "var(--tqr-accent, #2563EB)",
  } as CSSProperties;
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
      <span>Powered by <a href="https://trackqr.app">TrackQR</a></span>
    </div>
  );
}
function CampaignFooter({ settings }: { settings: CampaignPageSettings }) {
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
            <div className="tqr-socials" aria-label="Social links">
              {links.map(link => (
                <a
                  key={link.key}
                  className="tqr-social-link"
                  href={link.href}
                  aria-label={link.label}
                  style={{ color: settings.socialIconColorMode === "brand" ? link.color : undefined }}
                >
                  <SocialIcon path={link.path} />
                </a>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {settings.showPoweredBy && <TrackQrWatermark />}
    </footer>
  );
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
              <p style={bodyStyle(p)}>{it.a}</p>
            </details>
          ))}
        </>
      );
    }
    case "reviews": {
      const items = (p.items as Array<{ name: string; rating: number; text: string; verified?: boolean }>) ?? [];
      const avg = items.reduce((sum, item) => sum + (item.rating || 5), 0) / Math.max(items.length, 1);
      return wrap(
        <>
          {!!p.title &&<h2 style={{ textAlign: "center", ...headingStyle(p) }}>{String(p.title)}</h2>}
          <div className="tqr-reviews-meta">
            <span className="stars" style={{ color: accentColor(p) }}>{"★".repeat(Math.round(avg))}</span>
            <span>{avg.toFixed(1)} · {items.length} reviews</span>
          </div>
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
      if (collection && !selectedProducts.length) {
        return wrap(
          <>
            <h2 style={headingStyle(p)}>{String(p.title ?? "Featured collection")}</h2>
            <a className="tqr-collection-card" href={href} style={cardInlineStyle(p)}>
              <div className="tqr-collection-img">
                {collection.image ? <img src={collection.image} alt="" /> : null}
              </div>
              <div>
                <div className="tqr-product-name" style={{ color: cssColor(p, "cardTextColor") }}>{collection.title}</div>
                <div className="tqr-product-price" style={{ color: cssColor(p, "priceColor") }}>Collection</div>
              </div>
            </a>
            <a href={href} className="tqr-btn secondary" style={buttonInlineStyle(p)}>{String(p.cta || "Shop collection")} →</a>
          </>
        );
      }
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
  const settings = normalizeCampaignPageSettings(data.settings);
  const content = (
    <>
      <style>{css}</style>
      <main className="tqr-page" data-layout={settings.layout} data-theme={settings.theme} style={pageStyle(settings)}>
        {data.isPreview && (
          <div className="tqr-preview-banner">
            Preview mode · {data.status}
          </div>
        )}
        <CampaignBrandBar settings={settings} fallbackName={data.name} />
        {data.blocks.length === 0 ? (
          <section className="tqr-block center">
            <h1>{data.name}</h1>
            <p>This campaign has no blocks yet.</p>
          </section>
        ) : data.blocks.map(b => (
          <div key={b.id}>{renderBlock(b, data.slug, data.shopDomain, data.qrById, fetcher)}</div>
        ))}
        <CampaignFooter settings={settings} />
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
  .tqr-page {
    --tqr-heading: #FFFFFF;
    --tqr-muted: #9DA4B8;
    --tqr-panel: rgba(255,255,255,0.04);
    --tqr-panel-border: rgba(255,255,255,0.10);
    width: min(100%, 1180px);
    min-height: 100vh;
    margin: 0 auto;
    padding: 0 clamp(18px, 3vw, 40px) 56px;
    background: var(--tqr-page-bg, #0B1220);
    color: var(--tqr-page-text, #E2E8F0);
  }
  .tqr-page[data-theme="light"] {
    --tqr-heading: #0F172A;
    --tqr-muted: #475569;
    --tqr-panel: rgba(255,255,255,0.82);
    --tqr-panel-border: rgba(15,23,42,0.12);
  }
  .tqr-page[data-layout="contained"] { width: min(100%, 760px); }
  .tqr-page[data-layout="full"] { width: 100%; padding-inline: 0; }
  .tqr-page[data-layout="full"] .tqr-section { border-radius: 0; }
  .tqr-preview-banner { position: sticky; top: 0; z-index: 20; margin: 0 calc(clamp(18px, 3vw, 40px) * -1) 18px; padding: 9px 16px; background: #FBBF24; color: #0B1220; font: 700 11px ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; text-align: center; }
  .tqr-brand-bar { position: relative; z-index: 4; display: flex; padding: clamp(18px, 3vw, 28px) clamp(18px, 4vw, 56px) 0; margin-bottom: -12px; pointer-events: none; }
  .tqr-brand-bar[data-align="left"] { justify-content: flex-start; }
  .tqr-brand-bar[data-align="center"] { justify-content: center; }
  .tqr-brand-bar[data-align="right"] { justify-content: flex-end; }
  .tqr-brand-lockup { display: inline-flex; align-items: center; gap: 10px; max-width: min(100%, 360px); min-height: 44px; padding: 8px 13px; border-radius: 999px; background: color-mix(in srgb, var(--tqr-page-text, #fff) 9%, var(--tqr-page-bg, #0B1220)); border: 1px solid color-mix(in srgb, var(--tqr-page-text, #fff) 14%, transparent); color: var(--tqr-page-text, #fff); box-shadow: 0 18px 42px rgba(0,0,0,0.18); font-weight: 700; overflow: hidden; }
  .tqr-brand-lockup img { width: 28px; height: 28px; border-radius: 8px; object-fit: contain; background: #fff; flex-shrink: 0; }
  .tqr-brand-lockup span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tqr-section { border-radius: 16px; margin: 0; overflow: hidden; }
  .hide-desktop { display: none; }
  @media (max-width: 767px) {
    .hide-mobile { display: none; }
    .hide-desktop { display: block; }
  }
  .tqr-block { padding: 28px 0; }
  .tqr-block.center { text-align: center; }
  .center { text-align: center; }
  .right { text-align: right; }
  .tqr-eyebrow { display: inline-block; font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--tqr-muted); margin-bottom: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--tqr-panel-border); background: var(--tqr-panel); }
  .tqr-eyebrow.center { text-align: center; }
  .tqr-hero { padding: 48px 0 32px; text-align: center; }
  .tqr-hero h1 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 40px; letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 12px; color: var(--tqr-heading); }
  .tqr-hero p { color: var(--tqr-muted); font-size: 17px; max-width: 480px; margin: 0 auto 24px; }
  h2 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 28px; letter-spacing: -0.018em; margin: 0 0 14px; color: var(--tqr-heading); }
  h3 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 22px; margin: 0 0 10px; color: var(--tqr-heading); }
  p  { margin: 0 0 14px; }
  a  { color: #93C5FD; }
  .tqr-btn { display: inline-block; padding: 12px 22px; border-radius: 10px; font-weight: 500; font-size: 14px; cursor: pointer; border: 0; text-decoration: none; }
  .tqr-btn.primary { background: var(--tqr-accent, #2563EB); color: #fff; }
  .tqr-btn.secondary { background: rgba(255,255,255,0.10); color: #fff; border: 1px solid rgba(255,255,255,0.18); }
  .tqr-page[data-theme="light"] .tqr-btn.secondary { background: #fff; color: #0F172A; border-color: rgba(15,23,42,0.16); }
  .tqr-btn.outline { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.24); }
  .tqr-page[data-theme="light"] .tqr-btn.outline { color: #0F172A; border-color: rgba(15,23,42,0.22); }
  .tqr-btn.ghost { background: transparent; color: var(--tqr-accent, #93C5FD); }
  .tqr-timer { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .tqr-timer > div { background: var(--tqr-panel); padding: 14px 10px; border-radius: 10px; text-align: center; }
  .tqr-timer .num { font-family: "Instrument Serif", serif; font-size: 32px; color: var(--tqr-heading); }
  .tqr-timer .lbl { font-size: 10px; color: var(--tqr-muted); text-transform: uppercase; letter-spacing: 0.08em; font-family: ui-monospace, monospace; }
  .tqr-promo { width: 100%; font-family: ui-monospace, monospace; letter-spacing: 0.08em; font-size: 28px; background: var(--tqr-panel); border: 1px dashed var(--tqr-panel-border); padding: 18px; border-radius: 10px; text-align: center; overflow-wrap: anywhere; }
  .tqr-capture { width: 100%; padding: 18px; border-radius: 12px; border: 1px solid transparent; }
  .tqr-capture form { display: flex; gap: 8px; margin: 14px auto 0; max-width: 520px; }
  .tqr-capture input { flex: 1; min-width: 0; padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color: #fff; font-size: 14px; }
  .tqr-page[data-theme="light"] .tqr-capture input { background: #fff; color: #0F172A; border-color: rgba(15,23,42,0.16); }
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
  .tqr-product { background: var(--tqr-panel); border: 1px solid var(--tqr-panel-border); border-radius: 10px; overflow: hidden; color: inherit; text-decoration: none; }
  .tqr-product-img { aspect-ratio: 1 / 1; background: var(--tqr-panel); }
  .tqr-product-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tqr-product-name { font-size: 12px; font-weight: 600; padding: 8px 8px 2px; color: var(--tqr-heading); }
  .tqr-product-price { font-size: 11px; color: var(--tqr-muted); padding: 0 8px 8px; font-family: ui-monospace, monospace; }
  .tqr-collection-card { display: grid; grid-template-columns: 120px minmax(0, 1fr); align-items: center; gap: 16px; margin: 16px 0; padding: 12px; background: var(--tqr-panel); border: 1px solid var(--tqr-panel-border); border-radius: 12px; color: inherit; text-decoration: none; }
  .tqr-collection-img { aspect-ratio: 1 / 1; border-radius: 8px; overflow: hidden; background: var(--tqr-panel); }
  .tqr-collection-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .qr-render-output { display: inline-grid; place-items: center; width: max-content; max-width: 100%; margin: 14px auto 0; background: transparent; border: 0; padding: 0; box-shadow: none; overflow: visible; }
  .qr-render-output svg { display: block; width: auto; height: auto; max-width: 100%; }
  .tqr-qr { min-width: 0; }
  .tqr-reviews-meta { display: flex; align-items: center; justify-content: center; gap: 8px; margin: -4px 0 16px; color: var(--tqr-muted); font-family: ui-monospace, monospace; font-size: 12px; }
  .tqr-reviews { display: grid; gap: 12px; }
  .tqr-review { background: var(--tqr-panel); border: 1px solid var(--tqr-panel-border); border-radius: 12px; padding: 16px; }
  .tqr-review .stars { color: #FBBF24; }
  .tqr-review .name { color: #8B92A8; font-size: 12px; margin-top: 8px; }
  details { background: var(--tqr-panel); border: 1px solid var(--tqr-panel-border); border-radius: 10px; padding: 12px 16px; margin-bottom: 8px; }
  details summary { cursor: pointer; font-weight: 500; }
  details p { color: #9DA4B8; margin: 8px 0 0; }
  .tqr-campaign-footer { position: relative; padding: 28px clamp(18px, 4vw, 56px) 18px; color: var(--tqr-footer-text, color-mix(in srgb, var(--tqr-page-text, #E2E8F0) 68%, transparent)); background: var(--tqr-footer-bg, transparent); }
  .tqr-footer-inner { position: relative; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 14px; min-height: 54px; padding: 18px 0; border-top: 1px solid var(--tqr-footer-border, color-mix(in srgb, var(--tqr-page-text, #E2E8F0) 12%, transparent)); text-align: center; }
  .tqr-footer-copy { width: min(100%, 560px); margin: 0 auto; padding-inline: 46px; }
  .tqr-footer-inner p { margin: 0 auto 4px; max-width: 520px; color: var(--tqr-footer-text, var(--tqr-page-text, #E2E8F0)); }
  .tqr-credit { font-size: 12px; color: var(--tqr-footer-credit, color-mix(in srgb, var(--tqr-page-text, #E2E8F0) 54%, transparent)); }
  .tqr-socials { position: absolute; top: 18px; right: 0; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: center; }
  .tqr-social-link { display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; color: var(--tqr-footer-icon, var(--tqr-page-text, #E2E8F0)); background: transparent; text-decoration: none; transition: color 180ms ease, transform 180ms ease; }
  .tqr-social-link svg { width: 100%; height: 100%; display: block; }
  .tqr-social-link:hover { color: var(--tqr-accent, #2563EB); transform: translateY(-1px); }
  .tqr-powered { display: inline-flex; align-items: center; justify-content: center; gap: 8px; margin: 14px auto 0; padding: 0; border-radius: 0; color: var(--tqr-powered-text, color-mix(in srgb, var(--tqr-page-text, #E2E8F0) 62%, transparent)); background: transparent; border: 0; font-size: 11px; }
  .tqr-powered a { color: inherit; font-weight: 700; text-decoration: none; }
  .tqr-powered-logo { width: 20px; height: 20px; border-radius: 5px; object-fit: contain; display: block; }
  @media (min-width: 900px) {
    .tqr-hero { padding: 72px clamp(40px, 7vw, 104px) 58px; }
    .tqr-hero h1 { font-size: clamp(46px, 5vw, 72px); max-width: 920px; margin-inline: auto; }
    .tqr-hero p { max-width: 720px; font-size: 19px; }
    .tqr-timer { gap: 14px; }
    .tqr-timer > div { padding: 18px 14px; }
    .tqr-timer .num { font-size: 44px; }
    .tqr-products { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; }
    .tqr-product-name { font-size: 14px; padding: 12px 12px 3px; }
    .tqr-product-price { font-size: 12px; padding: 0 12px 12px; }
    .tqr-reviews { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .tqr-capture { padding: 28px; }
    .tqr-promo { font-size: 38px; }
  }
  @media (max-width: 767px) {
    body { padding: 0; }
    .tqr-page { width: 100%; max-width: none; padding: 0 12px 36px; }
    .tqr-section { border-radius: 10px; }
    .tqr-brand-bar { padding: 14px 14px 0; margin-bottom: -8px; }
    .tqr-brand-lockup { min-height: 38px; max-width: 100%; }
    .tqr-hero { padding: 38px 0 26px; }
    .tqr-hero h1 { font-size: clamp(30px, 10vw, 40px); }
    .tqr-hero p { font-size: 15px; max-width: 34rem; }
    .tqr-timer { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .tqr-capture form { flex-direction: column; }
    .tqr-capture input, .tqr-capture button { width: 100%; }
    .tqr-products { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .tqr-collection-card { grid-template-columns: 84px minmax(0, 1fr); }
    .tqr-reviews { grid-template-columns: 1fr; }
    .tqr-btn { width: 100%; text-align: center; }
    .tqr-footer-copy { padding-inline: 0; padding-top: 30px; }
    .tqr-footer-inner { align-items: center; flex-direction: column; }
    .tqr-socials { justify-content: flex-end; top: 14px; right: 0; }
  }
  @media (max-width: 420px) {
    .tqr-page { padding-inline: 10px; }
    .tqr-products { grid-template-columns: 1fr; }
    .tqr-timer { gap: 6px; }
    .tqr-timer > div { padding: 12px 8px; }
  }
`;
