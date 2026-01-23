-- CreateEnum
CREATE TYPE "LeadEnrichmentStatus" AS ENUM ('PENDING', 'PROCESSING', 'AWAITING_REVIEW', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EnrichmentFieldStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "mobileNumber" TEXT;

-- CreateTable
CREATE TABLE "LeadEnrichmentRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leadId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "LeadEnrichmentStatus" NOT NULL DEFAULT 'PENDING',
    "apifyRunId" TEXT,
    "apifyDatasetId" TEXT,
    "rawResponse" JSONB,
    "errorMessage" TEXT,

    CONSTRAINT "LeadEnrichmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEnrichmentFieldChange" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requestId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "status" "EnrichmentFieldStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "LeadEnrichmentFieldChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadEnrichmentRequest_leadId_status_idx" ON "LeadEnrichmentRequest"("leadId", "status");

-- CreateIndex
CREATE INDEX "LeadEnrichmentRequest_requestedById_idx" ON "LeadEnrichmentRequest"("requestedById");

-- CreateIndex
CREATE INDEX "LeadEnrichmentRequest_status_createdAt_idx" ON "LeadEnrichmentRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LeadEnrichmentFieldChange_requestId_idx" ON "LeadEnrichmentFieldChange"("requestId");

-- CreateIndex
CREATE INDEX "LeadEnrichmentFieldChange_status_idx" ON "LeadEnrichmentFieldChange"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LeadEnrichmentFieldChange_requestId_fieldName_key" ON "LeadEnrichmentFieldChange"("requestId", "fieldName");

-- AddForeignKey
ALTER TABLE "LeadEnrichmentRequest" ADD CONSTRAINT "LeadEnrichmentRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEnrichmentRequest" ADD CONSTRAINT "LeadEnrichmentRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEnrichmentFieldChange" ADD CONSTRAINT "LeadEnrichmentFieldChange_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LeadEnrichmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEnrichmentFieldChange" ADD CONSTRAINT "LeadEnrichmentFieldChange_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
