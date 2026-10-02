import crypto from "node:crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

/**
 * Capture-block rewards (Growth): every lead gets its own single-use
 * discount code. One Shopify code discount per (campaign, block, percent)
 * holds all the codes — the first code is created with the discount, the
 * next ones are added with discountRedeemCodeBulkAdd (live within seconds).
 * Usage limits apply to each code of a bulk set, so a code works once.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRewardCode(prefix = "TQR"): string {
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  const clean = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "TQR";
  return `${clean}-${out}`;
}

export interface RewardInput {
  shopDomain: string;
  campaignId: string;
  campaignName: string;
  blockId: string;
  /** Percent off, 5–50. */
  percent: number;
  prefix?: string;
}

type GqlResult<T> = { data?: T; errors?: { message: string }[] };

export async function issueRewardCode(input: RewardInput): Promise<{ code: string } | { error: string }> {
  const percent = Math.min(50, Math.max(5, Math.round(input.percent)));
  const code = generateRewardCode(input.prefix);
  try {
    const { admin } = await unauthenticated.admin(input.shopDomain);
    const existing = await prisma.campaignReward.findUnique({
      where: { campaignId_blockId_percent: { campaignId: input.campaignId, blockId: input.blockId, percent } },
    });

    if (existing) {
      const response = await admin.graphql(`#graphql
        mutation TrackQrRewardCodes($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
          discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
            bulkCreation { id }
            userErrors { field message code }
          }
        }
      `, { variables: { discountId: existing.discountNodeId, codes: [{ code }] } });
      const json = (await response.json()) as GqlResult<{
        discountRedeemCodeBulkAdd?: { userErrors: { message: string }[] };
      }>;
      const errors = json.data?.discountRedeemCodeBulkAdd?.userErrors ?? [];
      if (!errors.length && !json.errors?.length) return { code };
      // The discount was deleted in Shopify admin: forget it and start a new one.
      await prisma.campaignReward.delete({ where: { id: existing.id } }).catch(() => undefined);
    }

    const response = await admin.graphql(`#graphql
      mutation TrackQrRewardDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode { id }
          userErrors { field message }
        }
      }
    `, {
      variables: {
        basicCodeDiscount: {
          title: `TrackQr · ${input.campaignName.slice(0, 60)} · ${percent}% reward`,
          code,
          startsAt: new Date().toISOString(),
          context: { all: "ALL" },
          customerGets: {
            value: { percentage: percent / 100 },
            items: { all: true },
          },
          usageLimit: 1,
          appliesOncePerCustomer: true,
          combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
        },
      },
    });
    const json = (await response.json()) as GqlResult<{
      discountCodeBasicCreate?: { codeDiscountNode?: { id: string } | null; userErrors: { message: string }[] };
    }>;
    const payload = json.data?.discountCodeBasicCreate;
    const nodeId = payload?.codeDiscountNode?.id;
    if (!nodeId) {
      const message = payload?.userErrors?.map(e => e.message).join("; ") || json.errors?.map(e => e.message).join("; ");
      return { error: message || "Shopify did not create the reward discount." };
    }
    await prisma.campaignReward.upsert({
      where: { campaignId_blockId_percent: { campaignId: input.campaignId, blockId: input.blockId, percent } },
      create: { campaignId: input.campaignId, blockId: input.blockId, percent, discountNodeId: nodeId },
      update: { discountNodeId: nodeId },
    });
    return { code };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 300) : "Reward code failed" };
  }
}
