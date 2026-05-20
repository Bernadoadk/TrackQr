import prisma from "../db.server";
import { z } from "zod";
import type { Campaign, IntegrationProvider, Lead } from "@prisma/client";
import { decryptSecret } from "./crypto.server";
import { klaviyoSubscribe } from "./integrations/klaviyo";
import { mailchimpSubscribe } from "./integrations/mailchimp";
import { hubspotSubscribe } from "./integrations/hubspot";

const EmailSchema = z.string().email().max(320);

const PROVIDER_BY_DESTINATION: Record<string, IntegrationProvider | null> = {
  klaviyo:   "KLAVIYO",
  mailchimp: "MAILCHIMP",
  hubspot:   "HUBSPOT",
  db:        null,
  csv:       null,
};

export interface CaptureLeadInput {
  campaign: Campaign;
  shopId: string;
  email: string;
  destination: string;
  extra: Record<string, string>;
  sourceIp: string | null;
  sourceUa: string | null;
}

/**
 * Capture a lead — always persists to our DB; optionally forwards to the
 * configured external provider. Integration errors do NOT lose the lead.
 */
export async function captureLead(input: CaptureLeadInput): Promise<Lead> {
  const email = EmailSchema.parse(input.email);
  const provider = PROVIDER_BY_DESTINATION[input.destination] ?? null;

  // Always write to DB first.
  const lead = await prisma.lead.create({
    data: {
      campaignId: input.campaign.id,
      email,
      fields: input.extra,
      source: input.sourceIp ? `${input.sourceIp.slice(0, 24)} · ${(input.sourceUa ?? "").slice(0, 80)}` : null,
      destination: input.destination,
      syncStatus: provider ? "PENDING" : "DB_ONLY",
    },
  });

  if (!provider) return lead;

  // Lookup the integration secrets — silently skip if not configured.
  const integration = await prisma.integration.findUnique({
    where: { shopId_provider: { shopId: input.shopId, provider } },
  });
  if (!integration || !integration.active) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { syncStatus: "FAILED", syncError: `${provider} not configured` },
    });
    return lead;
  }

  try {
    const token = decryptSecret(integration.encryptedToken);
    const listId = integration.listId ?? "";
    if (provider === "KLAVIYO")   await klaviyoSubscribe({ apiKey: token, listId, email, properties: input.extra });
    if (provider === "MAILCHIMP") await mailchimpSubscribe({ apiKey: token, listId, email, fields: input.extra });
    if (provider === "HUBSPOT")   await hubspotSubscribe({ apiKey: token, email, properties: input.extra });
    await prisma.lead.update({ where: { id: lead.id }, data: { syncStatus: "SYNCED" } });
  } catch (err) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { syncStatus: "FAILED", syncError: err instanceof Error ? err.message.slice(0, 500) : "Unknown error" },
    });
  }

  return lead;
}

export async function listLeads(campaignId: string) {
  return prisma.lead.findMany({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
  });
}
