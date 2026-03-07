-- CreateEnum
CREATE TYPE "SignalCategory" AS ENUM ('HIRING', 'FUNDING', 'COMMUNITY');

-- CreateTable
CREATE TABLE "SignalCategoryConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "category" "SignalCategory" NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SignalCategoryConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignalCategoryConfig_companyId_idx" ON "SignalCategoryConfig"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SignalCategoryConfig_companyId_category_key" ON "SignalCategoryConfig"("companyId", "category");

-- AddForeignKey
ALTER TABLE "SignalCategoryConfig" ADD CONSTRAINT "SignalCategoryConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
