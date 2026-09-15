import { Link, useLocation, useRouteLoaderData } from "react-router";
import { Icon } from "../ui/Icon";
import { withEmbeddedParams } from "../../lib/embedded-params";
import type { AppRouteLoaderData } from "../../routes/app";

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
    const parts: string[] = [];
    if (overQr > 0) parts.push(`${overQr} QR code${overQr > 1 ? "s" : ""}`);
    if (overCampaigns > 0) parts.push(`${overCampaigns} campaign${overCampaigns > 1 ? "s" : ""}`);
    return (
      <div className="plan-notice warning" role="status">
        <Icon name="alert-triangle" size={15} />
        <div className="plan-notice-body">
          <b>{parts.join(" and ")} paused</b> — your {usage.planName} plan allows
          {usage.qrLimit != null ? ` ${usage.qrLimit} QR codes` : ""}
          {usage.qrLimit != null && usage.campaignLimit != null ? " and" : ""}
          {usage.campaignLimit != null ? ` ${usage.campaignLimit} campaign${usage.campaignLimit > 1 ? "s" : ""}` : ""}.
          Archive or delete older items to make room, or upgrade to reactivate everything.
        </div>
        <Link to={pricingHref} className="plan-notice-cta">Upgrade <Icon name="arrow-right" size={12} /></Link>
      </div>
    );
  }

  return null;
}
