import { Link, useLocation, useRouteLoaderData } from "react-router";
import { Icon } from "../ui/Icon";
import { withEmbeddedParams } from "../../lib/embedded-params";
import type { AppRouteLoaderData } from "../../routes/app";
import { t, tp } from "../../lib/i18n";

/**
 * Contextual banner under the page header: items paused because they sit
 * beyond the plan quota (after a downgrade or a cancellation).
 */
export function PlanNotice() {
  const location = useLocation();
  const appData = useRouteLoaderData("routes/app") as AppRouteLoaderData | undefined;
  const usage = appData?.usage;
  if (!usage) return null;
  if (location.pathname.startsWith("/app/pricing")) return null;

  const pricingHref = withEmbeddedParams("/app/pricing", location.search);
  const overQr = usage.qrOverQuota;
  const overCampaigns = usage.campaignOverQuota;

  if (overQr > 0 || overCampaigns > 0) {
    const paused: string[] = [];
    if (overQr > 0) paused.push(tp(overQr, "{count} QR code", "{count} QR codes"));
    if (overCampaigns > 0) paused.push(tp(overCampaigns, "{count} campaign", "{count} campaigns"));
    const limits: string[] = [];
    if (usage.qrLimit != null) limits.push(tp(usage.qrLimit, "{count} QR code", "{count} QR codes"));
    if (usage.campaignLimit != null) limits.push(tp(usage.campaignLimit, "{count} campaign", "{count} campaigns"));
    return (
      <div className="plan-notice warning" role="status">
        <Icon name="alert-triangle" size={15} />
        <div className="plan-notice-body">
          <b>{t("{items} paused", { items: paused.join(t(" and ")) })}</b>{" "}
          {t("— your {plan} plan allows {limits}.", { plan: usage.planName, limits: limits.join(t(" and ")) })}{" "}
          {t("They come back automatically once they fit again — archive or delete older items to make room, or upgrade.")}
        </div>
        <Link to={pricingHref} className="plan-notice-cta">{t("Upgrade")} <Icon name="arrow-right" size={12} /></Link>
      </div>
    );
  }

  return null;
}
