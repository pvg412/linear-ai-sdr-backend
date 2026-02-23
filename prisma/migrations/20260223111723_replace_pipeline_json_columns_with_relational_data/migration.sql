/*
  Warnings:

  - You are about to drop the column `context` on the `PipelineRun` table. All the data in the column will be lost.
  - You are about to drop the column `definition` on the `PipelineRun` table. All the data in the column will be lost.
  - You are about to drop the column `input` on the `PipelineRun` table. All the data in the column will be lost.
  - Added the required column `pipelineDisplayName` to the `PipelineRun` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PipelineRun" DROP COLUMN "context",
DROP COLUMN "definition",
DROP COLUMN "input",
ADD COLUMN     "defaultOnError" TEXT,
ADD COLUMN     "defaultRetryBackoffMs" INTEGER,
ADD COLUMN     "defaultRetryBackoffType" TEXT,
ADD COLUMN     "defaultRetryMaxAttempts" INTEGER,
ADD COLUMN     "defaultTimeoutMs" INTEGER,
ADD COLUMN     "inputDirectoryId" TEXT,
ADD COLUMN     "inputLeadIds" TEXT[],
ADD COLUMN     "pipelineDescription" TEXT,
ADD COLUMN     "pipelineDisplayName" TEXT;

-- Backfill existing rows before adding NOT NULL constraint
UPDATE "PipelineRun" SET "pipelineDisplayName" = "pipelineKey" WHERE "pipelineDisplayName" IS NULL;

ALTER TABLE "PipelineRun" ALTER COLUMN "pipelineDisplayName" SET NOT NULL;

-- AlterTable
ALTER TABLE "PipelineStepRun" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onError" TEXT,
ADD COLUMN     "retryBackoffMs" INTEGER,
ADD COLUMN     "retryBackoffType" TEXT,
ADD COLUMN     "retryMaxAttempts" INTEGER,
ADD COLUMN     "stepConfig" JSONB,
ADD COLUMN     "timeoutMs" INTEGER;

-- CreateTable
CREATE TABLE "PipelineRunLead" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pipelineRunId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "excludedByStepId" TEXT,

    CONSTRAINT "PipelineRunLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineRunLead_pipelineRunId_idx" ON "PipelineRunLead"("pipelineRunId");

-- CreateIndex
CREATE INDEX "PipelineRunLead_pipelineRunId_excluded_idx" ON "PipelineRunLead"("pipelineRunId", "excluded");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineRunLead_pipelineRunId_leadId_key" ON "PipelineRunLead"("pipelineRunId", "leadId");

-- AddForeignKey
ALTER TABLE "PipelineRunLead" ADD CONSTRAINT "PipelineRunLead_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRunLead" ADD CONSTRAINT "PipelineRunLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
