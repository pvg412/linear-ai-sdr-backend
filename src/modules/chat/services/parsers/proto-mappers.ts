// Proto enum mapping utilities for prompt parser

import {
  LeadProvider as PrismaLeadProvider,
  LeadSearchKind as PrismaLeadSearchKind,
} from "@prisma/client";

import {
  CompanySize as ProtoCompanySize,
  LeadProvider as ProtoLeadProvider,
  LeadResponseType as ProtoLeadResponseType,
  LeadSearchKind as ProtoLeadSearchKind,
  OutreachChannel as ProtoOutreachChannel,
  OutreachStage as ProtoOutreachStage,
  OutreachTactic as ProtoOutreachTactic,
} from "@/generated/aisdr/v1/ai_sdr";

import type { CompanySizeStr } from "./parser.schemas";

export function mapCompanySizeEnumToString(
  size: ProtoCompanySize | number | undefined,
): CompanySizeStr | undefined {
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

export function mapProviderToProto(
  provider: PrismaLeadProvider,
): ProtoLeadProvider {
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
    default:
      return ProtoLeadProvider.LEAD_PROVIDER_UNSPECIFIED;
  }
}

export function mapKindToProto(
  kind: PrismaLeadSearchKind,
): ProtoLeadSearchKind {
  switch (kind) {
    case PrismaLeadSearchKind.LEAD_DB:
      return ProtoLeadSearchKind.LEAD_SEARCH_KIND_LEAD_DB;
    case PrismaLeadSearchKind.SCRAPER:
      return ProtoLeadSearchKind.LEAD_SEARCH_KIND_SCRAPER;
    default:
      return ProtoLeadSearchKind.LEAD_SEARCH_KIND_UNSPECIFIED;
  }
}

export function mapLeadResponseTypeToProto(
  type?: string,
): ProtoLeadResponseType | undefined {
  if (!type) return undefined;

  switch (type) {
    case "NO_RESPONSE":
      return ProtoLeadResponseType.LEAD_RESPONSE_TYPE_NO_RESPONSE;
    case "POSITIVE":
      return ProtoLeadResponseType.LEAD_RESPONSE_TYPE_POSITIVE;
    case "QUESTION":
      return ProtoLeadResponseType.LEAD_RESPONSE_TYPE_QUESTION;
    case "NOT_NOW":
      return ProtoLeadResponseType.LEAD_RESPONSE_TYPE_NOT_NOW;
    case "NEGATIVE":
      return ProtoLeadResponseType.LEAD_RESPONSE_TYPE_NEGATIVE;
    case "OOO":
      return ProtoLeadResponseType.LEAD_RESPONSE_TYPE_OOO;
    default:
      return ProtoLeadResponseType.LEAD_RESPONSE_TYPE_UNSPECIFIED;
  }
}

export function mapOutreachChannelToProto(
  channel?: string,
): ProtoOutreachChannel | undefined {
  if (!channel) return undefined;

  switch (channel) {
    case "EMAIL":
    case "OUTREACH_CHANNEL_EMAIL":
      return ProtoOutreachChannel.OUTREACH_CHANNEL_EMAIL;
    case "LINKEDIN":
    case "OUTREACH_CHANNEL_LINKEDIN":
      return ProtoOutreachChannel.OUTREACH_CHANNEL_LINKEDIN;
    default:
      return ProtoOutreachChannel.OUTREACH_CHANNEL_UNSPECIFIED;
  }
}

export function mapOutreachChannelFromProto(
  channel: ProtoOutreachChannel,
): string {
  switch (channel) {
    case ProtoOutreachChannel.OUTREACH_CHANNEL_EMAIL:
      return "EMAIL";
    case ProtoOutreachChannel.OUTREACH_CHANNEL_LINKEDIN:
      return "LINKEDIN";
    case ProtoOutreachChannel.OUTREACH_CHANNEL_UNSPECIFIED:
      return "UNSPECIFIED";
    default:
      console.warn(
        `[mapOutreachChannelFromProto] Unknown channel enum value: ${channel}`,
      );
      return "UNSPECIFIED";
  }
}

export function mapOutreachStageFromProto(stage: ProtoOutreachStage): string {
  switch (stage) {
    case ProtoOutreachStage.OUTREACH_STAGE_CONNECTION_REQUEST:
      return "CONNECTION_REQUEST";
    case ProtoOutreachStage.OUTREACH_STAGE_POST_ACCEPT_FIRST_MESSAGE:
      return "POST_ACCEPT_FIRST_MESSAGE";
    case ProtoOutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_1:
      return "LINKEDIN_FOLLOW_UP_1";
    case ProtoOutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_2:
      return "LINKEDIN_FOLLOW_UP_2";
    case ProtoOutreachStage.OUTREACH_STAGE_LINKEDIN_CLOSE_LOOP:
      return "LINKEDIN_CLOSE_LOOP";
    case ProtoOutreachStage.OUTREACH_STAGE_COLD_EMAIL:
      return "COLD_EMAIL";
    case ProtoOutreachStage.OUTREACH_STAGE_WARM_EMAIL:
      return "WARM_EMAIL";
    case ProtoOutreachStage.OUTREACH_STAGE_INTRODUCTION_EMAIL:
      return "INTRODUCTION_EMAIL";
    case ProtoOutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_1:
      return "EMAIL_FOLLOW_UP_1";
    case ProtoOutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_2:
      return "EMAIL_FOLLOW_UP_2";
    case ProtoOutreachStage.OUTREACH_STAGE_EMAIL_CLOSE_LOOP:
      return "EMAIL_CLOSE_LOOP";
    case ProtoOutreachStage.OUTREACH_STAGE_FOLLOW_UP_NO_REPLY:
      return "FOLLOW_UP_NO_REPLY";
    case ProtoOutreachStage.OUTREACH_STAGE_AFTER_POSITIVE_REPLY:
      return "AFTER_POSITIVE_REPLY";
    case ProtoOutreachStage.OUTREACH_STAGE_REPLY_TO_QUESTION:
      return "REPLY_TO_QUESTION";
    default:
      return "UNSPECIFIED";
  }
}

export function mapOutreachTacticFromProto(
  tactic: ProtoOutreachTactic,
): string {
  switch (tactic) {
    case ProtoOutreachTactic.OUTREACH_TACTIC_OPTIONS:
      return "OPTIONS";
    case ProtoOutreachTactic.OUTREACH_TACTIC_MINI_PLAN:
      return "MINI_PLAN";
    case ProtoOutreachTactic.OUTREACH_TACTIC_TEASE:
      return "TEASE";
    case ProtoOutreachTactic.OUTREACH_TACTIC_RESOURCE:
      return "RESOURCE";
    case ProtoOutreachTactic.OUTREACH_TACTIC_SOCIAL_PROOF:
      return "SOCIAL_PROOF";
    case ProtoOutreachTactic.OUTREACH_TACTIC_CLOSE_LOOP:
      return "CLOSE_LOOP";
    default:
      return "UNSPECIFIED";
  }
}
