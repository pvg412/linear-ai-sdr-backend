/*
  Warnings:

  - You are about to drop the column `leadId` on the `ChatMessage` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_leadId_fkey";

-- AlterTable
ALTER TABLE "ChatMessage" DROP COLUMN "leadId";
