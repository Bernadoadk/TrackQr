import prisma from "../db.server";
import { z } from "zod";
import type { Campaign, Lead } from "@prisma/client";
import { leadNotificationHtml, sendSmtpMail } from "./smtp.server";

const EmailSchema = z.string().email().max(320);
const OptionalEmailSchema = z.string().email().max(320).optional();

export interface CaptureLeadInput {
  campaign: Campaign & { shop?: { domain?: string | null; email?: string | null } };
  shopId: string;
  email: string;
  recipientEmail?: string | null;
  mailSubject?: string | null;
  extra: Record<string, string>;
  sourceIp: string | null;
  sourceUa: string | null;
}

/**
 * Capture a lead — always persists to our DB, then notifies the merchant via SMTP.
 * SMTP errors do NOT lose the lead.
 */
export async function captureLead(input: CaptureLeadInput): Promise<Lead> {
  const email = EmailSchema.parse(input.email);
  const recipientEmail = OptionalEmailSchema.safeParse(
    (input.recipientEmail || input.campaign.shop?.email || "").trim() || undefined,
  );

  const lead = await prisma.lead.create({
    data: {
      campaignId: input.campaign.id,
      email,
      fields: input.extra,
      source: input.sourceIp ? `${input.sourceIp.slice(0, 24)} · ${(input.sourceUa ?? "").slice(0, 80)}` : null,
      destination: "smtp",
      syncStatus: "PENDING",
    },
  });

  if (!recipientEmail.success || !recipientEmail.data) {
    return prisma.lead.update({
      where: { id: lead.id },
      data: { syncStatus: "FAILED", syncError: "Recipient email is missing or invalid" },
    });
  }

  try {
    const subject = input.mailSubject?.trim() || `New lead from ${input.campaign.name}`;
    const text = [
      `Campaign: ${input.campaign.name}`,
      input.campaign.shop?.domain ? `Shop: ${input.campaign.shop.domain}` : "",
      `Customer email: ${email}`,
      "",
      ...Object.entries(input.extra)
        .filter(([key]) => key !== "blockId")
        .map(([key, value]) => `${key}: ${value}`),
    ].filter(Boolean).join("\n");

    await sendSmtpMail({
      to: recipientEmail.data,
      subject,
      text,
      html: leadNotificationHtml({
        campaignName: input.campaign.name,
        customerEmail: email,
        fields: input.extra,
        shopDomain: input.campaign.shop?.domain,
      }),
      replyTo: email,
    });
    return prisma.lead.update({ where: { id: lead.id }, data: { syncStatus: "SYNCED" } });
  } catch (err) {
    return prisma.lead.update({
      where: { id: lead.id },
      data: { syncStatus: "FAILED", syncError: err instanceof Error ? err.message.slice(0, 500) : "Unknown error" },
    });
  }
}

export async function listLeads(campaignId: string) {
  return prisma.lead.findMany({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
  });
}
