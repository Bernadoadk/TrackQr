-- TrackQr backend — full schema
-- Idempotent enough for fresh installs; assumes Session table already exists.

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'DECLINED', 'FROZEN');
CREATE TYPE "BillingCycle"       AS ENUM ('MONTHLY', 'ANNUAL');
CREATE TYPE "QrType"              AS ENUM ('HOME', 'PRODUCT', 'LINK', 'ATC', 'PROMO', 'URL', 'TEXT', 'PHONE', 'SMS', 'EMAIL', 'WIFI', 'VCARD');
CREATE TYPE "DeviceType"          AS ENUM ('MOBILE', 'DESKTOP', 'TABLET', 'UNKNOWN');
CREATE TYPE "CampaignStatus"      AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');
CREATE TYPE "LeadSyncStatus"      AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'DB_ONLY');
CREATE TYPE "IntegrationProvider" AS ENUM ('KLAVIYO', 'MAILCHIMP', 'HUBSPOT');

-- Shop
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "currency" TEXT DEFAULT 'USD',
    "ianaTimezone" TEXT,
    "primaryLocale" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "activeSubscriptionId" TEXT,
    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");
CREATE UNIQUE INDEX "Shop_activeSubscriptionId_key" ON "Shop"("activeSubscriptionId");
CREATE INDEX "Shop_domain_idx" ON "Shop"("domain");

-- Plan
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthly" INTEGER NOT NULL,
    "priceAnnual" INTEGER NOT NULL,
    "trialDays" INTEGER NOT NULL DEFAULT 14,
    "qrCodeLimit" INTEGER,
    "campaignLimit" INTEGER,
    "historyDays" INTEGER,
    "attribution" BOOLEAN NOT NULL DEFAULT false,
    "integrations" BOOLEAN NOT NULL DEFAULT false,
    "multiStore" BOOLEAN NOT NULL DEFAULT false,
    "api" BOOLEAN NOT NULL DEFAULT false,
    "customDomain" BOOLEAN NOT NULL DEFAULT false,
    "prioritySupport" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- Subscription
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "shopifyId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Subscription_shopifyId_key" ON "Subscription"("shopifyId");
CREATE INDEX "Subscription_shopId_idx" ON "Subscription"("shopId");

-- QrCode
CREATE TABLE "QrCode" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "QrType" NOT NULL,
    "target" TEXT NOT NULL,
    "shopifyRef" TEXT,
    "design" JSONB NOT NULL DEFAULT '{}',
    "label" JSONB NOT NULL DEFAULT '{}',
    "utmCampaign" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QrCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QrCode_slug_key"        ON "QrCode"("slug");
CREATE UNIQUE INDEX "QrCode_campaignId_key"  ON "QrCode"("campaignId");
CREATE INDEX "QrCode_shopId_createdAt_idx"   ON "QrCode"("shopId", "createdAt");
CREATE INDEX "QrCode_shopId_active_idx"      ON "QrCode"("shopId", "active");

-- Scan
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "qrCodeId" TEXT NOT NULL,
    "sessionToken" TEXT,
    "ipHash" TEXT,
    "country" TEXT,
    "device" "DeviceType" NOT NULL DEFAULT 'UNKNOWN',
    "os" TEXT,
    "browser" TEXT,
    "userAgent" TEXT,
    "referer" TEXT,
    "delivered" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Scan_qrCodeId_createdAt_idx" ON "Scan"("qrCodeId", "createdAt");
CREATE INDEX "Scan_sessionToken_idx"       ON "Scan"("sessionToken");

-- Conversion
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT,
    "amount" INTEGER,
    "currency" TEXT,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Conversion_scanId_key"          ON "Conversion"("scanId");
CREATE UNIQUE INDEX "Conversion_shopifyOrderId_key" ON "Conversion"("shopifyOrderId");
CREATE INDEX "Conversion_shopifyOrderId_idx"        ON "Conversion"("shopifyOrderId");

-- Campaign
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Campaign_slug_key"          ON "Campaign"("slug");
CREATE INDEX "Campaign_shopId_createdAt_idx"     ON "Campaign"("shopId", "createdAt");
CREATE INDEX "Campaign_shopId_status_idx"        ON "Campaign"("shopId", "status");

-- Lead
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT,
    "destination" TEXT NOT NULL DEFAULT 'db',
    "syncStatus" "LeadSyncStatus" NOT NULL DEFAULT 'DB_ONLY',
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Lead_campaignId_createdAt_idx" ON "Lead"("campaignId", "createdAt");
CREATE INDEX "Lead_email_idx"                ON "Lead"("email");

-- Integration
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "listId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Integration_shopId_provider_key" ON "Integration"("shopId", "provider");
CREATE INDEX "Integration_shopId_idx" ON "Integration"("shopId");

-- Asset
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyFileId" TEXT,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Asset_shopId_idx" ON "Asset"("shopId");

-- WebhookEvent
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "topic" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebhookEvent_shopId_topic_idx" ON "WebhookEvent"("shopId", "topic");

-- FKs
ALTER TABLE "Shop"         ADD CONSTRAINT "Shop_activeSubscriptionId_fkey" FOREIGN KEY ("activeSubscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_shopId_fkey"        FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE   ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey"        FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT  ON UPDATE CASCADE;
ALTER TABLE "QrCode"       ADD CONSTRAINT "QrCode_shopId_fkey"              FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE   ON UPDATE CASCADE;
ALTER TABLE "QrCode"       ADD CONSTRAINT "QrCode_campaignId_fkey"          FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Scan"         ADD CONSTRAINT "Scan_qrCodeId_fkey"              FOREIGN KEY ("qrCodeId") REFERENCES "QrCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversion"   ADD CONSTRAINT "Conversion_scanId_fkey"          FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE   ON UPDATE CASCADE;
ALTER TABLE "Campaign"     ADD CONSTRAINT "Campaign_shopId_fkey"            FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE   ON UPDATE CASCADE;
ALTER TABLE "Lead"         ADD CONSTRAINT "Lead_campaignId_fkey"            FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Integration"  ADD CONSTRAINT "Integration_shopId_fkey"         FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE   ON UPDATE CASCADE;
ALTER TABLE "Asset"        ADD CONSTRAINT "Asset_shopId_fkey"               FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE   ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopId_fkey"        FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL  ON UPDATE CASCADE;

-- Seed plans (prices in cents, USD)
INSERT INTO "Plan" ("id", "name", "priceMonthly", "priceAnnual", "qrCodeLimit", "campaignLimit", "historyDays", "attribution", "integrations", "multiStore", "api", "customDomain", "prioritySupport") VALUES
  ('starter', 'Starter', 1900,  1500,  10,   3,    30,   false, false, false, false, false, false),
  ('growth',  'Growth',  4900,  3900,  50,   NULL, 365,  true,  true,  false, false, false, true ),
  ('pro',     'Pro',     12900, 10300, NULL, NULL, NULL, true,  true,  true,  true,  true,  true );
