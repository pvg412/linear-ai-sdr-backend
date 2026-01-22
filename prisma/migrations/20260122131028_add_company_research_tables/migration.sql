-- CreateEnum
CREATE TYPE "CompanyResearchItemCategory" AS ENUM ('NEWS', 'BLOG', 'ACTIVITY', 'WEBSITE');

-- CreateTable
CREATE TABLE "CompanyResearch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leadId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "companyDomain" TEXT,
    "recency" TEXT,
    "maxResults" INTEGER NOT NULL DEFAULT 5,
    "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relatedQuestions" TEXT[],

    CONSTRAINT "CompanyResearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyResearchItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "researchId" TEXT NOT NULL,
    "date" TEXT,
    "summary" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "category" "CompanyResearchItemCategory" NOT NULL,

    CONSTRAINT "CompanyResearchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyResearch_leadId_createdAt_idx" ON "CompanyResearch"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyResearch_requestedById_idx" ON "CompanyResearch"("requestedById");

-- CreateIndex
CREATE INDEX "CompanyResearch_company_idx" ON "CompanyResearch"("company");

-- CreateIndex
CREATE INDEX "CompanyResearchItem_researchId_idx" ON "CompanyResearchItem"("researchId");

-- CreateIndex
CREATE INDEX "CompanyResearchItem_category_idx" ON "CompanyResearchItem"("category");

-- AddForeignKey
ALTER TABLE "CompanyResearch" ADD CONSTRAINT "CompanyResearch_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyResearch" ADD CONSTRAINT "CompanyResearch_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyResearchItem" ADD CONSTRAINT "CompanyResearchItem_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "CompanyResearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
