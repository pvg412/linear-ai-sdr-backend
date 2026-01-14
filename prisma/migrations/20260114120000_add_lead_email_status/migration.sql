-- Add Lead.emailStatus (normalized deliverability)

-- Prisma will also create this enum type during migration generation;
-- we keep it explicit here since migrations are checked in.
CREATE TYPE "EmailStatus" AS ENUM (
  'DELIVERABLE',
  'UNDELIVERABLE',
  'RISKY',
  'CATCH_ALL',
  'UNKNOWN'
);

ALTER TABLE "Lead" ADD COLUMN "emailStatus" "EmailStatus";

-- Index for common filtering
CREATE INDEX "Lead_emailStatus_idx" ON "Lead"("emailStatus");

