import { AsyncLocalStorage } from "node:async_hooks";
import { es } from "../locales/es";
import { fr } from "../locales/fr";
import { isLocale, registerDictionary, setServerLocaleSource, type Locale } from "./i18n";

/**
 * Server side of app/lib/i18n.ts: every dictionary is available, and t()
 * reads the locale of the work in progress — the request being rendered
 * (entry.server.tsx) or an email built for a merchant (weekly report, lead
 * notification).
 */
registerDictionary("fr", fr);
registerDictionary("es", es);

const localeStore = new AsyncLocalStorage<Locale>();
setServerLocaleSource(() => localeStore.getStore());

export function runWithLocale<T>(locale: unknown, fn: () => T): T {
  return localeStore.run(isLocale(locale) ? locale : "en", fn);
}
