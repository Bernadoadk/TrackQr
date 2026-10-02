-- Audit improvements (2026-09-27)
--   • QR types for Shopify collections and store pages (pages, blog posts…)
--   • QR fallback URL, auto-applied discount code, smart routing rules
--   • Missed scans (paused / scheduled / expired / over quota / archived)
--   • Scan reference (?ref=…) for per-order QR codes
--   • Several orders can be attributed to the same scan
--   • Campaign page views, capture rewards, lead consent / privacy fields

-- CreateEnum
CREATE TYPE "MissedScanReason" AS ENUM ('PAUSED', 'SCHEDULED', 'EXPIRED', 'OVER_QUOTA', 'ARCHIVED');

-- AlterEnum (PostgreSQL 12+ accepts several ADD VALUE in one migration)
ALTER TYPE "QrType" ADD VALUE 'COLLECTION';
ALTER TYPE "QrType" ADD VALUE 'PAGE';

-- A scan can now lead to several orders: drop the 1:1 constraint.
DROP INDEX "Conversion_scanId_key";
CREATE INDEX "Conversion_scanId_idx" ON "Conversion"("scanId");

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "consent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ipHash" TEXT,
ADD COLUMN     "rewardCode" TEXT,
ADD COLUMN     "shopifyCustomerId" TEXT;

-- Leads used to keep the first characters of the raw IP in "source";
-- keep only the user-agent part (the IP is hashed from now on).
UPDATE "Lead"
SET "source" = NULLIF(TRIM(SUBSTRING("source" FROM POSITION(' · ' IN "source") + 3)), '')
WHERE "source" LIKE '% · %';

-- AlterTable
ALTER TABLE "QrCode" ADD COLUMN     "discountCode" TEXT,
ADD COLUMN     "fallbackUrl" TEXT,
ADD COLUMN     "rules" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Scan" ADD COLUMN     "ref" TEXT;

-- CreateTable
CREATE TABLE "MissedScan" (
    "id" TEXT NOT NULL,
    "qrCodeId" TEXT NOT NULL,
    "reason" "MissedScanReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissedScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignView" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sessionToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignReward" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "discountNodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissedScan_qrCodeId_createdAt_idx" ON "MissedScan"("qrCodeId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignView_campaignId_createdAt_idx" ON "CampaignView"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignReward_campaignId_blockId_percent_key" ON "CampaignReward"("campaignId", "blockId", "percent");

-- AddForeignKey
ALTER TABLE "MissedScan" ADD CONSTRAINT "MissedScan_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "QrCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignView" ADD CONSTRAINT "CampaignView_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignReward" ADD CONSTRAINT "CampaignReward_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
