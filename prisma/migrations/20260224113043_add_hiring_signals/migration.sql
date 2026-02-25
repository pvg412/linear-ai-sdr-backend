-- CreateTable
CREATE TABLE "HiringSignal" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "openJobCount" INTEGER NOT NULL,
    "departments" TEXT[],
    "topJobTitles" TEXT[],
    "rawData" JSONB NOT NULL,

    CONSTRAINT "HiringSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalProviderDailyUsage" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SignalProviderDailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiringSignal_leadId_idx" ON "HiringSignal"("leadId");

-- CreateIndex
CREATE INDEX "HiringSignal_pipelineRunId_idx" ON "HiringSignal"("pipelineRunId");

-- CreateIndex
CREATE UNIQUE INDEX "HiringSignal_pipelineRunId_leadId_providerKey_key" ON "HiringSignal"("pipelineRunId", "leadId", "providerKey");

-- CreateIndex
CREATE INDEX "SignalProviderDailyUsage_providerKey_date_idx" ON "SignalProviderDailyUsage"("providerKey", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SignalProviderDailyUsage_providerKey_date_key" ON "SignalProviderDailyUsage"("providerKey", "date");

-- AddForeignKey
ALTER TABLE "HiringSignal" ADD CONSTRAINT "HiringSignal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
