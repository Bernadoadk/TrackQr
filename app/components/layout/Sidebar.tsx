import { NavLink, useLocation, useNavigate, useRouteLoaderData } from "react-router";
import { Icon } from "../ui/Icon";
import type { AppRouteLoaderData } from "../../routes/app";
import { t, tp } from "../../lib/i18n";

/** Main navigation — `kbd` keys are live shortcuts (see AppShell). */
export const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard",      icon: "layout-dashboard", path: "/app",            kbd: "D" },
  { id: "create",    label: "Create QR code", icon: "plus",             path: "/app/create",     kbd: "C" },
  { id: "manager",   label: "My QR codes",    icon: "qr-code",          path: "/app/qr-manager", kbd: "Q" },
  { id: "bulk",      label: "Bulk create",    icon: "layers",           path: "/app/bulk",       kbd: "B" },
  { id: "analytics", label: "Analytics",      icon: "bar-chart",        path: "/app/analytics",  kbd: "A" },
  { id: "campaigns", label: "Campaigns",      icon: "megaphone",        path: "/app/campaigns",  kbd: "P" },
];

export const SECONDARY = [
  { id: "settings", label: "Settings",        icon: "settings",    path: "/app/settings", soon: false, kbd: "S" },
  { id: "pricing",  label: "Pricing & plans", icon: "credit-card", path: "/app/pricing",  soon: false, kbd: "" },
  { id: "loyalty",  label: "Loyalty",         icon: "heart",       path: "/app/loyalty",  soon: true,  kbd: "" },
  { id: "help",     label: "Help",            icon: "help-circle", path: "/app/help",     soon: false, kbd: "H" },
];

const PLAN_ICON: Record<string, string> = {
  free:    "gift",
  starter: "rocket",
  growth:  "zap",
};

const UPGRADE_TARGET: Record<string, string | null> = {
  free:    "Starter",
  starter: "Growth",
  growth:  null,
};

interface SidebarProps {
  theme: "light" | "dark";
  onTheme: (t: "light" | "dark") => void;
}

export function Sidebar({ theme, onTheme }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const appData  = useRouteLoaderData("routes/app") as AppRouteLoaderData | undefined;

  const usage = appData?.usage;
  const planId   = usage?.planId   ?? "free";
  const planName = usage?.planName ?? "Free";
  const planIcon = PLAN_ICON[planId] ?? "gift";
  const qrUsed   = usage?.qrUsed   ?? 0;
  const qrLimit  = usage?.qrLimit  ?? null;
  const overQuota = (usage?.qrOverQuota ?? 0) + (usage?.campaignOverQuota ?? 0);
  const upgradeTarget = UPGRADE_TARGET[planId] ?? null;

  const isActive = (path: string) => {
    if (path === "/app") return location.pathname === "/app";
    return location.pathname.startsWith(path);
  };

  const withEmbeddedParams = (path: string) => {
    const current = new URLSearchParams(location.search);
    const next = new URLSearchParams();
    const shop = current.get("shop");
    const host = current.get("host");
    if (shop) next.set("shop", shop);
    if (host) next.set("host", host);
    const query = next.toString();
    return query ? `${path}?${query}` : path;
  };

  const usagePct = qrLimit == null ? 0 : Math.min(100, Math.round(qrUsed / qrLimit * 100));

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sb-brand">
        <div className="sb-mark">
          <img src="/TrackQr.png" alt="" />
        </div>
        <div className="sb-brand-text">
          <div className="sb-brand-name">TrackQr</div>
          <div className="sb-brand-badge">{planName}</div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="sb-section">
        <div className="sb-label">{t("Navigation")}</div>
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.id}
            to={withEmbeddedParams(item.path)}
            className={`sb-item ${isActive(item.path) ? "active" : ""}`}
          >
            <div className="sb-item-icon"><Icon name={item.icon} /></div>
            <div className="sb-item-label">{t(item.label)}</div>
            <span className="sb-item-kbd">{item.kbd}</span>
          </NavLink>
        ))}
      </nav>

      {/* Secondary nav */}
      <nav className="sb-section">
        <div className="sb-label">{t("More")}</div>
        {SECONDARY.map(item => (
          item.soon ? (
            <div key={item.id} className="sb-item disabled">
              <div className="sb-item-icon"><Icon name={item.icon} /></div>
              <div className="sb-item-label">{t(item.label)}</div>
              <span className="sb-item-soon">{t("Soon")}</span>
            </div>
          ) : (
            <NavLink
              key={item.id}
              to={withEmbeddedParams(item.path)}
              className={`sb-item ${isActive(item.path) ? "active" : ""}`}
            >
              <div className="sb-item-icon"><Icon name={item.icon} /></div>
              <div className="sb-item-label">{t(item.label)}</div>
              {item.kbd && <span className="sb-item-kbd">{item.kbd}</span>}
            </NavLink>
          )
        ))}
      </nav>

      <div className="sb-spacer" />

      {/* Current plan widget */}
      <div
        className="sb-plan"
        data-plan={planId}
        role="link"
        tabIndex={0}
        aria-label={t("Current plan: {planName}. Open pricing and plans", { planName })}
        onClick={() => navigate(withEmbeddedParams("/app/pricing"))}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(withEmbeddedParams("/app/pricing")); } }}
        style={{ cursor: "pointer" }}
      >
        <div className="sb-plan-head">
          <div className="sb-plan-dot">
            <Icon name={planIcon} />
          </div>
          <div className="sb-plan-meta">
            <span className="sb-plan-eyebrow">
              {usage?.cycle === "ANNUAL" ? t("Current plan · annual") : usage?.cycle === "MONTHLY" ? t("Current plan · monthly") : t("Current plan")}
            </span>
            <span className="sb-plan-name">{planName}</span>
          </div>
        </div>

        <div className="sb-plan-usage">
          <span><b>{qrUsed}</b> / {qrLimit ?? "∞"} {t("QR codes")}</span>
          <span>{qrLimit == null ? "∞" : `${usagePct}%`}</span>
        </div>
        <div className="sb-plan-bar">
          <div className="sb-plan-bar-fill" style={{ width: `${qrLimit == null ? 100 : usagePct}%` }} />
        </div>
        {overQuota > 0 && (
          <div className="sb-plan-warning">
            <Icon name="alert-triangle" />
            {tp(overQuota, "{count} item paused (over limit)", "{count} items paused (over limit)")}
          </div>
        )}

        {upgradeTarget && (
          <button
            className="sb-plan-cta"
            onClick={(e) => { e.stopPropagation(); navigate(withEmbeddedParams("/app/pricing")); }}
          >
            <Icon name="arrow-up" />
            {t("Upgrade to {plan}", { plan: upgradeTarget })}
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="sb-footer">
        <div className="sb-avatar" />
        <div className="sb-footer-text">
          <div><b>v1.0</b> · TrackQr</div>
        </div>
        <div className="sb-theme">
          <button
            className={`sb-theme-btn ${theme === "light" ? "active" : ""}`}
            onClick={() => onTheme("light")}
            aria-label={t("Light mode")}
          >
            <Icon name="sun" />
          </button>
          <button
            className={`sb-theme-btn ${theme === "dark" ? "active" : ""}`}
            onClick={() => onTheme("dark")}
            aria-label={t("Dark mode")}
          >
            <Icon name="moon" />
          </button>
        </div>
      </div>
    </aside>
  );
}
