import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { requireShop } from "../lib/shop.server";
import { resolvePlan } from "../lib/plan.server";
import { startSubscription, cancelSubscription, markSubscriptionActive } from "../lib/billing.server";
import prisma from "../db.server";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Segmented } from "../components/ui/Segmented";
import { useToast } from "../components/ui/Toast";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const url = new URL(request.url);

  // Shopify returns the merchant with ?confirmed=1 after they approve the subscription.
  if (url.searchParams.get("confirmed") === "1") {
    await markSubscriptionActive({ shopId: shop.id });
  }

  const plans = await prisma.plan.findMany({ orderBy: { priceMonthly: "asc" } });
  const active = await resolvePlan(shop);
  return {
    plans: plans.map(p => ({
      id: p.id,
      name: p.name,
      priceMonthly: p.priceMonthly / 100,
      priceAnnual:  p.priceAnnual  / 100,
      annualTotal: (p.priceAnnual / 100) * 12,
      trialDays: p.trialDays,
      qrCodeLimit: p.qrCodeLimit,
      campaignLimit: p.campaignLimit,
      historyDays: p.historyDays,
      attribution: p.attribution,
      integrations: p.integrations,
      multiStore: p.multiStore,
      api: p.api,
      customDomain: p.customDomain,
    })),
    currentPlanId: active.id,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "subscribe") {
    const planId = String(form.get("planId") ?? "");
    const cycle  = (String(form.get("cycle") ?? "MONTHLY").toUpperCase() === "ANNUAL" ? "ANNUAL" : "MONTHLY") as "MONTHLY" | "ANNUAL";
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return { ok: false, error: "unknown-plan" } as const;
    if (planId === "starter") {
      // No paid plan needed for Starter — just deactivate any existing subscription.
      await prisma.shop.update({ where: { id: shop.id }, data: { activeSubscriptionId: null } });
      return { ok: true, intent, plan: planId } as const;
    }
    const appUrl = process.env.SHOPIFY_APP_URL ?? new URL(request.url).origin;
    const { confirmationUrl } = await startSubscription({
      admin: admin as never as { graphql: AdminGraphqlClientArg },
      shop,
      plan,
      cycle,
      appUrl,
    });
    return { ok: true, intent, confirmationUrl } as const;
  }

  if (intent === "cancel") {
    const active = shop.activeSubscription;
    if (active) {
      await cancelSubscription({
        admin: admin as never as { graphql: AdminGraphqlClientArg },
        subscription: active,
      });
    }
    return { ok: true, intent } as const;
  }

  return { ok: false, error: "unknown-intent" } as const;
};

type AdminGraphqlClientArg = (q: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: <T>() => Promise<T> }>;

const PLAN_META: Record<string, { icon: string; accent: string; tagline: string; featured?: boolean; badge?: string }> = {
  starter: { icon: "rocket",    accent: "blue",   tagline: "Lancez vos premiers QR codes en quelques minutes." },
  growth:  { icon: "zap",       accent: "violet", tagline: "Attribuez chaque scan à une commande Shopify.", featured: true, badge: "Le plus populaire" },
  pro:     { icon: "sparkles",  accent: "amber",  tagline: "Multi-boutiques, agences & équipes avancées." },
};

const PLAN_ORDER = ["starter", "growth", "pro"];

const FAQS = [
  { q: "Puis-je changer de plan plus tard ?", a: "Oui — upgrade ou downgrade à tout moment. Les frais sont calculés au prorata lors d'un upgrade, et un crédit est appliqué sur la prochaine facture lors d'un downgrade." },
  { q: "Que se passe-t-il avec mes QR codes si je rétrograde ?", a: "Tous vos codes continuent de fonctionner. Si vous dépassez la limite du nouveau plan, les plus anciens seront mis en pause (non supprimés) jusqu'à ce que vous upgradiez ou en supprimiez." },
  { q: "Y a-t-il une période d'essai ?", a: "Chaque plan démarre avec 14 jours d'essai gratuit. Facturation Shopify uniquement — pas de carte requise." },
  { q: "Les taxes sont-elles incluses ?", a: "Les prix affichés sont hors TVA. La taxe applicable est ajoutée lors du paiement selon votre pays de facturation." },
  { q: "Puis-je payer par facture ?", a: "Les plans Pro annuels peuvent être facturés. Contactez-nous à sales@trackqr.com." },
];

function featuresFor(plan: ReturnType<typeof useLoaderData<typeof loader>>["plans"][number]) {
  const items: { label: string; included: boolean; hl?: boolean }[] = [];
  items.push({ label: plan.qrCodeLimit == null   ? "QR codes illimités"     : `${plan.qrCodeLimit} QR codes dynamiques`, included: true, hl: plan.qrCodeLimit == null });
  items.push({ label: plan.campaignLimit == null ? "Campagnes illimitées"   : `${plan.campaignLimit} pages de campagne`, included: true });
  items.push({ label: plan.historyDays == null   ? "Historique illimité"    : `Historique scans — ${plan.historyDays >= 365 ? "1 an" : `${plan.historyDays} jours`}`, included: true });
  items.push({ label: "Couleurs & styles personnalisés", included: true });
  items.push({ label: "Attribution commandes Shopify",   included: plan.attribution,  hl: plan.attribution });
  items.push({ label: "Notifications leads par SMTP",   included: true });
  items.push({ label: "Multi-boutiques Shopify",         included: plan.multiStore });
  items.push({ label: "Accès API + webhooks",            included: plan.api });
  items.push({ label: "Domaine de redirection personnalisé", included: plan.customDomain });
  return items;
}

export default function PricingPage() {
  const toast = useToast();
  const { plans, currentPlanId } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cycle, setCycle] = useState<"monthly" | "annual">("annual");
  const [openFaq, setOpenFaq] = useState<string | null>(FAQS[0].q);

  // After successful subscription start, redirect to Shopify confirmation page.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.intent === "subscribe" && fetcher.data.confirmationUrl) {
      // Use top-level redirect since the confirmation URL is on Shopify admin.
      window.top!.location.href = fetcher.data.confirmationUrl;
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (searchParams.get("confirmed") === "1") {
      toast({ title: "Subscription active", desc: "Welcome to your new plan." });
      const next = new URLSearchParams(searchParams);
      next.delete("confirmed");
      setSearchParams(next, { replace: true });
    }
  }, []);

  const startCheckout = (planId: string) => {
    const fd = new FormData();
    fd.set("intent", "subscribe");
    fd.set("planId", planId);
    fd.set("cycle", cycle === "annual" ? "ANNUAL" : "MONTHLY");
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-left" style={{ textAlign: "center", marginInline: "auto", flex: "0 1 720px" }}>
          <div className="page-eyebrow" style={{ marginInline: "auto" }}>
            <Icon name="credit-card" size={11} /> Pricing
          </div>
          <h1 className="page-h1">
            Plans that <span className="em">scale</span> with your scans.
          </h1>
          <div className="page-sub" style={{ marginInline: "auto" }}>
            Pay as your QR program grows. Cancel any time. Every plan starts with a 14-day free trial.
          </div>

          <div className="pricing-cycle">
            <Segmented
              value={cycle}
              onChange={(v) => setCycle(v as "monthly" | "annual")}
              options={[
                { value: "monthly", label: "Monthly" },
                { value: "annual",  label: "Annual" },
              ]}
            />
            <span className={`pricing-cycle-save ${cycle === "annual" ? "on" : ""}`}>
              <Icon name="zap" size={10} />
              Save 20% · 2 months free
            </span>
          </div>
        </div>
      </div>

      <div className="pricing-grid">
        {plans.map(plan => {
          const meta = PLAN_META[plan.id] ?? { icon: "rocket", accent: "blue", tagline: "" };
          const price = cycle === "annual" ? plan.priceAnnual : plan.priceMonthly;
          const isCurrent = plan.id === currentPlanId;
          const currentIdx = PLAN_ORDER.indexOf(currentPlanId);
          const planIdx    = PLAN_ORDER.indexOf(plan.id);
          const direction  = planIdx > currentIdx ? "up" : planIdx < currentIdx ? "down" : "same";

          return (
            <div
              key={plan.id}
              className={`pricing-card ${meta.featured ? "featured" : ""} ${isCurrent ? "is-current" : ""}`}
              data-accent={meta.accent}
            >
              {meta.badge && !isCurrent && (
                <div className="pricing-badge"><Icon name="sparkles" size={10} />{meta.badge}</div>
              )}
              {isCurrent && (
                <div className="pricing-badge current"><Icon name="circle-check" size={10} />Your plan</div>
              )}

              <div className="pricing-head">
                <div className="pricing-icon" data-accent={meta.accent}>
                  <Icon name={meta.icon} size={17} />
                </div>
                <div>
                  <div className="pricing-name">{plan.name}</div>
                  <div className="pricing-tag">{meta.tagline}</div>
                </div>
              </div>

              <div className="pricing-price-block">
                <div className="pricing-price">
                  <span className="pricing-currency">$</span>
                  <span className="pricing-amount num">{price}</span>
                  <span className="pricing-per">/mo</span>
                </div>
                <div className="pricing-billed">
                  {cycle === "annual" ? (
                    <>
                      <span className="num strong">${plan.annualTotal.toLocaleString()}</span> billed annually
                      <span className="pricing-strike num">${plan.priceMonthly * 12}</span>
                    </>
                  ) : (
                    <>Billed monthly · ${plan.annualTotal.toLocaleString()}/yr if you switch</>
                  )}
                </div>
              </div>

              <Button
                variant={meta.featured && !isCurrent ? "primary" : isCurrent ? "secondary" : "outline"}
                size="lg"
                className="pricing-cta"
                disabled={fetcher.state !== "idle"}
                onClick={() => {
                  if (isCurrent) {
                    toast({ title: "You're on this plan", desc: "Manage billing from Shopify admin → Settings → Apps.", type: "info" });
                    return;
                  }
                  startCheckout(plan.id);
                }}
                iconRight={isCurrent ? undefined : "arrow-right"}
              >
                {fetcher.state !== "idle"
                  ? "Opening Shopify…"
                  : isCurrent
                    ? "Your plan"
                    : direction === "up"
                      ? `Upgrade to ${plan.name}`
                      : direction === "down"
                        ? `Switch to ${plan.name}`
                        : `Choose ${plan.name}`}
              </Button>

              <div className="pricing-features">
                <div className="pricing-features-label">What's included</div>
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
        <div><Icon name="shield" size={14} /><span>14-day free trial</span></div>
        <div><Icon name="credit-card" size={14} /><span>Billed via Shopify</span></div>
        <div><Icon name="zap" size={14} /><span>Cancel any time</span></div>
        <div><Icon name="globe" size={14} /><span>Used by 1,200+ Shopify stores</span></div>
      </div>

      <div className="section">
        <h2 className="section-h">Pricing FAQ</h2>
        <Card>
          {FAQS.map((f, i) => (
            <div
              key={f.q}
              style={{
                borderBottom: i === FAQS.length - 1 ? 0 : "1px solid var(--border-soft)",
                padding: "14px 18px",
                cursor: "default",
              }}
              onClick={() => setOpenFaq(openFaq === f.q ? null : f.q)}
            >
              <div className="flex items-center justify-between">
                <div className="strong" style={{ fontSize: 13.5 }}>{f.q}</div>
                <Icon name={openFaq === f.q ? "chevron-up" : "chevron-down"} size={14} style={{ color: "var(--fg-subtle)" }} />
              </div>
              {openFaq === f.q && (
                <div className="text-sm muted mt-2" style={{ maxWidth: 720 }}>{f.a}</div>
              )}
            </div>
          ))}
        </Card>
      </div>

      <Card
        className="card-pad-lg mt-6"
        style={{
          background: "linear-gradient(135deg, #14225C 0%, #2A2078 50%, #4A1F8B 100%)",
          color: "#fff",
          border: 0,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background:
            "radial-gradient(60% 50% at 20% 10%, rgba(255,255,255,0.18) 0%, transparent 60%), " +
            "radial-gradient(45% 60% at 90% 100%, rgba(165, 128, 255, 0.4) 0%, transparent 60%)",
        }} />
        <div className="flex items-center" style={{ justifyContent: "space-between", gap: 24, position: "relative" }}>
          <div>
            <Badge tone="violet" style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.18)" }}>
              <Icon name="message-square" size={10} /> Enterprise
            </Badge>
            <h3 style={{ fontFamily: "var(--ff-display)", fontWeight: 600, fontSize: 22, letterSpacing: "-0.02em", margin: "10px 0 6px" }}>
              Running 10+ stores or printing a million QR codes?
            </h3>
            <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, margin: 0 }}>
              Custom volume pricing, dedicated CSM, security review and procurement help.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              iconRight="external-link"
              style={{ background: "rgba(255,255,255,0.10)", color: "#fff", borderColor: "rgba(255,255,255,0.18)" }}
            >
              Read the docs
            </Button>
            <Button
              variant="primary"
              icon="message-square"
              style={{ background: "#fff", color: "#14225C", borderColor: "#fff", boxShadow: "0 6px 18px -6px rgba(0,0,0,0.4)" }}
            >
              Talk to sales
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
