import QRCode from "qrcode";
import type { QrCode, QrType } from "@prisma/client";
import { safeHexColor } from "./url-safety";

/* ─── Design / label shapes (stored as JSON on QrCode rows) ─── */
export interface QrDesign {
  style?: "square" | "rounded" | "dot" | "classy";
  cornerStyle?: "square" | "rounded" | "extra-rounded";
  fg?: string;
  bg?: string;
  withLogo?: boolean;
  logoBrand?: string | null;
  logoUrl?: string | null;
  logoAssetId?: string | null;
  /** Logo size as fraction of QR (e.g. 0.20 = 20%). Default 0.20. */
  logoSize?: number;
  /** Quiet zone in px at the 220px preview size (scaled with the output). Default 8. */
  margin?: number;
  /** Color of the 3 finder squares — defaults to fg. */
  cornerColor?: string;
  /** Linear gradient for the modules (overrides fg when set). */
  gradient?: {
    from: string;
    to:   string;
    angle?: number; // 0-360 degrees, default 45
  } | null;
}

export interface QrLabel {
  text?: string;
  position?: "none" | "top" | "bottom" | "left" | "right";
  framed?: boolean;
  /** Frame style (e.g. "polaroid", "header") — extends legacy `framed`. */
  frame?: string;
  /** Font id for the label. */
  font?: string;
  /** Rich-text formatting. */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
  /** Explicit text color inside the frame's text zone. */
  labelColor?: string;
  /** Explicit background fill of the frame's text zone band. */
  bandColor?: string;
}

export const DEFAULT_DESIGN: Required<Omit<QrDesign,
  "logoBrand" | "logoUrl" | "logoAssetId" | "gradient">> = {
  style: "rounded",
  cornerStyle: "rounded",
  fg: "#0B1220",
  bg: "#FFFFFF",
  withLogo: false,
  logoSize: 0.20,
  margin: 8,
  cornerColor: "#0B1220",
};

export const DEFAULT_LABEL: Required<Omit<QrLabel,
  "text" | "labelColor" | "bandColor" | "size" | "bold" | "italic" | "underline" | "align">> = {
  position: "bottom",
  framed: false,
  frame: "none",
  font: "",
};

/** Base URL encoded into every QR code (a stable short domain when configured). */
export function scanBaseUrl(appUrl?: string): string {
  return (appUrl ?? process.env.SCAN_BASE_URL ?? process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "");
}

/**
 * Public scan URL — the string actually encoded into the QR. Every QR points
 * through TrackQr so we can track + later redirect to the merchant's choice.
 * SCAN_BASE_URL (e.g. https://scan.yourbrand.com) keeps printed codes working
 * if the app host ever changes; it defaults to SHOPIFY_APP_URL.
 */
export function scanUrl(slug: string, appUrl?: string): string {
  const base = scanBaseUrl(appUrl);
  return base ? `${base}/s/${slug}` : `/s/${slug}`;
}

/**
 * Type of dispatch the /s/:slug route should perform.
 *   - "redirect"  → 302 to a real URL (http/https/tel/sms/mailto)
 *   - "landing"   → render an HTML landing page for non-URL payloads
 *                  (text content, wifi credentials, vcard contact)
 */
export type ScanDispatch =
  | { kind: "redirect"; url: string }
  | { kind: "landing"; type: "TEXT" | "WIFI" | "VCARD"; payload: string };

type RedirectQr = Pick<QrCode, "type" | "target" | "utmCampaign" | "utmSource" | "utmMedium"> & {
  utmTerm?: string | null;
  discountCode?: string | null;
};

/** Shopify cart permalink items: "123" or "123:2,456:1" → "123:1" / "123:2,456:1". */
export function cartPermalinkItems(target: string): string | null {
  const cleaned = target.trim().replace(/^\//, "").replace(/^cart\//, "");
  const items: string[] = [];
  for (const part of cleaned.split(",")) {
    const [id, qtyRaw] = part.trim().split(":");
    if (!/^\d+$/.test(id ?? "")) continue;
    const qty = Math.min(99, Math.max(1, Math.floor(Number(qtyRaw ?? "1")) || 1));
    items.push(`${id}:${qty}`);
  }
  return items.length ? items.join(",") : null;
}

/** Path of a store page from a handle, path or full URL ("/pages/about"). */
export function storePagePath(target: string): string {
  const raw = target.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      return `${u.pathname}${u.search}` || "/";
    } catch {
      return "/";
    }
  }
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return path.replace(/\/{2,}/g, "/");
}

function cleanDiscountCode(code: string | null | undefined): string | null {
  const c = (code ?? "").trim();
  return c ? c.slice(0, 255) : null;
}

/**
 * Resolve what the /s/:slug endpoint should do for this QR. UTM params are
 * appended when the destination is a real http(s) URL. On Shopify
 * destinations, `discountCode` is applied through /discount/CODE?redirect=…
 * (or the cart permalink ?discount= parameter).
 */
export function buildRedirectTarget(qr: RedirectQr, shopDomain: string): ScanDispatch {
  const store = `https://${shopDomain}`;
  const discount = cleanDiscountCode(qr.discountCode);
  // /discount/CODE drops its other query params: the UTMs travel inside `redirect`.
  const discountLink = (code: string, landing: string) => {
    const u = new URL(landing);
    return `${store}/discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent(`${u.pathname}${u.search}`)}`;
  };
  const onStore = (path: string) => {
    const landing = ensureUtm(`${store}${path}`, qr);
    return discount ? discountLink(discount, landing) : landing;
  };

  switch (qr.type) {
    case "HOME":
      return { kind: "redirect", url: onStore("/") };
    case "PRODUCT": {
      const handle = qr.target.trim().replace(/^\//, "").replace(/^products\//, "");
      return { kind: "redirect", url: onStore(`/products/${handle}`) };
    }
    case "COLLECTION": {
      const handle = qr.target.trim().replace(/^\//, "").replace(/^collections\//, "");
      return { kind: "redirect", url: onStore(`/collections/${handle}`) };
    }
    case "PAGE":
      return { kind: "redirect", url: onStore(storePagePath(qr.target)) };
    case "ATC": {
      // target: one numeric variant id ("42569231") or several with
      // quantities ("42569231:2,42569232:1"). Shopify cart permalink:
      // /cart/{variantId}:{qty},… — it accepts ?discount=CODE natively.
      const items = cartPermalinkItems(qr.target) ?? qr.target.trim();
      const url = new URL(ensureUtm(`${store}/cart/${items}`, qr));
      if (discount) url.searchParams.set("discount", discount);
      return { kind: "redirect", url: url.toString() };
    }
    case "PROMO": {
      const code = cleanDiscountCode(qr.target);
      return { kind: "redirect", url: code ? discountLink(code, ensureUtm(`${store}/`, qr)) : onStore("/") };
    }
    case "LINK":
    case "URL": {
      // Auto-add https:// if the merchant typed only the host part.
      const url = /^https?:\/\//i.test(qr.target) ? qr.target : `https://${qr.target}`;
      return { kind: "redirect", url: ensureUtm(url, qr) };
    }
    case "PHONE":
      return { kind: "redirect", url: `tel:${qr.target.replace(/[\s()-]/g, "")}` };
    case "SMS":
      return { kind: "redirect", url: `sms:${qr.target.replace(/[\s()-]/g, "")}` };
    case "EMAIL":
      return { kind: "redirect", url: `mailto:${qr.target.trim()}` };
    case "TEXT":
      return { kind: "landing", type: "TEXT",  payload: qr.target };
    case "WIFI":
      return { kind: "landing", type: "WIFI",  payload: qr.target };
    case "VCARD":
      return { kind: "landing", type: "VCARD", payload: qr.target };
    default:
      return { kind: "redirect", url: qr.target };
  }
}

export { withScanAttribution } from "./attribution-links";

type UtmFields = { utmCampaign?: string | null; utmSource?: string | null; utmMedium?: string | null; utmTerm?: string | null };

/** Append the QR code's UTM parameters to an http(s) URL. */
export function ensureUtm(url: string, qr: UtmFields): string {
  if (!qr.utmCampaign && !qr.utmSource && !qr.utmMedium && !qr.utmTerm) return url;
  if (!url.startsWith("http")) return url;
  try {
    const u = new URL(url);
    if (qr.utmCampaign) u.searchParams.set("utm_campaign", qr.utmCampaign);
    if (qr.utmSource)   u.searchParams.set("utm_source",   qr.utmSource);
    if (qr.utmMedium)   u.searchParams.set("utm_medium",   qr.utmMedium);
    if (qr.utmTerm)     u.searchParams.set("utm_term",     qr.utmTerm);
    return u.toString();
  } catch {
    return url;
  }
}

/* ──────────── Server-side QR rendering ──────────── */

/**
 * PNG buffer via node-qrcode — plain modules in the design colors. Used for
 * images embedded in emails / packing slips, where a raster is required.
 * The styled rendering lives in qr-render.ts (SVG).
 */
export async function renderQrPng(text: string, design: QrDesign = {}, size = 1024): Promise<Buffer> {
  const d = { ...DEFAULT_DESIGN, ...design };
  return QRCode.toBuffer(text || "TrackQr placeholder", {
    type: "png",
    width: size,
    margin: 2,
    errorCorrectionLevel: d.withLogo ? "H" : "M",
    color: { dark: safeHexColor(d.fg, DEFAULT_DESIGN.fg), light: safeHexColor(d.bg, DEFAULT_DESIGN.bg) },
  });
}

/**
 * Minimal vector PDF — emits the QR as filled rectangles directly to a PDF
 * content stream. Avoids shipping pdfkit (~6MB dep) for a single-page output.
 * Output is an A6-ish 200pt square page.
 */
export function renderQrPdf(text: string, design: QrDesign = {}): Buffer {
  const d = { ...DEFAULT_DESIGN, ...design };
  const size = 400; // pt — final page size
  const margin = 24;
  const qr = QRCode.create(text || "TrackQr placeholder", { errorCorrectionLevel: d.withLogo ? "H" : "M" });
  const count = qr.modules.size;
  const data = qr.modules.data;
  const cell = (size - margin * 2) / count;

  const fgRgb = hexToRgb(d.fg);
  const bgRgb = hexToRgb(d.bg);

  const ops: string[] = [];
  // background
  ops.push(`${bgRgb} rg`);
  ops.push(`0 0 ${size} ${size} re f`);
  // modules
  ops.push(`${fgRgb} rg`);
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!data[r * count + c]) continue;
      const x = margin + c * cell;
      // PDF y origin is bottom-left
      const y = size - margin - (r + 1) * cell;
      ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`);
    }
  }
  const content = ops.join("\n");

  return assemblePdf(size, content);
}

function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "0 0 0";
  return `${(parseInt(m[1], 16) / 255).toFixed(3)} ${(parseInt(m[2], 16) / 255).toFixed(3)} ${(parseInt(m[3], 16) / 255).toFixed(3)}`;
}

/** Tiny PDF 1.4 builder for a single-page content stream. */
function assemblePdf(size: number, content: string): Buffer {
  const stream = Buffer.from(content, "utf8");
  const objects: string[] = [];
  const offsets: number[] = [];
  const header = "%PDF-1.4\n%âãÏÓ\n";

  // 1: Catalog
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  // 2: Pages
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`);
  // 3: Page
  objects.push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size} ${size}] /Contents 4 0 R /Resources << >> >>\nendobj\n`);
  // 4: Content stream
  objects.push(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${content}\nendstream\nendobj\n`);

  let body = header;
  for (const o of objects) {
    offsets.push(Buffer.byteLength(body, "binary"));
    body += o;
  }
  const xrefStart = Buffer.byteLength(body, "binary");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(body + xref + trailer, "binary");
}

/* ──────────── Type / validation helpers ──────────── */

export const QR_TYPES_ENUM = [
  "HOME", "PRODUCT", "COLLECTION", "PAGE", "LINK", "ATC", "PROMO",
  "URL", "TEXT", "PHONE", "SMS", "EMAIL", "WIFI", "VCARD",
] as const satisfies readonly QrType[];

// Re-export shared constants so existing imports keep working.
export { QR_TYPE_FROM_UI, QR_TYPE_TO_UI, parseQrType } from "./qr-types";
