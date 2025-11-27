-- CreateEnum
CREATE TYPE "SearchTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'DONE_NO_RESULTS', 'FAILED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'REPLIED', 'QUALIFIED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('AMPLELEADS', 'APOLLO', 'SALES_NAVIGATOR', 'MANUAL');

-- CreateTable
CREATE TABLE "SearchTask" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "prompt" TEXT NOT NULL,
    "industry" TEXT,
    "titles" TEXT[],
    "locations" TEXT[],
    "companySize" TEXT,
    "limit" INTEGER NOT NULL,
    "status" "SearchTaskStatus" NOT NULL DEFAULT 'PENDING',
    "source" "LeadSource" NOT NULL DEFAULT 'AMPLELEADS',
    "chatId" TEXT,
    "telegramUserId" TEXT,
    "telegramMessageId" TEXT,
    "apolloUrl" TEXT,
    "fileName" TEXT,
    "runId" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "totalLeads" INTEGER,
    "errorMessage" TEXT,
    "campaignId" TEXT,

    CONSTRAINT "SearchTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchTaskId" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL DEFAULT 'AMPLELEADS',
    "externalId" TEXT,
    "fullName" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "title" TEXT,
    "company" TEXT,
    "companyDomain" TEXT,
    "companyUrl" TEXT,
    "linkedinUrl" TEXT,
    "location" TEXT,
    "email" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "raw" JSONB,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "provider" TEXT,
    "externalId" TEXT,
    "externalUrl" TEXT,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchTask_status_idx" ON "SearchTask"("status");

-- CreateIndex
CREATE INDEX "SearchTask_runId_idx" ON "SearchTask"("runId");

-- CreateIndex
CREATE INDEX "SearchTask_chatId_idx" ON "SearchTask"("chatId");

-- CreateIndex
CREATE INDEX "Lead_searchTaskId_idx" ON "Lead"("searchTaskId");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Campaign_provider_externalId_idx" ON "Campaign"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "SearchTask" ADD CONSTRAINT "SearchTask_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_searchTaskId_fkey" FOREIGN KEY ("searchTaskId") REFERENCES "SearchTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
