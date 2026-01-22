-- CreateIndex
CREATE UNIQUE INDEX "LeadCompanyWebsite_leadId_domain_key" ON "LeadCompanyWebsite"("leadId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "LeadEmail_leadId_email_key" ON "LeadEmail"("leadId", "email");
