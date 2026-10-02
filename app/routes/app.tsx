import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import { useLoaderData, useRouteError } from "react-router";
import { AppShell } from "../components/layout/AppShell";
import { RouteError } from "../components/RouteError";
import { requireShop } from "../lib/shop.server";
import { enforcePlanQuotas, getPlanEntitlements, getPlanUsage } from "../lib/plan.server";
import { syncShopFromShopify } from "../lib/shop-sync.server";
import { readShopSettings, updateShopSettings } from "../lib/shop-settings.server";
import { resolveLocale, setClientLocale, t } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const url = new URL(request.url);
  // Shopify is the source of truth for the plan: sync every few minutes, and
  // right away when the merchant comes back from a billing confirmation.
  await syncShopFromShopify({
    admin: admin as never as { graphql: AdminGraphqlClientArg },
    shop,
    force: url.searchParams.has("charge_id") || url.searchParams.get("confirmed") === "1",
  });
  const freshShop = await import("../db.server").then(({ default: prisma }) =>
    prisma.shop.findUnique({
      where: { id: shop.id },
      include: { activeSubscription: { include: { plan: true } } },
    }),
  );
  const effectiveShop = freshShop ?? shop;
  // The app is never blocked: without a subscription the store is on the
  // Free plan. Items beyond the plan quotas are paused here.
  const quotas = await enforcePlanQuotas(effectiveShop);
  const [usage, entitlements] = await Promise.all([
    getPlanUsage(effectiveShop, quotas),
    getPlanEntitlements(effectiveShop),
  ]);
  // Admin language: Shopify adds ?locale= when it loads the app. Remembered
  // on the shop so emails (weekly report, lead alerts) use it too.
  const localeParam = url.searchParams.get("locale");
  const locale = resolveLocale(localeParam, request.headers.get("accept-language"));
  if (localeParam && readShopSettings(effectiveShop).adminLocale !== locale) {
    await updateShopSettings(effectiveShop.id, { adminLocale: locale });
  }
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    locale,
    shop: {
      domain: effectiveShop.domain,
      name: effectiveShop.name,
      currency: effectiveShop.currency,
    },
    usage,
    features: {
      bulkCreate: entitlements.bulkCreate,
      exports: entitlements.exports,
      attribution: entitlements.attribution,
    },
  };
};

type AdminGraphqlClientArg = (q: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: <T>() => Promise<T> }>;

export type AppRouteLoaderData = Awaited<ReturnType<typeof loader>>;

export default function App() {
  const { apiKey, locale: loadedLocale } = useLoaderData<typeof loader>();
  // Later revalidations no longer carry ?locale=: keep the language the app was opened with.
  const [locale] = useState(loadedLocale);
  if (typeof document !== "undefined") setClientLocale(locale);

  return (
    <AppProvider embedded apiKey={apiKey}>
      {/* Admin sidebar entries (Shopify chrome) — the in-app sidebar stays the main
          navigation. The app name already links to the dashboard (/app). */}
      <s-app-nav>
        <s-link href="/app/create">{t("Create QR code")}</s-link>
        <s-link href="/app/qr-manager">{t("My QR codes")}</s-link>
        <s-link href="/app/bulk">{t("Bulk create")}</s-link>
        <s-link href="/app/analytics">{t("Analytics")}</s-link>
        <s-link href="/app/campaigns">{t("Campaigns")}</s-link>
        <s-link href="/app/settings">{t("Settings")}</s-link>
        <s-link href="/app/pricing">{t("Plans")}</s-link>
      </s-app-nav>
      <AppShell />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return <RouteError error={useRouteError()} />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
