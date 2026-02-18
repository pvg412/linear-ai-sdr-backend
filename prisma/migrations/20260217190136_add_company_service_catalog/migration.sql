-- CreateTable
CREATE TABLE "CompanyServiceCatalog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" CITEXT NOT NULL,

    CONSTRAINT "CompanyServiceCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyServiceCatalogSubService" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyServiceCatalogId" TEXT NOT NULL,
    "name" CITEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "budgetMin" INTEGER NOT NULL,
    "budgetMax" INTEGER NOT NULL,

    CONSTRAINT "CompanyServiceCatalogSubService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyServiceCatalog_companyId_idx" ON "CompanyServiceCatalog"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyServiceCatalog_companyId_name_key" ON "CompanyServiceCatalog"("companyId", "name");

-- CreateIndex
CREATE INDEX "CompanyServiceCatalogSubService_companyServiceCatalogId_idx" ON "CompanyServiceCatalogSubService"("companyServiceCatalogId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyServiceCatalogSubService_companyServiceCatalogId_nam_key" ON "CompanyServiceCatalogSubService"("companyServiceCatalogId", "name");

-- AddForeignKey
ALTER TABLE "CompanyServiceCatalog" ADD CONSTRAINT "CompanyServiceCatalog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyServiceCatalogSubService" ADD CONSTRAINT "CompanyServiceCatalogSubService_companyServiceCatalogId_fkey" FOREIGN KEY ("companyServiceCatalogId") REFERENCES "CompanyServiceCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
