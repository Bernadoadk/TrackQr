import React from "react";
import { NavLink, useLocation, useNavigate, useRouteLoaderData } from "react-router";
import { Icon } from "../ui/Icon";
import type { AppRouteLoaderData } from "../../routes/app";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard",      icon: "layout-dashboard", path: "/app",            kbd: "D" },
  { id: "create",    label: "Create QR code", icon: "plus",             path: "/app/create",     kbd: "C" },
  { id: "manager",   label: "My QR codes",    icon: "qr-code",          path: "/app/qr-manager", kbd: "Q" },
  { id: "analytics", label: "Analytics",      icon: "bar-chart",        path: "/app/analytics",  kbd: "A" },
  { id: "campaigns", label: "Campaigns",      icon: "megaphone",        path: "/app/campaigns",  kbd: "P" },
];

const SECONDARY = [
  { id: "pricing", label: "Pricing & plans", icon: "credit-card", path: "/app/pricing", soon: false },
  { id: "loyalty", label: "Loyalty",         icon: "heart",        path: "/app/loyalty", soon: true  },
  { id: "help",    label: "Help",            icon: "help-circle",  path: "/app/help",    soon: false },
];

const PLAN_ICON: Record<string, string> = {
  starter: "rocket",
  growth:  "zap",
  pro:     "sparkles",
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
  const planId   = usage?.planId   ?? "starter";
  const planName = usage?.planName ?? "Starter";
  const planIcon = PLAN_ICON[planId] ?? "rocket";
  const qrUsed   = usage?.qrUsed   ?? 0;
  const qrLimit  = usage?.qrLimit  ?? null;
  const upgradeTarget = planId === "starter" ? "Growth" : planId === "growth" ? "Pro" : null;

  const isActive = (path: string) => {
    if (path === "/app") return location.pathname === "/app";
    return location.pathname.startsWith(path);
  };

  const usagePct = qrLimit == null ? 0 : Math.min(100, Math.round(qrUsed / qrLimit * 100));

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sb-brand">
        <div className="sb-mark">
          <Icon name="qr-code" size={18} />
        </div>
        <div className="sb-brand-text">
          <div className="sb-brand-name">TrackQr</div>
          <div className="sb-brand-badge">{planName}</div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="sb-section">
        <div className="sb-label">Navigation</div>
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.id}
            to={item.path}
            className={`sb-item ${isActive(item.path) ? "active" : ""}`}
          >
            <div className="sb-item-icon"><Icon name={item.icon} /></div>
            <div className="sb-item-label">{item.label}</div>
            <span className="sb-item-kbd">{item.kbd}</span>
          </NavLink>
        ))}
      </nav>

      {/* Secondary nav */}
      <nav className="sb-section">
        <div className="sb-label">More</div>
        {SECONDARY.map(item => (
          item.soon ? (
            <div key={item.id} className="sb-item disabled">
              <div className="sb-item-icon"><Icon name={item.icon} /></div>
              <div className="sb-item-label">{item.label}</div>
              <span className="sb-item-soon">Soon</span>
            </div>
          ) : (
            <NavLink
              key={item.id}
              to={item.path}
              className={`sb-item ${isActive(item.path) ? "active" : ""}`}
            >
              <div className="sb-item-icon"><Icon name={item.icon} /></div>
              <div className="sb-item-label">{item.label}</div>
            </NavLink>
          )
        ))}
      </nav>

      <div className="sb-spacer" />

      {/* Current plan widget */}
      <div
        className="sb-plan"
        data-plan={planId}
        onClick={() => navigate("/app/pricing")}
        style={{ cursor: "default" }}
      >
        <div className="sb-plan-head">
          <div className="sb-plan-dot">
            <Icon name={planIcon} />
          </div>
          <div className="sb-plan-meta">
            <span className="sb-plan-eyebrow">{usage?.trial ? "Trial" : "Current plan"}</span>
            <span className="sb-plan-name">{planName}</span>
          </div>
        </div>

        <div className="sb-plan-usage">
          <span><b>{qrUsed}</b> / {qrLimit ?? "∞"} QR codes</span>
          <span>{qrLimit == null ? "∞" : `${usagePct}%`}</span>
        </div>
        <div className="sb-plan-bar">
          <div className="sb-plan-bar-fill" style={{ width: `${qrLimit == null ? 100 : usagePct}%` }} />
        </div>

        {upgradeTarget && (
          <button
            className="sb-plan-cta"
            onClick={(e) => { e.stopPropagation(); navigate("/app/pricing"); }}
          >
            <Icon name="arrow-up" />
            Upgrade to {upgradeTarget}
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
            aria-label="Light mode"
          >
            <Icon name="sun" />
          </button>
          <button
            className={`sb-theme-btn ${theme === "dark" ? "active" : ""}`}
            onClick={() => onTheme("dark")}
            aria-label="Dark mode"
          >
            <Icon name="moon" />
          </button>
        </div>
      </div>
    </aside>
  );
}
