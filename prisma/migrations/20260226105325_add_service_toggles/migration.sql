-- CreateTable
CREATE TABLE "ServiceToggle" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,

    CONSTRAINT "ServiceToggle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceToggle_serviceKey_key" ON "ServiceToggle"("serviceKey");

-- CreateIndex
CREATE INDEX "ServiceToggle_serviceKey_idx" ON "ServiceToggle"("serviceKey");

-- AddForeignKey
ALTER TABLE "ServiceToggle" ADD CONSTRAINT "ServiceToggle_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
