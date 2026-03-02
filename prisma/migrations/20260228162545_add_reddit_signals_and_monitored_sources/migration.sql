-- CreateEnum
CREATE TYPE "MonitoredSourceChannel" AS ENUM ('REDDIT');

-- CreateTable
CREATE TABLE "MonitoredSource" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "channel" "MonitoredSourceChannel" NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,

    CONSTRAINT "MonitoredSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedditSignal" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "totalMentions" INTEGER NOT NULL,
    "totalActivities" INTEGER NOT NULL,
    "subredditsFound" TEXT[],

    CONSTRAINT "RedditSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedditSignalPost" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redditSignalId" TEXT NOT NULL,
    "subreddit" TEXT NOT NULL,
    "postType" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT,
    "author" TEXT,
    "url" TEXT,
    "score" INTEGER,
    "numComments" INTEGER,
    "createdUtc" TEXT,

    CONSTRAINT "RedditSignalPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitoredSource_channel_enabled_idx" ON "MonitoredSource"("channel", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoredSource_channel_value_key" ON "MonitoredSource"("channel", "value");

-- CreateIndex
CREATE INDEX "RedditSignal_leadId_idx" ON "RedditSignal"("leadId");

-- CreateIndex
CREATE INDEX "RedditSignal_pipelineRunId_idx" ON "RedditSignal"("pipelineRunId");

-- CreateIndex
CREATE UNIQUE INDEX "RedditSignal_pipelineRunId_leadId_providerKey_key" ON "RedditSignal"("pipelineRunId", "leadId", "providerKey");

-- CreateIndex
CREATE INDEX "RedditSignalPost_redditSignalId_idx" ON "RedditSignalPost"("redditSignalId");

-- AddForeignKey
ALTER TABLE "MonitoredSource" ADD CONSTRAINT "MonitoredSource_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedditSignal" ADD CONSTRAINT "RedditSignal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedditSignalPost" ADD CONSTRAINT "RedditSignalPost_redditSignalId_fkey" FOREIGN KEY ("redditSignalId") REFERENCES "RedditSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
