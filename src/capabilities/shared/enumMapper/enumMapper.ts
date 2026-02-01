// Centralized enum mapping utilities
// Uses Map-based registries instead of switch statements for OCP compliance

import {
  LeadProvider as PrismaLeadProvider,
  LeadSearchKind as PrismaLeadSearchKind,
} from "@prisma/client";

import {
  LeadProvider as ProtoLeadProvider,
  LeadSearchKind as ProtoLeadSearchKind,
  CompanySize as ProtoCompanySize,
  LeadResponseType as ProtoLeadResponseType,
  OutreachChannel as ProtoOutreachChannel,
} from "@/generated/aisdr/v1/ai_sdr";

// Company size string type
export type CompanySizeStr =
  | "1-10"
  | "11-50"
  | "51-200"
  | "201-500"
  | "501-1000"
  | "1000+";

// ========================
// Company Size Mapping
// ========================

const companySizeProtoToString = new Map<ProtoCompanySize, CompanySizeStr>([
  [ProtoCompanySize.COMPANY_SIZE_1_10, "1-10"],
  [ProtoCompanySize.COMPANY_SIZE_11_50, "11-50"],
  [ProtoCompanySize.COMPANY_SIZE_51_200, "51-200"],
  [ProtoCompanySize.COMPANY_SIZE_201_500, "201-500"],
  [ProtoCompanySize.COMPANY_SIZE_501_1000, "501-1000"],
  [ProtoCompanySize.COMPANY_SIZE_1000_PLUS, "1000+"],
]);

export function mapCompanySizeEnumToString(
  size: ProtoCompanySize | number | undefined,
): CompanySizeStr | undefined {
  if (size === undefined) return undefined;
  return companySizeProtoToString.get(size as ProtoCompanySize);
}

// ========================
// Lead Provider Mapping
// ========================

const providerPrismaToProto = new Map<PrismaLeadProvider, ProtoLeadProvider>([
  [PrismaLeadProvider.SCRAPER_CITY, ProtoLeadProvider.LEAD_PROVIDER_SCRAPER_CITY],
  [PrismaLeadProvider.SEARCH_LEADS, ProtoLeadProvider.LEAD_PROVIDER_SEARCH_LEADS],
  [PrismaLeadProvider.BOOMERANG, ProtoLeadProvider.LEAD_PROVIDER_BOOMERANG],
  [PrismaLeadProvider.DADDY_LEADS, ProtoLeadProvider.LEAD_PROVIDER_DADDY_LEADS],
  [PrismaLeadProvider.APIFY, ProtoLeadProvider.LEAD_PROVIDER_APIFY],
  [PrismaLeadProvider.SCRUPP, ProtoLeadProvider.LEAD_PROVIDER_SCRUPP],
]);

export function mapProviderToProto(
  provider: PrismaLeadProvider,
): ProtoLeadProvider {
  return (
    providerPrismaToProto.get(provider) ??
    ProtoLeadProvider.LEAD_PROVIDER_UNSPECIFIED
  );
}

// ========================
// Lead Search Kind Mapping
// ========================

const kindPrismaToProto = new Map<PrismaLeadSearchKind, ProtoLeadSearchKind>([
  [PrismaLeadSearchKind.LEAD_DB, ProtoLeadSearchKind.LEAD_SEARCH_KIND_LEAD_DB],
  [PrismaLeadSearchKind.SCRAPER, ProtoLeadSearchKind.LEAD_SEARCH_KIND_SCRAPER],
]);

export function mapKindToProto(
  kind: PrismaLeadSearchKind,
): ProtoLeadSearchKind {
  return (
    kindPrismaToProto.get(kind) ??
    ProtoLeadSearchKind.LEAD_SEARCH_KIND_UNSPECIFIED
  );
}

// ========================
// Lead Response Type Mapping
// ========================

const leadResponseTypeStringToProto = new Map<string, ProtoLeadResponseType>([
  ["NO_RESPONSE", ProtoLeadResponseType.LEAD_RESPONSE_TYPE_NO_RESPONSE],
  ["POSITIVE", ProtoLeadResponseType.LEAD_RESPONSE_TYPE_POSITIVE],
  ["QUESTION", ProtoLeadResponseType.LEAD_RESPONSE_TYPE_QUESTION],
  ["NOT_NOW", ProtoLeadResponseType.LEAD_RESPONSE_TYPE_NOT_NOW],
  ["NEGATIVE", ProtoLeadResponseType.LEAD_RESPONSE_TYPE_NEGATIVE],
  ["OOO", ProtoLeadResponseType.LEAD_RESPONSE_TYPE_OOO],
]);

export function mapLeadResponseTypeToProto(
  type?: string,
): ProtoLeadResponseType | undefined {
  if (!type) return undefined;
  return (
    leadResponseTypeStringToProto.get(type) ??
    ProtoLeadResponseType.LEAD_RESPONSE_TYPE_UNSPECIFIED
  );
}

// ========================
// Outreach Channel Mapping
// ========================

const outreachChannelStringToProto = new Map<string, ProtoOutreachChannel>([
  ["EMAIL", ProtoOutreachChannel.OUTREACH_CHANNEL_EMAIL],
  ["OUTREACH_CHANNEL_EMAIL", ProtoOutreachChannel.OUTREACH_CHANNEL_EMAIL],
  ["LINKEDIN", ProtoOutreachChannel.OUTREACH_CHANNEL_LINKEDIN],
  ["OUTREACH_CHANNEL_LINKEDIN", ProtoOutreachChannel.OUTREACH_CHANNEL_LINKEDIN],
]);

const outreachChannelProtoToString = new Map<ProtoOutreachChannel, string>([
  [ProtoOutreachChannel.OUTREACH_CHANNEL_EMAIL, "EMAIL"],
  [ProtoOutreachChannel.OUTREACH_CHANNEL_LINKEDIN, "LINKEDIN"],
  [ProtoOutreachChannel.OUTREACH_CHANNEL_UNSPECIFIED, "UNSPECIFIED"],
]);

export function mapOutreachChannelToProto(
  channel?: string,
): ProtoOutreachChannel | undefined {
  if (!channel) return undefined;
  return (
    outreachChannelStringToProto.get(channel) ??
    ProtoOutreachChannel.OUTREACH_CHANNEL_UNSPECIFIED
  );
}

export function mapOutreachChannelFromProto(
  channel: ProtoOutreachChannel,
): string {
  return outreachChannelProtoToString.get(channel) ?? "UNSPECIFIED";
}
