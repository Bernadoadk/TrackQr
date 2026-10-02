import type { Campaign, Shop } from "@prisma/client";
import prisma from "../db.server";
import { campaignPageSettingsForPlan } from "./campaign-settings";
import { applyDesignEntitlement } from "./qr-standard";
import { scanUrl } from "./qr.server";
import { storeHosts } from "./shop-settings.server";
import type { CampaignLang } from "./campaign-copy";

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
  /** GA4 / Meta Pixel on the page (Growth). */
  pixels: boolean;
  /** Unique discount rewards on capture blocks (Growth). */
  rewards: boolean;
  /** Scan that led to this visit — appended to store links for attribution. */
  attribution?: { scanId: string; qrSlug: string } | null;
  /** Visitor language for the page's interface text (buttons, form messages…). */
  lang?: CampaignLang;
}

/** Keep only well-formed scan ids / slugs coming back from the URL. */
export function parseAttributionParams(url: URL): { scanId: string; qrSlug: string } | null {
  const scanId = url.searchParams.get("tqr_scan") ?? "";
  const qrSlug = url.searchParams.get("tqr_qr") ?? "";
  if (!/^[a-z0-9]{20,40}$/i.test(scanId) || !/^[A-Za-z0-9]{4,12}$/.test(qrSlug)) return null;
  return { scanId, qrSlug };
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

  return {
    name: campaign.name,
    slug: campaign.slug,
    isPreview: opts.isPreview ?? false,
    lang: opts.lang ?? "en",
    status: campaign.status,
    shopDomain: campaign.shop.domain,
    storeHosts: storeHosts(campaign.shop),
    attribution: opts.attribution ?? null,
    rewardsEnabled: opts.rewards,
    settings: campaignPageSettingsForPlan(campaign.settings, { forcePoweredBy: opts.forcePoweredBy, pixels: opts.pixels }),
    blocks,
    // Keyed by the block's QR choice. Only what the page renders is exposed
    // (no internal ids beyond the block reference).
    qrById: Object.fromEntries(qrRows.map(q => {
      const appearance = applyDesignEntitlement(opts.customDesign, q.design, q.label);
      return [q.id, {
        name: q.name,
        scanUrl: scanUrl(q.slug),
        design: appearance.design,
        label: appearance.label,
      }];
    })),
  };
}

export type CampaignLandingData = Awaited<ReturnType<typeof campaignLandingData>>;
