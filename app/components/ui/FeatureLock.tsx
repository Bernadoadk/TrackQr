import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { Icon } from "./Icon";
import { Button } from "./Button";
import { withEmbeddedParams } from "../../lib/embedded-params";
import { t } from "../../lib/i18n";

interface FeatureLockProps {
  /** What is locked, e.g. "Logo, colors & shapes". */
  title: string;
  desc?: string;
  /** Plan that unlocks it — used in the CTA label. */
  plan: string;
  /** Tighter layout for inline use inside a form card. */
  compact?: boolean;
  children?: ReactNode;
}

/**
 * Upsell panel shown in place of a plan-gated feature. Always links to the
 * Pricing page while preserving the embedded-app params.
 */
export function FeatureLock({ title, desc, plan, compact, children }: FeatureLockProps) {
  const location = useLocation();
  return (
    <div className={`feature-lock ${compact ? "compact" : ""}`} role="note">
      <div className="feature-lock-icon"><Icon name="lock" size={compact ? 14 : 18} /></div>
      <div className="feature-lock-body">
        <div className="feature-lock-title">{title}</div>
        {desc && <div className="feature-lock-desc">{desc}</div>}
        {children}
      </div>
      <Link to={withEmbeddedParams("/app/pricing", location.search)} className="feature-lock-cta">
        <Button variant="primary" size="sm" iconRight="arrow-right">{t("Upgrade to {plan}", { plan })}</Button>
      </Link>
    </div>
  );
}
