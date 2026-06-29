import prisma from "../db.server";
import type { Plan, Shop, Subscription } from "@prisma/client";
import { getBillingAccess, pauseShopPublicSurfaces } from "./plan.server";

interface AppSubscriptionCreatePayload {
  data: {
    appSubscriptionCreate: {
      userErrors: { field: string[]; message: string }[];
      confirmationUrl: string | null;
      appSubscription: { id: string; status: string } | null;
    };
  };
}

interface AppSubscriptionCancelPayload {
  data: {
    appSubscriptionCancel: {
      userErrors: { field: string[]; message: string }[];
      appSubscription: { id: string; status: string } | null;
    };
  };
}

interface ActiveSubscriptionsPayload {
  data?: {
    currentAppInstallation?: {
      activeSubscriptions?: Array<{
        id: string;
        status: string;
        currentPeriodEnd?: string | null;
      }>;
    } | null;
  };
}

export type BillingCycleInput = "MONTHLY" | "ANNUAL";

interface AdminGraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: <T>() => Promise<T> }>;
}

export function isForbiddenGraphqlError(error: unknown): boolean {
  if (error instanceof Response) return error.status === 403;
  if (!error || typeof error !== "object") return false;

  const record = error as Record<string, unknown>;
  if (record.status === 403 || record.networkStatusCode === 403) return true;

  const errors = record.errors;
  if (errors && typeof errors === "object") {
    const nested = errors as Record<string, unknown>;
    if (nested.networkStatusCode === 403) return true;
    if (typeof nested.message === "string" && nested.message.includes("Forbidden")) return true;
  }

  return typeof record.message === "string" && record.message.includes("Forbidden");
}

export function shopifyBillingForbiddenMessage() {
  return [
    "Shopify returned 403 Forbidden while creating the billing checkout.",
    "This usually means the app installation/session is not allowed to create managed billing charges for this shop.",
    "Reinstall or re-authenticate the app on this store, then verify the deployed app uses the same Shopify app client ID/secret and billing mode.",
    "If this app is still being tested from a production deployment, set TEST_MODE=true so Shopify creates test subscriptions.",
  ].join(" ");
}

export function isShopifyBillingTestMode() {
  const raw = process.env.TEST_MODE?.trim().toLowerCase();
  if (raw) {
    return ["1", "true", "yes", "test", "testing", "development", "dev"].includes(raw);
  }
  return process.env.NODE_ENV !== "production";
}

export function shopifyBillingModeLabel() {
  return isShopifyBillingTestMode() ? "development" : "production";
}

/**
 * Initiate a Shopify managed subscription. Returns the merchant-facing
 * confirmation URL. The local Subscription row is created in PENDING; we
 * wait for the merchant to approve in Shopify admin, then sync via the
 * app_subscriptions/update webhook.
 */
export async function startSubscription(opts: {
  admin: AdminGraphqlClient;
  shop: Shop;
  plan: Plan;
  cycle: BillingCycleInput;
  appUrl: string;
  host?: string | null;
  trialDays?: number;
  test?: boolean;
}): Promise<{ confirmationUrl: string; subscription: Subscription }> {
  const isAnnual = opts.cycle === "ANNUAL";
  const monthlyCents = isAnnual ? opts.plan.priceAnnual : opts.plan.priceMonthly;
  const amount = (monthlyCents / 100).toFixed(2);
  const interval = isAnnual ? "ANNUAL" : "EVERY_30_DAYS";
  const name = `TrackQr ${opts.plan.name}${isAnnual ? " (annual)" : ""}`;
  const returnUrl = new URL(`${opts.appUrl.replace(/\/$/, "")}/billing/return`);
  returnUrl.searchParams.set("shop", opts.shop.domain);
  if (opts.host) returnUrl.searchParams.set("host", opts.host);
  returnUrl.searchParams.set("confirmed", "1");

  // Annual subscriptions use a fixed price (12× monthly equivalent).
  const totalAmount = isAnnual ? (monthlyCents * 12 / 100).toFixed(2) : amount;

  const mutation = `#graphql
    mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $trialDays: Int!, $test: Boolean!, $replacementBehavior: AppSubscriptionReplacementBehavior!, $lineItems: [AppSubscriptionLineItemInput!]!) {
      appSubscriptionCreate(
        name: $name,
        returnUrl: $returnUrl,
        trialDays: $trialDays,
        test: $test,
        replacementBehavior: $replacementBehavior,
        lineItems: $lineItems
      ) {
        userErrors { field message }
        confirmationUrl
        appSubscription { id status }
      }
    }
  `;

  const variables = {
    name,
    returnUrl: returnUrl.toString(),
    trialDays: Math.max(0, opts.trialDays ?? opts.plan.trialDays),
    test: opts.test ?? isShopifyBillingTestMode(),
    replacementBehavior: "APPLY_IMMEDIATELY",
    lineItems: [{
      plan: {
        appRecurringPricingDetails: {
          price: { amount: Number(totalAmount), currencyCode: "USD" },
          interval,
        },
      },
    }],
  };

  let response: Awaited<ReturnType<AdminGraphqlClient["graphql"]>>;
  try {
    response = await opts.admin.graphql(mutation, { variables });
  } catch (error) {
    if (isForbiddenGraphqlError(error)) {
      console.warn("[billing] Shopify billing checkout failed with 403 Forbidden.");
      throw new Error(shopifyBillingForbiddenMessage());
    }
    throw error;
  }
  const json = await response.json<AppSubscriptionCreatePayload>();
  const result = json.data.appSubscriptionCreate;
  if (result.userErrors.length) {
    throw new Error(`Shopify billing error: ${result.userErrors.map(e => e.message).join("; ")}`);
  }
  if (!result.confirmationUrl || !result.appSubscription) {
    throw new Error("Shopify did not return a confirmation URL.");
  }

  const sub = await prisma.subscription.create({
    data: {
      shopId: opts.shop.id,
      planId: opts.plan.id,
      cycle: opts.cycle,
      status: "PENDING",
      shopifyId: result.appSubscription.id,
      trialEndsAt: (opts.trialDays ?? opts.plan.trialDays) > 0 ? new Date(Date.now() + (opts.trialDays ?? opts.plan.trialDays) * 86400000) : null,
    },
  });

  return { confirmationUrl: result.confirmationUrl, subscription: sub };
}

export async function syncShopifySubscriptions(opts: {
  admin: AdminGraphqlClient;
  shopId: string;
}): Promise<void> {
  const query = `#graphql
    query CurrentAppSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          id
          status
          currentPeriodEnd
        }
      }
    }
  `;

  let response: Awaited<ReturnType<AdminGraphqlClient["graphql"]>>;
  try {
    response = await opts.admin.graphql(query);
  } catch (error) {
    if (isForbiddenGraphqlError(error)) {
      console.warn(
        "[billing] Shopify subscription sync skipped because Admin GraphQL returned 403 Forbidden.",
      );
      return;
    }
    throw error;
  }
  const json = await response.json<ActiveSubscriptionsPayload>();
  const activeSubscriptions = json.data?.currentAppInstallation?.activeSubscriptions ?? [];
  const activeIds = new Set(
    activeSubscriptions
      .filter(sub => sub.status === "ACTIVE")
      .map(sub => sub.id),
  );

  const localSubscriptions = await prisma.subscription.findMany({
    where: { shopId: opts.shopId },
    orderBy: { createdAt: "desc" },
  });

  const updates = localSubscriptions.map(sub => {
    const remote = activeSubscriptions.find(item => item.id === sub.shopifyId);
    if (remote?.status === "ACTIVE") {
      return prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: "ACTIVE",
          currentPeriodEnd: remote.currentPeriodEnd ? new Date(remote.currentPeriodEnd) : sub.currentPeriodEnd,
        },
      });
    }
    if (sub.status === "ACTIVE" && sub.shopifyId && !activeIds.has(sub.shopifyId)) {
      return prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "PENDING" },
      });
    }
    return null;
  }).filter((update): update is Exclude<typeof update, null> => Boolean(update));

  if (updates.length) await prisma.$transaction(updates);

  const activeLocal = await prisma.subscription.findFirst({
    where: { shopId: opts.shopId, shopifyId: { in: [...activeIds] }, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  await prisma.shop.update({
    where: { id: opts.shopId },
    data: { activeSubscriptionId: activeLocal?.id ?? null },
  });
}

/** Cancel an active subscription. */
export async function cancelSubscription(opts: { admin: AdminGraphqlClient; subscription: Subscription }): Promise<void> {
  if (!opts.subscription.shopifyId) return;
  const mutation = `#graphql
    mutation AppSubscriptionCancel($id: ID!) {
      appSubscriptionCancel(id: $id) {
        userErrors { field message }
        appSubscription { id status }
      }
    }
  `;
  const response = await opts.admin.graphql(mutation, { variables: { id: opts.subscription.shopifyId } });
  const json = await response.json<AppSubscriptionCancelPayload>();
  if (json.data.appSubscriptionCancel.userErrors.length) {
    throw new Error(json.data.appSubscriptionCancel.userErrors.map(e => e.message).join("; "));
  }
  await prisma.subscription.update({
    where: { id: opts.subscription.id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  await prisma.shop.update({
    where: { id: opts.subscription.shopId },
    data: { activeSubscriptionId: null },
  });
  const shop = await prisma.shop.findUnique({
    where: { id: opts.subscription.shopId },
    include: { activeSubscription: { include: { plan: true } } },
  });
  if (shop && !(await getBillingAccess(shop)).hasAccess) {
    await pauseShopPublicSurfaces(opts.subscription.shopId);
  }
}

/**
 * Mark a subscription as confirmed/active. Called when the merchant returns
 * with ?confirmed=1, OR when the app_subscriptions/update webhook arrives.
 */
export async function markSubscriptionActive(opts: { shopId: string; shopifyId?: string; subscriptionId?: string }): Promise<void> {
  const sub = opts.subscriptionId
    ? await prisma.subscription.findUnique({ where: { id: opts.subscriptionId } })
    : opts.shopifyId
    ? await prisma.subscription.findUnique({ where: { shopifyId: opts.shopifyId } })
    : await prisma.subscription.findFirst({ where: { shopId: opts.shopId, status: "PENDING" }, orderBy: { createdAt: "desc" } });

  if (!sub) return;

  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: sub.id },
      data: { status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 30 * 86400000) },
    }),
    prisma.shop.update({
      where: { id: opts.shopId },
      data: { activeSubscriptionId: sub.id },
    }),
  ]);
}
