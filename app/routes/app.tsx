import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useLoaderData } from "react-router";
import { AppShell } from "../components/layout/AppShell";
import { requireShop } from "../lib/shop.server";
import { getPlanUsage } from "../lib/plan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const usage = await getPlanUsage(shop);
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
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
