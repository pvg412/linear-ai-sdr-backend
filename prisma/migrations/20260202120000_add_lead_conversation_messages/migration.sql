-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('SALE_MANAGER', 'LEAD');

-- CreateEnum
CREATE TYPE "OutreachChannel" AS ENUM ('EMAIL', 'LINKEDIN');

-- CreateEnum
CREATE TYPE "OutreachStage" AS ENUM ('UNSPECIFIED', 'CONNECTION_REQUEST', 'POST_ACCEPT_FIRST_MESSAGE', 'LINKEDIN_FOLLOW_UP_1', 'LINKEDIN_FOLLOW_UP_2', 'LINKEDIN_CLOSE_LOOP', 'COLD_EMAIL', 'WARM_EMAIL', 'INTRODUCTION_EMAIL', 'EMAIL_FOLLOW_UP_1', 'EMAIL_FOLLOW_UP_2', 'EMAIL_CLOSE_LOOP', 'FOLLOW_UP_NO_REPLY', 'AFTER_POSITIVE_REPLY', 'REPLY_TO_QUESTION');

-- CreateTable
CREATE TABLE "LeadConversationMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leadId" TEXT NOT NULL,
    "senderType" "MessageSender" NOT NULL,
    "channel" "OutreachChannel" NOT NULL,
    "stage" "OutreachStage",
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "characterCount" INTEGER,
    "wordCount" INTEGER,
    "usageNote" TEXT,
    "tacticUsed" TEXT,
    "sentAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "chatMessageId" TEXT,
    "createdBy" TEXT,

    CONSTRAINT "LeadConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadConversationMessage_leadId_createdAt_idx" ON "LeadConversationMessage"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadConversationMessage_createdBy_idx" ON "LeadConversationMessage"("createdBy");

-- CreateIndex
CREATE INDEX "LeadConversationMessage_channel_idx" ON "LeadConversationMessage"("channel");

-- CreateIndex
CREATE INDEX "LeadConversationMessage_stage_idx" ON "LeadConversationMessage"("stage");

-- CreateIndex
CREATE INDEX "LeadConversationMessage_sentAt_idx" ON "LeadConversationMessage"("sentAt");

-- CreateIndex
CREATE INDEX "LeadConversationMessage_chatMessageId_idx" ON "LeadConversationMessage"("chatMessageId");

-- AddForeignKey
ALTER TABLE "LeadConversationMessage" ADD CONSTRAINT "LeadConversationMessage_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadConversationMessage" ADD CONSTRAINT "LeadConversationMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadConversationMessage" ADD CONSTRAINT "LeadConversationMessage_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
