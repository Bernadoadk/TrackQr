// sidebar.jsx

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "layout-dashboard", kbd: "D" },
  { id: "create",    label: "Create QR code",  icon: "plus",        kbd: "C" },
  { id: "manager",   label: "My QR codes",     icon: "qr-code",     kbd: "Q" },
  { id: "analytics", label: "Analytics",       icon: "bar-chart",   kbd: "A" },
  { id: "campaigns", label: "Campaigns",       icon: "megaphone",   kbd: "P" },
];

const SECONDARY = [
  { id: "pricing", label: "Pricing & plans", icon: "credit-card" },
  { id: "loyalty", label: "Loyalty", icon: "heart", soon: true },
  { id: "help",    label: "Help",    icon: "help-circle" },
];

function Sidebar({ active, onNavigate, theme, onTheme, plan = "growth" }) {
  const planMeta = (window.PLAN_BY_ID || {})[plan] || { id: plan, name: plan };
  const next = (window.nextPlan || (() => null))(plan);

  // Mocked usage — would come from backend
  const USAGE = {
    starter: { used: 8,   limit: 10,  label: "QR codes" },
    growth:  { used: 27,  limit: 50,  label: "QR codes" },
    pro:     { used: 184, limit: Infinity, label: "QR codes" },
  }[plan] || { used: 0, limit: 0, label: "" };

  const usagePct = USAGE.limit === Infinity ? 18 : Math.min(100, Math.round(USAGE.used / USAGE.limit * 100));
  const isUnlimited = USAGE.limit === Infinity;

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-mark">
          <Icon name="qr-code" size={18} />
        </div>
        <div className="sb-brand-text">
          <div className="sb-brand-name">QR Flow</div>
          <div className="sb-brand-badge">{planMeta.name}</div>
        </div>
      </div>

      <div className="sb-search" onClick={() => onNavigate("manager")}>
        <Icon name="search" />
        <span>Search…</span>
        <span className="sb-kbd">⌘K</span>
      </div>

      <nav className="sb-section">
        <div className="sb-label">Navigation</div>
        {NAV_ITEMS.map(item => (
          <div key={item.id}
               className={`sb-item ${active === item.id ? "active" : ""}`}
               onClick={() => onNavigate(item.id)}>
            <div className="sb-item-icon"><Icon name={item.icon} /></div>
            <div className="sb-item-label">{item.label}</div>
            <span className="sb-item-kbd">{item.kbd}</span>
          </div>
        ))}
      </nav>

      <nav className="sb-section">
        <div className="sb-label">More</div>
        {SECONDARY.map(item => (
          <div key={item.id}
               className={`sb-item ${active === item.id ? "active" : ""} ${item.soon ? "disabled" : ""}`}
               onClick={() => !item.soon && onNavigate(item.id)}>
            <div className="sb-item-icon"><Icon name={item.icon} /></div>
            <div className="sb-item-label">{item.label}</div>
            {item.soon && <span className="sb-item-soon">Soon</span>}
          </div>
        ))}
      </nav>

      <div className="sb-spacer"></div>

      <div className="sb-plan" data-plan={plan} onClick={() => onNavigate("pricing")}>
        <div className="sb-plan-head">
          <div className="sb-plan-dot">
            <Icon name={planMeta.icon || "sparkles"} />
          </div>
          <div className="sb-plan-meta">
            <span className="sb-plan-eyebrow">Current plan</span>
            <span className="sb-plan-name">{planMeta.name}</span>
          </div>
        </div>

        <div className="sb-plan-usage">
          <span><b>{USAGE.used}</b>{!isUnlimited && <> / {USAGE.limit}</>} {USAGE.label}</span>
          <span>{isUnlimited ? "Unlimited" : `${usagePct}%`}</span>
        </div>
        <div className="sb-plan-bar">
          <div className="sb-plan-bar-fill" style={{ width: `${usagePct}%` }}></div>
        </div>

        <button className="sb-plan-cta" onClick={(e) => { e.stopPropagation(); onNavigate("pricing"); }}>
          {next ? (
            <>
              <Icon name="arrow-up" />
              Upgrade to {next.name}
            </>
          ) : (
            <>
              <Icon name="credit-card" />
              Manage billing
            </>
          )}
        </button>
      </div>

      <div className="sb-footer">
        <div className="sb-avatar"></div>
        <div className="sb-footer-text">
          <div><b>v2.0</b> · QR Flow</div>
        </div>
        <div className="sb-theme">
          <button className={`sb-theme-btn ${theme === "light" ? "active" : ""}`} onClick={() => onTheme("light")}><Icon name="sun" /></button>
          <button className={`sb-theme-btn ${theme === "dark" ? "active" : ""}`} onClick={() => onTheme("dark")}><Icon name="moon" /></button>
        </div>
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;
