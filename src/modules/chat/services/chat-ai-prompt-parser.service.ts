// src/modules/chat/parsers/chat-ai-prompt-parser.ts
import { inject, injectable } from "inversify";
import { z } from "zod";
import { LeadProvider as PrismaLeadProvider, LeadSearchKind as PrismaLeadSearchKind } from "@prisma/client";

import { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { CompanySizeSchema, LeadDbCanonicalFiltersSchema } from "@/capabilities/lead-db/lead-db.dto";
import type { ChatPromptParser } from "@/modules/chat/schemas/chat.dto";

import {
  CompanySize as ProtoCompanySize,
  LeadProvider as ProtoLeadProvider,
  LeadSearchKind as ProtoLeadSearchKind,
  ParseLeadSearchPromptResponse,
} from "@/generated/aisdr/v1/ai_sdr";
import { AI_GRPC_CLIENT_TYPES } from "@/infra/ai-grpc-client/ai-grpc-client.types";

// -------------------------
// Local schemas (same as before, to keep Node contract stable)
// -------------------------

const LimitSchema = z.number().int().min(1).max(50_000);

const ScraperQuerySchema = z
  .object({
    industry: z.string().trim().min(1).optional(),
    titles: z.array(z.string().trim().min(1)).default([]),
    locations: z.array(z.string().trim().min(1)).default([]),
    companySize: CompanySizeSchema.optional(),
    companyKeywords: z.array(z.string().trim().min(1)).optional(),
  })
  .strip();

const AiLeadDbOutputSchema = z
  .object({
    limit: LimitSchema.optional(),
    query: LeadDbCanonicalFiltersSchema.default({}),
  })
  .strip();

const AiScraperOutputSchema = z
  .object({
    limit: LimitSchema.optional(),
    query: ScraperQuerySchema.default({ titles: [], locations: [] }),
  })
  .strip();

type LeadDbQueryOut = z.infer<typeof LeadDbCanonicalFiltersSchema>;
type ScraperQueryOut = z.infer<typeof ScraperQuerySchema>;
type CompanySizeStr = z.infer<typeof CompanySizeSchema>;

// -------------------------
// Helpers (no any, safe runtime access)
// -------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readNonEmptyString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

function readStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

function readOptionalBool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  if (typeof v === "boolean") return v;
  return undefined;
}

function readOptionalEnumNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function mapCompanySizeEnumToString(size: ProtoCompanySize | number | undefined): CompanySizeStr | undefined {
  const n = typeof size === "number" ? size : undefined;
  switch (n) {
    case ProtoCompanySize.COMPANY_SIZE_1_10:
      return "1-10";
    case ProtoCompanySize.COMPANY_SIZE_11_50:
      return "11-50";
    case ProtoCompanySize.COMPANY_SIZE_51_200:
      return "51-200";
    case ProtoCompanySize.COMPANY_SIZE_201_500:
      return "201-500";
    case ProtoCompanySize.COMPANY_SIZE_501_1000:
      return "501-1000";
    case ProtoCompanySize.COMPANY_SIZE_1000_PLUS:
      return "1000+";
    default:
      return undefined;
  }
}

function mapProviderToProto(provider: PrismaLeadProvider): ProtoLeadProvider {
  switch (provider) {
    case PrismaLeadProvider.SCRAPER_CITY:
      return ProtoLeadProvider.LEAD_PROVIDER_SCRAPER_CITY;
    case PrismaLeadProvider.SEARCH_LEADS:
      return ProtoLeadProvider.LEAD_PROVIDER_SEARCH_LEADS;
    case PrismaLeadProvider.BOOMERANG:
      return ProtoLeadProvider.LEAD_PROVIDER_BOOMERANG;
    case PrismaLeadProvider.DADDY_LEADS:
      return ProtoLeadProvider.LEAD_PROVIDER_DADDY_LEADS;
    case PrismaLeadProvider.APIFY:
      return ProtoLeadProvider.LEAD_PROVIDER_APIFY;
    case PrismaLeadProvider.SCRUPP:
      return ProtoLeadProvider.LEAD_PROVIDER_SCRUPP;

    // if Apollo appears in Prisma — simply uncomment:
    // case PrismaLeadProvider.APOLLO:
    //   return ProtoLeadProvider.LEAD_PROVIDER_APOLLO;

    default:
      return ProtoLeadProvider.LEAD_PROVIDER_UNSPECIFIED;
  }
}

function mapKindToProto(kind: PrismaLeadSearchKind): ProtoLeadSearchKind {
  switch (kind) {
    case PrismaLeadSearchKind.LEAD_DB:
      return ProtoLeadSearchKind.LEAD_SEARCH_KIND_LEAD_DB;
    case PrismaLeadSearchKind.SCRAPER:
      return ProtoLeadSearchKind.LEAD_SEARCH_KIND_SCRAPER;
    default:
      return ProtoLeadSearchKind.LEAD_SEARCH_KIND_UNSPECIFIED;
  }
}

type ExtractedQuery =
  | { kind: "leadDb"; value: Record<string, unknown> }
  | { kind: "scraper"; value: Record<string, unknown> };

function extractQueryFromParseResponse(resp: ParseLeadSearchPromptResponse): ExtractedQuery {
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

  throw new Error("ParseLeadSearchPromptResponse: query is empty (no leadDbQuery/scraperQuery)");
}

function toLeadDbQuery(pb: Record<string, unknown>): LeadDbQueryOut {
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
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        null,
        2,
      )}`,
    );
  }

  return parsed.data;
}

function toScraperQuery(pb: Record<string, unknown>): ScraperQueryOut {
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
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        null,
        2,
      )}`,
    );
  }

  return parsed.data;
}

@injectable()
export class ChatAiPromptParserService implements ChatPromptParser {
  constructor(
    @inject(AI_GRPC_CLIENT_TYPES.AiGrpcClient)
    private readonly aiGrpcClient: AiGrpcClient,
  ) {}

  async parsePrompt(input: {
    text: string;
    provider: PrismaLeadProvider;
    kind: PrismaLeadSearchKind;
  }): Promise<{ query: Record<string, unknown>; suggestedLimit?: number }> {
    const { provider, kind, text } = input;

    const resp = await this.aiGrpcClient.parseLeadSearchPrompt({
      requestId: "", // AiGrpcClient will set UUID if empty
      userId: "", // can be passed later if you extend the interface
      threadId: "",
      provider: mapProviderToProto(provider),
      kind: mapKindToProto(kind),
      text,
      defaultLimit: 100,
      maxLimit: 50_000,
      outputLanguage: "en",
      debug: false,
    });

    const extracted = extractQueryFromParseResponse(resp);
    const suggestedLimit = resp.limit > 0 ? resp.limit : undefined;

    if (extracted.kind === "leadDb") {
      const query = toLeadDbQuery(extracted.value);

      // final contract check (limit/query)
      const validated = AiLeadDbOutputSchema.safeParse({ limit: suggestedLimit, query });
      if (!validated.success) {
        throw new Error(`AI gRPC LeadDb output failed validation: ${validated.error.message}`);
      }

      return { query: validated.data.query, suggestedLimit: validated.data.limit };
    }

    const query = toScraperQuery(extracted.value);

    const validated = AiScraperOutputSchema.safeParse({ limit: suggestedLimit, query });
    if (!validated.success) {
      throw new Error(`AI gRPC Scraper output failed validation: ${validated.error.message}`);
    }

    return { query: validated.data.query, suggestedLimit: validated.data.limit };
  }
}
