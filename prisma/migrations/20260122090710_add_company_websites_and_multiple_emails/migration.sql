-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('SELF_EMPLOYED', 'STARTUP_1_10', 'SMALL_11_50', 'MEDIUM_51_200', 'LARGE_201_500', 'ENTERPRISE_501_1000', 'CORPORATE_1001_5000', 'MEGA_5001_10000', 'GIANT_10000_PLUS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SeniorityLevel" AS ENUM ('INTERN', 'ENTRY_LEVEL', 'JUNIOR', 'MID_LEVEL', 'SENIOR', 'LEAD', 'MANAGER', 'SENIOR_MANAGER', 'DIRECTOR', 'SENIOR_DIRECTOR', 'VP', 'SVP', 'C_LEVEL', 'FOUNDER', 'OWNER', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "companyIndustry" TEXT,
ADD COLUMN     "companyLinkedinUrl" TEXT,
ADD COLUMN     "companyLocation" TEXT,
ADD COLUMN     "companySize" "CompanySize",
ADD COLUMN     "currentPosition" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "headline" TEXT,
ADD COLUMN     "seniorityLevel" "SeniorityLevel",
ADD COLUMN     "totalExperienceYears" INTEGER,
ADD COLUMN     "yearsInCompany" INTEGER,
ADD COLUMN     "yearsInPosition" INTEGER;

-- CreateTable
CREATE TABLE "LeadCompanyWebsite" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leadId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "validEmailServer" BOOLEAN,

    CONSTRAINT "LeadCompanyWebsite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEmail" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leadId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "deliverable" BOOLEAN,
    "catchAllDomain" BOOLEAN,
    "validEmailServer" BOOLEAN,
    "free" BOOLEAN,
    "status" "EmailStatus",
    "qualityScore" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LeadEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadCompanyWebsite_leadId_idx" ON "LeadCompanyWebsite"("leadId");

-- CreateIndex
CREATE INDEX "LeadCompanyWebsite_domain_idx" ON "LeadCompanyWebsite"("domain");

-- CreateIndex
CREATE INDEX "LeadEmail_leadId_idx" ON "LeadEmail"("leadId");

-- CreateIndex
CREATE INDEX "LeadEmail_email_idx" ON "LeadEmail"("email");

-- CreateIndex
CREATE INDEX "LeadEmail_status_idx" ON "LeadEmail"("status");

-- CreateIndex
CREATE INDEX "LeadEmail_isPrimary_idx" ON "LeadEmail"("isPrimary");

-- CreateIndex
CREATE INDEX "Lead_companyId_idx" ON "Lead"("companyId");

-- CreateIndex
CREATE INDEX "Lead_seniorityLevel_idx" ON "Lead"("seniorityLevel");

-- CreateIndex
CREATE INDEX "Lead_companySize_idx" ON "Lead"("companySize");

-- AddForeignKey
ALTER TABLE "LeadCompanyWebsite" ADD CONSTRAINT "LeadCompanyWebsite_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEmail" ADD CONSTRAINT "LeadEmail_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing companyUrl and companyDomain to LeadCompanyWebsite
-- Extract domain from URL if companyDomain is empty
INSERT INTO "LeadCompanyWebsite" ("id", "createdAt", "updatedAt", "leadId", "url", "domain", "validEmailServer")
SELECT
  gen_random_uuid()::text,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  "id" as "leadId",
  "companyUrl" as "url",
  COALESCE(
    NULLIF("companyDomain", ''),
    regexp_replace(
      regexp_replace("companyUrl", '^https?://(www\.)?', '', 'i'),
      '/.*$', '', 'g'
    )
  ) as "domain",
  NULL as "validEmailServer"
FROM "Lead"
WHERE "companyUrl" IS NOT NULL
  AND "companyUrl" != '';

-- Migrate existing email to LeadEmail
-- Only migrate if email exists and is not empty
INSERT INTO "LeadEmail" ("id", "createdAt", "updatedAt", "leadId", "email", "deliverable", "catchAllDomain", "validEmailServer", "free", "status", "qualityScore", "isPrimary")
SELECT
  gen_random_uuid()::text,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  "id" as "leadId",
  "email",
  NULL as "deliverable",
  NULL as "catchAllDomain",
  NULL as "validEmailServer",
  NULL as "free",
  "emailStatus" as "status",
  NULL as "qualityScore",
  true as "isPrimary"
FROM "Lead"
WHERE "email" IS NOT NULL
  AND "email" != '';
