import { redirect as routerRedirect, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const host = url.searchParams.get("host");
  const next = new URLSearchParams({ confirmed: "1" });
  if (shop) next.set("shop", shop);
  if (host) next.set("host", host);

  if (shop || host) {
    return routerRedirect(`/app/pricing?${next.toString()}`);
  }

  const { redirect } = await authenticate.admin(request);
  return redirect(`/app/pricing?${next.toString()}`, { target: "_parent" });
};
