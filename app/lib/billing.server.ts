import prisma from "../db.server";
import type { Plan, Shop, Subscription } from "@prisma/client";

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

export type BillingCycleInput = "MONTHLY" | "ANNUAL";

interface AdminGraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: <T>() => Promise<T> }>;
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
  test?: boolean;
}): Promise<{ confirmationUrl: string; subscription: Subscription }> {
  const isAnnual = opts.cycle === "ANNUAL";
  const monthlyCents = isAnnual ? opts.plan.priceAnnual : opts.plan.priceMonthly;
  const amount = (monthlyCents / 100).toFixed(2);
  const interval = isAnnual ? "ANNUAL" : "EVERY_30_DAYS";
  const name = `TrackQr ${opts.plan.name}${isAnnual ? " (annual)" : ""}`;
  const returnUrl = `${opts.appUrl.replace(/\/$/, "")}/app/pricing?confirmed=1`;

  // Annual subscriptions use a fixed price (12× monthly equivalent).
  const totalAmount = isAnnual ? (monthlyCents * 12 / 100).toFixed(2) : amount;

  const mutation = `#graphql
    mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $trialDays: Int!, $test: Boolean!, $lineItems: [AppSubscriptionLineItemInput!]!) {
      appSubscriptionCreate(
        name: $name,
        returnUrl: $returnUrl,
        trialDays: $trialDays,
        test: $test,
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
    returnUrl,
    trialDays: opts.plan.trialDays,
    test: opts.test ?? (process.env.NODE_ENV !== "production"),
    lineItems: [{
      plan: {
        appRecurringPricingDetails: {
          price: { amount: Number(totalAmount), currencyCode: "USD" },
          interval,
        },
      },
    }],
  };

  const response = await opts.admin.graphql(mutation, { variables });
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
      trialEndsAt: opts.plan.trialDays > 0 ? new Date(Date.now() + opts.plan.trialDays * 86400000) : null,
    },
  });

  return { confirmationUrl: result.confirmationUrl, subscription: sub };
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
