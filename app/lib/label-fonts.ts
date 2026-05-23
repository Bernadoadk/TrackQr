/**
 * Curated list of label fonts loaded in root.tsx via Google Fonts.
 * Each entry's `family` is a CSS font-family value safe to pass to inline styles,
 * SVG <text font-family=…>, and the Google Fonts loader.
 *
 * `value` is the stable id stored on the QR record.
 */

export interface LabelFontSpec {
  value: string;       // stored id
  name: string;        // display name in the picker
  family: string;      // CSS font-family stack
  weight?: number;     // default font-weight when this family is used
  style?: "normal" | "italic";
  letterSpacing?: string;
  textTransform?: "uppercase" | "lowercase" | "none";
}

export const LABEL_FONTS: LabelFontSpec[] = [
  { value: "inter",      name: "Inter",            family: "'Inter', -apple-system, system-ui, sans-serif",                 weight: 600, letterSpacing: "-0.012em" },
  { value: "serif",      name: "Instrument Serif", family: "'Instrument Serif', 'Times New Roman', serif",                  weight: 400 },
  { value: "mono",       name: "JetBrains Mono",   family: "'JetBrains Mono', ui-monospace, monospace",                     weight: 500, letterSpacing: "0.06em", textTransform: "uppercase" },
  { value: "playfair",   name: "Playfair Display", family: "'Playfair Display', Georgia, serif",                            weight: 600, letterSpacing: "-0.005em" },
  { value: "bebas",      name: "Bebas Neue",       family: "'Bebas Neue', Impact, sans-serif",                              weight: 400, letterSpacing: "0.08em" },
  { value: "anton",      name: "Anton",            family: "'Anton', Impact, sans-serif",                                   weight: 400, letterSpacing: "0.04em" },
  { value: "oswald",     name: "Oswald",           family: "'Oswald', sans-serif",                                          weight: 600, letterSpacing: "0.03em" },
  { value: "robotoslab", name: "Roboto Slab",      family: "'Roboto Slab', Georgia, serif",                                 weight: 600 },
  { value: "lobster",    name: "Lobster",          family: "'Lobster', cursive",                                            weight: 400 },
  { value: "caveat",     name: "Caveat",           family: "'Caveat', 'Comic Sans MS', cursive",                            weight: 700 },
  { value: "marker",     name: "Permanent Marker", family: "'Permanent Marker', 'Marker Felt', cursive",                    weight: 400 },
  { value: "pacifico",   name: "Pacifico",         family: "'Pacifico', cursive",                                           weight: 400 },
];

export const DEFAULT_FONT = "inter";

export function getLabelFont(value?: string | null): LabelFontSpec {
  return LABEL_FONTS.find(f => f.value === value) ?? LABEL_FONTS[0];
}
