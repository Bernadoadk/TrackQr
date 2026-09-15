import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  BillingReplacementBehavior,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

type ShopifyAppConfig = Parameters<typeof shopifyApp>[0];
type ShopifySessionStorage = NonNullable<ShopifyAppConfig["sessionStorage"]>;

const prismaSessionStorage =
  new PrismaSessionStorage(prisma) as unknown as ShopifySessionStorage;

/**
 * Shopify managed-billing plan names. The Free plan has no entry on purpose:
 * it is the absence of a subscription (see app/lib/plan.server.ts).
 */
export const TRACKQR_BILLING_PLAN_NAMES = {
  starter: {
    MONTHLY: "TrackQr Starter",
    ANNUAL: "TrackQr Starter Annual",
  },
  growth: {
    MONTHLY: "TrackQr Growth",
    ANNUAL: "TrackQr Growth Annual",
  },
} as const;

/** USD amounts charged through Shopify — keep in sync with the Plan seed. */
export const TRACKQR_BILLING_AMOUNTS = {
  starter: { MONTHLY: 9.0, ANNUAL: 84.0 },
  growth: { MONTHLY: 29.0, ANNUAL: 276.0 },
} as const;

export type TrackQrBillingPlanId = keyof typeof TRACKQR_BILLING_PLAN_NAMES;
export type TrackQrBillingCycle = "MONTHLY" | "ANNUAL";
export type TrackQrBillingPlanName =
  (typeof TRACKQR_BILLING_PLAN_NAMES)[TrackQrBillingPlanId][TrackQrBillingCycle];

export function getTrackQrBillingPlanName(
  planId: string,
  cycle: TrackQrBillingCycle,
): TrackQrBillingPlanName | null {
  if (!isTrackQrBillingPlanId(planId)) return null;
  return TRACKQR_BILLING_PLAN_NAMES[planId][cycle];
}

export function parseTrackQrBillingPlanName(
  name: string,
): { planId: TrackQrBillingPlanId; cycle: TrackQrBillingCycle } | null {
  const normalized = name
    .toLowerCase()
    .replace(/^track\s*qr\s*/, "")
    .replace(/^trackqr\s*/, "")
    .replace(/[()]/g, "")
    .trim()
    .replace(/\s+/g, " ");

  for (const [planId, names] of Object.entries(TRACKQR_BILLING_PLAN_NAMES)) {
    const monthly = names.MONTHLY
      .toLowerCase()
      .replace(/^trackqr\s*/, "")
      .trim();
    const annual = names.ANNUAL
      .toLowerCase()
      .replace(/^trackqr\s*/, "")
      .trim();

    if (normalized === monthly || normalized === planId) {
      return { planId: planId as TrackQrBillingPlanId, cycle: "MONTHLY" };
    }
    if (normalized === annual || normalized === `${planId} annual`) {
      return { planId: planId as TrackQrBillingPlanId, cycle: "ANNUAL" };
    }
  }

  return null;
}

function isTrackQrBillingPlanId(planId: string): planId is TrackQrBillingPlanId {
  return planId in TRACKQR_BILLING_PLAN_NAMES;
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: prismaSessionStorage,
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  billing: {
    [TRACKQR_BILLING_PLAN_NAMES.starter.MONTHLY]: {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [
        {
          amount: TRACKQR_BILLING_AMOUNTS.starter.MONTHLY,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [TRACKQR_BILLING_PLAN_NAMES.starter.ANNUAL]: {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [
        {
          amount: TRACKQR_BILLING_AMOUNTS.starter.ANNUAL,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
    },
    [TRACKQR_BILLING_PLAN_NAMES.growth.MONTHLY]: {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [
        {
          amount: TRACKQR_BILLING_AMOUNTS.growth.MONTHLY,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [TRACKQR_BILLING_PLAN_NAMES.growth.ANNUAL]: {
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [
        {
          amount: TRACKQR_BILLING_AMOUNTS.growth.ANNUAL,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
    },
  } as ShopifyAppConfig["billing"],
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
