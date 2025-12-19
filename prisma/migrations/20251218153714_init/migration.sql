-- CreateEnum
CREATE TYPE "LeadSearchStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'DONE_NO_RESULTS', 'FAILED');

-- CreateEnum
CREATE TYPE "LeadSearchRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "LeadProvider" AS ENUM ('SCRAPER_CITY', 'SEARCH_LEADS', 'BOOMERANG', 'DADDY_LEADS', 'APIFY', 'SCRUPP');

-- CreateEnum
CREATE TYPE "LeadOrigin" AS ENUM ('PROVIDER', 'MANUAL', 'CSV_IMPORT');

-- CreateEnum
CREATE TYPE "LeadListStatus" AS ENUM ('NEW', 'CONTACTED', 'REPLIED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SALE_MANAGER');

-- CreateEnum
CREATE TYPE "LeadSearchKind" AS ENUM ('LEAD_DB', 'SCRAPER');

-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChatMessageType" AS ENUM ('TEXT', 'JSON', 'EVENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'SALE_MANAGER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSearch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "provider" "LeadProvider" NOT NULL,
    "kind" "LeadSearchKind" NOT NULL,
    "threadId" TEXT,
    "prompt" TEXT,
    "query" JSONB NOT NULL,
    "limit" INTEGER NOT NULL,
    "status" "LeadSearchStatus" NOT NULL DEFAULT 'PENDING',
    "totalLeads" INTEGER,
    "errorMessage" TEXT,

    CONSTRAINT "LeadSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSearchRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leadSearchId" TEXT NOT NULL,
    "provider" "LeadProvider" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "triggeredById" TEXT,
    "status" "LeadSearchRunStatus" NOT NULL DEFAULT 'RUNNING',
    "errorMessage" TEXT,
    "leadsCount" INTEGER,
    "externalRunId" TEXT,
    "requestPayload" JSONB,
    "responseMeta" JSONB,

    CONSTRAINT "LeadSearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "origin" "LeadOrigin" NOT NULL DEFAULT 'PROVIDER',
    "createdById" TEXT,
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
    "meta" JSONB,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadProviderRef" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" "LeadProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,

    CONSTRAINT "LeadProviderRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSearchLead" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leadSearchId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" "LeadListStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "assignedToId" TEXT,

    CONSTRAINT "LeadSearchLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSearchRunResult" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "provider" "LeadProvider" NOT NULL,
    "providerExternalId" TEXT,
    "raw" JSONB,

    CONSTRAINT "LeadSearchRunResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadProviderCapability" (
    "provider" "LeadProvider" NOT NULL,
    "kind" "LeadSearchKind" NOT NULL,
    "label" TEXT,
    "description" TEXT,

    CONSTRAINT "LeadProviderCapability_pkey" PRIMARY KEY ("provider","kind")
);

-- CreateTable
CREATE TABLE "ChatFolder" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ChatFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "folderId" TEXT,
    "title" TEXT,
    "defaultProvider" "LeadProvider",
    "defaultKind" "LeadSearchKind",
    "lastMessageAt" TIMESTAMP(3),
    "meta" JSONB,

    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "type" "ChatMessageType" NOT NULL DEFAULT 'TEXT',
    "authorUserId" TEXT,
    "text" TEXT,
    "payload" JSONB,
    "leadSearchId" TEXT,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "LeadSearch_createdById_idx" ON "LeadSearch"("createdById");

-- CreateIndex
CREATE INDEX "LeadSearch_status_idx" ON "LeadSearch"("status");

-- CreateIndex
CREATE INDEX "LeadSearch_threadId_idx" ON "LeadSearch"("threadId");

-- CreateIndex
CREATE INDEX "LeadSearch_provider_kind_idx" ON "LeadSearch"("provider", "kind");

-- CreateIndex
CREATE INDEX "LeadSearchRun_leadSearchId_idx" ON "LeadSearchRun"("leadSearchId");

-- CreateIndex
CREATE INDEX "LeadSearchRun_provider_status_idx" ON "LeadSearchRun"("provider", "status");

-- CreateIndex
CREATE INDEX "LeadSearchRun_triggeredById_idx" ON "LeadSearchRun"("triggeredById");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSearchRun_leadSearchId_provider_attempt_key" ON "LeadSearchRun"("leadSearchId", "provider", "attempt");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_linkedinUrl_idx" ON "Lead"("linkedinUrl");

-- CreateIndex
CREATE INDEX "Lead_companyDomain_idx" ON "Lead"("companyDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_email_key" ON "Lead"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_linkedinUrl_key" ON "Lead"("linkedinUrl");

-- CreateIndex
CREATE INDEX "LeadProviderRef_leadId_idx" ON "LeadProviderRef"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadProviderRef_provider_externalId_key" ON "LeadProviderRef"("provider", "externalId");

-- CreateIndex
CREATE INDEX "LeadSearchLead_leadSearchId_status_idx" ON "LeadSearchLead"("leadSearchId", "status");

-- CreateIndex
CREATE INDEX "LeadSearchLead_assignedToId_idx" ON "LeadSearchLead"("assignedToId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSearchLead_leadSearchId_leadId_key" ON "LeadSearchLead"("leadSearchId", "leadId");

-- CreateIndex
CREATE INDEX "LeadSearchRunResult_runId_idx" ON "LeadSearchRunResult"("runId");

-- CreateIndex
CREATE INDEX "LeadSearchRunResult_leadId_idx" ON "LeadSearchRunResult"("leadId");

-- CreateIndex
CREATE INDEX "LeadSearchRunResult_provider_providerExternalId_idx" ON "LeadSearchRunResult"("provider", "providerExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSearchRunResult_runId_leadId_key" ON "LeadSearchRunResult"("runId", "leadId");

-- CreateIndex
CREATE INDEX "ChatFolder_ownerId_idx" ON "ChatFolder"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatFolder_ownerId_name_key" ON "ChatFolder"("ownerId", "name");

-- CreateIndex
CREATE INDEX "ChatThread_ownerId_updatedAt_idx" ON "ChatThread"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatThread_folderId_idx" ON "ChatThread"("folderId");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_authorUserId_idx" ON "ChatMessage"("authorUserId");

-- CreateIndex
CREATE INDEX "ChatMessage_leadSearchId_idx" ON "ChatMessage"("leadSearchId");

-- AddForeignKey
ALTER TABLE "LeadSearch" ADD CONSTRAINT "LeadSearch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearch" ADD CONSTRAINT "LeadSearch_provider_kind_fkey" FOREIGN KEY ("provider", "kind") REFERENCES "LeadProviderCapability"("provider", "kind") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearch" ADD CONSTRAINT "LeadSearch_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearchRun" ADD CONSTRAINT "LeadSearchRun_leadSearchId_fkey" FOREIGN KEY ("leadSearchId") REFERENCES "LeadSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearchRun" ADD CONSTRAINT "LeadSearchRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadProviderRef" ADD CONSTRAINT "LeadProviderRef_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearchLead" ADD CONSTRAINT "LeadSearchLead_leadSearchId_fkey" FOREIGN KEY ("leadSearchId") REFERENCES "LeadSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearchLead" ADD CONSTRAINT "LeadSearchLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearchLead" ADD CONSTRAINT "LeadSearchLead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearchRunResult" ADD CONSTRAINT "LeadSearchRunResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LeadSearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearchRunResult" ADD CONSTRAINT "LeadSearchRunResult_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatFolder" ADD CONSTRAINT "ChatFolder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ChatFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_leadSearchId_fkey" FOREIGN KEY ("leadSearchId") REFERENCES "LeadSearch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
