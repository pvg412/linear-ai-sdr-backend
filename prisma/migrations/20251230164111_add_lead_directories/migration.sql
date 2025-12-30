-- CreateTable
CREATE TABLE "LeadDirectory" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LeadDirectory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadDirectoryLead" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "directoryId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,

    CONSTRAINT "LeadDirectoryLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadDirectory_ownerId_parentId_idx" ON "LeadDirectory"("ownerId", "parentId");

-- CreateIndex
CREATE INDEX "LeadDirectory_ownerId_updatedAt_idx" ON "LeadDirectory"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "LeadDirectory_parentId_position_idx" ON "LeadDirectory"("parentId", "position");

-- CreateIndex
CREATE INDEX "LeadDirectoryLead_directoryId_createdAt_idx" ON "LeadDirectoryLead"("directoryId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadDirectoryLead_leadId_idx" ON "LeadDirectoryLead"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadDirectoryLead_directoryId_leadId_key" ON "LeadDirectoryLead"("directoryId", "leadId");

-- AddForeignKey
ALTER TABLE "LeadDirectory" ADD CONSTRAINT "LeadDirectory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDirectory" ADD CONSTRAINT "LeadDirectory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LeadDirectory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDirectoryLead" ADD CONSTRAINT "LeadDirectoryLead_directoryId_fkey" FOREIGN KEY ("directoryId") REFERENCES "LeadDirectory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDirectoryLead" ADD CONSTRAINT "LeadDirectoryLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
