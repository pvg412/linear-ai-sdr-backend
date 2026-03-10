-- Step 1: Delete existing signal category configs (data belongs to company-level, no longer valid)
DELETE FROM "SignalCategoryConfig";

-- Step 2: Drop old foreign key, index, and unique constraint
ALTER TABLE "SignalCategoryConfig" DROP CONSTRAINT "SignalCategoryConfig_companyId_fkey";
DROP INDEX "SignalCategoryConfig_companyId_idx";
DROP INDEX "SignalCategoryConfig_companyId_category_key";

-- Step 3: Drop companyId column
ALTER TABLE "SignalCategoryConfig" DROP COLUMN "companyId";

-- Step 4: Add serviceCatalogId column (required)
ALTER TABLE "SignalCategoryConfig" ADD COLUMN "serviceCatalogId" TEXT NOT NULL;

-- Step 5: Add new index and unique constraint
CREATE INDEX "SignalCategoryConfig_serviceCatalogId_idx" ON "SignalCategoryConfig"("serviceCatalogId");
CREATE UNIQUE INDEX "SignalCategoryConfig_serviceCatalogId_category_key" ON "SignalCategoryConfig"("serviceCatalogId", "category");

-- Step 6: Add foreign key to CompanyServiceCatalog with cascade delete
ALTER TABLE "SignalCategoryConfig" ADD CONSTRAINT "SignalCategoryConfig_serviceCatalogId_fkey" FOREIGN KEY ("serviceCatalogId") REFERENCES "CompanyServiceCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
