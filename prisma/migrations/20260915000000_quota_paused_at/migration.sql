-- Remember which QR codes / campaigns were paused by the plan quota (as
-- opposed to the merchant) so they can be reactivated automatically once
-- the store upgrades or frees up room.
ALTER TABLE "QrCode"   ADD COLUMN "quotaPausedAt" TIMESTAMP(3);
ALTER TABLE "Campaign" ADD COLUMN "quotaPausedAt" TIMESTAMP(3);
