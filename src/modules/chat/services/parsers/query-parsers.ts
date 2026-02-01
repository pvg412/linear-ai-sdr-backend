// Query parsing utilities for AI responses

import type { ParseLeadSearchPromptResponse } from "@/generated/aisdr/v1/ai_sdr";

import {
  isRecord,
  readNonEmptyString,
  readOptionalBool,
  readOptionalEnumNumber,
  readStringArray,
  type ExtractedQuery,
} from "./parser.types";
import {
  LeadDbCanonicalFiltersSchema,
  ScraperQuerySchema,
  type LeadDbQueryOut,
  type ScraperQueryOut,
} from "./parser.schemas";
import { mapCompanySizeEnumToString } from "./proto-mappers";
import { structToJson } from "./struct-helpers";

export function extractQueryFromParseResponse(
  resp: ParseLeadSearchPromptResponse,
): ExtractedQuery {
  // Support both ts-proto modes:
  // 1) oneof=unions: resp.query = { $case: "leadDbQuery", leadDbQuery: {...} }
  // 2) oneof=properties: resp.leadDbQuery / resp.scraperQuery

  const u: unknown = resp;

  if (!isRecord(u)) {
    throw new Error("ParseLeadSearchPromptResponse: invalid response type");
  }

  const q = u["query"];
  if (isRecord(q)) {
    const kase = q["$case"];
    if (kase === "leadDbQuery") {
      const v = q["leadDbQuery"];
      if (isRecord(v)) return { kind: "leadDb", value: v };
    }
    if (kase === "scraperQuery") {
      const v = q["scraperQuery"];
      if (isRecord(v)) return { kind: "scraper", value: v };
    }
  }

  const leadDb = u["leadDbQuery"];
  if (isRecord(leadDb)) return { kind: "leadDb", value: leadDb };

  const scraper = u["scraperQuery"];
  if (isRecord(scraper)) return { kind: "scraper", value: scraper };

  throw new Error(
    "ParseLeadSearchPromptResponse: query is empty (no leadDbQuery/scraperQuery)",
  );
}

export function toLeadDbQuery(pb: Record<string, unknown>): LeadDbQueryOut {
  const out: Record<string, unknown> = {
    // arrays are always present to not break UI/contract
    personTitles: readStringArray(pb, "personTitles"),
    personCities: readStringArray(pb, "personCities"),
    companyCities: readStringArray(pb, "companyCities"),
    companyDomains: readStringArray(pb, "companyDomains"),
    companyKeywords: readStringArray(pb, "companyKeywords"),
  };

  const seniorityLevel = readNonEmptyString(pb, "seniorityLevel");
  if (seniorityLevel) out.seniorityLevel = seniorityLevel;

  const functionDept = readNonEmptyString(pb, "functionDept");
  if (functionDept) out.functionDept = functionDept;

  const personCountry = readNonEmptyString(pb, "personCountry");
  if (personCountry) out.personCountry = personCountry;

  const personState = readNonEmptyString(pb, "personState");
  if (personState) out.personState = personState;

  const companyIndustry = readNonEmptyString(pb, "companyIndustry");
  if (companyIndustry) out.companyIndustry = companyIndustry;

  const companyCountry = readNonEmptyString(pb, "companyCountry");
  if (companyCountry) out.companyCountry = companyCountry;

  const companyState = readNonEmptyString(pb, "companyState");
  if (companyState) out.companyState = companyState;

  const hasPhone = readOptionalBool(pb, "hasPhone");
  if (hasPhone !== undefined) out.hasPhone = hasPhone;

  const companySizeEnum = readOptionalEnumNumber(pb, "companySize");
  const companySize = mapCompanySizeEnumToString(companySizeEnum);
  if (companySize) out.companySize = companySize;

  const parsed = LeadDbCanonicalFiltersSchema.safeParse(out);
  if (!parsed.success) {
    throw new Error(
      `AI gRPC returned invalid LeadDbCanonicalFilters: ${JSON.stringify(
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        null,
        2,
      )}`,
    );
  }

  return parsed.data;
}

export function toScraperQuery(pb: Record<string, unknown>): ScraperQueryOut {
  const out: Record<string, unknown> = {
    titles: readStringArray(pb, "titles"),
    locations: readStringArray(pb, "locations"),
  };

  const industry = readNonEmptyString(pb, "industry");
  if (industry) out.industry = industry;

  const companyKeywords = readStringArray(pb, "companyKeywords");
  if (companyKeywords.length > 0) out.companyKeywords = companyKeywords;

  const companySizeEnum = readOptionalEnumNumber(pb, "companySize");
  const companySize = mapCompanySizeEnumToString(companySizeEnum);
  if (companySize) out.companySize = companySize;

  const parsed = ScraperQuerySchema.safeParse(out);
  if (!parsed.success) {
    throw new Error(
      `AI gRPC returned invalid ScraperQuery: ${JSON.stringify(
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        null,
        2,
      )}`,
    );
  }

  return parsed.data;
}

export function toApifyScraperQuery(
  pb: Record<string, unknown>,
): Record<string, unknown> {
  // base fields from normal ScraperQuery (keeps UI stable)
  const base = toScraperQuery(pb);

  // Apify extended fields come via proto ScraperQuery.extra (google.protobuf.Struct)
  const extraRaw = pb["extra"];
  const extraObj = structToJson(extraRaw) ?? {};

  // merge: extra first, base last (base overwrites titles/locations with sanitized arrays)
  const merged: Record<string, unknown> = { ...extraObj, ...base };

  // normalize ISO2 countries if present
  const countries = merged["autoQuerySegmentationTargetCountries"];
  if (Array.isArray(countries)) {
    const norm = countries
      .map((c) => (typeof c === "string" ? c.trim().toUpperCase() : ""))
      .filter(Boolean);
    if (norm.length > 0) merged["autoQuerySegmentationTargetCountries"] = norm;
  }

  return merged;
}
