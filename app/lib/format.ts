/** Display helpers shared by admin pages — client-safe. */
import { intlLocale } from "./i18n";

/** Cents → "$1,234.50" (or "$1.2k" when compact) in the store currency, formatted for the admin language. */
export function formatMoney(cents: number, currency: string | null | undefined, compact = false): string {
  const amount = (cents || 0) / 100;
  const code = currency || "USD";
  try {
    return new Intl.NumberFormat(intlLocale(), {
      style: "currency",
      currency: code,
      ...(compact && amount >= 10000 ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: amount >= 1000 ? 0 : 2 }),
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}
