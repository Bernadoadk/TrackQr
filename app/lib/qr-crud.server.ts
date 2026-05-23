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
    logoAssetId: z.string().nullable().optional(),
  }).default({}),
  label: z.object({
    text: z.string().max(20).optional(),
    position: z.enum(["none", "top", "bottom", "left", "right"]).optional(),
    tone: z.enum(["default", "brand", "mono", "muted"]).optional(),
    frame: z.enum(["none", "outline", "double", "sharp", "notched", "cut", "brackets", "ticket", "scallop", "polaroid", "banner", "header"]).optional(),
    font: z.string().max(40).optional(),
    /** Legacy boolean — accepted for backward compatibility (true → "outline"). */
    framed: z.boolean().optional(),
  }).default({}),
  utmCampaign: z.string().max(200).optional().nullable(),
  utmSource: z.string().max(200).optional().nullable(),
  utmMedium: z.string().max(200).optional().nullable(),
  activate: z.boolean().optional().default(true),
});

export type CreateQrInput = z.infer<typeof CreateQrSchema>;

export async function createQr(shop: ShopWithPlan, input: CreateQrInput): Promise<QrCode> {
  await assertQuota(shop, "qrCodes");
  const parsed = CreateQrSchema.parse(input);
  const type: QrType = parseQrType(parsed.type);

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
          utmSource: parsed.utmSource ?? null,
          utmMedium: parsed.utmMedium ?? null,
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
  if (input.type !== undefined)        next.type        = parseQrType(input.type);
  if (input.design !== undefined)      next.design      = { ...(qr.design as object), ...input.design };
  if (input.label !== undefined)       next.label       = { ...(qr.label as object), ...input.label };
  if (input.activate !== undefined)    next.active      = !!input.activate;

  return prisma.qrCode.update({ where: { id }, data: next });
}

export async function setActive(shopId: string, id: string, active: boolean) {
  await prisma.qrCode.update({
    where: { id },
    data: { active },
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
}

export interface QrListFilters {
  query?: string;
  type?: QrType | "all";
  status?: "all" | "active" | "inactive";
  sort?: "recent" | "scans" | "conv" | "name";
}

export async function listQrCodes(shopId: string, filters: QrListFilters = {}): Promise<QrListItem[]> {
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

  let items: QrListItem[] = rows.map(r => ({
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
    include: { shop: true },
  });
}
