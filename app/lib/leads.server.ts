import prisma from "../db.server";
import { z } from "zod";
import type { Campaign, Lead, Plan, Shop, Subscription } from "@prisma/client";
import { leadNotificationHtml, sendSmtpMail } from "./smtp.server";
import { t } from "./i18n";
import { runWithLocale } from "./i18n.server";
import { hashIp } from "./crypto.server";
import { getPlanEntitlements } from "./plan.server";
import { readShopSettings } from "./shop-settings.server";
import { issueRewardCode } from "./rewards.server";
import { syncLeadToCustomer } from "./customers.server";
import { FLOW_TRIGGERS, sendFlowTrigger } from "./flow.server";

const EmailSchema = z.string().trim().toLowerCase().email().max(320);
const OptionalEmailSchema = z.string().email().max(320).optional();

/** Leads accepted per visitor (hashed IP) and campaign in THROTTLE_MINUTES. */
const THROTTLE_MAX = 5;
const THROTTLE_MINUTES = 10;
/** Extra form fields kept per lead (keys / values are trimmed). */
const MAX_EXTRA_FIELDS = 12;

export type LeadShop = Shop & { activeSubscription: (Subscription & { plan: Plan }) | null };

export interface CaptureBlockConfig {
  id: string;
  title: string;
  recipientEmail: string | null;
  mailSubject: string | null;
  reward: { enabled: boolean; percent: number; prefix: string } | null;
}

export interface CaptureLeadInput {
  campaign: Campaign & { shop: LeadShop };
  email: string;
  consent: boolean;
  /** Hidden honeypot field — bots fill it, people don't. */
  honeypot: string;
  block: CaptureBlockConfig | null;
  extra: Record<string, string>;
  ip: string | null;
  userAgent: string | null;
}

export type CaptureLeadResult =
  | { ok: true; rewardCode: string | null }
  | { ok: false; error: "invalid-email" | "too-many" | "save-failed"; message?: string };

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function cleanExtra(extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(extra).slice(0, MAX_EXTRA_FIELDS)) {
    const k = key.trim().slice(0, 40);
    if (!k) continue;
    out[k] = String(value ?? "").trim().slice(0, 500);
  }
  return out;
}

/**
 * Capture a lead from a public campaign page. Always persisted first; the
 * reward code, the Shopify customer sync, the merchant notification and the
 * Flow trigger are best-effort and never lose the lead.
 */
export async function captureLead(input: CaptureLeadInput): Promise<CaptureLeadResult> {
  // Honeypot filled: pretend success, store nothing.
  if (input.honeypot.trim()) return { ok: true, rewardCode: null };

  const parsedEmail = EmailSchema.safeParse(input.email);
  if (!parsedEmail.success) return { ok: false, error: "invalid-email" };
  const email = parsedEmail.data;

  const ipHash = input.ip ? hashIp(input.ip) : null;
  const since = new Date(Date.now() - THROTTLE_MINUTES * 60_000);
  if (ipHash) {
    const recent = await prisma.lead.count({ where: { campaignId: input.campaign.id, ipHash, createdAt: { gte: since } } });
    if (recent >= THROTTLE_MAX) return { ok: false, error: "too-many" };
  }
  // Same person submitting twice in a row: keep the first lead.
  const duplicate = await prisma.lead.findFirst({
    where: { campaignId: input.campaign.id, email, createdAt: { gte: new Date(Date.now() - 60_000) } },
    select: { rewardCode: true },
  });
  if (duplicate) return { ok: true, rewardCode: duplicate.rewardCode };

  const fields = cleanExtra(input.extra);
  if (input.block?.title) fields.blockTitle = input.block.title.slice(0, 120);

  let lead: Lead;
  try {
    lead = await prisma.lead.create({
      data: {
        campaignId: input.campaign.id,
        email,
        fields,
        consent: input.consent,
        ipHash,
        source: input.userAgent ? input.userAgent.slice(0, 160) : null,
        destination: "db",
        syncStatus: "PENDING",
      },
    });
  } catch (err) {
    return { ok: false, error: "save-failed", message: err instanceof Error ? err.message : "" };
  }

  const shop = input.campaign.shop;
  const entitlements = await getPlanEntitlements(shop);
  const settings = readShopSettings(shop);
  const update: Partial<Pick<Lead, "rewardCode" | "shopifyCustomerId" | "destination" | "syncStatus" | "syncError">> = {};
  const errors: string[] = [];

  // 1. Unique discount reward (Growth).
  let rewardCode: string | null = null;
  if (input.block?.reward?.enabled && entitlements.leadRewards) {
    const reward = await withTimeout(issueRewardCode({
      shopDomain: shop.domain,
      campaignId: input.campaign.id,
      campaignName: input.campaign.name,
      blockId: input.block.id,
      percent: input.block.reward.percent,
      prefix: input.block.reward.prefix,
    }), 10_000, "Reward code").catch(err => ({ error: err instanceof Error ? err.message : "Reward code failed" }));
    if ("code" in reward) {
      rewardCode = reward.code;
      update.rewardCode = reward.code;
    } else {
      errors.push(`Reward: ${reward.error}`);
    }
  }

  // 2. Shopify customer (Growth + merchant opt-in + granted scope).
  if (entitlements.customerSync && settings.syncLeadsToCustomers) {
    const synced = await withTimeout(syncLeadToCustomer({
      shopDomain: shop.domain,
      email,
      consent: input.consent,
      campaignName: input.campaign.name,
      campaignSlug: input.campaign.slug,
    }), 10_000, "Customer sync").catch(err => ({ customerId: null, error: err instanceof Error ? err.message : "Customer sync failed" }));
    if (synced.customerId) {
      update.shopifyCustomerId = synced.customerId;
      update.destination = "shopify";
    }
    if (synced.error) errors.push(`Shopify customer: ${synced.error}`);
  }

  // 3. Merchant notification by email.
  const recipient = OptionalEmailSchema.safeParse(
    (input.block?.recipientEmail || settings.leadNotifyEmail || shop.email || "").trim() || undefined,
  );
  let notified = false;
  if (recipient.success && recipient.data) {
    try {
      // Written in the merchant's admin language.
      const mail = runWithLocale(settings.adminLocale, () => {
        const details: Record<string, string> = {
          ...fields,
          [t("Marketing consent")]: input.consent ? t("Yes") : t("No"),
          ...(rewardCode ? { [t("Reward code")]: rewardCode } : {}),
        };
        return {
          subject: input.block?.mailSubject?.trim() || t("New lead from {campaign}", { campaign: input.campaign.name }),
          text: [
            t("Campaign: {name}", { name: input.campaign.name }),
            t("Shop: {domain}", { domain: shop.domain }),
            t("Customer email: {email}", { email }),
            "",
            ...Object.entries(details).map(([key, value]) => `${key}: ${value}`),
          ].join("\n"),
          html: leadNotificationHtml({
            campaignName: input.campaign.name,
            customerEmail: email,
            fields: details,
            shopDomain: shop.domain,
          }),
        };
      });
      await withTimeout(sendSmtpMail({
        to: recipient.data,
        ...mail,
        replyTo: email,
      }), 15_000, "SMTP");
      notified = true;
    } catch (err) {
      errors.push(`Email: ${err instanceof Error ? err.message : "SMTP failed"}`);
    }
  } else {
    errors.push("Email: recipient is missing or invalid");
  }

  // 4. Shopify Flow trigger (Growth).
  if (entitlements.automations) {
    await withTimeout(sendFlowTrigger(shop.domain, FLOW_TRIGGERS.leadCaptured, {
      "Email": email,
      "Campaign name": input.campaign.name,
      "Marketing consent": input.consent,
      "Reward code": rewardCode ?? "",
    }), 8_000, "Flow").catch(() => undefined);
  }

  update.syncStatus = notified || update.shopifyCustomerId ? "SYNCED" : "FAILED";
  update.syncError = errors.length ? errors.join(" · ").slice(0, 500) : null;
  await prisma.lead.update({ where: { id: lead.id }, data: update }).catch(() => undefined);

  return { ok: true, rewardCode };
}

export async function listLeads(campaignId: string) {
  return prisma.lead.findMany({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
  });
}
