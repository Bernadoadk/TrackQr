import prisma from "../db.server";
import type { Plan, Shop, Subscription } from "@prisma/client";
import { getBillingAccess, pauseShopPublicSurfaces } from "./plan.server";
import { getTrackQrBillingPlanName, parseTrackQrBillingPlanName } from "../shopify.server";

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
        name?: string | null;
        status: string;
        currentPeriodEnd?: string | null;
        test?: boolean | null;
      }>;
    } | null;
  };
}

export type BillingCycleInput = "MONTHLY" | "ANNUAL";

interface AdminGraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: <T>() => Promise<T> }>;
}

interface ShopifyBillingClient {
  request: (options: {
    plan: string;
    isTest?: boolean;
    returnUrl?: string;
    trialDays?: number;
  }) => Promise<unknown>;
  cancel?: (options: {
    subscriptionId: string;
    isTest?: boolean;
    prorate?: boolean;
  }) => Promise<unknown>;
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
    "If this app is still being tested from a production deployment, set TEST_MODE=true or TEST_MODE=development so Shopify creates test subscriptions.",
  ].join(" ");
}

export function getShopifyBillingMode(): "development" | "production" {
  const raw = process.env.TEST_MODE?.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  if (raw) {
    if (["1", "true", "yes", "on", "test", "testing", "development", "dev"].includes(raw)) {
      return "development";
    }
    if (["0", "false", "no", "off", "live", "production", "prod"].includes(raw)) {
      return "production";
    }
    console.warn(`[billing] Unknown TEST_MODE value "${process.env.TEST_MODE}". Falling back to NODE_ENV.`);
  }
  return process.env.NODE_ENV !== "production" ? "development" : "production";
}

export function isShopifyBillingTestMode() {
  return getShopifyBillingMode() === "development";
}

export function shopifyBillingModeLabel() {
  return getShopifyBillingMode();
}

export function shopifyBillingModeDescription() {
  if (isShopifyBillingTestMode()) {
    return "Shopify test subscriptions are enabled. Merchants will see a test charge confirmation.";
  }
  return "Shopify live subscriptions are enabled. Merchants will create real recurring charges.";
}

function extractConfirmationUrl(response: Response): string | null {
  return (
    response.headers.get("Location") ||
    response.headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url") ||
    null
  );
}

async function extractConfirmationUrlAsync(response: Response): Promise<string | null> {
  const fromHeaders = extractConfirmationUrl(response);
  if (fromHeaders) return fromHeaders;
  try {
    const body = await response.text();
    const match = body.match(/https:\/\/[^\s"'<>]+confirm[^\s"'<>]*/);
    if (match) return match[0];
  } catch {
    /* ignore */
  }
  return null;
}

async function requestBillingConfirmationUrl(
  billing: ShopifyBillingClient,
  options: { plan: string; isTest: boolean; returnUrl: string; trialDays: number },
): Promise<{ confirmationUrl: string; shopifyId?: string | null }> {
  try {
    const result = await billing.request(options);
    if (result instanceof Response) {
      const confirmationUrl = await extractConfirmationUrlAsync(result);
      if (confirmationUrl) return { confirmationUrl };
    }

    if (result && typeof result === "object") {
      const record = result as Record<string, unknown>;
      if (typeof record.confirmationUrl === "string") {
        const appSubscription = record.appSubscription as { id?: unknown } | undefined;
        return {
          confirmationUrl: record.confirmationUrl,
          shopifyId: typeof appSubscription?.id === "string" ? appSubscription.id : null,
        };
      }
    }
  } catch (error) {
    if (error instanceof Response) {
      const confirmationUrl = await extractConfirmationUrlAsync(error);
      if (confirmationUrl) return { confirmationUrl };
    }
    if (isForbiddenGraphqlError(error)) {
      console.warn("[billing] Shopify billing checkout failed with 403 Forbidden.");
      throw new Error(shopifyBillingForbiddenMessage());
    }
    throw error;
  }

  throw new Error("Shopify did not return a confirmation URL.");
}

/**
 * Initiate a Shopify managed subscription. Returns the merchant-facing
 * confirmation URL. The local Subscription row is created in PENDING; we
 * wait for the merchant to approve in Shopify admin, then sync via the
 * app_subscriptions/update webhook.
 */
export async function startSubscription(opts: {
  admin: AdminGraphqlClient;
  billing?: ShopifyBillingClient;
  shop: Shop;
  plan: Plan;
  cycle: BillingCycleInput;
  appUrl: string;
  host?: string | null;
  trialDays?: number;
  test?: boolean;
}): Promise<{ confirmationUrl: string; subscription: Subscription }> {
  const billingPlanName = getTrackQrBillingPlanName(opts.plan.id, opts.cycle);
  if (!billingPlanName) throw new Error(`Unknown Shopify billing plan: ${opts.plan.id}`);

  const returnUrl = new URL(`${opts.appUrl.replace(/\/$/, "")}/billing/return`);
  returnUrl.searchParams.set("shop", opts.shop.domain);
  if (opts.host) returnUrl.searchParams.set("host", opts.host);
  returnUrl.searchParams.set("confirmed", "1");

  if (!opts.billing) throw new Error("Shopify billing helper is unavailable for this request.");
  const requestedTrialDays = Math.max(0, opts.trialDays ?? opts.plan.trialDays);
  const { confirmationUrl, shopifyId } = await requestBillingConfirmationUrl(opts.billing, {
    plan: billingPlanName,
    isTest: opts.test ?? isShopifyBillingTestMode(),
    returnUrl: returnUrl.toString(),
    trialDays: requestedTrialDays,
  });

  const sub = await prisma.subscription.create({
    data: {
      shopId: opts.shop.id,
      planId: opts.plan.id,
      cycle: opts.cycle,
      status: "PENDING",
      shopifyId,
      trialEndsAt: requestedTrialDays > 0 ? new Date(Date.now() + requestedTrialDays * 86400000) : null,
    },
  });

  return { confirmationUrl, subscription: sub };
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
          name
          status
          currentPeriodEnd
          test
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
      const parsed = remote.name ? parseTrackQrBillingPlanName(remote.name) : null;
      return prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: "ACTIVE",
          currentPeriodEnd: remote.currentPeriodEnd ? new Date(remote.currentPeriodEnd) : sub.currentPeriodEnd,
          ...(parsed ?? {}),
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

  for (const remote of activeSubscriptions.filter(sub => sub.status === "ACTIVE")) {
    const parsed = remote.name ? parseTrackQrBillingPlanName(remote.name) : null;
    if (!parsed) continue;

    const local =
      localSubscriptions.find(sub => sub.shopifyId === remote.id) ??
      localSubscriptions.find(sub =>
        !sub.shopifyId &&
        sub.planId === parsed.planId &&
        sub.cycle === parsed.cycle &&
        sub.status === "PENDING",
      );

    if (local) {
      await prisma.subscription.update({
        where: { id: local.id },
        data: {
          planId: parsed.planId,
          cycle: parsed.cycle,
          status: "ACTIVE",
          shopifyId: remote.id,
          currentPeriodEnd: remote.currentPeriodEnd ? new Date(remote.currentPeriodEnd) : local.currentPeriodEnd,
        },
      });
    } else {
      await prisma.subscription.create({
        data: {
          shopId: opts.shopId,
          planId: parsed.planId,
          cycle: parsed.cycle,
          status: "ACTIVE",
          shopifyId: remote.id,
          currentPeriodEnd: remote.currentPeriodEnd ? new Date(remote.currentPeriodEnd) : null,
        },
      });
    }
  }

  const activeLocal = await prisma.subscription.findFirst({
    where: activeIds.size
      ? { shopId: opts.shopId, shopifyId: { in: [...activeIds] }, status: "ACTIVE" }
      : { shopId: opts.shopId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  await prisma.shop.update({
    where: { id: opts.shopId },
    data: { activeSubscriptionId: activeLocal?.id ?? null },
  });
}

/** Cancel an active subscription. */
export async function cancelSubscription(opts: { admin: AdminGraphqlClient; billing?: ShopifyBillingClient; subscription: Subscription }): Promise<void> {
  const activeIds = new Set<string>();
  try {
    const response = await opts.admin.graphql(`#graphql
      query CurrentAppSubscriptions {
        currentAppInstallation {
          activeSubscriptions {
            id
            status
          }
        }
      }
    `);
    const json = await response.json<ActiveSubscriptionsPayload>();
    for (const sub of json.data?.currentAppInstallation?.activeSubscriptions ?? []) {
      if (sub.status === "ACTIVE") activeIds.add(sub.id);
    }
  } catch (error) {
    if (isForbiddenGraphqlError(error)) {
      console.warn("[billing] Could not list Shopify subscriptions before cancel because Admin GraphQL returned 403 Forbidden.");
    } else {
      throw error;
    }
  }

  if (opts.subscription.shopifyId) activeIds.add(opts.subscription.shopifyId);

  for (const id of activeIds) {
    try {
      if (opts.billing?.cancel) {
        await opts.billing.cancel({
          subscriptionId: id,
          isTest: isShopifyBillingTestMode(),
          prorate: true,
        });
        continue;
      }

      const mutation = `#graphql
        mutation AppSubscriptionCancel($id: ID!, $prorate: Boolean) {
          appSubscriptionCancel(id: $id, prorate: $prorate) {
            userErrors { field message }
            appSubscription { id status }
          }
        }
      `;
      const response = await opts.admin.graphql(mutation, { variables: { id, prorate: true } });
      const json = await response.json<AppSubscriptionCancelPayload>();
      if (json.data.appSubscriptionCancel.userErrors.length) {
        throw new Error(json.data.appSubscriptionCancel.userErrors.map(e => e.message).join("; "));
      }
    } catch (error) {
      if (isForbiddenGraphqlError(error)) {
        console.warn(`[billing] Shopify cancellation skipped for ${id} because Admin GraphQL returned 403 Forbidden.`);
        continue;
      }
      throw error;
    }
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
