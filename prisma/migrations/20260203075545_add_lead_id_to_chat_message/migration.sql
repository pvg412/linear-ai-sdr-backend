-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "leadId" TEXT;

-- CreateIndex
CREATE INDEX "ChatMessage_leadId_idx" ON "ChatMessage"("leadId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
