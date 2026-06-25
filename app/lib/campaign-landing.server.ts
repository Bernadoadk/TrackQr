import type { Campaign, Shop } from "@prisma/client";
import prisma from "../db.server";

type CampaignBlock = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  layout?: { padding: string; align: string; bg: string };
  visibility?: { mobile: boolean; desktop: boolean };
};

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function campaignLandingData(campaign: Campaign & { shop: Shop }, isPreview = false) {
  const blocks = campaign.blocks as CampaignBlock[];
  const qrIds = Array.from(new Set(blocks.map(b => String(b.props?.qrId || "")).filter(Boolean)));
  const qrRows = qrIds.length
    ? await prisma.qrCode.findMany({
        where: { shopId: campaign.shopId, id: { in: qrIds }, archivedAt: null },
        select: { id: true, name: true, slug: true, design: true, label: true },
      })
    : [];
  const appUrl = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "");

  return {
    name: campaign.name,
    slug: campaign.slug,
    isPreview,
    status: campaign.status,
    shopDomain: campaign.shop.domain,
    blocks,
    qrById: Object.fromEntries(qrRows.map(q => [q.id, {
      id: q.id,
      name: q.name,
      slug: q.slug,
      scanUrl: appUrl ? `${appUrl}/s/${q.slug}` : `/s/${q.slug}`,
      design: jsonRecord(q.design),
      label: jsonRecord(q.label),
    }])),
  };
}

export type CampaignLandingData = Awaited<ReturnType<typeof campaignLandingData>>;
