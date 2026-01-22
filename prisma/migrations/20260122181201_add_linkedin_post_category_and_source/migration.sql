-- AlterEnum
ALTER TYPE "CompanyResearchItemCategory" ADD VALUE 'LINKEDIN_POST';

-- AlterTable
ALTER TABLE "CompanyResearchItem" ADD COLUMN     "source" TEXT;
