-- Add Lead.isVerified
ALTER TABLE "Lead" ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing leads to keep backward compatibility
UPDATE "Lead" SET "isVerified" = true WHERE "isVerified" = false;

-- Index for common filtering
CREATE INDEX "Lead_isVerified_idx" ON "Lead"("isVerified");


