import type { Lead, CompanySize } from "@prisma/client";
import type { ApifyProfileEnrichmentResponse } from "./profile-enrichment-apify.client";

export interface FieldChange {
  fieldName: string;
  displayName: string;
  oldValue: string | null;
  newValue: string | null;
}

// Company size mapping from Apify string to Prisma enum
const COMPANY_SIZE_MAP: Record<string, CompanySize> = {
  "Self-employed": "SELF_EMPLOYED",
  "1-10": "STARTUP_1_10",
  "11-50": "SMALL_11_50",
  "51-200": "MEDIUM_51_200",
  "201-500": "LARGE_201_500",
  "501-1000": "ENTERPRISE_501_1000",
  "1001-5000": "CORPORATE_1001_5000",
  "5001-10000": "MEGA_5001_10000",
  "10001+": "GIANT_10000_PLUS",
};

function mapCompanySize(apifySize: string | null | undefined): CompanySize | null {
  if (!apifySize) return null;

  // Try exact match first
  if (COMPANY_SIZE_MAP[apifySize]) {
    return COMPANY_SIZE_MAP[apifySize];
  }

  // Try to find a match by checking if the string contains the key
  for (const [key, value] of Object.entries(COMPANY_SIZE_MAP)) {
    if (apifySize.includes(key)) {
      return value;
    }
  }

  return null;
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;

  try {
    // Add protocol if missing
    let urlToParse = url;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      urlToParse = `https://${url}`;
    }

    const parsed = new URL(urlToParse);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  // Ensure it starts with https://
  let normalized = url.trim();
  if (!normalized.startsWith("http")) {
    normalized = `https://${normalized}`;
  }

  // Ensure it uses www.linkedin.com
  normalized = normalized.replace("linkedin.com", "www.linkedin.com");
  normalized = normalized.replace("www.www.", "www.");

  // Remove trailing slash
  normalized = normalized.replace(/\/$/, "");

  return normalized;
}

function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value || null;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

function valuesAreDifferent(
  oldVal: string | null | undefined,
  newVal: string | null | undefined,
): boolean {
  const normalizedOld = (oldVal ?? "").trim().toLowerCase();
  const normalizedNew = (newVal ?? "").trim().toLowerCase();

  // Both empty - not different
  if (!normalizedOld && !normalizedNew) return false;

  // One empty, one not - different
  if (!normalizedOld || !normalizedNew) return true;

  // Compare normalized values
  return normalizedOld !== normalizedNew;
}

interface FieldMapping {
  fieldName: string;
  displayName: string;
  getOldValue: (lead: Lead) => string | null;
  getNewValue: (response: ApifyProfileEnrichmentResponse) => string | null;
}

const FIELD_MAPPINGS: FieldMapping[] = [
  {
    fieldName: "email",
    displayName: "Email",
    getOldValue: (lead) => lead.email,
    getNewValue: (response) => response.email ?? null,
  },
  {
    fieldName: "mobileNumber",
    displayName: "Mobile Number",
    getOldValue: (lead) => lead.mobileNumber,
    getNewValue: (response) => response.mobileNumber ?? null,
  },
  {
    fieldName: "title",
    displayName: "Job Title",
    getOldValue: (lead) => lead.title,
    getNewValue: (response) => response.jobTitle ?? null,
  },
  {
    fieldName: "headline",
    displayName: "Headline",
    getOldValue: (lead) => lead.headline,
    getNewValue: (response) => response.headline ?? null,
  },
  {
    fieldName: "location",
    displayName: "Location",
    getOldValue: (lead) => lead.location,
    getNewValue: (response) =>
      response.jobLocation ??
      response.addressWithCountry ??
      response.addressWithoutCountry ??
      null,
  },
  {
    fieldName: "company",
    displayName: "Company",
    getOldValue: (lead) => lead.company,
    getNewValue: (response) => response.companyName ?? null,
  },
  {
    fieldName: "companyIndustry",
    displayName: "Company Industry",
    getOldValue: (lead) => lead.companyIndustry,
    getNewValue: (response) => response.companyIndustry ?? null,
  },
  {
    fieldName: "companyLinkedinUrl",
    displayName: "Company LinkedIn",
    getOldValue: (lead) => lead.companyLinkedinUrl,
    getNewValue: (response) => normalizeLinkedInUrl(response.companyLinkedin),
  },
  {
    fieldName: "companySize",
    displayName: "Company Size",
    getOldValue: (lead) => lead.companySize,
    getNewValue: (response) => mapCompanySize(response.companySize),
  },
  {
    fieldName: "companyUrl",
    displayName: "Company Website",
    getOldValue: (lead) => lead.companyUrl,
    getNewValue: (response) => {
      const website = response.companyWebsite;
      if (!website) return null;
      // Ensure URL has protocol
      if (!website.startsWith("http")) {
        return `https://${website}`;
      }
      return website;
    },
  },
  {
    fieldName: "companyDomain",
    displayName: "Company Domain",
    getOldValue: (lead) => lead.companyDomain,
    getNewValue: (response) => extractDomain(response.companyWebsite),
  },
];

export function mapApifyResponseToFieldChanges(
  response: ApifyProfileEnrichmentResponse,
  currentLead: Lead,
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const mapping of FIELD_MAPPINGS) {
    const oldValue = stringifyValue(mapping.getOldValue(currentLead));
    const newValue = stringifyValue(mapping.getNewValue(response));

    // Only create a change if values are different AND new value is not empty
    if (newValue && valuesAreDifferent(oldValue, newValue)) {
      changes.push({
        fieldName: mapping.fieldName,
        displayName: mapping.displayName,
        oldValue,
        newValue,
      });
    }
  }

  return changes;
}

// Field name to Lead model field mapping for applying changes
export const FIELD_TO_LEAD_PROPERTY: Record<string, keyof Lead> = {
  email: "email",
  mobileNumber: "mobileNumber",
  title: "title",
  headline: "headline",
  location: "location",
  company: "company",
  companyIndustry: "companyIndustry",
  companyLinkedinUrl: "companyLinkedinUrl",
  companySize: "companySize",
  companyUrl: "companyUrl",
  companyDomain: "companyDomain",
};
