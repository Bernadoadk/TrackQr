import QRCode from "qrcode";

/**
 * Shared QR-to-SVG renderer used by BOTH server (download routes) and client
 * (Create page live preview). Same library on both sides = identical visuals.
 * No `.server.ts` suffix because we want to bundle this for the browser.
 */

export type QrStyle      = "square" | "rounded" | "dot" | "classy";
export type CornerStyle  = "square" | "rounded" | "extra-rounded";

export interface QrRenderOpts {
  size?: number;
  margin?: number;
  fg?: string;
  bg?: string;
  style?: QrStyle;
  cornerStyle?: CornerStyle;
  withLogo?: boolean;
}

const DEFAULTS: Required<Omit<QrRenderOpts, "size" | "margin">> = {
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
    finders += `<rect x="${x}" y="${y}" width="${outer}" height="${outer}" rx="${fr}" fill="${o.fg}"/>`;
    finders += `<rect x="${x + cell}" y="${y + cell}" width="${cell * 5}" height="${cell * 5}" rx="${Math.max(0, fr - cell)}" fill="${o.bg}"/>`;
    finders += `<rect x="${x + cell * 2}" y="${y + cell * 2}" width="${cell * 3}" height="${cell * 3}" rx="${Math.max(0, fr - cell * 2)}" fill="${o.fg}"/>`;
  }

  const logo = o.withLogo
    ? `<g transform="translate(${size / 2 - 18}, ${size / 2 - 18})"><rect width="36" height="36" rx="8" fill="${o.bg}" stroke="${o.fg}" stroke-width="0.5"/><rect x="4" y="4" width="28" height="28" rx="6" fill="${o.fg}"/></g>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%" height="100%">
  <rect width="${size}" height="${size}" fill="${o.bg}"/>
  <g fill="${o.fg}">${modules}</g>
  ${finders}
  ${logo}
</svg>`;
}
