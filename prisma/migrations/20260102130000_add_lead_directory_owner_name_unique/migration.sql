-- Make LeadDirectory.name unique per owner
-- Note: This will fail if duplicates already exist for the same (ownerId, name).

CREATE UNIQUE INDEX "LeadDirectory_ownerId_name_key" ON "LeadDirectory"("ownerId", "name");
