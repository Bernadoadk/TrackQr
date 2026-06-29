INSERT INTO "Plan" (
  "id",
  "name",
  "priceMonthly",
  "priceAnnual",
  "trialDays",
  "qrCodeLimit",
  "campaignLimit",
  "historyDays",
  "attribution",
  "integrations",
  "multiStore",
  "api",
  "customDomain",
  "prioritySupport"
) VALUES
  ('starter', 'Starter', 1900, 1500, 14, 10, 3, 30, false, false, false, false, false, false),
  ('growth', 'Growth', 4900, 3900, 14, 50, NULL, 365, true, true, false, false, false, true),
  ('pro', 'Pro', 12900, 10300, 14, NULL, NULL, NULL, true, true, true, true, true, true)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "priceMonthly" = EXCLUDED."priceMonthly",
  "priceAnnual" = EXCLUDED."priceAnnual",
  "trialDays" = EXCLUDED."trialDays",
  "qrCodeLimit" = EXCLUDED."qrCodeLimit",
  "campaignLimit" = EXCLUDED."campaignLimit",
  "historyDays" = EXCLUDED."historyDays",
  "attribution" = EXCLUDED."attribution",
  "integrations" = EXCLUDED."integrations",
  "multiStore" = EXCLUDED."multiStore",
  "api" = EXCLUDED."api",
  "customDomain" = EXCLUDED."customDomain",
  "prioritySupport" = EXCLUDED."prioritySupport";
