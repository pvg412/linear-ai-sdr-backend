/*
  Warnings:

  - You are about to drop the column `growthPrediction` on the `CrunchbaseSignal` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CrunchbaseSignal" DROP COLUMN "growthPrediction",
ADD COLUMN     "acquisitionPrediction" DOUBLE PRECISION,
ADD COLUMN     "categories" TEXT,
ADD COLUMN     "fundingPrediction" DOUBLE PRECISION,
ADD COLUMN     "fundingPrediction0to5" DOUBLE PRECISION,
ADD COLUMN     "fundingPrediction12to24" DOUBLE PRECISION,
ADD COLUMN     "fundingPrediction24plus" DOUBLE PRECISION,
ADD COLUMN     "fundingPrediction6to11" DOUBLE PRECISION,
ADD COLUMN     "hadLayoffs" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ipoPrediction" DOUBLE PRECISION,
ADD COLUMN     "numInvestors" INTEGER,
ADD COLUMN     "techStack" TEXT,
ADD COLUMN     "topCompetitors" TEXT;
