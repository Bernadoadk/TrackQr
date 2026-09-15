/**
 * "Standard" QR appearance — what plans without the `customDesign` feature
 * (Free) get: square modules, square finders, dark-on-white, no logo, no
 * gradient, no frame. The label text and its position are still allowed.
 *
 * Client-safe: imported by the Create page (live preview) and by the server
 * render routes, so both sides agree on what "standard" looks like.
 */
import { DEFAULT_FONT } from "./label-fonts";

export type LabelPosition = "none" | "top" | "bottom" | "left" | "right";

export const STANDARD_DESIGN = {
  style: "square",
  cornerStyle: "square",
  fg: "#0B1220",
  bg: "#FFFFFF",
  withLogo: false,
  logoBrand: null,
  logoUrl: null,
  logoAssetId: null,
  logoSize: 0.2,
  margin: 8,
  cornerColor: "#0B1220",
  gradient: null,
} as const;

export const STANDARD_LABEL_FORMAT = {
  frame: "none",
  framed: false,
  font: DEFAULT_FONT,
  size: 16,
  bold: false,
  italic: false,
  underline: false,
  align: "center",
} as const;

const LABEL_POSITIONS: LabelPosition[] = ["none", "top", "bottom", "left", "right"];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Fresh copy of the standard design (ignores whatever the merchant configured). */
export function standardDesign(): Record<string, unknown> {
  return { ...STANDARD_DESIGN };
}

/** Keep only the label text + position; every formatting option goes back to default. */
export function standardizeLabel(label: unknown): Record<string, unknown> {
  const l = record(label);
  const position = LABEL_POSITIONS.includes(l.position as LabelPosition) ? (l.position as LabelPosition) : "bottom";
  return {
    text: typeof l.text === "string" ? l.text : "",
    position,
    ...STANDARD_LABEL_FORMAT,
  };
}

/**
 * Apply the plan entitlement to a stored design + label pair. Plans with
 * `customDesign` get their configuration back untouched; the others are
 * rendered in the standard style.
 */
export function applyDesignEntitlement(
  canCustomize: boolean,
  design: unknown,
  label: unknown,
): { design: Record<string, unknown>; label: Record<string, unknown> } {
  if (canCustomize) return { design: record(design), label: record(label) };
  return { design: standardDesign(), label: standardizeLabel(label) };
}
