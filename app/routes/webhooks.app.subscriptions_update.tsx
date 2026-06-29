import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopByDomain } from "../lib/shop.server";
import { getBillingAccess, pauseShopPublicSurfaces } from "../lib/plan.server";

interface WebhookPayload {
  app_subscription?: {
    admin_graphql_api_id?: string;
    status?: string;
    current_period_end?: string;
  };
}

const STATUS_MAP: Record<string, "ACTIVE" | "CANCELLED" | "EXPIRED" | "DECLINED" | "FROZEN" | "PENDING"> = {
  ACTIVE: "ACTIVE",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  DECLINED: "DECLINED",
  FROZEN: "FROZEN",
  PENDING: "PENDING",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const event = payload as WebhookPayload;
  const data = event.app_subscription;
  if (!data?.admin_graphql_api_id) return new Response();

  const shopRow = await getShopByDomain(shop);
  if (!shopRow) return new Response();

  const status = STATUS_MAP[(data.status ?? "").toUpperCase()] ?? "PENDING";
  const sub = await prisma.subscription.update({
    where: { shopifyId: data.admin_graphql_api_id },
    data: {
      status,
      currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : undefined,
      cancelledAt: status === "CANCELLED" ? new Date() : undefined,
    },
  }).catch(() => null);

  if (sub) {
    if (status === "ACTIVE") {
      await prisma.shop.update({
        where: { id: shopRow.id },
        data: { activeSubscriptionId: sub.id },
      });
    } else if (status === "CANCELLED" || status === "EXPIRED" || status === "DECLINED") {
      // Only clear if THIS subscription was the active one.
      if (shopRow.activeSubscriptionId === sub.id) {
        await prisma.shop.update({
          where: { id: shopRow.id },
          data: { activeSubscriptionId: null },
        });
      }
      const freshShop = await prisma.shop.findUnique({
        where: { id: shopRow.id },
        include: { activeSubscription: { include: { plan: true } } },
      });
      if (freshShop && !(await getBillingAccess(freshShop)).hasAccess) {
        await pauseShopPublicSurfaces(shopRow.id);
      }
    }
  }

  console.log(`[webhook] ${topic} for ${shop} → ${status}`);
  return new Response();
};
