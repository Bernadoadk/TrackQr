/**
 * Smart routing (Growth): send a scan to another URL depending on the
 * visitor's device, country, language or local time, and A/B split the
 * default destination. Stored in QrCode.rules; evaluated by /s/:slug.
 *
 * Client-safe and pure — the Create page uses the same normalizer.
 */
import { normalizeWebUrl } from "./url-safety";

export type DeviceTarget = "ios" | "android" | "mobile" | "desktop";

export type RoutingCondition =
  | { type: "device"; devices: DeviceTarget[] }
  | { type: "country"; countries: string[] }
  | { type: "language"; languages: string[] }
  | { type: "schedule"; days: number[]; from: string; to: string; timezone: string };

export interface RoutingRule {
  id: string;
  label: string;
  /** Every condition must match (AND). */
  conditions: RoutingCondition[];
  url: string;
}

export interface AbTest {
  /** Variant B destination. Variant A is the QR code's normal destination. */
  url: string;
  /** Share of visitors sent to variant B, 1–99 (%). */
  share: number;
}

export interface RoutingConfig {
  rules: RoutingRule[];
  abTest: AbTest | null;
}

export const EMPTY_ROUTING: RoutingConfig = { rules: [], abTest: null };
export const MAX_ROUTING_RULES = 10;

const DEVICES: DeviceTarget[] = ["ios", "android", "mobile", "desktop"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringList(value: unknown, pattern: RegExp, transform: (s: string) => string): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const v = transform(item.trim());
    if (pattern.test(v)) out.add(v);
  }
  return [...out];
}

function validTimezone(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function normalizeCondition(value: unknown): RoutingCondition | null {
  const c = record(value);
  switch (c.type) {
    case "device": {
      const devices = Array.isArray(c.devices) ? c.devices.filter((d): d is DeviceTarget => DEVICES.includes(d as DeviceTarget)) : [];
      return devices.length ? { type: "device", devices: [...new Set(devices)] } : null;
    }
    case "country": {
      const countries = stringList(c.countries, /^[A-Z]{2}$/, s => s.toUpperCase());
      return countries.length ? { type: "country", countries } : null;
    }
    case "language": {
      const languages = stringList(c.languages, /^[a-z]{2}$/, s => s.toLowerCase().slice(0, 2));
      return languages.length ? { type: "language", languages } : null;
    }
    case "schedule": {
      const days = Array.isArray(c.days)
        ? [...new Set(c.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))]
        : [];
      const from = typeof c.from === "string" && TIME.test(c.from) ? c.from : null;
      const to = typeof c.to === "string" && TIME.test(c.to) ? c.to : null;
      if (!days.length || !from || !to) return null;
      return { type: "schedule", days: days.sort(), from, to, timezone: validTimezone(c.timezone) };
    }
    default:
      return null;
  }
}

/** Sanitize whatever is stored / submitted into a valid routing config. */
export function normalizeRoutingConfig(value: unknown): RoutingConfig {
  const raw = record(value);
  const rules: RoutingRule[] = [];
  const rawRules = Array.isArray(raw.rules) ? raw.rules : [];
  for (const item of rawRules.slice(0, MAX_ROUTING_RULES)) {
    const r = record(item);
    const url = normalizeWebUrl(r.url);
    const conditions = (Array.isArray(r.conditions) ? r.conditions : [])
      .map(normalizeCondition)
      .filter((c): c is RoutingCondition => !!c);
    if (!url || !conditions.length) continue;
    rules.push({
      id: typeof r.id === "string" && r.id ? r.id.slice(0, 40) : `r${rules.length + 1}`,
      label: typeof r.label === "string" ? r.label.slice(0, 60) : "",
      conditions,
      url,
    });
  }
  const ab = record(raw.abTest);
  const abUrl = normalizeWebUrl(ab.url);
  const share = Math.round(Number(ab.share));
  const abTest = abUrl && share >= 1 && share <= 99 ? { url: abUrl, share } : null;
  return { rules, abTest };
}

export function hasRouting(config: RoutingConfig): boolean {
  return config.rules.length > 0 || !!config.abTest;
}

export interface RoutingContext {
  /** Prisma DeviceType of the scan. */
  device: "MOBILE" | "DESKTOP" | "TABLET" | "UNKNOWN";
  os: string | null;
  country: string | null;
  /** Preferred languages from Accept-Language, 2-letter codes. */
  languages: string[];
  now: Date;
  /** Stable 0–1 value per visitor (keeps A/B assignments sticky). */
  bucket: number;
}

function matchDevice(targets: DeviceTarget[], ctx: RoutingContext): boolean {
  const os = (ctx.os ?? "").toLowerCase();
  return targets.some(t => {
    if (t === "ios") return os.includes("ios") || os.includes("ipados");
    if (t === "android") return os.includes("android");
    if (t === "mobile") return ctx.device === "MOBILE" || ctx.device === "TABLET";
    return ctx.device === "DESKTOP";
  });
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function matchSchedule(c: Extract<RoutingCondition, { type: "schedule" }>, now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: c.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const day = WEEKDAY[get("weekday")] ?? now.getUTCDay();
  const current = Number(get("hour")) * 60 + Number(get("minute"));
  const from = minutes(c.from);
  const to = minutes(c.to);
  if (from <= to) return c.days.includes(day) && current >= from && current < to;
  // Overnight window (e.g. 22:00 → 06:00): the part after midnight belongs to the previous day.
  if (current >= from) return c.days.includes(day);
  return current < to && c.days.includes((day + 6) % 7);
}

function matches(condition: RoutingCondition, ctx: RoutingContext): boolean {
  switch (condition.type) {
    case "device": return matchDevice(condition.devices, ctx);
    case "country": return !!ctx.country && condition.countries.includes(ctx.country);
    case "language": return ctx.languages.some(l => condition.languages.includes(l));
    case "schedule": return matchSchedule(condition, ctx.now);
  }
}

export interface RoutingDecision {
  /** Destination override, or null to use the QR code's own destination. */
  url: string | null;
  /** Which rule / variant served the scan ("rule:<id>", "ab:A", "ab:B"). */
  route: string | null;
}

export function resolveRouting(config: RoutingConfig, ctx: RoutingContext): RoutingDecision {
  for (const rule of config.rules) {
    if (rule.conditions.every(c => matches(c, ctx))) return { url: rule.url, route: `rule:${rule.id}` };
  }
  if (config.abTest) {
    return ctx.bucket < config.abTest.share / 100
      ? { url: config.abTest.url, route: "ab:B" }
      : { url: null, route: "ab:A" };
  }
  return { url: null, route: null };
}

/** Parse an Accept-Language header into 2-letter codes, best first. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map(part => {
      const [tag, q] = part.trim().split(";q=");
      return { lang: tag.trim().slice(0, 2).toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter(x => /^[a-z]{2}$/.test(x.lang) && Number.isFinite(x.q))
    .sort((a, b) => b.q - a.q)
    .map(x => x.lang)
    .filter((l, i, arr) => arr.indexOf(l) === i);
}
