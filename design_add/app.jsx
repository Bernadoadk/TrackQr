// app.jsx — Main shell + routing

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "accent": "#2563EB",
  "density": "regular",
  "sidebarCollapsed": false,
  "plan": "growth"
}/*EDITMODE-END*/;

const ACCENT_PRESETS = [
  { value: "#2563EB", name: "Blue" },
  { value: "#7C3AED", name: "Violet" },
  { value: "#16A34A", name: "Emerald" },
  { value: "#D97706", name: "Amber" },
  { value: "#DB2777", name: "Pink" },
];

function ViewHelp({ onNavigate }) {
  const [open, setOpen] = useState("a");
  const faqs = [
    { id: "a", q: "How does a QR Flow QR code differ from a static one?", a: "Every QR Flow code points to a unique short URL we own. That lets us track scans, devices and conversions — and you can change the destination later without reprinting." },
    { id: "b", q: "Will my QR code keep working if I edit it?", a: "Yes. The short URL stays the same. We re-route the destination in milliseconds when you edit and save." },
    { id: "c", q: "Can I add my logo to the center?", a: "Yes — under Design → Center logo. We auto-add error-correction so scanning stays reliable." },
    { id: "d", q: "How are conversions attributed?", a: "We attribute conversions to a scan when the visitor reaches the Shopify thank-you page within 7 days from the same device." },
    { id: "e", q: "Where are leads from a campaign stored?", a: "By default in QR Flow's database, exportable as CSV. Connect Klaviyo or Mailchimp under Campaign → Settings → Leads." },
  ];
  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="help-circle" size={11} /> Help center</div>
          <h1 className="page-h1"><span className="em">How</span> can we help?</h1>
          <div className="page-sub">Most questions answered in a sentence. Anything else, chat us — we reply in minutes.</div>
        </div>
        <div className="page-head-actions">
          <Button variant="secondary" icon="external-link">Documentation</Button>
          <Button variant="primary" icon="message-square">Chat with us</Button>
        </div>
      </div>

      <div className="grid grid-3 mb-6">
        {[
          { icon: "rocket", title: "Quick start", desc: "Create your first QR code in under a minute." },
          { icon: "scan", title: "How tracking works", desc: "Scans, conversions and attribution explained." },
          { icon: "shield", title: "Privacy & GDPR", desc: "What we collect, what we don't." },
        ].map((c, i) => (
          <Card key={i} hoverLift className="card-pad">
            <div className="action-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent-border)", boxShadow: "none" }}>
              <Icon name={c.icon} size={18} />
            </div>
            <div className="mt-4 strong" style={{ fontFamily: "var(--ff-display)", fontSize: 15 }}>{c.title}</div>
            <div className="text-sm muted mt-2">{c.desc}</div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHead title="Frequently asked" />
        {faqs.map(f => (
          <div key={f.id} style={{
            borderBottom: "1px solid var(--border-soft)",
            padding: "14px 18px",
            cursor: "default",
          }} onClick={() => setOpen(open === f.id ? null : f.id)}>
            <div className="flex items-center justify-between">
              <div className="strong" style={{ fontSize: 13.5 }}>{f.q}</div>
              <Icon name={open === f.id ? "chevron-up" : "chevron-down"} size={14} style={{ color: "var(--fg-subtle)" }} />
            </div>
            {open === f.id && (
              <div className="text-sm muted mt-2" style={{ maxWidth: 720 }}>{f.a}</div>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}

function ViewLoyalty() {
  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <Badge tone="brand"><span className="dot"></span>Coming soon</Badge>
          <h1 className="page-h1 mt-2"><span className="em">Loyalty</span> for QR-scanning shoppers</h1>
          <div className="page-sub">Print a QR on every receipt and packaging insert. Customers scan, earn points, come back.</div>
        </div>
      </div>

      <Card className="card-pad-lg" style={{
        background: "linear-gradient(135deg, var(--accent-softer) 0%, var(--violet-soft) 100%)",
        border: "1px solid var(--accent-border)",
      }}>
        <div className="grid grid-2" style={{ alignItems: "center", gap: 32 }}>
          <div>
            <Badge tone="violet"><Icon name="gift" size={11} />Launching Q3 2026</Badge>
            <h2 className="mt-4" style={{ fontFamily: "var(--ff-display)", fontSize: 26, fontWeight: 600, letterSpacing: "-0.022em", margin: "12px 0 8px" }}>
              Turn every scan into a returning customer.
            </h2>
            <p className="text-md muted">
              Tier-based points programs, automatic rewards, member-only campaigns — all triggered by QR scans, no app install required.
            </p>
            <div className="flex gap-2 mt-6">
              <Button variant="primary" icon="bell">Join the waitlist</Button>
              <Button variant="secondary" iconRight="external-link">Read the announcement</Button>
            </div>
          </div>
          <div style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 18,
            padding: 24,
            boxShadow: "var(--sh-lg)",
          }}>
            <div className="flex items-center justify-between mb-4">
              <div className="strong">Your Aurora rewards</div>
              <Badge tone="success" dot>Gold</Badge>
            </div>
            <div style={{ fontFamily: "var(--ff-display)", fontSize: 40, fontWeight: 600, letterSpacing: "-0.025em", color: "var(--fg-strong)" }}>
              2,840 <span className="text-sm muted" style={{ fontFamily: "var(--ff-mono)", fontSize: 12 }}>pts</span>
            </div>
            <div className="text-xs muted">160 points until Platinum</div>
            <div className="progress-bar mt-3">
              <div className="progress-fill" style={{ width: "78%" }}></div>
            </div>
            <div className="mt-6 col gap-2">
              {["Free shipping unlocked", "15% off · Available", "Free returns · Available"].map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <Icon name="circle-check" size={14} style={{ color: "var(--green)" }} />
                  {r}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-3 mt-6">
        {[
          { icon: "gift", title: "Points per scan", desc: "Award scans, purchases, reviews — fully tunable." },
          { icon: "users", title: "Tier-based perks", desc: "Bronze, Silver, Gold tiers with member-only rewards." },
          { icon: "send", title: "Auto-trigger campaigns", desc: "Send a coupon when a member is close to a tier-up." },
        ].map((c, i) => (
          <Card key={i} hoverLift className="card-pad">
            <div className="action-icon" style={{ background: "var(--violet-soft)", color: "var(--violet)", border: "1px solid var(--violet-border)", boxShadow: "none" }}>
              <Icon name={c.icon} size={18} />
            </div>
            <div className="mt-4 strong" style={{ fontFamily: "var(--ff-display)", fontSize: 15 }}>{c.title}</div>
            <div className="text-sm muted mt-2">{c.desc}</div>
          </Card>
        ))}
      </div>
    </>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = useState("dashboard");
  const [loaderActive, triggerLoader] = useToploader();

  // Apply theme on root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", t.theme);
  }, [t.theme]);

  // Apply accent CSS var override
  useEffect(() => {
    if (t.accent && t.accent !== "#2563EB") {
      // override accent CSS vars in :root
      const r = document.documentElement;
      r.style.setProperty("--accent", t.accent);
      // derive hover
      r.style.setProperty("--accent-hover", t.accent);
    } else {
      document.documentElement.style.removeProperty("--accent");
      document.documentElement.style.removeProperty("--accent-hover");
    }
  }, [t.accent]);

  const navigate = useCallback((next) => {
    if (next === route) return;
    triggerLoader();
    setRoute(next);
    // scroll to top
    const content = document.querySelector(".content");
    if (content) content.scrollTo({ top: 0, behavior: "instant" });
  }, [route, triggerLoader]);

  const isPublic = route === "scan-preview" || route === "campaign-public";

  // Public views render full-bleed without sidebar
  if (isPublic) {
    return (
      <ToastProvider>
        <div className={`toploader ${loaderActive ? "active" : ""}`}></div>
        {route === "scan-preview" && <ViewScan onNavigate={navigate} />}
        {route === "campaign-public" && <ViewCampaignPublic onNavigate={navigate} />}
        <AppTweaks t={t} setTweak={setTweak} route={route} setRoute={navigate} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div className={`toploader ${loaderActive ? "active" : ""}`}></div>
      <div className="app" data-density={t.density}>
        <Sidebar
          active={route}
          onNavigate={navigate}
          theme={t.theme}
          onTheme={(v) => setTweak("theme", v)}
          plan={t.plan}
        />
        <main className="content scroll" data-screen-label={`Screen · ${route}`}>
          <div className="content-inner">
            {route === "dashboard" && <ViewDashboard onNavigate={navigate} />}
            {route === "create"    && <ViewCreate    onNavigate={navigate} />}
            {route === "manager"   && <ViewManager   onNavigate={navigate} />}
            {route === "analytics" && <ViewAnalytics onNavigate={navigate} />}
            {route === "campaigns" && <ViewCampaigns onNavigate={navigate} onEdit={() => navigate("editor")} />}
            {route === "editor"    && null}
            {route === "loyalty"   && <ViewLoyalty />}
            {route === "pricing"   && <ViewPricing currentPlan={t.plan} onChangePlan={(p) => setTweak("plan", p)} />}
            {route === "help"      && <ViewHelp onNavigate={navigate} />}
          </div>
          {/* Editor renders outside the content-inner padding for full-bleed 3-col */}
          {route === "editor" && (
            <div style={{ padding: "0 16px 24px" }}>
              <ViewEditor onNavigate={navigate} />
            </div>
          )}
        </main>
      </div>
      <AppTweaks t={t} setTweak={setTweak} route={route} setRoute={navigate} />
    </ToastProvider>
  );
}

function AppTweaks({ t, setTweak, route, setRoute }) {
  return (
    <TweaksPanel>
      <TweakSection label="Appearance" />
      <TweakRadio
        label="Theme"
        value={t.theme}
        options={["light", "dark"]}
        onChange={v => setTweak("theme", v)}
      />
      <TweakColor
        label="Accent"
        value={t.accent}
        options={ACCENT_PRESETS.map(a => a.value)}
        onChange={v => setTweak("accent", v)}
      />
      <TweakRadio
        label="Density"
        value={t.density}
        options={["compact", "regular"]}
        onChange={v => setTweak("density", v)}
      />
      <TweakSection label="Billing" />
      <TweakRadio
        label="Current plan"
        value={t.plan}
        options={["starter", "growth", "pro"]}
        onChange={v => setTweak("plan", v)}
      />
      <TweakSection label="Navigation" />
      <TweakSelect
        label="Jump to screen"
        value={route}
        options={[
          { value: "dashboard", label: "Dashboard" },
          { value: "create", label: "Create QR code" },
          { value: "manager", label: "My QR codes" },
          { value: "analytics", label: "Analytics" },
          { value: "campaigns", label: "Campaigns list" },
          { value: "editor", label: "Campaign editor" },
          { value: "pricing", label: "Pricing & plans" },
          { value: "scan-preview", label: "Public · /scan/[slug]" },
          { value: "campaign-public", label: "Public · /campaign/[slug]" },
          { value: "loyalty", label: "Loyalty (soon)" },
          { value: "help", label: "Help" },
        ]}
        onChange={v => setRoute(v)}
      />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
