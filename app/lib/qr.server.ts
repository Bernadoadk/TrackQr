import QRCode from "qrcode";
import type { QrCode, QrType } from "@prisma/client";

/* ─── Design / label shapes (stored as JSON on QrCode rows) ─── */
export interface QrDesign {
  style?: "square" | "rounded" | "dot" | "classy";
  cornerStyle?: "square" | "rounded" | "extra-rounded";
  fg?: string;
  bg?: string;
  withLogo?: boolean;
  logoAssetId?: string | null;
}

export interface QrLabel {
  text?: string;
  position?: "none" | "top" | "bottom" | "left" | "right";
  tone?: "default" | "brand" | "mono" | "muted";
  framed?: boolean;
}

export const DEFAULT_DESIGN: Required<Omit<QrDesign, "logoAssetId">> = {
  style: "rounded",
  cornerStyle: "rounded",
  fg: "#0B1220",
  bg: "#FFFFFF",
  withLogo: false,
};

export const DEFAULT_LABEL: Required<Omit<QrLabel, "text">> = {
  position: "bottom",
  tone: "default",
  framed: false,
};

/**
 * Public scan URL — the string actually encoded into the QR. Every QR points
 * through TrackQr so we can track + later redirect to the merchant's choice.
 */
export function scanUrl(slug: string, appUrl?: string): string {
  const base = (appUrl ?? process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "");
  return base ? `${base}/s/${slug}` : `/s/${slug}`;
}

/**
 * Compute the merchant-facing redirect target for a QR. UTM params are
 * appended when present and the destination is a URL.
 */
export function buildRedirectTarget(qr: Pick<QrCode, "type" | "target" | "utmCampaign" | "utmSource" | "utmMedium">, shopDomain: string): string {
  switch (qr.type) {
    case "HOME":
      return ensureUtm(`https://${shopDomain}/`, qr);
    case "PRODUCT": {
      // target stored as "handle:aurora-tee" or full path
      const t = qr.target.startsWith("/") ? qr.target : `/products/${qr.target}`;
      return ensureUtm(`https://${shopDomain}${t}`, qr);
    }
    case "ATC": {
      // target stored as "variantId:42" or already as /cart/add
      const t = qr.target.startsWith("/") ? qr.target : `/cart/${qr.target}:1`;
      return ensureUtm(`https://${shopDomain}${t}`, qr);
    }
    case "PROMO": {
      const code = encodeURIComponent(qr.target);
      return ensureUtm(`https://${shopDomain}/discount/${code}`, qr);
    }
    case "LINK":
    case "URL":
      return ensureUtm(qr.target, qr);
    case "PHONE":
      return `tel:${qr.target.replace(/\s+/g, "")}`;
    case "SMS":
      return `sms:${qr.target.replace(/\s+/g, "")}`;
    case "EMAIL":
      return `mailto:${qr.target}`;
    case "TEXT":
      // text type — encode directly in the QR (no redirect target). Return the text as data URL fallback.
      return `data:text/plain,${encodeURIComponent(qr.target)}`;
    case "WIFI":
      // WIFI: SSID|PASSWORD format stored in target
      return qr.target;
    case "VCARD":
      return qr.target;
    default:
      return qr.target;
  }
}

function ensureUtm(url: string, qr: { utmCampaign?: string | null; utmSource?: string | null; utmMedium?: string | null }): string {
  if (!qr.utmCampaign && !qr.utmSource && !qr.utmMedium) return url;
  if (!url.startsWith("http")) return url;
  try {
    const u = new URL(url);
    if (qr.utmCampaign) u.searchParams.set("utm_campaign", qr.utmCampaign);
    if (qr.utmSource)   u.searchParams.set("utm_source",   qr.utmSource);
    if (qr.utmMedium)   u.searchParams.set("utm_medium",   qr.utmMedium);
    return u.toString();
  } catch {
    return url;
  }
}

/* ──────────── Server-side QR rendering ──────────── */

/**
 * Custom SVG generator — port of the client-side generateQrSvg used in
 * app.create.tsx. Uses node-qrcode's `create()` to get the bit matrix, then
 * emits styled SVG matching the chosen pattern + finder style.
 */
export function renderQrSvg(text: string, design: QrDesign = {}, size = 512): string {
  const d = { ...DEFAULT_DESIGN, ...design };
  const margin = 16;
  const qr = QRCode.create(text || "TrackQr placeholder", { errorCorrectionLevel: d.withLogo ? "H" : "M" });
  const count: number = qr.modules.size;
  const data = qr.modules.data;
  const cell = (size - margin * 2) / count;

  const radius =
    d.style === "dot"     ? cell * 0.45 :
    d.style === "rounded" ? cell * 0.30 :
    d.style === "classy"  ? cell * 0.18 : 0;

  const isFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);

  const modules: string[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!data[r * count + c]) continue;
      if (isFinder(r, c)) continue;
      const x = margin + c * cell;
      const y = margin + r * cell;
      if (d.style === "dot") {
        modules.push(`<circle cx="${(x + cell / 2).toFixed(2)}" cy="${(y + cell / 2).toFixed(2)}" r="${(cell * 0.42).toFixed(2)}"/>`);
      } else if (radius > 0) {
        modules.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="${radius.toFixed(2)}"/>`);
      } else {
        modules.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`);
      }
    }
  }

  const fr = d.cornerStyle === "rounded" ? cell * 1.3 : d.cornerStyle === "extra-rounded" ? cell * 2 : 0;
  const corners: [number, number][] = [[0, 0], [count - 7, 0], [0, count - 7]];
  const finders: string[] = [];
  for (const [cc, rr] of corners) {
    const x = margin + cc * cell;
    const y = margin + rr * cell;
    const outer = cell * 7;
    finders.push(`<rect x="${x}" y="${y}" width="${outer}" height="${outer}" rx="${fr}" fill="${d.fg}"/>`);
    finders.push(`<rect x="${x + cell}" y="${y + cell}" width="${cell * 5}" height="${cell * 5}" rx="${Math.max(0, fr - cell)}" fill="${d.bg}"/>`);
    finders.push(`<rect x="${x + cell * 2}" y="${y + cell * 2}" width="${cell * 3}" height="${cell * 3}" rx="${Math.max(0, fr - cell * 2)}" fill="${d.fg}"/>`);
  }

  const logo = d.withLogo
    ? `<g transform="translate(${size / 2 - 36}, ${size / 2 - 36})"><rect width="72" height="72" rx="14" fill="${d.bg}" stroke="${d.fg}" stroke-width="1"/><rect x="8" y="8" width="56" height="56" rx="10" fill="${d.fg}"/></g>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="${d.bg}"/>
  <g fill="${d.fg}">${modules.join("")}</g>
  ${finders.join("")}
  ${logo}
</svg>`;
}

/** PNG buffer via node-qrcode. Style is approximate (full styling lives in SVG). */
export async function renderQrPng(text: string, design: QrDesign = {}, size = 1024): Promise<Buffer> {
  const d = { ...DEFAULT_DESIGN, ...design };
  return QRCode.toBuffer(text || "TrackQr placeholder", {
    type: "png",
    width: size,
    margin: 2,
    errorCorrectionLevel: d.withLogo ? "H" : "M",
    color: { dark: d.fg, light: d.bg },
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
  "HOME", "PRODUCT", "LINK", "ATC", "PROMO",
  "URL", "TEXT", "PHONE", "SMS", "EMAIL", "WIFI", "VCARD",
] as const satisfies readonly QrType[];

// Re-export shared constants so existing imports keep working.
export { QR_TYPE_FROM_UI, QR_TYPE_TO_UI, parseQrType } from "./qr-types";
