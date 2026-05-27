-- Migration: Advanced Create-page features
--   • QrCode: add utmTerm, activatesAt, expiresAt
--   • QrTemplate: new table for saved design+label presets

-- ── QrCode columns ───────────────────────────────────
ALTER TABLE "QrCode"
  ADD COLUMN "utmTerm"     TEXT,
  ADD COLUMN "activatesAt" TIMESTAMP(3),
  ADD COLUMN "expiresAt"   TIMESTAMP(3);

-- Indexes for fast lifecycle gating in the scan endpoint.
CREATE INDEX "QrCode_expiresAt_idx"    ON "QrCode"("expiresAt");
CREATE INDEX "QrCode_activatesAt_idx"  ON "QrCode"("activatesAt");

-- ── QrTemplate table ─────────────────────────────────
CREATE TABLE "QrTemplate" (
  "id"        TEXT NOT NULL,
  "shopId"    TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "design"    JSONB NOT NULL DEFAULT '{}',
  "label"     JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QrTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QrTemplate_shopId_updatedAt_idx" ON "QrTemplate"("shopId", "updatedAt");

ALTER TABLE "QrTemplate"
  ADD CONSTRAINT "QrTemplate_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
