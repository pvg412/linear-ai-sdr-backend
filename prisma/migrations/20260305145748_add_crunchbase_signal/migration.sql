-- CreateTable
CREATE TABLE "CrunchbaseSignal" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "crunchbaseFound" BOOLEAN NOT NULL DEFAULT false,
    "crunchbasePermalink" TEXT,
    "fundingTotalUsd" DOUBLE PRECISION,
    "lastFundingAt" TEXT,
    "lastFundingType" TEXT,
    "numFundingRounds" INTEGER,
    "growthScore" INTEGER,
    "heatScore" INTEGER,
    "growthPrediction" DOUBLE PRECISION,
    "employeeCountEnum" TEXT,
    "semrushVisits" INTEGER,
    "shortDescription" TEXT,
    "foundedOn" TEXT,
    "operatingStatus" TEXT,

    CONSTRAINT "CrunchbaseSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrunchbaseSignal_leadId_idx" ON "CrunchbaseSignal"("leadId");

-- CreateIndex
CREATE INDEX "CrunchbaseSignal_pipelineRunId_idx" ON "CrunchbaseSignal"("pipelineRunId");

-- CreateIndex
CREATE UNIQUE INDEX "CrunchbaseSignal_pipelineRunId_leadId_providerKey_key" ON "CrunchbaseSignal"("pipelineRunId", "leadId", "providerKey");

-- AddForeignKey
ALTER TABLE "CrunchbaseSignal" ADD CONSTRAINT "CrunchbaseSignal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
