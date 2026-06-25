import prisma from "../db.server";
import { z } from "zod";
import type { Campaign, CampaignStatus } from "@prisma/client";
import { shortSlug, nameToSlug } from "./slug.server";
import { assertQuota, type ShopWithPlan } from "./plan.server";

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
        },
      });
    } catch (e: unknown) {
      if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("Could not create campaign");
}

export async function saveBlocks(shopId: string, id: string, blocks: unknown[], name?: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id, shopId } });
  if (!campaign) throw new Error("Campaign not found");
  const data: Record<string, unknown> = { blocks };
  if (typeof name === "string" && name.trim()) data.name = name.trim();
  return prisma.campaign.update({ where: { id }, data });
}

export async function setCampaignStatus(shopId: string, id: string, status: CampaignStatus) {
  const data: Record<string, unknown> = { status };
  if (status === "ACTIVE") data.publishedAt = new Date();
  return prisma.campaign.update({ where: { id }, data });
}

export async function deleteCampaign(shopId: string, id: string) {
  await prisma.campaign.delete({ where: { id } });
}

export async function duplicateCampaign(shop: ShopWithPlan, id: string) {
  await assertQuota(shop, "campaigns");
  const source = await prisma.campaign.findFirst({ where: { id, shopId: shop.id } });
  if (!source) throw new Error("Campaign not found");
  return createCampaign(shop, {
    name: `${source.name} (copy)`,
    description: source.description,
  }).then(async created => {
    await prisma.campaign.update({ where: { id: created.id }, data: { blocks: source.blocks as object[] } });
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
  leads: number;
  conversions: number;
  convRate: number;
}

export async function listCampaigns(shopId: string): Promise<CampaignListItem[]> {
  const rows = await prisma.campaign.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    include: {
      qrCode: {
        select: {
          _count: { select: { scans: true } },
          scans: { select: { id: true, conversion: { select: { id: true } } } },
        },
      },
      _count: { select: { leads: true } },
    },
  });
  return rows.map(c => {
    const scans = c.qrCode?._count.scans ?? 0;
    const conversions = c.qrCode?.scans.filter(s => s.conversion).length ?? 0;
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
      leads: c._count.leads,
      conversions,
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
  return prisma.campaign.findUnique({ where: { slug }, include: { shop: true } });
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
