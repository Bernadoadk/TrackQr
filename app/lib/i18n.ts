/**
 * Admin UI translations. The English source text is the key; a missing
 * translation falls back to English.
 *
 *   t("Save changes")                         → "Enregistrer les modifications"
 *   t("{count} codes paused", { count: 3 })   → "3 codes mis en pause"
 *   tp(n, "{count} scan", "{count} scans")    → plural form of the active locale
 *   tm(fetcher.data.message)                  → server message (exact or pattern match)
 *
 * `t()` is a plain function, so helpers and option lists rendered later can
 * use it. In the browser the locale is fixed when the app loads (app.tsx);
 * during SSR, entry.server.tsx scopes it to the request.
 *
 * Dictionaries are registered, not imported: a browser downloads only its
 * own language (entry.client.tsx, before hydration) and English needs none;
 * the server registers them all (i18n.server.ts).
 *
 * Client-safe.
 */
import { Fragment, createElement, type ReactNode } from "react";

export const LOCALES = ["en", "fr", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export type Dictionary = Record<string, string>;

type Params = Record<string, string | number>;
type Pattern = { re: RegExp; names: string[]; template: string };

const DICTIONARIES: Partial<Record<Locale, Dictionary>> = {};
const INTL_LOCALE: Record<Locale, string> = { en: "en-US", fr: "fr-FR", es: "es-ES" };
const patternCache = new Map<Locale, Pattern[]>();

export function registerDictionary(locale: Locale, dictionary: Dictionary) {
  DICTIONARIES[locale] = dictionary;
  patternCache.delete(locale);
}

function dictionaryFor(locale: Locale): Dictionary | undefined {
  return locale === "en" ? undefined : DICTIONARIES[locale];
}

let clientLocale: Locale = "en";
let serverLocale: (() => Locale | undefined) | null = null;

/** Server only: where the locale of the request being rendered comes from. */
export function setServerLocaleSource(source: () => Locale | undefined) {
  serverLocale = source;
}

/** Browser only: the merchant's admin language, set once by the app layout. */
export function setClientLocale(locale: Locale) {
  clientLocale = locale;
}

export function currentLocale(): Locale {
  return serverLocale?.() ?? clientLocale;
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Shopify passes the admin language as `?locale=fr` (or "fr-CA", "pt-BR"…)
 * when it loads the app. Without it, the browser languages decide.
 */
export function resolveLocale(param: string | null | undefined, acceptLanguage?: string | null): Locale {
  if (param) {
    const base = param.trim().toLowerCase().slice(0, 2);
    return isLocale(base) ? base : "en";
  }
  for (const part of (acceptLanguage ?? "").split(",")) {
    const base = part.split(";")[0].trim().toLowerCase().slice(0, 2);
    if (isLocale(base)) return base;
  }
  return "en";
}

/** BCP 47 tag for Intl formatting ("fr-FR"). */
export function intlLocale(): string {
  return INTL_LOCALE[currentLocale()];
}

function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!(name in params)) return match;
    const value = params[name];
    return typeof value === "number" ? value.toLocaleString(intlLocale()) : value;
  });
}

export function t(key: string, params?: Params): string {
  return interpolate(dictionaryFor(currentLocale())?.[key] ?? key, params);
}

/**
 * t() for sentences that contain markup: `{name}` placeholders found in
 * `nodes` are replaced by those React nodes, so translators can move them.
 *   tx("Click {save} in the theme editor.", { save: <b>{t("Save")}</b> })
 */
export function tx(key: string, nodes: Record<string, ReactNode>, params?: Params): ReactNode[] {
  return t(key, params)
    .split(/\{(\w+)\}/)
    .map((part, i) => (i % 2 ? createElement(Fragment, { key: i }, part in nodes ? nodes[part] : `{${part}}`) : part));
}

/**
 * Page titles with an emphasized part: "<em>…</em>" in the key (and in its
 * translation) becomes <span class="em">…</span>.
 *   tem("<em>Scan</em> analytics") → Analyse des <span class="em">scans</span>
 */
export function tem(key: string, params?: Params): ReactNode[] {
  return t(key, params)
    .split(/<em>(.*?)<\/em>/)
    .map((part, i) => (i % 2 ? createElement("span", { key: i, className: "em" }, part) : part));
}

/**
 * Plural-aware t(): the locale's rules pick the form (0 is singular in
 * French). When English uses one form for both ("{count} active"), the
 * dictionary can still tell them apart with "key|one" / "key|other" entries.
 * `params.count` may override the displayed count (pre-formatted "1.2k").
 */
export function tp(count: number, one: string, other: string = one, params?: Params): string {
  const locale = currentLocale();
  const form = new Intl.PluralRules(INTL_LOCALE[locale]).select(count) === "one" ? "one" : "other";
  const key = form === "one" ? one : other;
  const values = { count, ...params };
  const dict = dictionaryFor(locale);
  return interpolate(dict?.[`${key}|${form}`] ?? dict?.[key] ?? key, values);
}

/** Country name in the admin language ("FR" → "France"), or the code itself. */
export function regionName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames([intlLocale()], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function patternsFor(locale: Locale, dict: Dictionary): Pattern[] {
  const cached = patternCache.get(locale);
  if (cached) return cached;
  const list: Pattern[] = [];
  for (const [key, template] of Object.entries(dict)) {
    if (!key.includes("{")) continue;
    const parts = key.split(/\{(\w+)\}/);
    const names: string[] = [];
    let source = "^";
    parts.forEach((part, i) => {
      if (i % 2) {
        names.push(part);
        source += "(.+?)";
      } else {
        source += part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
    });
    list.push({ re: new RegExp(`${source}$`), names, template });
  }
  patternCache.set(locale, list);
  return list;
}

/**
 * Translate a message built on the server (action errors, plan limits…),
 * which may embed values: "Smart routing and A/B tests requires the Growth
 * plan." matches the "{feature} requires the {plan} plan." entry, and the
 * captured values are translated too.
 */
export function tm(message: string | null | undefined): string {
  if (!message) return "";
  const locale = currentLocale();
  const dict = dictionaryFor(locale);
  if (!dict) return message;
  const exact = dict[message];
  if (exact !== undefined) return exact;
  for (const { re, names, template } of patternsFor(locale, dict)) {
    const match = re.exec(message);
    if (!match) continue;
    const params: Params = {};
    names.forEach((name, i) => {
      params[name] = t(match[i + 1]);
    });
    return interpolate(template, params);
  }
  return message;
}

/** Number in the admin language ("1 234,5"). */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(intlLocale(), options);
}

/** Date in the admin language ("30 sept. 2026"). */
export function formatDate(value: Date | string | number, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(intlLocale(), options);
}
