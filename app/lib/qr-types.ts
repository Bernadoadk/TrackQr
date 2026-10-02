/** Shared QR type constants — safe to import from client code. */
import type { QrType } from "@prisma/client";

export const QR_TYPE_FROM_UI: Record<string, QrType> = {
  home: "HOME", product: "PRODUCT", collection: "COLLECTION", page: "PAGE", link: "LINK", atc: "ATC", promo: "PROMO",
  url: "URL", text: "TEXT", phone: "PHONE", sms: "SMS", email: "EMAIL", wifi: "WIFI", vcard: "VCARD",
};

export const QR_TYPE_TO_UI: Record<QrType, string> = {
  HOME: "home", PRODUCT: "product", COLLECTION: "collection", PAGE: "page", LINK: "link", ATC: "atc", PROMO: "promo",
  URL: "url", TEXT: "text", PHONE: "phone", SMS: "sms", EMAIL: "email", WIFI: "wifi", VCARD: "vcard",
};

/** QR types whose destination is on the Shopify storefront (discount codes apply). */
export const STORE_QR_TYPES: QrType[] = ["HOME", "PRODUCT", "COLLECTION", "PAGE", "ATC"];

export function parseQrType(input: string | null | undefined): QrType {
  const t = QR_TYPE_FROM_UI[(input ?? "").toLowerCase()];
  if (!t) throw new Error(`Unknown QR type: ${input}`);
  return t;
}
