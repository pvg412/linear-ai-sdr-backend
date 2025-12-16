/*
  Warnings:

  - The values [PENDING] on the enum `ScraperRunStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
ALTER TYPE "ScraperProvider" ADD VALUE 'SCRUPP';

-- AlterEnum
BEGIN;
CREATE TYPE "ScraperRunStatus_new" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');
ALTER TABLE "ScraperRun" ALTER COLUMN "status" TYPE "ScraperRunStatus_new" USING ("status"::text::"ScraperRunStatus_new");
ALTER TYPE "ScraperRunStatus" RENAME TO "ScraperRunStatus_old";
ALTER TYPE "ScraperRunStatus_new" RENAME TO "ScraperRunStatus";
DROP TYPE "public"."ScraperRunStatus_old";
COMMIT;
