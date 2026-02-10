import { CompanySize, SeniorityLevel } from "@prisma/client";

export type LeadFieldMapping = {
  prismaField: string;
  aliases: string[];
  required: boolean;
  transform?: (value: string) => unknown;
};

export type ColumnMatch = {
  csvColumn: string;
  prismaField: string;
  required: boolean;
  transform?: (value: string) => unknown;
};

export type MappingResult = {
  matched: ColumnMatch[];
  unmatchedCsvColumns: string[];
  missingRequired: string[];
};

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseIntSafe(value: string): number | null {
  const n = parseInt(value.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function mapToCompanySize(value: string): CompanySize | null {
  const v = value.trim().toUpperCase();
  if (Object.values(CompanySize).includes(v as CompanySize)) {
    return v as CompanySize;
  }
  const num = parseInt(value.replace(/[^0-9]/g, ""), 10);
  if (isNaN(num)) return null;
  if (num <= 1) return CompanySize.SELF_EMPLOYED;
  if (num <= 10) return CompanySize.STARTUP_1_10;
  if (num <= 50) return CompanySize.SMALL_11_50;
  if (num <= 200) return CompanySize.MEDIUM_51_200;
  if (num <= 500) return CompanySize.LARGE_201_500;
  if (num <= 1000) return CompanySize.ENTERPRISE_501_1000;
  if (num <= 5000) return CompanySize.CORPORATE_1001_5000;
  if (num <= 10000) return CompanySize.MEGA_5001_10000;
  return CompanySize.GIANT_10000_PLUS;
}

function mapToSeniorityLevel(value: string): SeniorityLevel | null {
  const v = value.trim().toUpperCase();
  if (Object.values(SeniorityLevel).includes(v as SeniorityLevel)) {
    return v as SeniorityLevel;
  }
  const map: Record<string, SeniorityLevel> = {
    intern: SeniorityLevel.INTERN,
    entry: SeniorityLevel.ENTRY_LEVEL,
    "entry level": SeniorityLevel.ENTRY_LEVEL,
    junior: SeniorityLevel.JUNIOR,
    mid: SeniorityLevel.MID_LEVEL,
    "mid level": SeniorityLevel.MID_LEVEL,
    middle: SeniorityLevel.MID_LEVEL,
    senior: SeniorityLevel.SENIOR,
    lead: SeniorityLevel.LEAD,
    manager: SeniorityLevel.MANAGER,
    "senior manager": SeniorityLevel.SENIOR_MANAGER,
    director: SeniorityLevel.DIRECTOR,
    "senior director": SeniorityLevel.SENIOR_DIRECTOR,
    vp: SeniorityLevel.VP,
    "vice president": SeniorityLevel.VP,
    svp: SeniorityLevel.SVP,
    "senior vice president": SeniorityLevel.SVP,
    "c level": SeniorityLevel.C_LEVEL,
    "c-level": SeniorityLevel.C_LEVEL,
    "c suite": SeniorityLevel.C_LEVEL,
    "c-suite": SeniorityLevel.C_LEVEL,
    ceo: SeniorityLevel.C_LEVEL,
    cto: SeniorityLevel.C_LEVEL,
    cfo: SeniorityLevel.C_LEVEL,
    coo: SeniorityLevel.C_LEVEL,
    founder: SeniorityLevel.FOUNDER,
    "co founder": SeniorityLevel.FOUNDER,
    owner: SeniorityLevel.OWNER,
  };
  return map[value.trim().toLowerCase()] ?? null;
}

export const LEAD_FIELD_MAPPINGS: LeadFieldMapping[] = [
  {
    prismaField: "firstName",
    aliases: [
      "firstname",
      "first name",
      "first_name",
      "given name",
      "givenname",
      "given_name",
    ],
    required: true,
  },
  {
    prismaField: "lastName",
    aliases: [
      "lastname",
      "last name",
      "last_name",
      "surname",
      "family name",
      "familyname",
      "family_name",
    ],
    required: true,
  },
  {
    prismaField: "fullName",
    aliases: [
      "fullname",
      "full name",
      "full_name",
      "name",
      "contact name",
      "contactname",
      "contact_name",
    ],
    required: false,
  },
  {
    prismaField: "linkedinUrl",
    aliases: [
      "linkedinurl",
      "linkedin url",
      "linkedin_url",
      "linkedin",
      "linkedin link",
      "linkedin_link",
      "linkedinlink",
      "linkedin profile",
      "linkedin_profile",
      "linkedinprofile",
      "profile url",
      "profile_url",
      "profileurl",
      "person linkedin url",
      "person_linkedin_url",
    ],
    required: true,
  },
  {
    prismaField: "email",
    aliases: [
      "email",
      "e mail",
      "e_mail",
      "email address",
      "emailaddress",
      "email_address",
      "mail",
      "contact email",
      "work email",
      "work_email",
    ],
    required: false,
  },
  {
    prismaField: "company",
    aliases: [
      "company",
      "companyname",
      "company name",
      "company_name",
      "organisation",
      "organization",
      "organisationname",
      "organizationname",
      "organisation name",
      "organization name",
      "organisation_name",
      "organization_name",
      "employer",
    ],
    required: true,
  },
  {
    prismaField: "companyDomain",
    aliases: [
      "companydomain",
      "company domain",
      "company_domain",
      "domain",
      "website domain",
      "website_domain",
    ],
    required: false,
  },
  {
    prismaField: "title",
    aliases: ["title", "job title", "jobtitle", "job_title", "position title"],
    required: false,
  },
  {
    prismaField: "headline",
    aliases: ["headline", "linkedin headline", "profile headline"],
    required: false,
  },
  {
    prismaField: "location",
    aliases: [
      "location",
      "city",
      "region",
      "geo",
      "geography",
      "person location",
      "person_location",
    ],
    required: false,
  },
  {
    prismaField: "mobileNumber",
    aliases: [
      "mobilenumber",
      "mobile number",
      "mobile_number",
      "phone",
      "phone number",
      "phonenumber",
      "phone_number",
      "mobile",
      "cell",
      "cell phone",
      "telephone",
      "tel",
    ],
    required: false,
  },
  {
    prismaField: "companyUrl",
    aliases: [
      "companyurl",
      "company url",
      "company_url",
      "company website",
      "companywebsite",
      "company_website",
      "website",
      "website url",
    ],
    required: false,
  },
  {
    prismaField: "companyLinkedinUrl",
    aliases: [
      "companylinkedinurl",
      "company linkedin url",
      "company_linkedin_url",
      "company linkedin",
      "company_linkedin",
    ],
    required: false,
  },
  {
    prismaField: "companySize",
    aliases: [
      "companysize",
      "company size",
      "company_size",
      "employees",
      "employee count",
      "employeecount",
      "employee_count",
      "num employees",
      "number of employees",
      "headcount",
    ],
    required: false,
    transform: mapToCompanySize,
  },
  {
    prismaField: "companyIndustry",
    aliases: [
      "companyindustry",
      "company industry",
      "company_industry",
      "industry",
      "sector",
    ],
    required: false,
  },
  {
    prismaField: "companyLocation",
    aliases: [
      "companylocation",
      "company location",
      "company_location",
      "hq location",
      "hqlocation",
      "headquarters",
      "company city",
    ],
    required: false,
  },
  {
    prismaField: "currentPosition",
    aliases: [
      "currentposition",
      "current position",
      "current_position",
      "role",
      "job role",
      "jobrole",
      "job_role",
    ],
    required: false,
  },
  {
    prismaField: "seniorityLevel",
    aliases: [
      "senioritylevel",
      "seniority level",
      "seniority_level",
      "seniority",
      "level",
      "job level",
      "joblevel",
      "job_level",
    ],
    required: false,
    transform: mapToSeniorityLevel,
  },
  {
    prismaField: "department",
    aliases: ["department", "dept", "team", "division"],
    required: false,
  },
  {
    prismaField: "yearsInPosition",
    aliases: [
      "yearsinposition",
      "years in position",
      "years_in_position",
      "tenure in role",
      "years in role",
    ],
    required: false,
    transform: parseIntSafe,
  },
  {
    prismaField: "yearsInCompany",
    aliases: [
      "yearsincompany",
      "years in company",
      "years_in_company",
      "company tenure",
      "tenure",
    ],
    required: false,
    transform: parseIntSafe,
  },
  {
    prismaField: "totalExperienceYears",
    aliases: [
      "totalexperienceyears",
      "total experience years",
      "total_experience_years",
      "experience",
      "years of experience",
      "total experience",
    ],
    required: false,
    transform: parseIntSafe,
  },
];

export function mapColumns(csvHeaders: string[]): MappingResult {
  const aliasMap = new Map<string, LeadFieldMapping>();
  for (const mapping of LEAD_FIELD_MAPPINGS) {
    aliasMap.set(normalizeHeader(mapping.prismaField), mapping);
    for (const alias of mapping.aliases) {
      aliasMap.set(alias, mapping);
    }
  }

  const matched: ColumnMatch[] = [];
  const usedFields = new Set<string>();
  const unmatchedCsvColumns: string[] = [];

  for (const header of csvHeaders) {
    const normalized = normalizeHeader(header);
    const mapping = aliasMap.get(normalized);

    if (mapping && !usedFields.has(mapping.prismaField)) {
      matched.push({
        csvColumn: header,
        prismaField: mapping.prismaField,
        required: mapping.required,
        transform: mapping.transform,
      });
      usedFields.add(mapping.prismaField);
    } else {
      unmatchedCsvColumns.push(header);
    }
  }

  const missingRequired = LEAD_FIELD_MAPPINGS.filter(
    (m) => m.required && !usedFields.has(m.prismaField),
  ).map((m) => m.prismaField);

  return { matched, unmatchedCsvColumns, missingRequired };
}
