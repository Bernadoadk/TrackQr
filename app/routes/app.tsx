import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useLoaderData } from "react-router";
import { AppShell } from "../components/layout/AppShell";
import { RouteError } from "../components/RouteError";
import { requireShop } from "../lib/shop.server";
import { enforcePlanQuotas, getPlanUsage } from "../lib/plan.server";
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
  // The app is never blocked: without a subscription the store is on the
  // Free plan. Items beyond the plan quotas are paused here.
  const quotas = await enforcePlanQuotas(effectiveShop);
  const usage = await getPlanUsage(effectiveShop, quotas);
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
