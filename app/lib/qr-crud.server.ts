import prisma from "../db.server";
import type { Prisma, QrType, QrCode } from "@prisma/client";
import { z } from "zod";
import { shortSlug } from "./slug.server";
import { assertQuota, assertWithinQuota, FeatureLockedError, hasFeature, resolvePlan, type ShopWithPlan } from "./plan.server";
import { featureMinPlanLabel } from "./plan.constants";
import { parseQrType, STORE_QR_TYPES } from "./qr-types";
import { standardDesign, standardizeLabel } from "./qr-standard";
import { type QrDesign, type QrLabel, DEFAULT_DESIGN, DEFAULT_LABEL } from "./qr.server";
import { hasRouting, normalizeRoutingConfig, type RoutingConfig } from "./routing";
import { normalizeWebUrl } from "./url-safety";
import { getQrStats } from "./analytics.server";

const HEX = /^#[0-9a-fA-F]{6}$/;

const DesignSchema = z.object({
  style: z.enum(["square", "rounded", "dot", "classy"]).optional(),
  cornerStyle: z.enum(["square", "rounded", "extra-rounded"]).optional(),
  fg: z.string().regex(HEX).optional(),
  bg: z.string().regex(HEX).optional(),
  withLogo: z.boolean().optional(),
  logoBrand: z.string().max(40).nullable().optional(),
  logoUrl: z.string().max(2000).nullable().optional(),
  logoAssetId: z.string().max(60).nullable().optional(),
  /** Logo size as fraction of QR (0.10 – 0.30). */
  logoSize: z.number().min(0.05).max(0.4).optional(),
  /** Quiet zone in px at the 220px preview size (0 – 24), scaled with the output. */
  margin: z.number().int().min(0).max(24).optional(),
  /** Color of the 3 finder squares. */
  cornerColor: z.string().regex(HEX).optional(),
  /** Linear gradient for the modules. */
  gradient: z.object({
    from:  z.string().regex(HEX),
    to:    z.string().regex(HEX),
    angle: z.number().min(0).max(360).optional(),
  }).nullable().optional(),
});

const LabelSchema = z.object({
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
  labelColor: z.string().regex(HEX).optional(),
  /** Background fill of the frame's text zone band. */
  bandColor: z.string().regex(HEX).optional(),
  /** Legacy boolean — accepted for backward compatibility (true → "outline"). */
  framed: z.boolean().optional(),
});

export const CreateQrSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().max(500).optional().nullable(),
  type: z.string().min(1),
  target: z.string().max(1000).optional().default(""),
  shopifyRef: z.string().max(200).optional().nullable(),
  design: DesignSchema.default({}),
  label: LabelSchema.default({}),
  utmCampaign: z.string().max(200).optional().nullable(),
  utmSource: z.string().max(200).optional().nullable(),
  utmMedium: z.string().max(200).optional().nullable(),
  utmTerm:   z.string().max(200).optional().nullable(),
  /** Optional activation / expiration timestamps (ISO 8601). */
  activatesAt: z.string().datetime().optional().nullable(),
  expiresAt:   z.string().datetime().optional().nullable(),
  /** Optional 1:1 Campaign link (cuid). */
  campaignId: z.string().max(60).optional().nullable(),
  /** Where scans go while the code can't serve its destination (Starter+). */
  fallbackUrl: z.string().max(1000).optional().nullable(),
  /** Discount code applied automatically on Shopify destinations. */
  discountCode: z.string().trim().max(255).optional().nullable(),
  /** Smart routing rules + A/B split (Growth) — normalized by routing.ts. */
  rules: z.unknown().optional(),
  activate: z.boolean().optional().default(true),
});

export type CreateQrInput = z.input<typeof CreateQrSchema>;

export const UpdateQrSchema = CreateQrSchema.partial().extend({
  design: DesignSchema.optional(),
  label: LabelSchema.optional(),
  activate: z.boolean().optional(),
  target: z.string().max(1000).optional(),
});
export type UpdateQrInput = z.input<typeof UpdateQrSchema>;

export class QrValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrValidationError";
  }
}

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

/**
 * Design + label actually persisted for a plan. Plans without `customDesign`
 * (Free) always store the standard look — the label keeps its text/position.
 */
async function appearanceForPlan(shop: ShopWithPlan, design: object, label: object) {
  const plan = await resolvePlan(shop);
  if (plan.customDesign) return { design, label, customDesign: true };
  return { design: standardDesign(), label: standardizeLabel(label), customDesign: false };
}

/** Human-readable message out of a Zod error (first issue). */
function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid QR code data";
  const path = issue.path.join(".");
  const labels: Record<string, string> = {
    name: "Name",
    "design.margin": "Quiet zone",
    "design.fg": "Foreground color",
    "design.bg": "Background color",
    "label.text": "Label text",
    activatesAt: "Activation date",
    expiresAt: "Expiration date",
  };
  const field = labels[path] ?? path;
  return field ? `${field}: ${issue.message}` : issue.message;
}

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new QrValidationError(zodMessage(result.error));
  return result.data;
}

/** Validate and gate the scan-behaviour fields (fallback, discount, routing). */
function scanBehaviour(
  plan: Awaited<ReturnType<typeof resolvePlan>>,
  type: QrType,
  input: { fallbackUrl?: string | null; discountCode?: string | null; rules?: unknown },
): { fallbackUrl?: string | null; discountCode?: string | null; rules?: RoutingConfig } {
  const out: { fallbackUrl?: string | null; discountCode?: string | null; rules?: RoutingConfig } = {};

  if (input.fallbackUrl !== undefined) {
    const raw = (input.fallbackUrl ?? "").trim();
    if (!raw) {
      out.fallbackUrl = null;
    } else {
      if (!hasFeature(plan, "customFallback")) {
        throw new FeatureLockedError("customFallback", featureMinPlanLabel("customFallback"));
      }
      const url = normalizeWebUrl(raw);
      if (!url) throw new QrValidationError("Fallback URL must be a valid web address (https://…).");
      out.fallbackUrl = url;
    }
  }

  if (input.discountCode !== undefined) {
    const code = (input.discountCode ?? "").trim();
    out.discountCode = code && STORE_QR_TYPES.includes(type) ? code : null;
  }

  if (input.rules !== undefined) {
    const config = normalizeRoutingConfig(input.rules);
    if (hasRouting(config) && !hasFeature(plan, "smartRouting")) {
      throw new FeatureLockedError("smartRouting", featureMinPlanLabel("smartRouting"));
    }
    out.rules = config;
  }

  return out;
}

function validateSchedule(activatesAt: string | null | undefined, expiresAt: string | null | undefined) {
  if (activatesAt && expiresAt && new Date(expiresAt) <= new Date(activatesAt)) {
    throw new QrValidationError("Expiration must be after activation.");
  }
}

export async function createQr(shop: ShopWithPlan, input: CreateQrInput): Promise<QrCode> {
  await assertQuota(shop, "qrCodes");
  const parsed = parseOrThrow(CreateQrSchema, input);
  const type: QrType = parseQrType(parsed.type);
  validateSchedule(parsed.activatesAt, parsed.expiresAt);
  const plan = await resolvePlan(shop);
  const behaviour = scanBehaviour(plan, type, parsed);
  await prepareCampaignLink(shop.id, parsed.campaignId);
  const appearance = await appearanceForPlan(
    shop,
    { ...DEFAULT_DESIGN, ...parsed.design },
    { ...DEFAULT_LABEL, ...parsed.label },
  );

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
          design: appearance.design,
          label: appearance.label,
          utmCampaign: parsed.utmCampaign ?? null,
          utmSource:   parsed.utmSource   ?? null,
          utmMedium:   parsed.utmMedium   ?? null,
          utmTerm:     parsed.utmTerm     ?? null,
          activatesAt: parsed.activatesAt ? new Date(parsed.activatesAt) : null,
          expiresAt:   parsed.expiresAt   ? new Date(parsed.expiresAt)   : null,
          campaignId:  parsed.campaignId  ?? null,
          fallbackUrl: behaviour.fallbackUrl ?? null,
          discountCode: behaviour.discountCode ?? null,
          rules: (behaviour.rules ?? { rules: [], abTest: null }) as unknown as Prisma.InputJsonValue,
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

export async function updateQr(shop: ShopWithPlan, id: string, input: UpdateQrInput) {
  const shopId = shop.id;
  const qr = await prisma.qrCode.findFirst({ where: { id, shopId } });
  if (!qr) throw new Error("QR code not found");
  const parsed = parseOrThrow(UpdateQrSchema, input);
  const plan = await resolvePlan(shop);

  const next: Prisma.QrCodeUpdateInput = {};
  if (parsed.name !== undefined)        next.name        = parsed.name;
  if (parsed.description !== undefined) next.description = parsed.description;
  if (parsed.target !== undefined)      next.target      = parsed.target;
  if (parsed.shopifyRef !== undefined)  next.shopifyRef  = parsed.shopifyRef;
  if (parsed.utmCampaign !== undefined) next.utmCampaign = parsed.utmCampaign;
  if (parsed.utmSource !== undefined)   next.utmSource   = parsed.utmSource;
  if (parsed.utmMedium !== undefined)   next.utmMedium   = parsed.utmMedium;
  if (parsed.utmTerm !== undefined)     next.utmTerm     = parsed.utmTerm;
  const type = parsed.type !== undefined ? parseQrType(parsed.type) : qr.type;
  if (parsed.type !== undefined)        next.type        = type;
  if (plan.customDesign) {
    if (parsed.design !== undefined)    next.design      = { ...(qr.design as object), ...parsed.design };
    if (parsed.label !== undefined)     next.label       = { ...(qr.label as object), ...parsed.label };
  } else if (parsed.label !== undefined) {
    // Without `customDesign` the stored design is left untouched (it comes
    // back after an upgrade); only the label text / position can change.
    const stored = qr.label as Record<string, unknown>;
    next.label = {
      ...stored,
      ...(parsed.label.text !== undefined ? { text: parsed.label.text } : {}),
      ...(parsed.label.position !== undefined ? { position: parsed.label.position } : {}),
    };
  }
  const activatesAt = parsed.activatesAt !== undefined ? parsed.activatesAt : qr.activatesAt?.toISOString();
  const expiresAt = parsed.expiresAt !== undefined ? parsed.expiresAt : qr.expiresAt?.toISOString();
  validateSchedule(activatesAt, expiresAt);
  if (parsed.activatesAt !== undefined) next.activatesAt = parsed.activatesAt ? new Date(parsed.activatesAt) : null;
  if (parsed.expiresAt !== undefined)   next.expiresAt   = parsed.expiresAt   ? new Date(parsed.expiresAt)   : null;

  const behaviour = scanBehaviour(plan, type, parsed);
  if (behaviour.fallbackUrl !== undefined) next.fallbackUrl = behaviour.fallbackUrl;
  if (behaviour.discountCode !== undefined) next.discountCode = behaviour.discountCode;
  if (behaviour.rules !== undefined) next.rules = behaviour.rules as unknown as Prisma.InputJsonValue;

  if (parsed.campaignId !== undefined) {
    await prepareCampaignLink(shopId, parsed.campaignId, id);
    next.campaign = parsed.campaignId ? { connect: { id: parsed.campaignId } } : { disconnect: true };
  }
  if (parsed.activate !== undefined) {
    if (parsed.activate && !qr.active) await assertWithinQuota(shop, "qrCodes", qr);
    next.active = !!parsed.activate;
    next.quotaPausedAt = null; // a merchant decision replaces any quota pause
  }

  return prisma.qrCode.update({ where: { id }, data: next });
}

export async function setActive(shop: ShopWithPlan, id: string, active: boolean) {
  const qr = await prisma.qrCode.findFirst({ where: { id, shopId: shop.id } });
  if (!qr) throw new Error("QR code not found");
  if (active) await assertWithinQuota(shop, "qrCodes", qr);
  // A merchant decision replaces any quota pause.
  await prisma.qrCode.update({ where: { id }, data: { active, quotaPausedAt: null } });
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

/** Used by the public scan route when a code turns out to be beyond the plan quota. */
export async function pauseQrForQuota(id: string) {
  await prisma.qrCode.update({
    where: { id },
    data: { active: false, quotaPausedAt: new Date() },
  });
}

/** Archive a QR code of this shop (scoped: another shop's id is a no-op error). */
export async function archiveQr(shopId: string, id: string) {
  const { count } = await prisma.qrCode.updateMany({
    where: { id, shopId, archivedAt: null },
    data: { archivedAt: new Date(), active: false, quotaPausedAt: null },
  });
  if (!count) throw new Error("QR code not found");
}

/** Hard delete (cascades scans / conversions) — scoped to the shop. */
export async function deleteQr(shopId: string, id: string) {
  const { count } = await prisma.qrCode.deleteMany({ where: { id, shopId } });
  if (!count) throw new Error("QR code not found");
}

export type BulkQrAction = "activate" | "pause" | "archive" | "delete";

/**
 * Apply one action to several QR codes of this shop. Activation respects the
 * plan quota item by item; the result says how many were changed / refused.
 */
export async function bulkQrAction(shop: ShopWithPlan, ids: string[], action: BulkQrAction) {
  const uniqueIds = [...new Set(ids)].slice(0, 500);
  const owned = await prisma.qrCode.findMany({
    where: { shopId: shop.id, id: { in: uniqueIds }, archivedAt: null },
    select: { id: true, createdAt: true, active: true },
  });
  const ownedIds = owned.map(q => q.id);
  if (!ownedIds.length) return { changed: 0, refused: 0 };

  if (action === "delete") {
    const { count } = await prisma.qrCode.deleteMany({ where: { shopId: shop.id, id: { in: ownedIds } } });
    return { changed: count, refused: 0 };
  }
  if (action === "archive") {
    const { count } = await prisma.qrCode.updateMany({
      where: { shopId: shop.id, id: { in: ownedIds } },
      data: { archivedAt: new Date(), active: false, quotaPausedAt: null },
    });
    return { changed: count, refused: 0 };
  }
  if (action === "pause") {
    const { count } = await prisma.qrCode.updateMany({
      where: { shopId: shop.id, id: { in: ownedIds } },
      data: { active: false, quotaPausedAt: null },
    });
    return { changed: count, refused: 0 };
  }

  // activate — skip codes that sit beyond the plan quota.
  let changed = 0;
  let refused = 0;
  for (const qr of owned) {
    if (qr.active) continue;
    try {
      await assertWithinQuota(shop, "qrCodes", qr);
      await prisma.qrCode.update({ where: { id: qr.id }, data: { active: true, quotaPausedAt: null } });
      changed++;
    } catch {
      refused++;
    }
  }
  return { changed, refused };
}

export async function duplicateQr(shop: ShopWithPlan, id: string) {
  await assertQuota(shop, "qrCodes");
  const source = await prisma.qrCode.findFirst({ where: { id, shopId: shop.id } });
  if (!source) throw new Error("QR code not found");
  const appearance = await appearanceForPlan(shop, source.design as object, source.label as object);
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
          design: appearance.design,
          label: appearance.label,
          utmCampaign: source.utmCampaign,
          utmSource: source.utmSource,
          utmMedium: source.utmMedium,
          utmTerm: source.utmTerm,
          activatesAt: source.activatesAt,
          expiresAt: source.expiresAt,
          fallbackUrl: source.fallbackUrl,
          discountCode: source.discountCode,
          rules: source.rules as Prisma.InputJsonValue,
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
  /** Attributed revenue in cents (0 without the attribution feature). */
  revenue: number;
  /** Scans that hit the fallback because the code could not serve them. */
  missed: number;
  activatesAt: Date | null;
  expiresAt: Date | null;
  hasRouting: boolean;
  discountCode: string | null;
}

export interface QrListFilters {
  query?: string;
  type?: QrType | "all";
  status?: "all" | "active" | "inactive";
  sort?: "recent" | "scans" | "conv" | "name";
}

export interface QrListAccess {
  earliestScanDate?: Date | null;
  attribution?: boolean;
}

export async function listQrCodes(shopId: string, filters: QrListFilters = {}, access: QrListAccess = {}): Promise<QrListItem[]> {
  await deactivateExpiredQrs(shopId);

  const where: Prisma.QrCodeWhereInput = { shopId, archivedAt: null };
  if (filters.query)  where.name = { contains: filters.query, mode: "insensitive" };
  if (filters.type && filters.type !== "all")    where.type   = filters.type;
  if (filters.status === "active")   where.active = true;
  if (filters.status === "inactive") where.active = false;

  const rows = await prisma.qrCode.findMany({
    where,
    orderBy:
      filters.sort === "name" ? { name: "asc" } :
      filters.sort === "scans" || filters.sort === "conv" ? undefined :
      { createdAt: "desc" },
  });
  const stats = await getQrStats(shopId, rows.map(r => r.id), access);

  const items: QrListItem[] = rows.map(r => {
    const s = stats.get(r.id);
    const routing = normalizeRoutingConfig(r.rules);
    return {
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
      scans: s?.scans ?? 0,
      conversions: access.attribution === false ? 0 : s?.conversions ?? 0,
      revenue: access.attribution === false ? 0 : s?.revenue ?? 0,
      missed: s?.missed ?? 0,
      hasRouting: hasRouting(routing),
      discountCode: r.discountCode,
    };
  });

  if (filters.sort === "scans") items.sort((a, b) => b.scans - a.scans);
  if (filters.sort === "conv")  items.sort((a, b) => b.conversions - a.conversions);

  return items;
}

export async function getQrBySlug(slug: string) {
  return prisma.qrCode.findUnique({
    where: { slug },
    // Eagerly include the linked campaign so the scan endpoint can redirect
    // straight to the campaign landing page when set.
    include: { shop: { include: { activeSubscription: { include: { plan: true } } } }, campaign: true },
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
      fallbackUrl: true,
      discountCode: true,
      rules: true,
      active: true,
    },
  });
}
