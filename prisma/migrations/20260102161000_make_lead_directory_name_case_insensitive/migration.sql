-- Make LeadDirectory.name case-insensitive (Postgres)
-- This enforces uniqueness for (ownerId, name) regardless of letter casing.
--
-- NOTE: This migration will fail if there are existing duplicates that differ only by case,
-- e.g. "Folder1" and "folder1" for the same ownerId.

CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE "LeadDirectory"
ALTER COLUMN "name" TYPE CITEXT;

-- Ensure the unique index exists (and is rebuilt against the new type)
DROP INDEX IF EXISTS "LeadDirectory_ownerId_name_key";
CREATE UNIQUE INDEX "LeadDirectory_ownerId_name_key" ON "LeadDirectory"("ownerId", "name");


