-- CreateTable
CREATE TABLE "LeadScore" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT NOT NULL,
    "pipelineRunId" TEXT,
    "stepInstanceId" TEXT,
    "score" INTEGER NOT NULL,
    "reasoning" TEXT,

    CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadScore_leadId_idx" ON "LeadScore"("leadId");

-- CreateIndex
CREATE INDEX "LeadScore_pipelineRunId_idx" ON "LeadScore"("pipelineRunId");

-- CreateIndex
CREATE INDEX "LeadScore_pipelineRunId_stepInstanceId_idx" ON "LeadScore"("pipelineRunId", "stepInstanceId");

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
