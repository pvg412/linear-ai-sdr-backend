-- CreateEnum
CREATE TYPE "ScraperProvider" AS ENUM ('SCRAPER_CITY', 'BOOMERANG', 'DADDY_LEADS', 'APIFY');

-- CreateEnum
CREATE TYPE "ScraperRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "Lead" ALTER COLUMN "source" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SearchTask" ADD COLUMN     "scraperProvider" "ScraperProvider",
ALTER COLUMN "source" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ScraperRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchTaskId" TEXT NOT NULL,
    "provider" "ScraperProvider" NOT NULL,
    "status" "ScraperRunStatus" NOT NULL,
    "errorMessage" TEXT,
    "leadsCount" INTEGER,
    "externalRunId" TEXT,
    "meta" JSONB,

    CONSTRAINT "ScraperRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScraperRun_searchTaskId_idx" ON "ScraperRun"("searchTaskId");

-- CreateIndex
CREATE INDEX "ScraperRun_provider_status_idx" ON "ScraperRun"("provider", "status");

-- AddForeignKey
ALTER TABLE "ScraperRun" ADD CONSTRAINT "ScraperRun_searchTaskId_fkey" FOREIGN KEY ("searchTaskId") REFERENCES "SearchTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
