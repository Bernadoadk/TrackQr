import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { normalizeWebUrl } from "./url-safety";

/**
 * Typed view of Shop.settings (free-form JSON column). Every field is
 * optional so older rows keep working; read through readShopSettings().
 */
export interface ShopSettings {
  /** Default destination for scans a QR code can't serve (Starter+). */
  defaultFallbackUrl: string | null;
  /** Default recipient of lead notifications (else the shop email). */
  leadNotifyEmail: string | null;
  /** Monday summary email — on unless the merchant turns it off. */
  weeklyReport: boolean;
  /** Create / update a Shopify customer for each campaign lead (Growth). */
  syncLeadsToCustomers: boolean;
  /** Dashboard onboarding checklist hidden by the merchant. */
  onboardingDismissed: boolean;
  /** The merchant opened the theme editor to enable the attribution embed. */
  attributionEmbedOpened: boolean;
  /** Storefront primary domain (e.g. "www.brand.com"), synced from Shopify. */
  primaryDomain: string | null;
  /** Admin language of the last staff member who opened the app (emails use it). */
  adminLocale: string | null;
  /** Throttles for background syncs / emails (ISO dates). */
  lastShopifySyncAt: string | null;
  lastWeeklyReportAt: string | null;
}

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  defaultFallbackUrl: null,
  leadNotifyEmail: null,
  weeklyReport: true,
  syncLeadsToCustomers: false,
  onboardingDismissed: false,
  attributionEmbedOpened: false,
  primaryDomain: null,
  adminLocale: null,
  lastShopifySyncAt: null,
  lastWeeklyReportAt: null,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readShopSettings(shop: { settings: unknown }): ShopSettings {
  const raw = record(shop.settings);
  return {
    defaultFallbackUrl: normalizeWebUrl(raw.defaultFallbackUrl),
    leadNotifyEmail: str(raw.leadNotifyEmail),
    weeklyReport: raw.weeklyReport !== false,
    syncLeadsToCustomers: raw.syncLeadsToCustomers === true,
    onboardingDismissed: raw.onboardingDismissed === true,
    attributionEmbedOpened: raw.attributionEmbedOpened === true,
    primaryDomain: str(raw.primaryDomain),
    adminLocale: str(raw.adminLocale),
    lastShopifySyncAt: str(raw.lastShopifySyncAt),
    lastWeeklyReportAt: str(raw.lastWeeklyReportAt),
  };
}

/** Merge a patch into Shop.settings (keeps unknown keys other code may store). */
export async function updateShopSettings(shopId: string, patch: Partial<ShopSettings>): Promise<ShopSettings> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { settings: true } });
  const next = { ...record(shop?.settings), ...patch };
  const updated = await prisma.shop.update({
    where: { id: shopId },
    data: { settings: next as Prisma.InputJsonValue },
    select: { settings: true },
  });
  return readShopSettings(updated);
}

/** Host names under which the store is reachable (myshopify + primary domain). */
export function storeHosts(shop: { domain: string; settings: unknown }): string[] {
  const hosts = new Set<string>([shop.domain.toLowerCase()]);
  const primary = readShopSettings(shop).primaryDomain;
  if (primary) hosts.add(primary.toLowerCase());
  return [...hosts];
}
