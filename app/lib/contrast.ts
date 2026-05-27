/**
 * WCAG 2.1 relative luminance + contrast ratio.
 * Used by the QR Create page to warn the merchant when the picked
 * foreground / background combination would be too low-contrast for a
 * camera to reliably scan the resulting QR code.
 *
 * Pure browser-safe (no Node APIs) — bundled into the client.
 */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function relLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio (1 — identical, 21 — black on white). */
export function contrastRatio(a: string, b: string): number {
  const l1 = relLuminance(a);
  const l2 = relLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Human-readable verdict for the picker UI. */
export function contrastVerdict(ratio: number): {
  level: "ok" | "warn" | "fail";
  message: string;
} {
  if (ratio >= 7)   return { level: "ok",   message: `Excellent contrast (${ratio.toFixed(1)}:1)` };
  if (ratio >= 4.5) return { level: "ok",   message: `Good contrast (${ratio.toFixed(1)}:1)` };
  if (ratio >= 3)   return { level: "warn", message: `Low contrast (${ratio.toFixed(1)}:1) — may scan unreliably` };
  return                   { level: "fail", message: `Very low contrast (${ratio.toFixed(1)}:1) — likely won't scan` };
}
