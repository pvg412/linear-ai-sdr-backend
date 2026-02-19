-- CreateEnum
CREATE TYPE "PipelineRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PipelineStepRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pipelineKey" TEXT NOT NULL,
    "pipelineVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "companyId" TEXT,
    "status" "PipelineRunStatus" NOT NULL DEFAULT 'PENDING',
    "currentStepId" TEXT,
    "currentStepIndex" INTEGER,
    "input" JSONB,
    "context" JSONB,
    "definition" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "errorStepId" TEXT,

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStepRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "stepType" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "PipelineStepRunStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "outputSummary" JSONB,
    "errorMessage" TEXT,

    CONSTRAINT "PipelineStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineRun_createdById_idx" ON "PipelineRun"("createdById");

-- CreateIndex
CREATE INDEX "PipelineRun_companyId_status_idx" ON "PipelineRun"("companyId", "status");

-- CreateIndex
CREATE INDEX "PipelineRun_status_idx" ON "PipelineRun"("status");

-- CreateIndex
CREATE INDEX "PipelineRun_pipelineKey_idx" ON "PipelineRun"("pipelineKey");

-- CreateIndex
CREATE INDEX "PipelineStepRun_pipelineRunId_stepIndex_idx" ON "PipelineStepRun"("pipelineRunId", "stepIndex");

-- CreateIndex
CREATE INDEX "PipelineStepRun_status_idx" ON "PipelineStepRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStepRun_pipelineRunId_stepId_key" ON "PipelineStepRun"("pipelineRunId", "stepId");

-- AddForeignKey
ALTER TABLE "PipelineRun" ADD CONSTRAINT "PipelineRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStepRun" ADD CONSTRAINT "PipelineStepRun_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
