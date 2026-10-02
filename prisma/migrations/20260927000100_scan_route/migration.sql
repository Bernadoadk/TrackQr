-- Smart routing: remember which rule / A/B variant served each scan.
ALTER TABLE "Scan" ADD COLUMN "route" TEXT;
