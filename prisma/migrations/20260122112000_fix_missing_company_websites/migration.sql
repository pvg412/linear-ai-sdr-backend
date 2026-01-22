-- Fix: Insert missing LeadCompanyWebsite records for Leads that have companyUrl
-- This migration handles cases where companyDomain was NULL or empty
INSERT INTO "LeadCompanyWebsite" ("id", "createdAt", "updatedAt", "leadId", "url", "domain", "validEmailServer")
SELECT
  gen_random_uuid()::text,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  l."id" as "leadId",
  l."companyUrl" as "url",
  COALESCE(
    NULLIF(l."companyDomain", ''),
    regexp_replace(
      regexp_replace(l."companyUrl", '^https?://(www\.)?', '', 'i'),
      '/.*$', '', 'g'
    )
  ) as "domain",
  NULL as "validEmailServer"
FROM "Lead" l
WHERE l."companyUrl" IS NOT NULL
  AND l."companyUrl" != ''
  AND NOT EXISTS (
    SELECT 1 FROM "LeadCompanyWebsite" lcw
    WHERE lcw."leadId" = l."id"
  )
ON CONFLICT DO NOTHING;
