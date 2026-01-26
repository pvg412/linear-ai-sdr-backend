-- CreateEnum
CREATE TYPE "CompanyResearchStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "CompanyResearch" ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "status" "CompanyResearchStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "CompanyResearch_status_idx" ON "CompanyResearch"("status");
