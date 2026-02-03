// Outreach message parsing utilities

import {
  outreachChannelToJSON,
  outreachStageToJSON,
  outreachTacticToJSON,
  OutreachChannel as PbOutreachChannel,
  OutreachStage as PbOutreachStage,
  OutreachTactic as PbOutreachTactic,
  type OutreachMessage as PbOutreachMessage,
} from "@/generated/aisdr/v1/ai_sdr";
import {
  OutreachChannel as PrismaOutreachChannel,
  OutreachStage as PrismaOutreachStage,
} from "@prisma/client";

import type { OutreachMessageJson, OutreachVariantJson } from "./chat-stream.types";

export function parseOutreachVariants(
  variants: PbOutreachMessage[],
): OutreachMessageJson {
  const parsedVariants: OutreachVariantJson[] = variants.map((variant) => ({
    channel: outreachChannelToJSON(variant.channel),
    stage: outreachStageToJSON(variant.stage),
    subject: variant.subject || "",
    body: variant.body || "",
    variants: variant.variants || [],
    characterCount: variant.characterCount || 0,
    wordCount: variant.wordCount || 0,
    containsLink: variant.containsLink || false,
    usageNote: variant.usageNote || undefined,
    tacticUsed: variant.tacticUsed
      ? outreachTacticToJSON(variant.tacticUsed)
      : undefined,
    warnings: variant.warnings || [],
  }));

  return {
    type: "outreach",
    outreachVariants: parsedVariants,
  };
}

// Legacy function for backward compatibility (if single outreach message is provided)
export function parseOutreachMessage(
  outreach: PbOutreachMessage,
): OutreachMessageJson {
  return parseOutreachVariants([outreach]);
}

export function mapStringToOutreachChannel(channel: string): PbOutreachChannel {
  switch (channel) {
    case "EMAIL":
    case "OUTREACH_CHANNEL_EMAIL":
      return PbOutreachChannel.OUTREACH_CHANNEL_EMAIL;
    case "LINKEDIN":
    case "OUTREACH_CHANNEL_LINKEDIN":
      return PbOutreachChannel.OUTREACH_CHANNEL_LINKEDIN;
    default:
      return PbOutreachChannel.OUTREACH_CHANNEL_UNSPECIFIED;
  }
}

export function mapStringToOutreachStage(stage: string): PbOutreachStage {
  switch (stage) {
    case "CONNECTION_REQUEST":
    case "OUTREACH_STAGE_CONNECTION_REQUEST":
      return PbOutreachStage.OUTREACH_STAGE_CONNECTION_REQUEST;
    case "POST_ACCEPT_FIRST_MESSAGE":
    case "OUTREACH_STAGE_POST_ACCEPT_FIRST_MESSAGE":
      return PbOutreachStage.OUTREACH_STAGE_POST_ACCEPT_FIRST_MESSAGE;
    case "LINKEDIN_FOLLOW_UP_1":
    case "OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_1":
      return PbOutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_1;
    case "LINKEDIN_FOLLOW_UP_2":
    case "OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_2":
      return PbOutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_2;
    case "LINKEDIN_CLOSE_LOOP":
    case "OUTREACH_STAGE_LINKEDIN_CLOSE_LOOP":
      return PbOutreachStage.OUTREACH_STAGE_LINKEDIN_CLOSE_LOOP;
    case "COLD_EMAIL":
    case "OUTREACH_STAGE_COLD_EMAIL":
      return PbOutreachStage.OUTREACH_STAGE_COLD_EMAIL;
    case "WARM_EMAIL":
    case "OUTREACH_STAGE_WARM_EMAIL":
      return PbOutreachStage.OUTREACH_STAGE_WARM_EMAIL;
    case "INTRODUCTION_EMAIL":
    case "OUTREACH_STAGE_INTRODUCTION_EMAIL":
      return PbOutreachStage.OUTREACH_STAGE_INTRODUCTION_EMAIL;
    case "EMAIL_FOLLOW_UP_1":
    case "OUTREACH_STAGE_EMAIL_FOLLOW_UP_1":
      return PbOutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_1;
    case "EMAIL_FOLLOW_UP_2":
    case "OUTREACH_STAGE_EMAIL_FOLLOW_UP_2":
      return PbOutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_2;
    case "EMAIL_CLOSE_LOOP":
    case "OUTREACH_STAGE_EMAIL_CLOSE_LOOP":
      return PbOutreachStage.OUTREACH_STAGE_EMAIL_CLOSE_LOOP;
    case "FOLLOW_UP_NO_REPLY":
    case "OUTREACH_STAGE_FOLLOW_UP_NO_REPLY":
      return PbOutreachStage.OUTREACH_STAGE_FOLLOW_UP_NO_REPLY;
    case "AFTER_POSITIVE_REPLY":
    case "OUTREACH_STAGE_AFTER_POSITIVE_REPLY":
      return PbOutreachStage.OUTREACH_STAGE_AFTER_POSITIVE_REPLY;
    case "REPLY_TO_QUESTION":
    case "OUTREACH_STAGE_REPLY_TO_QUESTION":
      return PbOutreachStage.OUTREACH_STAGE_REPLY_TO_QUESTION;
    default:
      return PbOutreachStage.OUTREACH_STAGE_UNSPECIFIED;
  }
}

export function mapStringToOutreachTactic(tactic: string): PbOutreachTactic {
  switch (tactic) {
    case "OPTIONS":
    case "OUTREACH_TACTIC_OPTIONS":
      return PbOutreachTactic.OUTREACH_TACTIC_OPTIONS;
    case "MINI_PLAN":
    case "OUTREACH_TACTIC_MINI_PLAN":
      return PbOutreachTactic.OUTREACH_TACTIC_MINI_PLAN;
    case "TEASE":
    case "OUTREACH_TACTIC_TEASE":
      return PbOutreachTactic.OUTREACH_TACTIC_TEASE;
    case "RESOURCE":
    case "OUTREACH_TACTIC_RESOURCE":
      return PbOutreachTactic.OUTREACH_TACTIC_RESOURCE;
    case "SOCIAL_PROOF":
    case "OUTREACH_TACTIC_SOCIAL_PROOF":
      return PbOutreachTactic.OUTREACH_TACTIC_SOCIAL_PROOF;
    case "CLOSE_LOOP":
    case "OUTREACH_TACTIC_CLOSE_LOOP":
      return PbOutreachTactic.OUTREACH_TACTIC_CLOSE_LOOP;
    default:
      return PbOutreachTactic.OUTREACH_TACTIC_UNSPECIFIED;
  }
}

// Map Prisma enum to protobuf enum
export function mapPrismaChannelToProtobuf(
  channel: PrismaOutreachChannel,
): PbOutreachChannel {
  switch (channel) {
    case PrismaOutreachChannel.EMAIL:
      return PbOutreachChannel.OUTREACH_CHANNEL_EMAIL;
    case PrismaOutreachChannel.LINKEDIN:
      return PbOutreachChannel.OUTREACH_CHANNEL_LINKEDIN;
    default:
      return PbOutreachChannel.OUTREACH_CHANNEL_UNSPECIFIED;
  }
}

// Map Prisma enum to protobuf enum
export function mapPrismaStageToProtobuf(
  stage: PrismaOutreachStage | null,
): PbOutreachStage {
  if (stage === null) {
    return PbOutreachStage.OUTREACH_STAGE_UNSPECIFIED;
  }

  switch (stage) {
    case PrismaOutreachStage.CONNECTION_REQUEST:
      return PbOutreachStage.OUTREACH_STAGE_CONNECTION_REQUEST;
    case PrismaOutreachStage.POST_ACCEPT_FIRST_MESSAGE:
      return PbOutreachStage.OUTREACH_STAGE_POST_ACCEPT_FIRST_MESSAGE;
    case PrismaOutreachStage.LINKEDIN_FOLLOW_UP_1:
      return PbOutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_1;
    case PrismaOutreachStage.LINKEDIN_FOLLOW_UP_2:
      return PbOutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_2;
    case PrismaOutreachStage.LINKEDIN_CLOSE_LOOP:
      return PbOutreachStage.OUTREACH_STAGE_LINKEDIN_CLOSE_LOOP;
    case PrismaOutreachStage.COLD_EMAIL:
      return PbOutreachStage.OUTREACH_STAGE_COLD_EMAIL;
    case PrismaOutreachStage.WARM_EMAIL:
      return PbOutreachStage.OUTREACH_STAGE_WARM_EMAIL;
    case PrismaOutreachStage.INTRODUCTION_EMAIL:
      return PbOutreachStage.OUTREACH_STAGE_INTRODUCTION_EMAIL;
    case PrismaOutreachStage.EMAIL_FOLLOW_UP_1:
      return PbOutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_1;
    case PrismaOutreachStage.EMAIL_FOLLOW_UP_2:
      return PbOutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_2;
    case PrismaOutreachStage.EMAIL_CLOSE_LOOP:
      return PbOutreachStage.OUTREACH_STAGE_EMAIL_CLOSE_LOOP;
    case PrismaOutreachStage.FOLLOW_UP_NO_REPLY:
      return PbOutreachStage.OUTREACH_STAGE_FOLLOW_UP_NO_REPLY;
    case PrismaOutreachStage.AFTER_POSITIVE_REPLY:
      return PbOutreachStage.OUTREACH_STAGE_AFTER_POSITIVE_REPLY;
    case PrismaOutreachStage.REPLY_TO_QUESTION:
      return PbOutreachStage.OUTREACH_STAGE_REPLY_TO_QUESTION;
    case PrismaOutreachStage.UNSPECIFIED:
      return PbOutreachStage.OUTREACH_STAGE_UNSPECIFIED;
    default:
      return PbOutreachStage.OUTREACH_STAGE_UNSPECIFIED;
  }
}
