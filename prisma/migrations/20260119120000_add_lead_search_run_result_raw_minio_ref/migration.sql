-- Add MinIO/S3 references for LeadSearchRunResult.raw
-- We keep the existing `raw` JSON column for backward compatibility, but new writes should avoid it.

ALTER TABLE "LeadSearchRunResult"
  ADD COLUMN "rawBucket" TEXT,
  ADD COLUMN "rawObjectKey" TEXT,
  ADD COLUMN "rawContentType" TEXT,
  ADD COLUMN "rawContentEncoding" TEXT,
  ADD COLUMN "rawSizeBytes" INTEGER,
  ADD COLUMN "rawEtag" TEXT;

