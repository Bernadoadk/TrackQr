export type CampaignPageLayout = "contained" | "wide" | "full";
export type CampaignPageTheme = "dark" | "light";
export type CampaignLogoPosition = "left" | "center" | "right";
export type CampaignSocialIconColorMode = "custom" | "brand";

export type CampaignPageSettings = {
  layout: CampaignPageLayout;
  theme: CampaignPageTheme;
  accentColor: string;
  pageBgColor: string;
  textColor: string;
  logoText: string;
  logoImageUrl: string;
  logoPosition: CampaignLogoPosition;
  footerEnabled: boolean;
  footerText: string;
  creditText: string;
  footerBgColor: string;
  footerTextColor: string;
  footerCreditColor: string;
  footerBorderColor: string;
  socialIconColorMode: CampaignSocialIconColorMode;
  socialIconColor: string;
  poweredTextColor: string;
  poweredMarkBgColor: string;
  instagramUrl: string;
  tiktokUrl: string;
  facebookUrl: string;
  xUrl: string;
  websiteUrl: string;
  showPoweredBy: boolean;
  /** Google Analytics 4 measurement id (G-XXXX) — Growth. */
  ga4MeasurementId: string;
  /** Meta (Facebook) Pixel id — Growth. */
  metaPixelId: string;
};

export const DEFAULT_CAMPAIGN_PAGE_SETTINGS: CampaignPageSettings = {
  layout: "wide",
  theme: "dark",
  accentColor: "#2563EB",
  pageBgColor: "",
  textColor: "",
  logoText: "",
  logoImageUrl: "",
  logoPosition: "left",
  footerEnabled: true,
  footerText: "",
  creditText: "",
  footerBgColor: "",
  footerTextColor: "",
  footerCreditColor: "",
  footerBorderColor: "",
  socialIconColorMode: "custom",
  socialIconColor: "",
  poweredTextColor: "",
  poweredMarkBgColor: "",
  instagramUrl: "",
  tiktokUrl: "",
  facebookUrl: "",
  xUrl: "",
  websiteUrl: "",
  showPoweredBy: true,
  ga4MeasurementId: "",
  metaPixelId: "",
};

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function normalizeCampaignPageSettings(value: unknown): CampaignPageSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    layout: choice(raw.layout, ["contained", "wide", "full"], DEFAULT_CAMPAIGN_PAGE_SETTINGS.layout),
    theme: choice(raw.theme, ["dark", "light"], DEFAULT_CAMPAIGN_PAGE_SETTINGS.theme),
    accentColor: text(raw.accentColor, DEFAULT_CAMPAIGN_PAGE_SETTINGS.accentColor) || DEFAULT_CAMPAIGN_PAGE_SETTINGS.accentColor,
    pageBgColor: text(raw.pageBgColor, DEFAULT_CAMPAIGN_PAGE_SETTINGS.pageBgColor),
    textColor: text(raw.textColor, DEFAULT_CAMPAIGN_PAGE_SETTINGS.textColor),
    logoText: text(raw.logoText, DEFAULT_CAMPAIGN_PAGE_SETTINGS.logoText),
    logoImageUrl: text(raw.logoImageUrl, DEFAULT_CAMPAIGN_PAGE_SETTINGS.logoImageUrl),
    logoPosition: choice(raw.logoPosition, ["left", "center", "right"], DEFAULT_CAMPAIGN_PAGE_SETTINGS.logoPosition),
    footerEnabled: typeof raw.footerEnabled === "boolean" ? raw.footerEnabled : DEFAULT_CAMPAIGN_PAGE_SETTINGS.footerEnabled,
    footerText: text(raw.footerText, DEFAULT_CAMPAIGN_PAGE_SETTINGS.footerText),
    creditText: text(raw.creditText, DEFAULT_CAMPAIGN_PAGE_SETTINGS.creditText),
    footerBgColor: text(raw.footerBgColor, DEFAULT_CAMPAIGN_PAGE_SETTINGS.footerBgColor),
    footerTextColor: text(raw.footerTextColor, DEFAULT_CAMPAIGN_PAGE_SETTINGS.footerTextColor),
    footerCreditColor: text(raw.footerCreditColor, DEFAULT_CAMPAIGN_PAGE_SETTINGS.footerCreditColor),
    footerBorderColor: text(raw.footerBorderColor, DEFAULT_CAMPAIGN_PAGE_SETTINGS.footerBorderColor),
    socialIconColorMode: choice(raw.socialIconColorMode, ["custom", "brand"], DEFAULT_CAMPAIGN_PAGE_SETTINGS.socialIconColorMode),
    socialIconColor: text(raw.socialIconColor, DEFAULT_CAMPAIGN_PAGE_SETTINGS.socialIconColor),
    poweredTextColor: text(raw.poweredTextColor, DEFAULT_CAMPAIGN_PAGE_SETTINGS.poweredTextColor),
    poweredMarkBgColor: text(raw.poweredMarkBgColor, DEFAULT_CAMPAIGN_PAGE_SETTINGS.poweredMarkBgColor),
    instagramUrl: text(raw.instagramUrl, DEFAULT_CAMPAIGN_PAGE_SETTINGS.instagramUrl),
    tiktokUrl: text(raw.tiktokUrl, DEFAULT_CAMPAIGN_PAGE_SETTINGS.tiktokUrl),
    facebookUrl: text(raw.facebookUrl, DEFAULT_CAMPAIGN_PAGE_SETTINGS.facebookUrl),
    xUrl: text(raw.xUrl, DEFAULT_CAMPAIGN_PAGE_SETTINGS.xUrl),
    websiteUrl: text(raw.websiteUrl, DEFAULT_CAMPAIGN_PAGE_SETTINGS.websiteUrl),
    showPoweredBy: typeof raw.showPoweredBy === "boolean" ? raw.showPoweredBy : DEFAULT_CAMPAIGN_PAGE_SETTINGS.showPoweredBy,
    ga4MeasurementId: pattern(raw.ga4MeasurementId, /^G-[A-Z0-9]{4,16}$/),
    metaPixelId: pattern(raw.metaPixelId, /^\d{6,20}$/),
  };
}

/** Keep a tracking id only when it has the expected shape (it ends up in a script). */
function pattern(value: unknown, re: RegExp): string {
  const v = typeof value === "string" ? value.trim().toUpperCase() : "";
  return re.test(v) ? v : "";
}

export interface CampaignPlanOptions {
  /** Free plan: the "Powered by TrackQr" watermark is always shown. */
  forcePoweredBy: boolean;
  /** Tracking pixels are a Growth feature — dropped otherwise. */
  pixels: boolean;
}

/**
 * Settings as the public page renders them for the plan of the store: the
 * "Powered by TrackQr" watermark is forced on stores without a paid
 * subscription (Free plan) and hidden on paid plans; pixels need Growth.
 */
export function campaignPageSettingsForPlan(value: unknown, opts: CampaignPlanOptions): CampaignPageSettings {
  const settings = normalizeCampaignPageSettings(value);
  return {
    ...settings,
    showPoweredBy: opts.forcePoweredBy,
    ga4MeasurementId: opts.pixels ? settings.ga4MeasurementId : "",
    metaPixelId: opts.pixels ? settings.metaPixelId : "",
  };
}
