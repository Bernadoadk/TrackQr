/**
 * Curated list of Google Fonts available for QR labels.
 * The matching <link> tag in root.tsx loads all of these from fonts.googleapis.com,
 * so `family` strings here MUST match the family name registered on Google Fonts.
 *
 * Grouped: Sans → Display → Serif → Script → Monospace.
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
  /** Optional category for grouping the picker dropdown. */
  group?: "sans" | "display" | "serif" | "script" | "mono";
}

export const LABEL_FONTS: LabelFontSpec[] = [
  /* ── Sans-serif ── */
  { value: "inter",        name: "Inter",            family: "'Inter', -apple-system, system-ui, sans-serif",     weight: 600, letterSpacing: "-0.012em", group: "sans" },
  { value: "roboto",       name: "Roboto",           family: "'Roboto', system-ui, sans-serif",                    weight: 500, group: "sans" },
  { value: "opensans",     name: "Open Sans",        family: "'Open Sans', system-ui, sans-serif",                 weight: 600, group: "sans" },
  { value: "lato",         name: "Lato",             family: "'Lato', system-ui, sans-serif",                      weight: 700, group: "sans" },
  { value: "montserrat",   name: "Montserrat",       family: "'Montserrat', system-ui, sans-serif",                weight: 600, group: "sans" },
  { value: "poppins",      name: "Poppins",          family: "'Poppins', system-ui, sans-serif",                   weight: 600, group: "sans" },
  { value: "raleway",      name: "Raleway",          family: "'Raleway', system-ui, sans-serif",                   weight: 600, group: "sans" },
  { value: "dmsans",       name: "DM Sans",          family: "'DM Sans', system-ui, sans-serif",                   weight: 600, group: "sans" },
  { value: "nunito",       name: "Nunito",           family: "'Nunito', system-ui, sans-serif",                    weight: 700, group: "sans" },
  { value: "worksans",     name: "Work Sans",        family: "'Work Sans', system-ui, sans-serif",                 weight: 600, group: "sans" },

  /* ── Display ── */
  { value: "bebas",        name: "Bebas Neue",       family: "'Bebas Neue', Impact, sans-serif",                   weight: 400, letterSpacing: "0.08em", group: "display" },
  { value: "anton",        name: "Anton",            family: "'Anton', Impact, sans-serif",                        weight: 400, letterSpacing: "0.04em", group: "display" },
  { value: "oswald",       name: "Oswald",           family: "'Oswald', sans-serif",                               weight: 600, letterSpacing: "0.03em", group: "display" },
  { value: "archivoblack", name: "Archivo Black",    family: "'Archivo Black', Impact, sans-serif",                weight: 400, group: "display" },
  { value: "abrilfatface", name: "Abril Fatface",    family: "'Abril Fatface', Georgia, serif",                    weight: 400, group: "display" },
  { value: "righteous",    name: "Righteous",        family: "'Righteous', sans-serif",                            weight: 400, group: "display" },
  { value: "bungee",       name: "Bungee",           family: "'Bungee', sans-serif",                               weight: 400, group: "display" },
  { value: "staatliches",  name: "Staatliches",      family: "'Staatliches', sans-serif",                          weight: 400, letterSpacing: "0.04em", group: "display" },

  /* ── Serif ── */
  { value: "playfair",     name: "Playfair Display", family: "'Playfair Display', Georgia, serif",                 weight: 600, letterSpacing: "-0.005em", group: "serif" },
  { value: "merriweather", name: "Merriweather",     family: "'Merriweather', Georgia, serif",                     weight: 700, group: "serif" },
  { value: "lora",         name: "Lora",             family: "'Lora', Georgia, serif",                             weight: 600, group: "serif" },
  { value: "ebgaramond",   name: "EB Garamond",      family: "'EB Garamond', Georgia, serif",                      weight: 600, group: "serif" },
  { value: "serif",        name: "Instrument Serif", family: "'Instrument Serif', 'Times New Roman', serif",       weight: 400, group: "serif" },
  { value: "dmserif",      name: "DM Serif Display", family: "'DM Serif Display', Georgia, serif",                 weight: 400, group: "serif" },
  { value: "ptserif",      name: "PT Serif",         family: "'PT Serif', Georgia, serif",                         weight: 700, group: "serif" },
  { value: "cormorant",    name: "Cormorant Garamond", family: "'Cormorant Garamond', Georgia, serif",             weight: 600, group: "serif" },
  { value: "robotoslab",   name: "Roboto Slab",      family: "'Roboto Slab', Georgia, serif",                      weight: 600, group: "serif" },

  /* ── Script / Handwriting ── */
  { value: "lobster",      name: "Lobster",          family: "'Lobster', cursive",                                 weight: 400, group: "script" },
  { value: "caveat",       name: "Caveat",           family: "'Caveat', 'Comic Sans MS', cursive",                 weight: 700, group: "script" },
  { value: "marker",       name: "Permanent Marker", family: "'Permanent Marker', 'Marker Felt', cursive",         weight: 400, group: "script" },
  { value: "pacifico",     name: "Pacifico",         family: "'Pacifico', cursive",                                weight: 400, group: "script" },
  { value: "dancing",      name: "Dancing Script",   family: "'Dancing Script', cursive",                          weight: 700, group: "script" },
  { value: "greatvibes",   name: "Great Vibes",      family: "'Great Vibes', cursive",                             weight: 400, group: "script" },
  { value: "sacramento",   name: "Sacramento",       family: "'Sacramento', cursive",                              weight: 400, group: "script" },
  { value: "satisfy",      name: "Satisfy",          family: "'Satisfy', cursive",                                 weight: 400, group: "script" },

  /* ── Monospace ── */
  { value: "mono",         name: "JetBrains Mono",   family: "'JetBrains Mono', ui-monospace, monospace",          weight: 500, letterSpacing: "0.06em", textTransform: "uppercase", group: "mono" },
  { value: "firacode",     name: "Fira Code",        family: "'Fira Code', ui-monospace, monospace",               weight: 500, group: "mono" },
  { value: "spacemono",    name: "Space Mono",       family: "'Space Mono', ui-monospace, monospace",              weight: 700, group: "mono" },
  { value: "robotomono",   name: "Roboto Mono",      family: "'Roboto Mono', ui-monospace, monospace",             weight: 500, group: "mono" },
];

export const DEFAULT_FONT = "inter";

export function getLabelFont(value?: string | null): LabelFontSpec {
  return LABEL_FONTS.find(f => f.value === value) ?? LABEL_FONTS[0];
}

/** Group label for the picker dropdown (`<optgroup>` heading). */
export const LABEL_FONT_GROUPS: Record<NonNullable<LabelFontSpec["group"]>, string> = {
  sans:    "Sans-serif",
  display: "Display",
  serif:   "Serif",
  script:  "Handwriting",
  mono:    "Monospace",
};
