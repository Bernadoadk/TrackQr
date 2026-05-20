// view-pricing.jsx — Pricing page

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For makers shipping their first QR codes.",
    icon: "rocket",
    accent: "blue",
    priceMonthly: 19,
    priceAnnual: 15,
    annualTotal: 180,
    cta: "Start free trial",
    features: [
      { label: "10 dynamic QR codes",            included: true },
      { label: "Scan analytics — 30 day history", included: true },
      { label: "5 campaign landing pages",        included: true },
      { label: "Custom QR colors & styles",       included: true },
      { label: "Email support",                   included: true },
      { label: "Shopify checkout attribution",    included: false },
      { label: "Integrations (Klaviyo, etc.)",    included: false },
    ],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "For DTC brands ready to attribute every scan.",
    icon: "zap",
    accent: "violet",
    badge: "Most popular",
    priceMonthly: 49,
    priceAnnual: 39,
    annualTotal: 468,
    cta: "Start free trial",
    featured: true,
    features: [
      { label: "50 dynamic QR codes",             included: true },
      { label: "Unlimited campaigns",             included: true },
      { label: "1 year of scan history",          included: true },
      { label: "Shopify checkout attribution",    included: true, hl: true },
      { label: "Klaviyo + Mailchimp leads sync",  included: true, hl: true },
      { label: "A/B test campaign landing pages", included: true },
      { label: "Priority email support",          included: true },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For multi-store ops, agencies & enterprise.",
    icon: "sparkles",
    accent: "amber",
    priceMonthly: 129,
    priceAnnual: 103,
    annualTotal: 1236,
    cta: "Talk to sales",
    features: [
      { label: "Unlimited QR codes & campaigns",  included: true, hl: true },
      { label: "Full scan history, forever",      included: true },
      { label: "Team seats + role permissions",   included: true, hl: true },
      { label: "Multi-store rollups",             included: true },
      { label: "API access + webhooks",           included: true },
      { label: "SSO/SAML",                        included: true },
      { label: "SLA + dedicated CSM",             included: true },
    ],
  },
];

const PLAN_ORDER = ["starter", "growth", "pro"];
const PLAN_BY_ID = Object.fromEntries(PLANS.map(p => [p.id, p]));

function nextPlan(currentId) {
  const i = PLAN_ORDER.indexOf(currentId);
  if (i === -1 || i === PLAN_ORDER.length - 1) return null;
  return PLAN_BY_ID[PLAN_ORDER[i + 1]];
}

window.PLANS = PLANS;
window.PLAN_BY_ID = PLAN_BY_ID;
window.PLAN_ORDER = PLAN_ORDER;
window.nextPlan = nextPlan;

function ViewPricing({ currentPlan = "growth", onChangePlan }) {
  const toast = useToast();
  const [cycle, setCycle] = useState("annual"); // "monthly" | "annual"

  const FAQS = [
    { q: "Can I switch plans later?", a: "Yes — upgrade or downgrade any time. Prorated charges on upgrade, credit on the next bill on downgrade." },
    { q: "What happens to my QR codes if I downgrade?", a: "All codes keep working. If you exceed the new plan's limit, the oldest will be paused (not deleted) until you upgrade or remove some." },
    { q: "Do you offer a free trial?", a: "Every plan starts with a 14-day free trial. No credit card required to begin." },
    { q: "Are taxes included?", a: "Prices shown exclude VAT/GST. Tax is added at checkout based on your billing country." },
    { q: "Can I pay by invoice?", a: "Annual Pro plans can be invoiced. Reach out to sales@qrflow.com." },
  ];
  const [openFaq, setOpenFaq] = useState(FAQS[0].q);

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
              onChange={setCycle}
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
        {PLANS.map(plan => {
          const price = cycle === "annual" ? plan.priceAnnual : plan.priceMonthly;
          const isCurrent = plan.id === currentPlan;
          const currentIdx = PLAN_ORDER.indexOf(currentPlan);
          const planIdx    = PLAN_ORDER.indexOf(plan.id);
          const direction  = planIdx > currentIdx ? "up" : planIdx < currentIdx ? "down" : "same";

          return (
            <div
              key={plan.id}
              className={`pricing-card ${plan.featured ? "featured" : ""} ${isCurrent ? "is-current" : ""}`}
              data-accent={plan.accent}
            >
              {plan.badge && !isCurrent && (
                <div className="pricing-badge">
                  <Icon name="sparkles" size={10} />
                  {plan.badge}
                </div>
              )}
              {isCurrent && (
                <div className="pricing-badge current">
                  <Icon name="circle-check" size={10} />
                  Your plan
                </div>
              )}

              <div className="pricing-head">
                <div className="pricing-icon" data-accent={plan.accent}>
                  <Icon name={plan.icon} size={17} />
                </div>
                <div>
                  <div className="pricing-name">{plan.name}</div>
                  <div className="pricing-tag">{plan.tagline}</div>
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
                variant={plan.featured && !isCurrent ? "primary" : isCurrent ? "secondary" : "outline"}
                size="lg"
                className="pricing-cta"
                onClick={() => {
                  if (isCurrent) {
                    toast({ title: "Manage billing", desc: "Stripe portal would open here.", tone: "info" });
                  } else {
                    onChangePlan?.(plan.id);
                    toast({
                      title: direction === "up" ? `Upgraded to ${plan.name}` : `Switched to ${plan.name}`,
                      desc: cycle === "annual" ? `Billed $${plan.annualTotal.toLocaleString()}/year` : `Billed $${plan.priceMonthly}/month`,
                    });
                  }
                }}
                iconRight={isCurrent ? null : "arrow-right"}
              >
                {isCurrent ? "Manage billing" : direction === "up" ? `Upgrade to ${plan.name}` : direction === "down" ? `Switch to ${plan.name}` : plan.cta}
              </Button>

              <div className="pricing-features">
                <div className="pricing-features-label">What's included</div>
                <ul>
                  {plan.features.map((f, i) => (
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

      {/* Trust strip */}
      <div className="pricing-trust">
        <div>
          <Icon name="shield" size={14} />
          <span>14-day free trial</span>
        </div>
        <div>
          <Icon name="credit-card" size={14} />
          <span>No card required to start</span>
        </div>
        <div>
          <Icon name="zap" size={14} />
          <span>Cancel any time</span>
        </div>
        <div>
          <Icon name="globe" size={14} />
          <span>Used by 1,200+ Shopify stores</span>
        </div>
      </div>

      {/* FAQ */}
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

      {/* Bottom CTA */}
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
            <h3 style={{
              fontFamily: "var(--ff-display)", fontWeight: 600, fontSize: 22, letterSpacing: "-0.02em",
              margin: "10px 0 6px",
            }}>
              Running 10+ stores or printing a million QR codes?
            </h3>
            <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, margin: 0 }}>
              Custom volume pricing, dedicated CSM, security review and procurement help.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" iconRight="external-link" style={{ background: "rgba(255,255,255,0.10)", color: "#fff", borderColor: "rgba(255,255,255,0.18)" }}>Read the docs</Button>
            <Button variant="primary" icon="message-square" style={{ background: "#fff", color: "#14225C", borderColor: "#fff", boxShadow: "0 6px 18px -6px rgba(0,0,0,0.4)" }}>Talk to sales</Button>
          </div>
        </div>
      </Card>
    </>
  );
}

window.ViewPricing = ViewPricing;
