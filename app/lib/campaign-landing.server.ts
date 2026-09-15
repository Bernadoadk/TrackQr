import type { Campaign, Shop } from "@prisma/client";
import prisma from "../db.server";
import { campaignPageSettingsForPlan } from "./campaign-settings";
import { applyDesignEntitlement } from "./qr-standard";

type CampaignBlock = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  layout?: { padding: string; align: string; bg: string };
  visibility?: { mobile: boolean; desktop: boolean };
};

export interface CampaignLandingOptions {
  isPreview?: boolean;
  /** Plan entitlement — without it embedded QR blocks render in the standard style. */
  customDesign: boolean;
  /** Free-plan stores always show the "Powered by TrackQr" watermark. */
  forcePoweredBy: boolean;
}

export async function campaignLandingData(campaign: Campaign & { shop: Shop }, opts: CampaignLandingOptions) {
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
    isPreview: opts.isPreview ?? false,
    status: campaign.status,
    shopDomain: campaign.shop.domain,
    settings: campaignPageSettingsForPlan(campaign.settings, opts.forcePoweredBy),
    blocks,
    qrById: Object.fromEntries(qrRows.map(q => {
      const appearance = applyDesignEntitlement(opts.customDesign, q.design, q.label);
      return [q.id, {
        id: q.id,
        name: q.name,
        slug: q.slug,
        scanUrl: appUrl ? `${appUrl}/s/${q.slug}` : `/s/${q.slug}`,
        design: appearance.design,
        label: appearance.label,
      }];
    })),
  };
}

export type CampaignLandingData = Awaited<ReturnType<typeof campaignLandingData>>;
