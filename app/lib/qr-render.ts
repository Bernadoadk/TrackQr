import QRCode from "qrcode";
import { getLabelFont } from "./label-fonts";

/**
 * Shared QR-to-SVG renderer used by BOTH server (download routes) and client
 * (Create page live preview). Same library on both sides = identical visuals.
 * No `.server.ts` suffix because we want to bundle this for the browser.
 */

export type QrStyle      = "square" | "rounded" | "dot" | "classy";
export type CornerStyle  = "square" | "rounded" | "extra-rounded";
export type LabelPosition = "none" | "top" | "bottom" | "left" | "right";

export type FrameStyle =
  | "none"
  | "outline"
  | "double"
  | "sharp"
  | "notched"
  | "cut"
  | "brackets"
  | "scallop"
  // Position-aware frames (need a label position to look right)
  | "polaroid"   // thick band on label side, label sits in it
  | "banner"     // pointed ribbon shape on label side
  | "ticket"     // outline + perforated separator on label side
  | "header";    // filled colored band on label side (label = inverted color)

export const FRAME_STYLES: FrameStyle[] = [
  "none", "outline", "double", "sharp", "cut",
  "notched", "brackets", "scallop",
  "polaroid", "banner", "ticket", "header",
];

export const FRAME_LABEL: Record<FrameStyle, string> = {
  none:     "None",
  outline:  "Outline",
  double:   "Double",
  sharp:    "Sharp",
  cut:      "Cut",
  notched:  "Notched",
  brackets: "Brackets",
  scallop:  "Scallop",
  polaroid: "Polaroid",
  banner:   "Banner",
  ticket:   "Ticket",
  header:   "Header",
};

/** Frames that have a designated text zone — only meaningful when a label position is set. */
export const FRAMES_WITH_LABEL_ZONE: FrameStyle[] = ["polaroid", "banner", "ticket", "header"];

/** Frames that work as pure decoration — fine without a label. */
export const FRAMES_DECORATIVE: FrameStyle[] = [
  "none", "outline", "double", "sharp", "cut", "notched", "brackets", "scallop",
];

/** Filter the catalog by current label position. */
export function framesForPosition(pos?: LabelPosition): FrameStyle[] {
  if (!pos || pos === "none") return FRAMES_DECORATIVE;
  return ["none", "outline", ...FRAMES_WITH_LABEL_ZONE];
}

/** True when the chosen frame style overlays a dark band where the label sits. */
export function frameInvertsLabel(style: FrameStyle): boolean {
  return style === "header" || style === "banner";
}

export interface QrLabelOpts {
  text?: string;
  position?: LabelPosition;
  /** Frame style. Legacy boolean `framed` maps to "outline" / "none". */
  frame?: FrameStyle;
  /** Optional explicit frame color. Defaults to the QR fg. */
  frameColor?: string;
  /** Explicit label text color (for frames with a text zone). When unset,
   *  defaults derive from the QR fg / bg + frame inversion. */
  labelColor?: string;
  /** Explicit text-zone band fill color (header/banner/polaroid). Defaults
   *  to the frame color. Ignored by frames without a band fill. */
  bandColor?: string;
  /** Font id (matches LABEL_FONTS in app/lib/label-fonts). */
  font?: string;
  /** Rich-text formatting from the Label section's inline toolbar. */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
}

type FrameSide = "top" | "bottom" | "left" | "right";

function sideFromLabelPos(pos?: LabelPosition): FrameSide {
  if (pos === "top" || pos === "left" || pos === "right") return pos;
  return "bottom";
}

/**
 * Generate just the frame as a self-contained SVG (no QR, no label).
 * Position-aware: when `labelPosition` is set, frames with a text zone
 * (polaroid, banner, ticket, header) draw the zone on that side.
 */
export function renderFrameSvg(style: FrameStyle, opts: {
  width: number; height: number;
  color: string;
  bg?: string;
  inset?: number;
  strokeWidth?: number;
  labelPosition?: LabelPosition;
  /** Pixels reserved for label band when applicable. */
  bandSize?: number;
  /** Extra inward offset between the frame inner edge and the band — used
   *  so the band sits flush with the CSS-grid label cell rather than the
   *  frame's outer outline. */
  bandOffset?: number;
  /** Fill color for the label-zone band (header, banner, polaroid).
   *  Defaults to `color` (the frame outline color). */
  bandColor?: string;
}): string {
  const { width: w, height: h, color, bg = "transparent", inset = 6 } = opts;
  const sw = opts.strokeWidth ?? 1.6;
  const band = opts.bandSize ?? 44;
  const off = opts.bandOffset ?? 0;
  const bandColor = opts.bandColor ?? color;
  const x = inset, y = inset, w2 = w - inset * 2, h2 = h - inset * 2;
  const side = sideFromLabelPos(opts.labelPosition);

  if (style === "none") {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"></svg>`;
  }

  let body = "";
  switch (style) {
    case "outline":
      body = `<rect x="${x}" y="${y}" width="${w2}" height="${h2}" rx="14" fill="${bg}" stroke="${color}" stroke-width="${sw}"/>`;
      break;

    case "sharp":
      body = `<rect x="${x}" y="${y}" width="${w2}" height="${h2}" rx="0" fill="${bg}" stroke="${color}" stroke-width="${sw}"/>`;
      break;

    case "double": {
      const gap = 4;
      body =
        `<rect x="${x}" y="${y}" width="${w2}" height="${h2}" rx="14" fill="${bg}" stroke="${color}" stroke-width="${sw}"/>` +
        `<rect x="${x + gap}" y="${y + gap}" width="${w2 - gap * 2}" height="${h2 - gap * 2}" rx="${Math.max(0, 14 - gap)}" fill="none" stroke="${color}" stroke-width="${sw * 0.7}"/>`;
      break;
    }

    case "notched": {
      const c = 8;
      body =
        `<rect x="${x}" y="${y}" width="${w2}" height="${h2}" rx="14" fill="${bg}" stroke="${color}" stroke-width="${sw}"/>` +
        `<rect x="${x + 6}" y="${y + 6}" width="${c}" height="${c}" fill="${color}"/>` +
        `<rect x="${x + w2 - 6 - c}" y="${y + 6}" width="${c}" height="${c}" fill="${color}"/>` +
        `<rect x="${x + 6}" y="${y + h2 - 6 - c}" width="${c}" height="${c}" fill="${color}"/>` +
        `<rect x="${x + w2 - 6 - c}" y="${y + h2 - 6 - c}" width="${c}" height="${c}" fill="${color}"/>`;
      break;
    }

    case "cut": {
      const cut = 14;
      const x2 = x + w2, y2 = y + h2;
      const pts = [
        [x + cut, y], [x2 - cut, y],
        [x2, y + cut], [x2, y2 - cut],
        [x2 - cut, y2], [x + cut, y2],
        [x, y2 - cut], [x, y + cut],
      ];
      body = `<polygon points="${pts.map(([px, py]) => `${px},${py}`).join(" ")}" fill="${bg}" stroke="${color}" stroke-width="${sw}"/>`;
      break;
    }

    case "brackets": {
      const a = 22;
      const x2 = x + w2, y2 = y + h2;
      body =
        `<path d="M${x} ${y + a} L${x} ${y} L${x + a} ${y}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>` +
        `<path d="M${x2 - a} ${y} L${x2} ${y} L${x2} ${y + a}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>` +
        `<path d="M${x} ${y2 - a} L${x} ${y2} L${x + a} ${y2}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>` +
        `<path d="M${x2 - a} ${y2} L${x2} ${y2} L${x2} ${y2 - a}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
      break;
    }

    case "scallop": {
      const r = 5;
      const step = 14;
      const scallops: string[] = [];
      for (let cx = x + step; cx < x + w2 - step / 2; cx += step) {
        scallops.push(`<circle cx="${cx}" cy="${y}"     r="${r}" fill="${bg}" stroke="${color}" stroke-width="${sw * 0.7}"/>`);
        scallops.push(`<circle cx="${cx}" cy="${y + h2}" r="${r}" fill="${bg}" stroke="${color}" stroke-width="${sw * 0.7}"/>`);
      }
      for (let cy = y + step; cy < y + h2 - step / 2; cy += step) {
        scallops.push(`<circle cx="${x}"     cy="${cy}" r="${r}" fill="${bg}" stroke="${color}" stroke-width="${sw * 0.7}"/>`);
        scallops.push(`<circle cx="${x + w2}" cy="${cy}" r="${r}" fill="${bg}" stroke="${color}" stroke-width="${sw * 0.7}"/>`);
      }
      body =
        `<rect x="${x}" y="${y}" width="${w2}" height="${h2}" rx="6" fill="${bg}" stroke="${color}" stroke-width="${sw}"/>` +
        scallops.join("");
      break;
    }

    /* ── Position-aware: text-zone frames ── */

    case "polaroid": {
      // Outline + tinted band on label side. Uses bandColor at lower opacity
      // when it matches the outline; full opacity when it's customized so the
      // user actually sees their picked color.
      const { bx, by, bw, bh } = bandRect(side, x, y, w2, h2, band, off);
      const bandOpacity = bandColor === color ? 0.08 : 1;
      body =
        `<rect x="${x}" y="${y}" width="${w2}" height="${h2}" rx="6" fill="${bg}" stroke="${color}" stroke-width="${sw}"/>` +
        `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${bandColor}" opacity="${bandOpacity}"/>` +
        separatorLine(side, x, y, w2, h2, band, color, sw * 0.7, undefined, off);
      break;
    }

    case "header": {
      // Filled solid band on label side. Text inside should use the bg color.
      const { bx, by, bw, bh } = bandRect(side, x, y, w2, h2, band, off);
      body =
        `<rect x="${x}" y="${y}" width="${w2}" height="${h2}" rx="10" fill="${bg}" stroke="${color}" stroke-width="${sw}"/>` +
        `<path d="${roundedBandPath(side, bx, by, bw, bh, 10)}" fill="${bandColor}"/>`;
      break;
    }

    case "banner": {
      // Outline + ribbon shape (pointed end) on label side, drawn behind the label.
      const { bx, by, bw, bh } = bandRect(side, x, y, w2, h2, band, off);
      body =
        `<rect x="${x}" y="${y}" width="${w2}" height="${h2}" rx="10" fill="${bg}" stroke="${color}" stroke-width="${sw}"/>` +
        `<path d="${ribbonPath(side, bx, by, bw, bh)}" fill="${bandColor}"/>`;
      break;
    }

    case "ticket": {
      // Outline + perforated dashed separator parallel to the label edge.
      body = `<rect x="${x}" y="${y}" width="${w2}" height="${h2}" rx="14" fill="${bg}" stroke="${color}" stroke-width="${sw}"/>` +
        separatorLine(side, x, y, w2, h2, band, color, sw, "3 4", off);
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
}

/**
 * Helper: compute the band rectangle on the given side.
 *
 * `band` is the width of the label cell itself (text + cell padding).
 * `offset` is the gap between the frame's inner outline edge and the label
 * cell's outer edge — needed because the stage CSS padding is larger than
 * the frame SVG inset.
 *
 * The band extends from the label cell's INNER edge (toward the QR) ALL THE
 * WAY to the frame's inner outline edge — so the colored area fully covers
 * the cell + the offset gap, without any visible uncolored strip.
 */
function bandRect(side: FrameSide, x: number, y: number, w: number, h: number, band: number, offset = 0): { bx: number; by: number; bw: number; bh: number } {
  switch (side) {
    // Top: band starts at the frame inner top, extends down past the label cell.
    case "top":    return { bx: x,                       by: y,                          bw: w,             bh: band + offset };
    // Bottom: band starts at label cell top, extends down to frame inner bottom.
    case "bottom": return { bx: x,                       by: y + h - band - offset,      bw: w,             bh: band + offset };
    // Left: band starts at frame inner left, extends right past label cell.
    case "left":   return { bx: x,                       by: y,                          bw: band + offset, bh: h };
    // Right: band starts at label cell left, extends right to frame inner right.
    case "right":  return { bx: x + w - band - offset,   by: y,                          bw: band + offset, bh: h };
  }
}

/** Helper: draw the separator line at the inner edge of the band. */
function separatorLine(side: FrameSide, x: number, y: number, w: number, h: number, band: number, color: string, sw: number, dash?: string, offset = 0): string {
  let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  switch (side) {
    case "top":    x1 = x;                       y1 = y + band + offset;       x2 = x + w; y2 = y1; break;
    case "bottom": x1 = x;                       y1 = y + h - band - offset;   x2 = x + w; y2 = y1; break;
    case "left":   x1 = x + band + offset;       y1 = y; x2 = x1; y2 = y + h; break;
    case "right":  x1 = x + w - band - offset;   y1 = y; x2 = x1; y2 = y + h; break;
  }
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
}

/**
 * Rounded-band path. The band sits flush against one outer edge of the frame
 * (so 2 corners are rounded, the 2 inner corners are square).
 */
function roundedBandPath(side: FrameSide, x: number, y: number, w: number, h: number, r: number): string {
  switch (side) {
    case "top":    return `M${x} ${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} L${x + w - r} ${y} A${r} ${r} 0 0 1 ${x + w} ${y + r} L${x + w} ${y + h} L${x} ${y + h} Z`;
    case "bottom": return `M${x} ${y} L${x + w} ${y} L${x + w} ${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} L${x + r} ${y + h} A${r} ${r} 0 0 1 ${x} ${y + h - r} Z`;
    case "left":   return `M${x + r} ${y} L${x + w} ${y} L${x + w} ${y + h} L${x + r} ${y + h} A${r} ${r} 0 0 1 ${x} ${y + h - r} L${x} ${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
    case "right":  return `M${x} ${y} L${x + w - r} ${y} A${r} ${r} 0 0 1 ${x + w} ${y + r} L${x + w} ${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} L${x} ${y + h} Z`;
  }
}

/**
 * Ribbon path — like a banner with a pointed/chevron tip pointing INTO the QR area.
 * Yields a flag/ribbon shape on the label side.
 */
function ribbonPath(side: FrameSide, x: number, y: number, w: number, h: number): string {
  const tip = 12;
  switch (side) {
    case "top":    return `M${x} ${y} L${x + w} ${y} L${x + w} ${y + h} L${x + w / 2 + tip} ${y + h} L${x + w / 2} ${y + h - tip} L${x + w / 2 - tip} ${y + h} L${x} ${y + h} Z`;
    case "bottom": return `M${x} ${y + h} L${x + w} ${y + h} L${x + w} ${y} L${x + w / 2 + tip} ${y} L${x + w / 2} ${y + tip} L${x + w / 2 - tip} ${y} L${x} ${y} Z`;
    case "left":   return `M${x} ${y} L${x + w} ${y} L${x + w} ${y + h / 2 - tip} L${x + w - tip} ${y + h / 2} L${x + w} ${y + h / 2 + tip} L${x + w} ${y + h} L${x} ${y + h} Z`;
    case "right":  return `M${x + w} ${y} L${x} ${y} L${x} ${y + h / 2 - tip} L${x + tip} ${y + h / 2} L${x} ${y + h / 2 + tip} L${x} ${y + h} L${x + w} ${y + h} Z`;
  }
}

/** Encode the frame SVG as a data URL for use as a CSS background-image. */
export function frameDataUrl(style: FrameStyle, w: number, h: number, color: string, bg = "transparent", labelPosition?: LabelPosition): string {
  const svg = renderFrameSvg(style, { width: w, height: h, color, bg, labelPosition });
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface QrRenderOpts {
  size?: number;
  /** Quiet-zone margin in pixels. Default 8. */
  margin?: number;
  fg?: string;
  bg?: string;
  style?: QrStyle;
  cornerStyle?: CornerStyle;
  withLogo?: boolean;
  logoDataUrl?: string;
  /** Logo size as fraction of QR size (0.10–0.30). Default 0.20. */
  logoSize?: number;
  /** Color of the 3 finder squares. Defaults to fg. */
  cornerColor?: string;
  /** Linear gradient for the modules + finders. Overrides flat fg when set. */
  gradient?: { from: string; to: string; angle?: number } | null;
  /** Optional label + frame. When set, output is a composed SVG (not bare QR). */
  label?: QrLabelOpts;
}

const DEFAULTS: Required<Pick<QrRenderOpts, "fg" | "bg" | "style" | "cornerStyle" | "withLogo">> = {
  fg: "#0B1220",
  bg: "#FFFFFF",
  style: "rounded",
  cornerStyle: "rounded",
  withLogo: false,
};

export function renderQrSvg(text: string, opts: QrRenderOpts = {}): string {
  const o = { ...DEFAULTS, ...opts };
  const size = opts.size ?? 220;
  const margin = opts.margin ?? 8;
  const logoSize = opts.logoSize ?? 0.20;
  const cornerColor = opts.cornerColor ?? o.fg;
  const gradient = opts.gradient ?? null;
  // Stable id for the SVG gradient def (avoids collisions across multiple
  // QR SVGs on the same page — uses size+colors as a poor-man's hash).
  const gradId = gradient
    ? `g-${(text.length + size).toString(36)}-${gradient.from.slice(1)}-${gradient.to.slice(1)}`
    : null;

  const qr = QRCode.create(text || "TrackQr placeholder", {
    errorCorrectionLevel: o.withLogo ? "H" : "M",
  });
  const count: number = qr.modules.size;
  const data = qr.modules.data;
  const cell = (size - margin * 2) / count;

  const radius =
    o.style === "dot"     ? cell * 0.45 :
    o.style === "rounded" ? cell * 0.30 :
    o.style === "classy"  ? cell * 0.18 : 0;

  const isFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);

  let modules = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!data[r * count + c]) continue;
      if (isFinder(r, c)) continue;
      const x = margin + c * cell;
      const y = margin + r * cell;
      if (o.style === "dot") {
        modules += `<circle cx="${(x + cell / 2).toFixed(2)}" cy="${(y + cell / 2).toFixed(2)}" r="${(cell * 0.42).toFixed(2)}"/>`;
      } else if (radius > 0) {
        modules += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="${radius.toFixed(2)}"/>`;
      } else {
        modules += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
      }
    }
  }

  const fr = o.cornerStyle === "rounded" ? cell * 1.3 : o.cornerStyle === "extra-rounded" ? cell * 2 : 0;
  const corners: [number, number][] = [[0, 0], [count - 7, 0], [0, count - 7]];
  let finders = "";
  for (const [cc, rr] of corners) {
    const x = margin + cc * cell;
    const y = margin + rr * cell;
    const outer = cell * 7;
    finders += `<rect x="${x}" y="${y}" width="${outer}" height="${outer}" rx="${fr}" fill="${cornerColor}"/>`;
    finders += `<rect x="${x + cell}" y="${y + cell}" width="${cell * 5}" height="${cell * 5}" rx="${Math.max(0, fr - cell)}" fill="${o.bg}"/>`;
    finders += `<rect x="${x + cell * 2}" y="${y + cell * 2}" width="${cell * 3}" height="${cell * 3}" rx="${Math.max(0, fr - cell * 2)}" fill="${cornerColor}"/>`;
  }

  // Logo: prefer a passed-in data URL (e.g. from logoSvgDataUrl), else the
  // small built-in placeholder rectangle when `withLogo` is true.
  // Size is `logoSize` (0.10–0.30) fraction of the QR.
  let logo = "";
  if (opts.logoDataUrl) {
    const ls = Math.round(size * logoSize);
    const lx = (size - ls) / 2;
    const ly = (size - ls) / 2;
    const pad = Math.max(2, Math.round(size * 0.018));
    logo =
      `<rect x="${lx - pad}" y="${ly - pad}" width="${ls + pad * 2}" height="${ls + pad * 2}" rx="${Math.max(4, ls * 0.18)}" fill="${o.bg}"/>` +
      `<image href="${escapeXmlAttr(opts.logoDataUrl)}" x="${lx}" y="${ly}" width="${ls}" height="${ls}" preserveAspectRatio="xMidYMid meet"/>`;
  } else if (o.withLogo) {
    const ls = Math.round(size * logoSize);
    const half = ls / 2;
    logo = `<g transform="translate(${size / 2 - half}, ${size / 2 - half})"><rect width="${ls}" height="${ls}" rx="${ls * 0.22}" fill="${o.bg}" stroke="${o.fg}" stroke-width="0.5"/><rect x="${ls * 0.11}" y="${ls * 0.11}" width="${ls * 0.78}" height="${ls * 0.78}" rx="${ls * 0.17}" fill="${o.fg}"/></g>`;
  }

  // Gradient def — used by both modules (<g>) and finders if active.
  // Angle is in degrees; convert to x1/y1/x2/y2 in the 0-1 box.
  let gradientDef = "";
  let modulesFill = o.fg;
  if (gradient && gradId) {
    const ang = ((gradient.angle ?? 45) * Math.PI) / 180;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    // Map angle to gradient stops in object bounding box.
    const x1 = 0.5 - cos * 0.5, y1 = 0.5 - sin * 0.5;
    const x2 = 0.5 + cos * 0.5, y2 = 0.5 + sin * 0.5;
    gradientDef =
      `<defs><linearGradient id="${gradId}" x1="${x1.toFixed(3)}" y1="${y1.toFixed(3)}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(3)}">` +
      `<stop offset="0%" stop-color="${gradient.from}"/>` +
      `<stop offset="100%" stop-color="${gradient.to}"/>` +
      `</linearGradient></defs>`;
    modulesFill = `url(#${gradId})`;
    // Replace the cornerColor fills in `finders` with gradient when corners
    // weren't explicitly overridden by the user (i.e. they match fg).
    if (cornerColor === o.fg) {
      finders = finders.split(`fill="${cornerColor}"`).join(`fill="url(#${gradId})"`);
    }
  }

  const innerSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%" height="100%">
  <rect width="${size}" height="${size}" fill="${o.bg}"/>
  ${gradientDef}
  <g fill="${modulesFill}">${modules}</g>
  ${finders}
  ${logo}
</svg>`;

  // Resolve the frame style — accept both new `frame` and legacy `framed` boolean.
  const label = opts.label ?? {};
  const labelFrame: FrameStyle =
    label.frame ??
    ((label as { framed?: boolean }).framed ? "outline" : "none");

  const hasLabel = !!(label.text && label.position && label.position !== "none");
  const hasFrame = labelFrame !== "none";
  if (!opts.label && !hasLabel && !hasFrame) return innerSvg;

  return wrapWithLabelAndFrame(innerSvg, size, o.bg, o.fg, { ...label, frame: labelFrame });
}

/**
 * Compose a wrapper SVG containing the QR + a text label (top/bottom/left/right)
 * and an optional outer frame. Output dimensions adapt to the position.
 */
function wrapWithLabelAndFrame(qrSvg: string, qrSize: number, bg: string, fg: string, label: QrLabelOpts): string {
  const text = label.text ?? "";
  const pos  = label.position ?? "none";
  const frameStyle: FrameStyle =
    label.frame ??
    ((label as { framed?: boolean }).framed ? "outline" : "none");
  const framed = frameStyle !== "none";
  const frameColor = label.frameColor ?? fg;
  const fontSpec = getLabelFont(label.font);
  const scale = qrSize / 220;
  const qrBox = (pos === "left" || pos === "right") ? 160 * scale : 200 * scale;
  const qrCol = (pos === "left" || pos === "right") ? 200 * scale : qrBox;
  const gap = (text && pos !== "none") ? 16 * scale : 0;
  const pad = framed
    ? (pos === "left" || pos === "right"
      ? { top: 32 * scale, right: 28 * scale, bottom: 32 * scale, left: 28 * scale }
      : pos === "top" || pos === "bottom"
        ? { top: 28 * scale, right: 32 * scale, bottom: 32 * scale, left: 32 * scale }
        : { top: 32 * scale, right: 32 * scale, bottom: 32 * scale, left: 32 * scale })
    : { top: 24 * scale, right: 24 * scale, bottom: 24 * scale, left: 24 * scale };

  // Font stack respects the user's picked font.
  const fontStack = fontSpec.family;
  // Honor the rich-text toolbar size; fall back to the position default.
  const fontSize = (label.size ?? (pos === "left" || pos === "right" ? 14 : 18)) * scale;
  // Bold from the toolbar wins over the font's natural weight.
  const fontWeight = label.bold ? 700 : (fontSpec.weight ?? 600);
  const fontStyle  = label.italic ? "italic" : "normal";
  const decoration = label.underline ? "underline" : "none";
  const transform = [
    fontSpec.letterSpacing ? `letter-spacing:${fontSpec.letterSpacing};` : "",
    fontSpec.textTransform ? `text-transform:${fontSpec.textTransform};` : "",
    `font-style:${fontStyle};`,
    `text-decoration:${decoration};`,
  ].filter(Boolean).join("");
  // For frames that overlay a dark band where the label sits (header, banner),
  // invert the label color so it stays readable against the band fill.
  // When the user has explicitly picked a `labelColor`, that always wins.
  const inverted = frameInvertsLabel(frameStyle);
  const baseColor = inverted ? bg : fg;
  const color = label.labelColor ?? baseColor;
  const align = label.align ?? "center";

  const labelBoxW = (pos === "left" || pos === "right") ? 180 * scale : 200 * scale;
  const labelPadX = (pos === "left" || pos === "right") ? 12 * scale : 0;
  const lineHeight = fontSize * (pos === "left" || pos === "right" ? 1.3 : 1.22);
  const lines = wrapLabelLines(text, labelBoxW - labelPadX * 2, fontSize);
  const textHeight = lines.length ? lines.length * lineHeight : 0;
  const labelBoxH = text ? textHeight : 0;

  let contentW = qrBox;
  let contentH = qrBox;
  let qrX = pad.left;
  let qrY = pad.top;
  let labelX = pad.left;
  let labelY = pad.top;

  if (pos === "top") {
    contentW = Math.max(qrBox, labelBoxW);
    contentH = labelBoxH + gap + qrBox;
    labelX = pad.left + (contentW - labelBoxW) / 2;
    labelY = pad.top;
    qrX = pad.left + (contentW - qrBox) / 2;
    qrY = pad.top + labelBoxH + gap;
  } else if (pos === "bottom") {
    contentW = Math.max(qrBox, labelBoxW);
    contentH = qrBox + gap + labelBoxH;
    qrX = pad.left + (contentW - qrBox) / 2;
    qrY = pad.top;
    labelX = pad.left + (contentW - labelBoxW) / 2;
    labelY = pad.top + qrBox + gap;
  } else if (pos === "left") {
    contentW = labelBoxW + gap + qrCol;
    contentH = Math.max(qrBox, labelBoxH);
    labelX = pad.left;
    labelY = pad.top + (contentH - labelBoxH) / 2;
    qrX = pad.left + labelBoxW + gap + (qrCol - qrBox) / 2;
    qrY = pad.top + (contentH - qrBox) / 2;
  } else if (pos === "right") {
    contentW = qrCol + gap + labelBoxW;
    contentH = Math.max(qrBox, labelBoxH);
    qrX = pad.left + (qrCol - qrBox) / 2;
    qrY = pad.top + (contentH - qrBox) / 2;
    labelX = pad.left + qrCol + gap;
    labelY = pad.top + (contentH - labelBoxH) / 2;
  }

  const outerW = contentW + pad.left + pad.right;
  const outerH = contentH + pad.top + pad.bottom;

  // Map the user's alignment to SVG's text-anchor for the chosen column.
  const textAnchor: "start" | "middle" | "end" =
    align === "left" ? "start" : align === "right" ? "end" : "middle";
  const textX =
    align === "left" ? labelX + labelPadX :
    align === "right" ? labelX + labelBoxW - labelPadX :
    labelX + labelBoxW / 2;
  const firstBaseline = labelY + (lineHeight - fontSize) / 2 + fontSize * 0.82;

  // Background + frame decoration. The same composed SVG is used by the live
  // preview and the download route, so frame geometry stays identical.
  const bgRect = `<rect width="${outerW}" height="${outerH}" fill="${bg}"/>`;
  const frameSvg = framed
    ? renderFrameSvg(frameStyle, {
        width: outerW, height: outerH,
        color: frameColor,
        bandColor: label.bandColor,
        bg: "transparent",
        inset: 8 * scale,
        strokeWidth: 1.6 * scale,
        labelPosition: pos,
        bandSize: pos === "left" || pos === "right" ? labelBoxW + 24 * scale : labelBoxH + 16 * scale,
        bandOffset: pos === "none" ? 0 : 20 * scale,
      })
    : "";
  const frameInner = framed ? frameSvg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "") : "";

  // Embed the inner QR svg as a nested fragment via foreignObject would be flaky for
  // downstream rasterizers; instead inline it inside a <g transform>.
  // Strip the outer <svg> wrapper from qrSvg.
  const inner = qrSvg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");

  const labelEl = (pos !== "none" && text)
    ? lines.map((line, i) => `<text x="${textX}" y="${firstBaseline + i * lineHeight}" fill="${escapeXmlAttr(color)}" font-family="${escapeXmlAttr(fontStack)}" font-size="${fontSize}" font-weight="${fontWeight}" text-anchor="${textAnchor}" style="${escapeXmlAttr(transform)}">${escapeXml(line)}</text>`).join("")
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${outerW} ${outerH}" width="${outerW}" height="${outerH}">
  ${bgRect}
  ${frameInner}
  <g transform="translate(${qrX}, ${qrY}) scale(${qrBox / qrSize})">${inner}</g>
  ${labelEl}
</svg>`;
}

function wrapLabelLines(text: string, maxWidth: number, fontSize: number): string[] {
  if (!text) return [];
  const charWidth = fontSize * 0.55;
  const maxChars = Math.max(1, Math.floor(maxWidth / charWidth));
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (!line) {
        line = word;
      } else if ((line.length + 1 + word.length) <= maxChars) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function escapeXmlAttr(s: string): string {
  return escapeXml(s);
}
