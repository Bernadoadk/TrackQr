import prisma from "../db.server";
import { z } from "zod";
import type { Campaign, CampaignStatus, Prisma } from "@prisma/client";
import { shortSlug, nameToSlug } from "./slug.server";
import { assertQuota, assertWithinQuota, type ShopWithPlan } from "./plan.server";
import { getQrStats } from "./analytics.server";

export const CreateCampaignSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  startAt: z.string().optional().nullable(),
  endAt: z.string().optional().nullable(),
});
export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;

export async function createCampaign(shop: ShopWithPlan, input: CreateCampaignInput): Promise<Campaign> {
  await assertQuota(shop, "campaigns");
  const parsed = CreateCampaignSchema.parse(input);

  // Slug from name + suffix to avoid collisions
  const base = nameToSlug(parsed.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = `${base}-${shortSlug(4).toLowerCase()}`;
    try {
      return await prisma.campaign.create({
        data: {
          shopId: shop.id,
          slug,
          name: parsed.name,
          description: parsed.description ?? null,
          startAt: parsed.startAt ? new Date(parsed.startAt) : null,
          endAt:   parsed.endAt   ? new Date(parsed.endAt)   : null,
          status: "DRAFT",
          blocks: [],
          settings: {},
        },
      });
    } catch (e: unknown) {
      if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("Could not create campaign");
}

const MAX_BLOCKS = 60;
const MAX_BLOCKS_BYTES = 400_000;

export async function saveBlocks(shopId: string, id: string, blocks: unknown[], name?: string, settings?: unknown) {
  const campaign = await prisma.campaign.findFirst({ where: { id, shopId } });
  if (!campaign) throw new Error("Campaign not found");
  if (!Array.isArray(blocks)) throw new Error("Invalid blocks");
  if (blocks.length > MAX_BLOCKS) throw new Error(`A campaign page can hold up to ${MAX_BLOCKS} blocks.`);
  if (JSON.stringify(blocks).length > MAX_BLOCKS_BYTES) throw new Error("This page is too large — remove a few blocks or images.");
  const data: Prisma.CampaignUpdateInput = { blocks: blocks as Prisma.InputJsonValue };
  if (typeof name === "string" && name.trim()) data.name = name.trim();
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    data.settings = settings as Prisma.InputJsonValue;
  }
  return prisma.campaign.update({ where: { id }, data });
}

const CAMPAIGN_STATUSES: CampaignStatus[] = ["DRAFT", "ACTIVE", "PAUSED", "ENDED"];

export async function setCampaignStatus(shop: ShopWithPlan, id: string, status: CampaignStatus) {
  if (!CAMPAIGN_STATUSES.includes(status)) throw new Error("Unknown campaign status");
  const campaign = await prisma.campaign.findFirst({ where: { id, shopId: shop.id } });
  if (!campaign) throw new Error("Campaign not found");
  // A merchant decision replaces any quota pause.
  const data: Record<string, unknown> = { status, quotaPausedAt: null };
  if (status === "ACTIVE") {
    // Publishing a campaign beyond the plan quota is blocked (it would be
    // paused again on the next page load anyway).
    if (campaign.status !== "ACTIVE") await assertWithinQuota(shop, "campaigns", campaign);
    data.publishedAt = new Date();
  }
  return prisma.campaign.update({ where: { id }, data });
}

export type CampaignPublicState = "live" | "draft" | "paused" | "scheduled" | "ended";

/**
 * What the public page should do right now, taking the merchant's start /
 * end dates into account (a published campaign with a future start date
 * stays hidden until then; past its end date it is ended).
 */
export function campaignPublicState(
  campaign: Pick<Campaign, "status" | "startAt" | "endAt">,
  now = new Date(),
): CampaignPublicState {
  if (campaign.status === "DRAFT") return "draft";
  if (campaign.status === "PAUSED") return "paused";
  if (campaign.status === "ENDED") return "ended";
  if (campaign.endAt && campaign.endAt <= now) return "ended";
  if (campaign.startAt && campaign.startAt > now) return "scheduled";
  return "live";
}

/** Persist the end of a campaign whose end date has passed. */
export async function endCampaignIfExpired(campaign: Pick<Campaign, "id" | "status" | "endAt">) {
  if (campaign.status === "ACTIVE" && campaign.endAt && campaign.endAt <= new Date()) {
    await prisma.campaign.updateMany({ where: { id: campaign.id, status: "ACTIVE" }, data: { status: "ENDED" } });
  }
}

/** Used by the public page when a campaign turns out to be beyond the plan quota. */
export async function pauseCampaignForQuota(id: string) {
  await prisma.campaign.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "PAUSED", quotaPausedAt: new Date() } });
}

/** Hard delete (cascades leads / views) — scoped to the shop. */
export async function deleteCampaign(shopId: string, id: string) {
  const { count } = await prisma.campaign.deleteMany({ where: { id, shopId } });
  if (!count) throw new Error("Campaign not found");
}

/** One row per human visit of a public campaign page (not previews). */
export async function recordCampaignView(campaignId: string, sessionToken: string | null) {
  try {
    await prisma.campaignView.create({ data: { campaignId, sessionToken } });
  } catch (err) {
    console.error("[campaign] recordCampaignView failed", err);
  }
}

export async function duplicateCampaign(shop: ShopWithPlan, id: string) {
  await assertQuota(shop, "campaigns");
  const source = await prisma.campaign.findFirst({ where: { id, shopId: shop.id } });
  if (!source) throw new Error("Campaign not found");
  return createCampaign(shop, {
    name: `${source.name} (copy)`,
    description: source.description,
  }).then(async created => {
    await prisma.campaign.update({
      where: { id: created.id },
      data: {
        blocks: source.blocks as Prisma.InputJsonValue,
        settings: source.settings as Prisma.InputJsonValue,
      },
    });
    return created;
  });
}

export interface CampaignListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  startAt: Date | null;
  endAt: Date | null;
  createdAt: Date;
  scans: number;
  views: number;
  leads: number;
  /** Leads / page views, in percent. */
  signupRate: number;
  conversions: number;
  /** Attributed revenue in cents. */
  revenue: number;
  convRate: number;
}

export interface CampaignListAccess {
  earliestScanDate?: Date | null;
  attribution?: boolean;
}

export async function listCampaigns(shopId: string, access: CampaignListAccess = {}): Promise<CampaignListItem[]> {
  const since = access.earliestScanDate ?? new Date(0);
  const rows = await prisma.campaign.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    include: {
      qrCode: { select: { id: true } },
      _count: { select: { leads: true } },
    },
  });
  const campaignIds = rows.map(c => c.id);
  const qrIds = rows.map(c => c.qrCode?.id).filter((id): id is string => !!id);
  const [qrStats, viewRows] = await Promise.all([
    getQrStats(shopId, qrIds, { earliestScanDate: access.earliestScanDate ?? null, attribution: access.attribution !== false }),
    campaignIds.length
      ? prisma.campaignView.groupBy({
          by: ["campaignId"],
          where: { campaignId: { in: campaignIds }, createdAt: { gte: since } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);
  const views = new Map(viewRows.map(r => [r.campaignId, r._count._all]));

  return rows.map(c => {
    const stats = c.qrCode ? qrStats.get(c.qrCode.id) : undefined;
    const scans = stats?.scans ?? 0;
    const conversions = access.attribution === false ? 0 : stats?.conversions ?? 0;
    const pageViews = views.get(c.id) ?? 0;
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      status: c.status,
      startAt: c.startAt,
      endAt: c.endAt,
      createdAt: c.createdAt,
      scans,
      views: pageViews,
      leads: c._count.leads,
      signupRate: pageViews > 0 ? (c._count.leads / pageViews) * 100 : 0,
      conversions,
      revenue: access.attribution === false ? 0 : stats?.revenue ?? 0,
      convRate: scans > 0 ? (conversions / scans) * 100 : 0,
    };
  });
}

export async function getCampaign(shopId: string, id: string) {
  return prisma.campaign.findFirst({
    where: { id, shopId },
    include: {
      qrCode: {
        select: { id: true, name: true, slug: true },
      },
    },
  });
}

export async function getCampaignBySlug(slug: string) {
  return prisma.campaign.findUnique({
    where: { slug },
    include: { shop: { include: { activeSubscription: { include: { plan: true } } } } },
  });
}

export async function listCampaignBlockQrChoices(shopId: string) {
  const rows = await prisma.qrCode.findMany({
    where: {
      shopId,
      archivedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      target: true,
      active: true,
      campaignId: true,
      design: true,
      label: true,
    },
  });
  return rows;
}
