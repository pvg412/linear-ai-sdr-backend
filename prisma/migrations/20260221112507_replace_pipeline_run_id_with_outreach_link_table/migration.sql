/*
  Warnings:

  - You are about to drop the column `pipelineRunId` on the `LeadConversationMessage` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "LeadConversationMessage" DROP CONSTRAINT "LeadConversationMessage_pipelineRunId_fkey";

-- DropIndex
DROP INDEX "LeadConversationMessage_pipelineRunId_idx";

-- AlterTable
ALTER TABLE "LeadConversationMessage" DROP COLUMN "pipelineRunId";

-- CreateTable
CREATE TABLE "PipelineRunOutreachMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pipelineRunId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,

    CONSTRAINT "PipelineRunOutreachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineRunOutreachMessage_pipelineRunId_idx" ON "PipelineRunOutreachMessage"("pipelineRunId");

-- CreateIndex
CREATE INDEX "PipelineRunOutreachMessage_messageId_idx" ON "PipelineRunOutreachMessage"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineRunOutreachMessage_pipelineRunId_messageId_key" ON "PipelineRunOutreachMessage"("pipelineRunId", "messageId");

-- AddForeignKey
ALTER TABLE "PipelineRunOutreachMessage" ADD CONSTRAINT "PipelineRunOutreachMessage_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRunOutreachMessage" ADD CONSTRAINT "PipelineRunOutreachMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "LeadConversationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
