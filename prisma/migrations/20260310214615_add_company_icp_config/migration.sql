-- CreateTable
CREATE TABLE "CompanyIcpConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "locations" TEXT[],
    "companySizes" TEXT[],

    CONSTRAINT "CompanyIcpConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyIcpIndustry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "configId" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "CompanyIcpIndustry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyIcpConfig_companyId_key" ON "CompanyIcpConfig"("companyId");

-- CreateIndex
CREATE INDEX "CompanyIcpConfig_companyId_idx" ON "CompanyIcpConfig"("companyId");

-- CreateIndex
CREATE INDEX "CompanyIcpIndustry_configId_idx" ON "CompanyIcpIndustry"("configId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyIcpIndustry_configId_industryId_key" ON "CompanyIcpIndustry"("configId", "industryId");

-- AddForeignKey
ALTER TABLE "CompanyIcpConfig" ADD CONSTRAINT "CompanyIcpConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyIcpIndustry" ADD CONSTRAINT "CompanyIcpIndustry_configId_fkey" FOREIGN KEY ("configId") REFERENCES "CompanyIcpConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
