import prisma from "../db.server";
import type { QrType, QrCode } from "@prisma/client";
import { z } from "zod";
import { shortSlug } from "./slug.server";
import { assertQuota, type ShopWithPlan } from "./plan.server";
import { parseQrType } from "./qr-types";
import { type QrDesign, type QrLabel, DEFAULT_DESIGN, DEFAULT_LABEL } from "./qr.server";

export const CreateQrSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(500).optional().nullable(),
  type: z.string().min(1),
  target: z.string().max(1000).optional().default(""),
  shopifyRef: z.string().optional().nullable(),
  design: z.object({
    style: z.enum(["square", "rounded", "dot", "classy"]).optional(),
    cornerStyle: z.enum(["square", "rounded", "extra-rounded"]).optional(),
    fg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    bg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    withLogo: z.boolean().optional(),
    logoBrand: z.string().nullable().optional(),
    logoUrl: z.string().nullable().optional(),
    logoAssetId: z.string().nullable().optional(),
    /** Logo size as fraction of QR (0.10 – 0.30). */
    logoSize: z.number().min(0.05).max(0.4).optional(),
    /** Quiet zone in modules (0 – 8). */
    margin: z.number().int().min(0).max(8).optional(),
    /** Color of the 3 finder squares. */
    cornerColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    /** Linear gradient for the modules. */
    gradient: z.object({
      from:  z.string().regex(/^#[0-9a-fA-F]{6}$/),
      to:    z.string().regex(/^#[0-9a-fA-F]{6}$/),
      angle: z.number().min(0).max(360).optional(),
    }).nullable().optional(),
  }).default({}),
  label: z.object({
    text: z.string().max(20).optional(),
    position: z.enum(["none", "top", "bottom", "left", "right"]).optional(),
    frame: z.enum(["none", "outline", "double", "sharp", "notched", "cut", "brackets", "ticket", "scallop", "polaroid", "banner", "header"]).optional(),
    font: z.string().max(40).optional(),
    /** Rich-text formatting: size (px), bold/italic/underline, alignment. */
    size: z.number().int().min(8).max(48).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    /** Text color inside the frame's text zone (polaroid/banner/ticket/header). */
    labelColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    /** Background fill of the frame's text zone band. */
    bandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    /** Legacy boolean — accepted for backward compatibility (true → "outline"). */
    framed: z.boolean().optional(),
  }).default({}),
  utmCampaign: z.string().max(200).optional().nullable(),
  utmSource: z.string().max(200).optional().nullable(),
  utmMedium: z.string().max(200).optional().nullable(),
  utmTerm:   z.string().max(200).optional().nullable(),
  /** Optional activation / expiration timestamps (ISO 8601). */
  activatesAt: z.string().datetime().optional().nullable(),
  expiresAt:   z.string().datetime().optional().nullable(),
  /** Optional 1:1 Campaign link (cuid). */
  campaignId: z.string().optional().nullable(),
  activate: z.boolean().optional().default(true),
});

export type CreateQrInput = z.infer<typeof CreateQrSchema>;

async function prepareCampaignLink(shopId: string, campaignId: string | null | undefined, currentQrId?: string) {
  if (!campaignId) return;
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, shopId },
    select: { id: true },
  });
  if (!campaign) throw new Error("Campaign not found");

  await prisma.qrCode.updateMany({
    where: {
      shopId,
      campaignId,
      ...(currentQrId ? { id: { not: currentQrId } } : {}),
    },
    data: { campaignId: null },
  });
}

export async function createQr(shop: ShopWithPlan, input: CreateQrInput): Promise<QrCode> {
  await assertQuota(shop, "qrCodes");
  const parsed = CreateQrSchema.parse(input);
  const type: QrType = parseQrType(parsed.type);
  await prepareCampaignLink(shop.id, parsed.campaignId);

  // Generate a unique slug — retry up to 5 times on collision (statistically: never).
  for (let i = 0; i < 5; i++) {
    const slug = shortSlug(7);
    try {
      return await prisma.qrCode.create({
        data: {
          shopId: shop.id,
          slug,
          name: parsed.name,
          description: parsed.description ?? null,
          type,
          target: parsed.target ?? "",
          shopifyRef: parsed.shopifyRef ?? null,
          design: { ...DEFAULT_DESIGN, ...parsed.design },
          label: { ...DEFAULT_LABEL, ...parsed.label },
          utmCampaign: parsed.utmCampaign ?? null,
          utmSource:   parsed.utmSource   ?? null,
          utmMedium:   parsed.utmMedium   ?? null,
          utmTerm:     parsed.utmTerm     ?? null,
          activatesAt: parsed.activatesAt ? new Date(parsed.activatesAt) : null,
          expiresAt:   parsed.expiresAt   ? new Date(parsed.expiresAt)   : null,
          campaignId:  parsed.campaignId  ?? null,
          active: !!parsed.activate,
        },
      });
    } catch (e: unknown) {
      // unique violation on slug — retry
      if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("Could not generate a unique slug after 5 attempts");
}

export const UpdateQrSchema = CreateQrSchema.partial().extend({
  id: z.string(),
});

export async function updateQr(shopId: string, id: string, input: Partial<CreateQrInput>) {
  const qr = await prisma.qrCode.findFirst({ where: { id, shopId } });
  if (!qr) throw new Error("QR code not found");

  const next: Record<string, unknown> = {};
  if (input.name !== undefined)        next.name        = input.name;
  if (input.description !== undefined) next.description = input.description;
  if (input.target !== undefined)      next.target      = input.target;
  if (input.shopifyRef !== undefined)  next.shopifyRef  = input.shopifyRef;
  if (input.utmCampaign !== undefined) next.utmCampaign = input.utmCampaign;
  if (input.utmSource !== undefined)   next.utmSource   = input.utmSource;
  if (input.utmMedium !== undefined)   next.utmMedium   = input.utmMedium;
  if (input.utmTerm !== undefined)     next.utmTerm     = input.utmTerm;
  if (input.type !== undefined)        next.type        = parseQrType(input.type);
  if (input.design !== undefined)      next.design      = { ...(qr.design as object), ...input.design };
  if (input.label !== undefined)       next.label       = { ...(qr.label as object), ...input.label };
  if (input.activatesAt !== undefined) next.activatesAt = input.activatesAt ? new Date(input.activatesAt) : null;
  if (input.expiresAt !== undefined)   next.expiresAt   = input.expiresAt   ? new Date(input.expiresAt)   : null;
  if (input.campaignId !== undefined) {
    await prepareCampaignLink(shopId, input.campaignId, id);
    next.campaignId = input.campaignId || null;
  }
  if (input.activate !== undefined)    next.active      = !!input.activate;

  return prisma.qrCode.update({ where: { id }, data: next });
}

export async function setActive(shopId: string, id: string, active: boolean) {
  const qr = await prisma.qrCode.findFirst({ where: { id, shopId } });
  if (!qr) throw new Error("QR code not found");
  await prisma.qrCode.update({ where: { id }, data: { active } });
}

export async function deactivateExpiredQrs(shopId: string) {
  await prisma.qrCode.updateMany({
    where: {
      shopId,
      active: true,
      archivedAt: null,
      expiresAt: { lte: new Date() },
    },
    data: { active: false },
  });
}

export async function deactivateQrById(id: string) {
  await prisma.qrCode.update({
    where: { id },
    data: { active: false },
  });
}

export async function archiveQr(shopId: string, id: string) {
  await prisma.qrCode.update({
    where: { id },
    data: { archivedAt: new Date(), active: false },
  });
}

export async function deleteQr(shopId: string, id: string) {
  // Hard delete — cascades scans/conversions
  await prisma.qrCode.delete({ where: { id } });
}

export async function duplicateQr(shop: ShopWithPlan, id: string) {
  await assertQuota(shop, "qrCodes");
  const source = await prisma.qrCode.findFirst({ where: { id, shopId: shop.id } });
  if (!source) throw new Error("QR code not found");
  for (let i = 0; i < 5; i++) {
    const slug = shortSlug(7);
    try {
      return await prisma.qrCode.create({
        data: {
          shopId: shop.id,
          slug,
          name: `${source.name} (copy)`,
          description: source.description,
          type: source.type,
          target: source.target,
          shopifyRef: source.shopifyRef,
          design: source.design as object,
          label: source.label as object,
          utmCampaign: source.utmCampaign,
          utmSource: source.utmSource,
          utmMedium: source.utmMedium,
          utmTerm: source.utmTerm,
          activatesAt: source.activatesAt,
          expiresAt: source.expiresAt,
          active: false,
        },
      });
    } catch (e: unknown) {
      if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("Could not duplicate QR");
}

export interface QrListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: QrType;
  target: string;
  design: QrDesign;
  label: QrLabel;
  active: boolean;
  createdAt: Date;
  scans: number;
  conversions: number;
  activatesAt: Date | null;
  expiresAt: Date | null;
}

export interface QrListFilters {
  query?: string;
  type?: QrType | "all";
  status?: "all" | "active" | "inactive";
  sort?: "recent" | "scans" | "conv" | "name";
}

export async function listQrCodes(shopId: string, filters: QrListFilters = {}): Promise<QrListItem[]> {
  await deactivateExpiredQrs(shopId);

  const where: Record<string, unknown> = { shopId, archivedAt: null };
  if (filters.query)  where.name = { contains: filters.query, mode: "insensitive" };
  if (filters.type && filters.type !== "all")    where.type   = filters.type;
  if (filters.status === "active")   where.active = true;
  if (filters.status === "inactive") where.active = false;

  const rows = await prisma.qrCode.findMany({
    where,
    include: {
      _count: { select: { scans: true } },
      scans:  { select: { id: true, conversion: { select: { id: true } } } },
    },
    orderBy:
      filters.sort === "name" ? { name: "asc" } :
      filters.sort === "scans" || filters.sort === "conv" ? undefined :
      { createdAt: "desc" },
  });

  const items: QrListItem[] = rows.map(r => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    type: r.type,
    target: r.target,
    design: (r.design as QrDesign) ?? {},
    label:  (r.label  as QrLabel)  ?? {},
    active: r.active,
    createdAt: r.createdAt,
    activatesAt: r.activatesAt,
    expiresAt: r.expiresAt,
    scans: r._count.scans,
    conversions: r.scans.filter(s => s.conversion).length,
  }));

  if (filters.sort === "scans") items.sort((a, b) => b.scans - a.scans);
  if (filters.sort === "conv")  items.sort((a, b) => b.conversions - a.conversions);

  return items;
}

export async function getQrBySlug(slug: string) {
  return prisma.qrCode.findUnique({
    where: { slug },
    // Eagerly include the linked campaign so the scan endpoint can redirect
    // straight to the campaign landing page when set.
    include: { shop: true, campaign: true },
  });
}

export async function getQrForEdit(shopId: string, id: string) {
  return prisma.qrCode.findFirst({
    where: { id, shopId, archivedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      type: true,
      target: true,
      shopifyRef: true,
      design: true,
      label: true,
      utmCampaign: true,
      utmSource: true,
      utmMedium: true,
      utmTerm: true,
      activatesAt: true,
      expiresAt: true,
      campaignId: true,
      active: true,
    },
  });
}
