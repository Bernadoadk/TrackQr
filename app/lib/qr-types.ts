/** Shared QR type constants — safe to import from client code. */
import type { QrType } from "@prisma/client";

export const QR_TYPE_FROM_UI: Record<string, QrType> = {
  home: "HOME", product: "PRODUCT", link: "LINK", atc: "ATC", promo: "PROMO",
  url: "URL", text: "TEXT", phone: "PHONE", sms: "SMS", email: "EMAIL", wifi: "WIFI", vcard: "VCARD",
};

export const QR_TYPE_TO_UI: Record<QrType, string> = {
  HOME: "home", PRODUCT: "product", LINK: "link", ATC: "atc", PROMO: "promo",
  URL: "url", TEXT: "text", PHONE: "phone", SMS: "sms", EMAIL: "email", WIFI: "wifi", VCARD: "vcard",
};

export function parseQrType(input: string | null | undefined): QrType {
  const t = QR_TYPE_FROM_UI[(input ?? "").toLowerCase()];
  if (!t) throw new Error(`Unknown QR type: ${input}`);
  return t;
}
