import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { FREE_PLAN_ID, PLAN_ORDER, planIncludes } from "../lib/plan.constants";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Segmented } from "../components/ui/Segmented";
import { useToast } from "../components/ui/Toast";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { useReviewRequest } from "../lib/use-review-request";
import { formatNumber, t, tem, tm, tp } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const [
    { requireShop },
    { getBillingAccess, getPlanUsage },
    { syncShopifySubscriptions, isShopifyBillingTestMode, shopifyBillingModeDescription, shopifyBillingModeLabel },
    { default: prisma },
  ] = await Promise.all([
    import("../lib/shop.server"),
    import("../lib/plan.server"),
    import("../lib/billing.server"),
    import("../db.server"),
  ]);
  const { admin, shop } = await requireShop(request);

  await syncShopifySubscriptions({
    admin: admin as never as { graphql: AdminGraphqlClientArg },
    shopId: shop.id,
  });
  const syncedShop = await prisma.shop.findUnique({
    where: { id: shop.id },
    include: { activeSubscription: { include: { plan: true } } },
  });

  const effectiveShop = syncedShop ?? shop;
  const [access, usage, plans] = await Promise.all([
    getBillingAccess(effectiveShop),
    getPlanUsage(effectiveShop),
    prisma.plan.findMany({ orderBy: { priceMonthly: "asc" } }),
  ]);
  return {
    plans: plans.map(p => ({
      id: p.id,
      name: p.name,
      priceMonthly: p.priceMonthly / 100,
      priceAnnual:  p.priceAnnual  / 100,
      annualTotal: (p.priceAnnual / 100) * 12,
      qrCodeLimit: p.qrCodeLimit,
      campaignLimit: p.campaignLimit,
      historyDays: p.historyDays,
      customDesign: p.customDesign,
      detailedAnalytics: p.detailedAnalytics,
      exports: p.exports,
      attribution: p.attribution,
      prioritySupport: p.prioritySupport,
    })),
    currentPlanId: access.plan.id,
    currentCycle: access.cycle,
    accessStatus: access.status,
    hasActiveSubscription: access.status === "active",
    usage: { qrUsed: usage.qrUsed, campaignUsed: usage.campaignUsed },
    billingMode: shopifyBillingModeLabel(),
    billingModeDescription: shopifyBillingModeDescription(),
    billingTestMode: isShopifyBillingTestMode(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const [
    { requireShop },
    { startSubscription, cancelSubscription },
    { default: prisma },
  ] = await Promise.all([
    import("../lib/shop.server"),
    import("../lib/billing.server"),
    import("../db.server"),
  ]);
  const { admin, billing, shop } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "subscribe") {
    const planId = String(form.get("planId") ?? "");
    const cycle  = (String(form.get("cycle") ?? "MONTHLY").toUpperCase() === "ANNUAL" ? "ANNUAL" : "MONTHLY") as "MONTHLY" | "ANNUAL";
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    // The Free plan is the absence of a subscription — it is never "subscribed to".
    if (!plan || plan.priceMonthly === 0) return { ok: false, error: "unknown-plan" } as const;
    const url = new URL(request.url);
    const host = (form.get("host") as string | null) || url.searchParams.get("host");
    const appUrl = process.env.SHOPIFY_APP_URL ?? url.origin;
    try {
      const { confirmationUrl } = await startSubscription({
        admin: admin as never as { graphql: AdminGraphqlClientArg },
        billing: billing as never as ShopifyBillingClientArg,
        shop,
        plan,
        cycle,
        appUrl,
        host,
        // No trial today (Plan.trialDays = 0). Raising the DB value turns on a
        // Shopify-managed free-trial period for that plan.
        trialDays: plan.trialDays,
      });
      return { ok: true, intent, confirmationUrl } as const;
    } catch (err) {
      return {
        ok: false,
        intent,
        error: "billing-checkout",
        message: err instanceof Error ? err.message : "Shopify billing checkout failed.",
      } as const;
    }
  }

  // "cancel" = switch back to the Free plan.
  if (intent === "cancel") {
    const active = shop.activeSubscription;
    try {
      if (active) {
        await cancelSubscription({
          admin: admin as never as { graphql: AdminGraphqlClientArg },
          billing: billing as never as ShopifyBillingClientArg,
          subscription: active,
        });
      }
      return { ok: true, intent } as const;
    } catch (err) {
      return {
        ok: false,
        intent,
        error: "billing-cancel",
        message: err instanceof Error ? err.message : "Shopify billing cancellation failed.",
      } as const;
    }
  }

  return { ok: false, error: "unknown-intent" } as const;
};

type AdminGraphqlClientArg = (q: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: <T>() => Promise<T> }>;
type ShopifyBillingClientArg = {
  request: (options: { plan: string; isTest?: boolean; returnUrl?: string; trialDays?: number }) => Promise<unknown>;
  cancel?: (options: { subscriptionId: string; isTest?: boolean; prorate?: boolean }) => Promise<unknown>;
};

type PlanRow = ReturnType<typeof useLoaderData<typeof loader>>["plans"][number];

const PLAN_META: Record<string, { icon: string; accent: string; tagline: string; featured?: boolean; badge?: string }> = {
  free:    { icon: "gift",   accent: "slate",  tagline: "Try dynamic QR codes at no cost." },
  starter: { icon: "rocket", accent: "blue",   tagline: "Brand your codes and understand every scan." },
  growth:  { icon: "zap",    accent: "violet", tagline: "Unlimited codes, campaigns and history — with Shopify sales attribution.", featured: true, badge: "Most popular" },
};

const FAQS = [
  { q: "Is the Free plan really free?", a: "Yes. The Free plan needs no subscription and never expires: 3 dynamic QR codes, 1 campaign page, a scan counter and PNG downloads in the standard style. Every store starts on it." },
  { q: "What happens to my QR codes if I downgrade or cancel?", a: "Nothing is deleted. QR codes and campaigns beyond the new plan limits are paused automatically (the oldest ones stay active) and come back by themselves as soon as they fit again — after you archive or delete older items, or when you upgrade. Codes designed with a logo or colors are shown in the standard style on the Free plan and get their design back when you upgrade." },
  { q: "What do customers see when they scan a paused or expired code?", a: "Never an error page. They land on your store home page — or on the fallback page you choose, from the Starter plan — and the scan shows up as a missed scan in your stats." },
  { q: "Do I need to reprint my codes to change where they go?", a: "No. Every TrackQr code is dynamic: change the destination, add a discount code or a smart routing rule at any time, the printed code stays the same." },
  { q: "Can I change plans later?", a: "Yes. Upgrade or downgrade at any time — Shopify applies the change immediately and prorates the difference." },
  { q: "Are taxes included?", a: "Displayed prices exclude taxes. Shopify adds applicable taxes during checkout based on the store's billing location." },
];

function historyLabel(days: number | null) {
  if (days == null) return t("unlimited history");
  return days >= 365 ? t("1-year history") : t("{days}-day history", { days });
}

function featuresFor(plan: PlanRow) {
  const paid = plan.priceMonthly > 0;
  const items: { label: string; included: boolean; hl?: boolean }[] = [
    {
      label: plan.qrCodeLimit == null ? t("Unlimited dynamic QR codes") : tp(plan.qrCodeLimit, "{count} dynamic QR code", "{count} dynamic QR codes"),
      included: true,
      hl: plan.qrCodeLimit == null,
    },
    {
      label: plan.campaignLimit == null ? t("Unlimited campaign pages") : tp(plan.campaignLimit, "{count} campaign page", "{count} campaign pages"),
      included: true,
      hl: plan.campaignLimit == null,
    },
    plan.detailedAnalytics
      ? { label: t("Detailed analytics — devices, countries, timeline · {history}", { history: historyLabel(plan.historyDays) }), included: true, hl: plan.historyDays == null }
      : { label: t("Scan counter per QR code · {history}", { history: historyLabel(plan.historyDays) }), included: true },
    plan.customDesign
      ? { label: t("Logo, colors, shapes, frames & saved design templates"), included: true }
      : { label: t("Standard style — dark on white, no logo"), included: true },
    { label: plan.exports ? t("PNG, SVG and PDF downloads · ZIP & print sheets") : t("PNG downloads"), included: true },
    { label: t("All QR types: product, collection, cart, promo code, store page, URL, Wi-Fi, vCard…"), included: true },
    { label: t("Auto-applied discount codes, UTM tracking & weekly report"), included: true },
    { label: t("Campaign pages with email capture & GDPR consent"), included: true },
    { label: t("Never an error page — scans fall back to your store"), included: true },
    { label: t("Bulk creation from your catalog or a CSV file"), included: planIncludes(plan.id, "bulkCreate") },
    { label: t("Custom fallback page & automatic switch after expiry"), included: planIncludes(plan.id, "customFallback") },
    { label: t("QR codes on order emails & packing slips"), included: planIncludes(plan.id, "orderTracking") },
    { label: t("CSV exports — scans, QR codes and leads"), included: plan.exports },
    { label: t("Shopify order attribution — orders & revenue per QR code"), included: plan.attribution, hl: plan.attribution },
    { label: t("Smart routing by device, country & time · A/B tests"), included: planIncludes(plan.id, "smartRouting"), hl: planIncludes(plan.id, "smartRouting") },
    { label: t("Leads → Shopify customers · unique reward codes"), included: planIncludes(plan.id, "customerSync") },
    { label: t("Shopify Flow triggers · GA4 & Meta Pixel on campaigns"), included: planIncludes(plan.id, "automations") },
    { label: t("No “Powered by TrackQr” badge on campaign pages"), included: paid },
    { label: t("Priority support"), included: plan.prioritySupport },
  ];
  return items;
}

export default function PricingPage() {
  const toast = useToast();
  const requestReview = useReviewRequest();
  const {
    plans, currentPlanId, currentCycle, accessStatus, hasActiveSubscription,
    usage, billingMode, billingModeDescription, billingTestMode,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cycle, setCycle] = useState<"monthly" | "annual">(currentCycle === "ANNUAL" ? "annual" : "monthly");
  const [openFaq, setOpenFaq] = useState<string | null>(FAQS[0].q);
  const [confirmFreeOpen, setConfirmFreeOpen] = useState(false);

  const freePlan = plans.find(p => p.id === FREE_PLAN_ID);
  const qrOverFree = freePlan?.qrCodeLimit != null ? Math.max(0, usage.qrUsed - freePlan.qrCodeLimit) : 0;
  const campaignsOverFree = freePlan?.campaignLimit != null ? Math.max(0, usage.campaignUsed - freePlan.campaignLimit) : 0;

  // After successful subscription start, redirect to Shopify confirmation page.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.intent === "subscribe" && fetcher.data.confirmationUrl) {
      // Use top-level redirect since the confirmation URL is on Shopify admin.
      window.top!.location.href = fetcher.data.confirmationUrl;
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.intent === "cancel") {
      setConfirmFreeOpen(false);
      toast({ title: t("Subscription cancelled"), desc: t("Your store is now on the Free plan. Items beyond its limits were paused."), type: "info" });
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.ok) {
      toast({
        type: "error",
        title: fetcher.data.error === "billing-checkout" ? t("Shopify billing blocked") : t("Billing action failed"),
        desc: "message" in fetcher.data ? tm(fetcher.data.message) : t("Try again from Shopify admin."),
      });
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (searchParams.get("confirmed") === "1") {
      toast({ title: t("Payment approved"), desc: t("Shopify is now syncing your TrackQr subscription.") });
      // The merchant just approved a paid plan — a strong moment for a review request.
      void requestReview("subscription-confirmed");
      const next = new URLSearchParams(searchParams);
      next.delete("confirmed");
      setSearchParams(next, { replace: true });
    }
  }, []);

  const embeddedFields = (fd: FormData) => {
    const shop = searchParams.get("shop");
    const host = searchParams.get("host");
    if (shop) fd.set("shop", shop);
    if (host) fd.set("host", host);
  };

  const startCheckout = (planId: string) => {
    const fd = new FormData();
    fd.set("intent", "subscribe");
    fd.set("planId", planId);
    fd.set("cycle", cycle === "annual" ? "ANNUAL" : "MONTHLY");
    embeddedFields(fd);
    fetcher.submit(fd, { method: "post" });
  };

  const switchToFree = () => {
    const fd = new FormData();
    fd.set("intent", "cancel");
    embeddedFields(fd);
    fetcher.submit(fd, { method: "post" });
  };

  const busy = fetcher.state !== "idle";

  return (
    <>
      <ConfirmDialog
        open={confirmFreeOpen}
        title={t("Switch to the Free plan?")}
        description={[
          t("Your Shopify subscription will be cancelled (prorated) and the store switches to the Free plan: 3 QR codes, 1 campaign page, standard style, scan counter."),
          qrOverFree > 0 || campaignsOverFree > 0
            ? t("You currently have {qrCodes} and {campaigns} — {paused} will be paused (the oldest ones stay active). Nothing is deleted.", {
                qrCodes: tp(usage.qrUsed, "{count} QR code", "{count} QR codes"),
                campaigns: tp(usage.campaignUsed, "{count} campaign", "{count} campaigns"),
                paused: [
                  qrOverFree > 0 ? tp(qrOverFree, "{count} QR code", "{count} QR codes") : "",
                  campaignsOverFree > 0 ? tp(campaignsOverFree, "{count} campaign", "{count} campaigns") : "",
                ].filter(Boolean).join(t(" and ")),
              })
            : t("Your current QR codes and campaigns fit within the Free limits, so nothing will be paused."),
        ].join(" ")}
        confirmLabel={t("Switch to Free")}
        cancelLabel={t("Keep my plan")}
        tone="danger"
        loading={busy}
        onClose={() => setConfirmFreeOpen(false)}
        onConfirm={switchToFree}
      />

      <div className="page-head">
        <div className="page-head-left" style={{ textAlign: "center", marginInline: "auto", flex: "0 1 720px" }}>
          <div className="page-eyebrow" style={{ marginInline: "auto" }}>
            <Icon name="credit-card" size={11} /> {t("Pricing")}
          </div>
          <h1 className="page-h1">
            {tem("Plans that <em>scale</em> with your scans.")}
          </h1>
          <div className="page-sub" style={{ marginInline: "auto" }}>
            {t("Every store starts on the Free plan. Upgrade when you need more codes, branding, analytics or Shopify sales attribution — and switch back any time.")}
          </div>

          <div className="pricing-cycle">
            <Segmented
              value={cycle}
              onChange={(v) => setCycle(v as "monthly" | "annual")}
              options={[
                { value: "monthly", label: t("Monthly") },
                { value: "annual",  label: t("Annual") },
              ]}
            />
            <span className={`pricing-cycle-save ${cycle === "annual" ? "on" : ""}`}>
              <Icon name="zap" size={10} />
              {t("Save 20% · 2+ months free")}
            </span>
          </div>
        </div>
      </div>

      <div className="pricing-grid">
        {plans.map(plan => {
          const meta = PLAN_META[plan.id] ?? { icon: "rocket", accent: "blue", tagline: "" };
          const isFree = plan.priceMonthly === 0;
          const price = cycle === "annual" ? plan.priceAnnual : plan.priceMonthly;
          const selectedCycle = cycle === "annual" ? "ANNUAL" : "MONTHLY";
          const isCurrentPaid = hasActiveSubscription && plan.id === currentPlanId && currentCycle === selectedCycle;
          const isCurrentFree = isFree && accessStatus === "free";
          const isCurrent = isCurrentPaid || isCurrentFree;
          const currentIdx = PLAN_ORDER.indexOf(currentPlanId as (typeof PLAN_ORDER)[number]);
          const planIdx    = PLAN_ORDER.indexOf(plan.id as (typeof PLAN_ORDER)[number]);
          const direction  = planIdx > currentIdx ? "up" : planIdx < currentIdx ? "down" : "same";
          const cycleLabel = cycle === "annual" ? t("annual") : t("monthly");

          let ctaLabel: string;
          let ctaVariant: "primary" | "secondary" | "outline" = meta.featured && !isCurrent ? "primary" : isCurrent ? "secondary" : "outline";
          let ctaAction: () => void;
          if (busy) {
            ctaLabel = t("Opening Shopify...");
            ctaAction = () => {};
          } else if (isCurrentFree) {
            ctaLabel = t("Your current plan");
            ctaAction = () => toast({ title: t("You're on the Free plan"), desc: t("Pick Starter or Growth whenever you need more."), type: "info" });
          } else if (isFree) {
            ctaLabel = t("Switch to Free");
            ctaVariant = "outline";
            ctaAction = () => setConfirmFreeOpen(true);
          } else if (isCurrentPaid) {
            ctaLabel = t("Your {cycle} plan", { cycle: cycleLabel });
            ctaAction = () => toast({ title: t("You're on this plan"), desc: t("Billing is managed in Shopify admin → Settings → Apps."), type: "info" });
          } else {
            ctaLabel = direction === "up"
              ? t("Upgrade to {plan} {cycle}", { plan: plan.name, cycle: cycleLabel })
              : direction === "down"
                ? t("Switch to {plan} {cycle}", { plan: plan.name, cycle: cycleLabel })
                : t("Choose {plan} {cycle}", { plan: plan.name, cycle: cycleLabel });
            ctaAction = () => startCheckout(plan.id);
          }

          return (
            <div
              key={plan.id}
              className={`pricing-card ${meta.featured ? "featured" : ""} ${isCurrent ? "is-current" : ""}`}
              data-accent={meta.accent}
            >
              {meta.badge && !isCurrent && (
                <div className="pricing-badge"><Icon name="sparkles" size={10} />{t(meta.badge)}</div>
              )}
              {isCurrent && (
                <div className="pricing-badge current"><Icon name="circle-check" size={10} />{isFree ? t("Current plan") : t("Your {cycle} plan", { cycle: cycleLabel })}</div>
              )}

              <div className="pricing-head">
                <div className="pricing-icon" data-accent={meta.accent}>
                  <Icon name={meta.icon} size={17} />
                </div>
                <div>
                  <div className="pricing-name">{plan.name}</div>
                  <div className="pricing-tag">{meta.tagline ? t(meta.tagline) : ""}</div>
                </div>
              </div>

              <div className="pricing-price-block">
                <div className="pricing-price">
                  <span className="pricing-currency">$</span>
                  <span className="pricing-amount num">{price}</span>
                  <span className="pricing-per">{t("/mo")}</span>
                </div>
                <div className="pricing-billed">
                  {isFree ? (
                    <>{t("Free forever · no subscription required")}</>
                  ) : cycle === "annual" ? (
                    <>
                      <span className="num strong">${formatNumber(plan.annualTotal)}</span> {t("billed annually")}
                      <span className="pricing-strike num">${plan.priceMonthly * 12}</span>
                    </>
                  ) : (
                    <>{t("Billed monthly · ${amount}/yr on annual", { amount: formatNumber(plan.annualTotal) })}</>
                  )}
                </div>
              </div>

              <Button
                variant={ctaVariant}
                size="lg"
                className="pricing-cta"
                disabled={busy}
                onClick={ctaAction}
                iconRight={isCurrent ? undefined : "arrow-right"}
              >
                {ctaLabel}
              </Button>
              {isCurrentPaid && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="pricing-cta"
                  disabled={busy}
                  onClick={() => setConfirmFreeOpen(true)}
                  icon="trash"
                  style={{ marginTop: 8, color: "var(--red-fg)" }}
                >
                  {t("Cancel subscription")}
                </Button>
              )}

              <div className="pricing-features">
                <div className="pricing-features-label">{t("Included")}</div>
                <ul>
                  {featuresFor(plan).map((f, i) => (
                    <li key={i} className={f.included ? "" : "off"} data-hl={f.hl ? "true" : "false"}>
                      <Icon name={f.included ? "circle-check" : "x"} size={13} />
                      <span>{f.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pricing-trust">
        <div><Icon name="gift" size={14} /><span>{t("Free plan, forever — no card required")}</span></div>
        <div><Icon name="credit-card" size={14} /><span>{t("Billed through Shopify")}</span></div>
        <div title={tm(billingModeDescription)}>
          <Icon name={billingTestMode ? "settings" : "lock"} size={14} />
          <span>{t("Billing mode:")} {billingMode === "development" ? t("test") : t("live")}</span>
        </div>
        <div><Icon name="zap" size={14} /><span>{t("Cancel any time")}</span></div>
      </div>

      <div className="section">
        <h2 className="section-h">{t("Frequently Asked Questions")}</h2>
        <Card>
          {FAQS.map((f, i) => (
            <button
              type="button"
              key={f.q}
              className="faq-row"
              aria-expanded={openFaq === f.q}
              style={{
                borderBottom: i === FAQS.length - 1 ? 0 : "1px solid var(--border-soft)",
                padding: "14px 18px",
              }}
              onClick={() => setOpenFaq(openFaq === f.q ? null : f.q)}
            >
              <div className="flex items-center justify-between">
                <div className="strong" style={{ fontSize: 13.5, textAlign: "left" }}>{t(f.q)}</div>
                <Icon name={openFaq === f.q ? "chevron-up" : "chevron-down"} size={14} style={{ color: "var(--fg-subtle)", flexShrink: 0, marginLeft: 12 }} />
              </div>
              {openFaq === f.q && (
                <div className="text-sm muted mt-2" style={{ maxWidth: 720, textAlign: "left" }}>{t(f.a)}</div>
              )}
            </button>
          ))}
        </Card>
      </div>

    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
