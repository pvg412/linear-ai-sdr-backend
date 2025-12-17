-- Dedupe existing rows before adding unique constraints.
-- Postgres unique indexes allow multiple NULLs, so we only dedupe non-NULL values.

-- Normalize values to align with runtime normalization (trim + lowercasing).
UPDATE "Lead" SET "email" = LOWER(BTRIM("email")) WHERE "email" IS NOT NULL;
UPDATE "Lead" SET "linkedinUrl" = LOWER(BTRIM("linkedinUrl")) WHERE "linkedinUrl" IS NOT NULL;
UPDATE "Lead" SET "externalId" = BTRIM("externalId") WHERE "externalId" IS NOT NULL;

-- 1) One lead per task+email
DELETE FROM "Lead"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "searchTaskId", "email"
        ORDER BY "createdAt" ASC, "id" ASC
      ) AS rn
    FROM "Lead"
    WHERE "email" IS NOT NULL
  ) t
  WHERE t.rn > 1
);

-- 2) One lead per task+linkedinUrl
DELETE FROM "Lead"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "searchTaskId", "linkedinUrl"
        ORDER BY "createdAt" ASC, "id" ASC
      ) AS rn
    FROM "Lead"
    WHERE "linkedinUrl" IS NOT NULL
  ) t
  WHERE t.rn > 1
);

-- 3) One lead per task+source+externalId
DELETE FROM "Lead"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "searchTaskId", "source", "externalId"
        ORDER BY "createdAt" ASC, "id" ASC
      ) AS rn
    FROM "Lead"
    WHERE "externalId" IS NOT NULL
  ) t
  WHERE t.rn > 1
);

-- Add unique indexes (required for createMany({ skipDuplicates: true }) to work as intended).
CREATE UNIQUE INDEX "Lead_searchTaskId_email_key" ON "Lead"("searchTaskId", "email");
CREATE UNIQUE INDEX "Lead_searchTaskId_linkedinUrl_key" ON "Lead"("searchTaskId", "linkedinUrl");
CREATE UNIQUE INDEX "Lead_searchTaskId_source_externalId_key" ON "Lead"("searchTaskId", "source", "externalId");
