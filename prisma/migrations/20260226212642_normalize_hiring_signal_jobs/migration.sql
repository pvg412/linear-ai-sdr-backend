-- AlterTable
ALTER TABLE "HiringSignal" DROP COLUMN "rawData";

-- CreateTable
CREATE TABLE "HiringSignalJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiringSignalId" TEXT NOT NULL,
    "externalId" TEXT,
    "jobTitle" TEXT,
    "team" TEXT,
    "jobType" TEXT,
    "locationType" TEXT,
    "datePosted" TEXT,
    "companyName" TEXT,
    "companySlug" TEXT,
    "requirementsSummary" TEXT,
    "skills" TEXT[],
    "technologies" TEXT[],
    "jobCategories" TEXT[],

    CONSTRAINT "HiringSignalJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringSignalJobLocation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,

    CONSTRAINT "HiringSignalJobLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiringSignalJob_hiringSignalId_idx" ON "HiringSignalJob"("hiringSignalId");

-- CreateIndex
CREATE INDEX "HiringSignalJobLocation_jobId_idx" ON "HiringSignalJobLocation"("jobId");

-- AddForeignKey
ALTER TABLE "HiringSignalJob" ADD CONSTRAINT "HiringSignalJob_hiringSignalId_fkey" FOREIGN KEY ("hiringSignalId") REFERENCES "HiringSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringSignalJobLocation" ADD CONSTRAINT "HiringSignalJobLocation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HiringSignalJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
