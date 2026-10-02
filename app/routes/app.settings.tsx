import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { z } from "zod";
import { requireShop } from "../lib/shop.server";
import { getPlanEntitlements } from "../lib/plan.server";
import { readShopSettings, updateShopSettings } from "../lib/shop-settings.server";
import { normalizeWebUrl } from "../lib/url-safety";
import { scanBaseUrl } from "../lib/qr.server";
import { isSmtpConfigured } from "../lib/smtp.server";
import { sendWeeklyReports } from "../lib/weekly-report.server";
import { CUSTOMER_SYNC_SCOPE, hasGrantedScope } from "../lib/customers.server";
import { unauthenticated } from "../shopify.server";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Field, Input } from "../components/ui/Input";
import { FeatureLock } from "../components/ui/FeatureLock";
import { useToast } from "../components/ui/Toast";
import { t, tem, tm, tx } from "../lib/i18n";

/** Liquid file name of the attribution app embed (extensions/trackqr-attribution/blocks). */
const ATTRIBUTION_EMBED_HANDLE = "attribution";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const entitlements = await getPlanEntitlements(shop);
  const settings = readShopSettings(shop);
  let customerScopeGranted = false;
  if (entitlements.customerSync) {
    try {
      const { admin } = await unauthenticated.admin(shop.domain);
      customerScopeGranted = await hasGrantedScope(admin, CUSTOMER_SYNC_SCOPE);
    } catch {
      customerScopeGranted = false;
    }
  }
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  return {
    shopDomain: shop.domain,
    shopEmail: shop.email,
    planName: entitlements.planName,
    features: {
      customFallback: entitlements.customFallback,
      customerSync: entitlements.customerSync,
      attribution: entitlements.attribution,
    },
    settings: {
      defaultFallbackUrl: settings.defaultFallbackUrl ?? "",
      leadNotifyEmail: settings.leadNotifyEmail ?? "",
      weeklyReport: settings.weeklyReport,
      syncLeadsToCustomers: settings.syncLeadsToCustomers,
      attributionEmbedOpened: settings.attributionEmbedOpened,
    },
    customerScopeGranted,
    smtpConfigured: isSmtpConfigured(),
    scanBase: scanBaseUrl() || new URL(request.url).origin,
    embedLink: apiKey
      ? `https://${shop.domain}/admin/themes/current/editor?context=apps&activateAppId=${apiKey}/${ATTRIBUTION_EMBED_HANDLE}`
      : `https://${shop.domain}/admin/themes/current/editor?context=apps`,
  };
};

const EmailSchema = z.string().trim().email().max(320);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");
  const entitlements = await getPlanEntitlements(shop);

  if (intent === "embed-opened") {
    await updateShopSettings(shop.id, { attributionEmbedOpened: true });
    return { ok: true as const, intent };
  }
  if (intent === "onboarding-dismiss") {
    await updateShopSettings(shop.id, { onboardingDismissed: form.get("value") !== "0" });
    return { ok: true as const, intent };
  }
  if (intent === "test-report") {
    const result = await sendWeeklyReports({ force: true, shopDomain: shop.domain });
    if (result.sent) return { ok: true as const, intent, message: "Report sent — check your inbox." };
    return { ok: false as const, intent, message: result.failed ? "The report could not be sent (email server error)." : "Nothing to report yet — there was no activity in the last 7 days." };
  }

  // save
  const patch: Parameters<typeof updateShopSettings>[1] = {};
  const rawFallback = String(form.get("defaultFallbackUrl") ?? "").trim();
  if (entitlements.customFallback) {
    if (rawFallback) {
      const url = normalizeWebUrl(rawFallback);
      if (!url) return { ok: false as const, intent, message: "The fallback page must be a valid web address (https://…)." };
      patch.defaultFallbackUrl = url;
    } else {
      patch.defaultFallbackUrl = null;
    }
  }
  const rawEmail = String(form.get("leadNotifyEmail") ?? "").trim();
  if (rawEmail) {
    const email = EmailSchema.safeParse(rawEmail);
    if (!email.success) return { ok: false as const, intent, message: "The notification email is not valid." };
    patch.leadNotifyEmail = email.data;
  } else {
    patch.leadNotifyEmail = null;
  }
  patch.weeklyReport = form.get("weeklyReport") === "1";

  const wantsSync = form.get("syncLeadsToCustomers") === "1";
  if (wantsSync && entitlements.customerSync) {
    const { admin } = await unauthenticated.admin(shop.domain);
    if (!(await hasGrantedScope(admin, CUSTOMER_SYNC_SCOPE))) {
      return { ok: false as const, intent, message: "Grant customer access first — Shopify asks you to confirm it." };
    }
    patch.syncLeadsToCustomers = true;
  } else {
    patch.syncLeadsToCustomers = false;
  }

  await updateShopSettings(shop.id, patch);
  return { ok: true as const, intent, message: "Settings saved." };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const toast = useToast();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();

  const [fallback, setFallback] = useState(data.settings.defaultFallbackUrl);
  const [notifyEmail, setNotifyEmail] = useState(data.settings.leadNotifyEmail);
  const [weeklyReport, setWeeklyReport] = useState(data.settings.weeklyReport);
  const [syncCustomers, setSyncCustomers] = useState(data.settings.syncLeadsToCustomers);
  const [granting, setGranting] = useState(false);
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const d = fetcher.data;
    if (d.intent === "embed-opened" || d.intent === "onboarding-dismiss") return;
    if ("message" in d && d.message) {
      toast({ type: d.ok ? "success" : "error", title: d.ok ? (d.intent === "test-report" ? t("Report sent") : t("Saved")) : t("Not saved"), desc: tm(d.message) });
    }
  }, [fetcher.state, fetcher.data]);

  const save = () => {
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("defaultFallbackUrl", fallback);
    fd.set("leadNotifyEmail", notifyEmail);
    fd.set("weeklyReport", weeklyReport ? "1" : "0");
    fd.set("syncLeadsToCustomers", syncCustomers ? "1" : "0");
    fetcher.submit(fd, { method: "post" });
  };

  const grantCustomerAccess = async () => {
    setGranting(true);
    try {
      const scopes = (shopify as unknown as { scopes?: { request: (s: string[]) => Promise<{ result: string }> } }).scopes;
      if (!scopes) throw new Error("Open the app inside Shopify admin to grant access.");
      const res = await scopes.request(["write_customers"]);
      if (res.result === "granted-all") {
        toast({ title: t("Customer access granted"), desc: t("Turn on the sync and save.") });
        revalidator.revalidate();
      } else {
        toast({ type: "info", title: t("Access not granted"), desc: t("Leads stay in TrackQr only.") });
      }
    } catch (err) {
      toast({ type: "error", title: t("Could not request access"), desc: err instanceof Error ? tm(err.message) : t("Try again.") });
    } finally {
      setGranting(false);
    }
  };

  const openThemeEditor = () => {
    window.open(data.embedLink, "_blank", "noopener,noreferrer");
    const fd = new FormData();
    fd.set("intent", "embed-opened");
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-left">
          <div className="page-eyebrow"><Icon name="settings" size={11} /> {t("Settings · {plan} plan", { plan: data.planName })}</div>
          <h1 className="page-h1">{tem("App <em>settings</em>")}</h1>
          <div className="page-sub">{t("How your QR codes behave, who gets notified, and how TrackQr connects to your store.")}</div>
        </div>
        <div className="page-head-actions">
          <Button variant="primary" icon="save" onClick={save} disabled={saving}>{saving ? t("Saving…") : t("Save settings")}</Button>
        </div>
      </div>

      <div className="settings-grid">
        {/* Scan experience */}
        <Card className="card-pad-lg">
          <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>{t("Scan experience")}</div>
          <div className="section-sub">{t("A printed QR code never ends on an error page.")}</div>
          <div className="col gap-3 mt-4">
            {data.features.customFallback ? (
              <Field label={t("Default fallback page")} hint={t("Where scans go when a code is paused, not active yet, expired or over your plan limit. Empty = your store home page ({shopDomain}). Each QR code can override it.", { shopDomain: data.shopDomain })}>
                <Input icon="link" value={fallback} onChange={e => setFallback(e.target.value)} placeholder={`https://${data.shopDomain}/`} />
              </Field>
            ) : (
              <FeatureLock
                compact
                title={t("Fallback: your store home page")}
                desc={t("Pick your own fallback page — a promotion, a newsletter sign-up — from the Starter plan.")}
                plan="Starter"
              />
            )}
            <div className="settings-info">
              <Icon name="globe" size={14} />
              <div>
                <div className="strong text-sm">{t("Scan domain")}</div>
                <div className="text-xs muted">{tx("Your codes open {url}. Keep this domain for as long as your codes are printed.", { url: <span className="mono">{data.scanBase}/s/…</span> })}</div>
              </div>
            </div>
          </div>
        </Card>

        {/* Notifications */}
        <Card className="card-pad-lg">
          <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>{t("Notifications")}</div>
          <div className="section-sub">{t("Lead alerts and your weekly summary.")}</div>
          <div className="col gap-3 mt-4">
            <Field label={t("Lead notification email")} hint={data.shopEmail ? t("Default recipient for campaign sign-ups (a capture block can override it). Empty = {email}.", { email: data.shopEmail }) : t("Default recipient for campaign sign-ups (a capture block can override it).")}>
              <Input type="email" icon="mail" value={notifyEmail} onChange={e => setNotifyEmail(e.target.value)} placeholder={data.shopEmail ?? "you@yourstore.com"} />
            </Field>
            <div className="settings-toggle-row">
              <label className="toggle">
                <input type="checkbox" aria-label={t("Weekly report")} checked={weeklyReport} onChange={e => setWeeklyReport(e.target.checked)} />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
              </label>
              <div style={{ flex: 1 }}>
                <div className="strong text-sm">{t("Weekly report")}</div>
                <div className="text-xs muted">{data.features.attribution ? t("Scans, leads, top QR codes, orders and revenue — every week, skipped when nothing happened.") : t("Scans, leads, top QR codes — every week, skipped when nothing happened.")}</div>
              </div>
              <Button size="sm" variant="ghost" icon="send" disabled={saving || !data.smtpConfigured} onClick={() => {
                const fd = new FormData();
                fd.set("intent", "test-report");
                fetcher.submit(fd, { method: "post" });
              }}>{t("Send now")}</Button>
            </div>
            {!data.smtpConfigured && (
              <div className="text-xs" style={{ color: "var(--amber-fg)" }}>{t("Email sending is not configured on this server (SMTP settings missing).")}</div>
            )}
          </div>
        </Card>

        {/* Shopify customers */}
        <Card className="card-pad-lg">
          <div className="section-h" style={{ fontSize: 15, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
            {t("Leads → Shopify customers")} <Badge tone="violet">{t("Growth")}</Badge>
          </div>
          <div className="section-sub">{t("Each campaign sign-up becomes a Shopify customer, tagged with the campaign — ready for Shopify Email, Klaviyo or Flow.")}</div>
          <div className="col gap-3 mt-4">
            {!data.features.customerSync ? (
              <FeatureLock compact title={t("Sync leads to Shopify")} desc={t("Skip CSV exports: leads land in your customer list with their marketing consent.")} plan="Growth" />
            ) : !data.customerScopeGranted ? (
              <div className="settings-toggle-row">
                <Icon name="shield" size={16} />
                <div style={{ flex: 1 }}>
                  <div className="strong text-sm">{t("Customer access required")}</div>
                  <div className="text-xs muted">{t("TrackQr only asks for it when you use this feature. You can revoke it any time.")}</div>
                </div>
                <Button size="sm" variant="primary" onClick={grantCustomerAccess} disabled={granting}>{granting ? t("Waiting…") : t("Grant access")}</Button>
              </div>
            ) : (
              <div className="settings-toggle-row">
                <label className="toggle">
                  <input type="checkbox" aria-label={t("Create Shopify customers from leads")} checked={syncCustomers} onChange={e => setSyncCustomers(e.target.checked)} />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                </label>
                <div style={{ flex: 1 }}>
                  <div className="strong text-sm">{t("Create Shopify customers from leads")}</div>
                  <div className="text-xs muted">{t("Marketing consent is recorded only when the visitor ticks the consent box. Existing customers are tagged, never downgraded.")}</div>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Attribution */}
        <Card className="card-pad-lg">
          <div className="section-h" style={{ fontSize: 15, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
            {t("Sales attribution")} <Badge tone="violet">{t("Growth")}</Badge>
          </div>
          <div className="section-sub">{t("Match Shopify orders to the scans that started them.")}</div>
          <div className="col gap-3 mt-4">
            {!data.features.attribution ? (
              <FeatureLock compact title={t("Know which QR codes sell")} desc={t("Orders, revenue and conversion rate per QR code and campaign.")} plan="Growth" />
            ) : (
              <>
                <div className="settings-toggle-row">
                  <Icon name={data.settings.attributionEmbedOpened ? "circle-check" : "zap"} size={16} style={{ color: data.settings.attributionEmbedOpened ? "var(--green-fg)" : "var(--accent)" }} />
                  <div style={{ flex: 1 }}>
                    <div className="strong text-sm">{t("TrackQr attribution app embed")}</div>
                    <div className="text-xs muted">
                      {tx("Needed for every QR type except Add to cart. The theme editor opens with the embed switched on — click {save} there.", { save: <b>{t("Save")}</b> })}
                    </div>
                  </div>
                  <Button size="sm" variant={data.settings.attributionEmbedOpened ? "secondary" : "primary"} icon="external-link" onClick={openThemeEditor}>
                    {data.settings.attributionEmbedOpened ? t("Open again") : t("Enable")}
                  </Button>
                </div>
                <div className="text-xs muted">{t("Orders placed within 7 days of a scan, on the same device, are attributed. A new theme needs the embed enabled again.")}</div>
              </>
            )}
          </div>
        </Card>

        {/* Privacy */}
        <Card className="card-pad-lg settings-wide">
          <div className="section-h" style={{ fontSize: 15, marginBottom: 4 }}>{t("Data & privacy")}</div>
          <div className="settings-privacy">
            <div><Icon name="shield" size={14} /> {t("Scans are anonymous: the visitor IP is hashed with a daily salt and never stored.")}</div>
            <div><Icon name="users" size={14} /> {t("Campaign leads are stored with their consent status; Shopify privacy requests (data request, erasure) are handled automatically.")}</div>
            <div><Icon name="trash" size={14} /> {t("Uninstalling TrackQr deletes your data 48 hours later, as required by Shopify.")}</div>
          </div>
        </Card>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
