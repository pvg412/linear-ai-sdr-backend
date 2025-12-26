/*
  Warnings:

  - You are about to drop the column `folderId` on the `ChatThread` table. All the data in the column will be lost.
  - You are about to drop the `ChatFolder` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ChatFolder" DROP CONSTRAINT "ChatFolder_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ChatThread" DROP CONSTRAINT "ChatThread_folderId_fkey";

-- DropIndex
DROP INDEX "ChatThread_folderId_idx";

-- AlterTable
ALTER TABLE "ChatThread" DROP COLUMN "folderId";

-- DropTable
DROP TABLE "ChatFolder";
