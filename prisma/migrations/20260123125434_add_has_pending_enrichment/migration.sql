-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "hasPendingEnrichment" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Lead_hasPendingEnrichment_idx" ON "Lead"("hasPendingEnrichment");
