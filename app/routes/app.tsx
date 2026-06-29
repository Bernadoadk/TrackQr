import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useLoaderData } from "react-router";
import { AppShell } from "../components/layout/AppShell";
import { RouteError } from "../components/RouteError";
import { requireShop } from "../lib/shop.server";
import { getBillingAccess, getPlanUsage, pauseShopPublicSurfaces } from "../lib/plan.server";
import { syncShopifySubscriptions } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  await syncShopifySubscriptions({
    admin: admin as never as { graphql: AdminGraphqlClientArg },
    shopId: shop.id,
  });
  const freshShop = await import("../db.server").then(({ default: prisma }) =>
    prisma.shop.findUnique({
      where: { id: shop.id },
      include: { activeSubscription: { include: { plan: true } } },
    }),
  );
  const effectiveShop = freshShop ?? shop;
  const access = await getBillingAccess(effectiveShop);
  if (!access.hasAccess) {
    await pauseShopPublicSurfaces(effectiveShop.id);
    const url = new URL(request.url);
    const path = url.pathname;
    if (path !== "/app/pricing") {
      const next = new URLSearchParams({ billing: "required" });
      const shopParam = url.searchParams.get("shop");
      const hostParam = url.searchParams.get("host");
      if (shopParam) next.set("shop", shopParam);
      if (hostParam) next.set("host", hostParam);
      throw redirect(`/app/pricing?${next.toString()}`);
    }
  }
  const usage = await getPlanUsage(effectiveShop);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: {
      domain: shop.domain,
      name: shop.name,
      currency: shop.currency,
    },
    usage,
  };
};

type AdminGraphqlClientArg = (q: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: <T>() => Promise<T> }>;

export type AppRouteLoaderData = Awaited<ReturnType<typeof loader>>;

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
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
