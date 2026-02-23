-- AlterTable
ALTER TABLE "LeadConversationMessage" ADD COLUMN     "pipelineRunId" TEXT;

-- CreateIndex
CREATE INDEX "LeadConversationMessage_pipelineRunId_idx" ON "LeadConversationMessage"("pipelineRunId");

-- AddForeignKey
ALTER TABLE "LeadConversationMessage" ADD CONSTRAINT "LeadConversationMessage_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
