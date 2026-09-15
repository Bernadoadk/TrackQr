-- New feature flags used by the Free / Starter / Growth grid.
ALTER TABLE "Plan" ADD COLUMN "customDesign"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Plan" ADD COLUMN "detailedAnalytics" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Plan" ADD COLUMN "exports"           BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Plan" ALTER COLUMN "trialDays" SET DEFAULT 0;

-- Free (no Shopify subscription) / Starter $9 / Growth $29.
-- priceAnnual is the per-month equivalent billed yearly (Starter $84/yr, Growth $276/yr).
INSERT INTO "Plan" (
  "id",
  "name",
  "priceMonthly",
  "priceAnnual",
  "trialDays",
  "qrCodeLimit",
  "campaignLimit",
  "historyDays",
  "customDesign",
  "detailedAnalytics",
  "exports",
  "attribution",
  "integrations",
  "multiStore",
  "api",
  "customDomain",
  "prioritySupport"
) VALUES
  ('free',    'Free',    0,    0,    0, 3,    1,    30,   false, false, false, false, false, false, false, false, false),
  ('starter', 'Starter', 900,  700,  0, 25,   5,    90,   true,  true,  true,  false, false, false, false, false, false),
  ('growth',  'Growth',  2900, 2300, 0, NULL, NULL, NULL, true,  true,  true,  true,  true,  false, false, false, true)
ON CONFLICT ("id") DO UPDATE SET
  "name"              = EXCLUDED."name",
  "priceMonthly"      = EXCLUDED."priceMonthly",
  "priceAnnual"       = EXCLUDED."priceAnnual",
  "trialDays"         = EXCLUDED."trialDays",
  "qrCodeLimit"       = EXCLUDED."qrCodeLimit",
  "campaignLimit"     = EXCLUDED."campaignLimit",
  "historyDays"       = EXCLUDED."historyDays",
  "customDesign"      = EXCLUDED."customDesign",
  "detailedAnalytics" = EXCLUDED."detailedAnalytics",
  "exports"           = EXCLUDED."exports",
  "attribution"       = EXCLUDED."attribution",
  "integrations"      = EXCLUDED."integrations",
  "multiStore"        = EXCLUDED."multiStore",
  "api"               = EXCLUDED."api",
  "customDomain"      = EXCLUDED."customDomain",
  "prioritySupport"   = EXCLUDED."prioritySupport";

-- Retire the Pro tier: any subscription still pointing at it is carried over
-- to Growth (the new top tier) before the plan row is removed.
UPDATE "Subscription" SET "planId" = 'growth' WHERE "planId" = 'pro';
DELETE FROM "Plan" WHERE "id" = 'pro';
