/**
 * QR design templates — saved presets the merchant can re-apply when
 * creating new QR codes. Light wrapper over Prisma.
 */
import prisma from "../db.server";

export interface QrTemplateInput {
  name: string;
  design: Record<string, unknown>;
  label:  Record<string, unknown>;
}

export async function listTemplates(shopId: string) {
  return prisma.qrTemplate.findMany({
    where: { shopId },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
}

export async function createTemplate(shopId: string, input: QrTemplateInput) {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new Error("Template name required");
  return prisma.qrTemplate.create({
    data: {
      shopId,
      name,
      design: input.design,
      label:  input.label,
    },
  });
}

export async function deleteTemplate(shopId: string, id: string) {
  // Scope by shop to prevent cross-tenant deletion.
  await prisma.qrTemplate.deleteMany({ where: { id, shopId } });
}
