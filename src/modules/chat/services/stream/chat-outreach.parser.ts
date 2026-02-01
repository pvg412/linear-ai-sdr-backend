// Outreach message parsing utilities

import {
  outreachChannelToJSON,
  outreachStageToJSON,
  OutreachChannel as PbOutreachChannel,
  OutreachStage as PbOutreachStage,
  OutreachTactic as PbOutreachTactic,
  type OutreachMessage as PbOutreachMessage,
} from "@/generated/aisdr/v1/ai_sdr";

import type { OutreachMessageJson } from "./chat-stream.types";

export function parseOutreachMessage(
  outreach: PbOutreachMessage,
): OutreachMessageJson {
  return {
    type: "outreach",
    channel: outreachChannelToJSON(outreach.channel),
    stage: outreachStageToJSON(outreach.stage),
    subject: outreach.subject || "",
    body: outreach.body || "",
    variants: outreach.variants || [],
    characterCount: outreach.characterCount || 0,
    wordCount: outreach.wordCount || 0,
    containsLink: outreach.containsLink || false,
    usageNote: outreach.usageNote || undefined,
  };
}

export function mapStringToOutreachChannel(channel: string): PbOutreachChannel {
  switch (channel) {
    case "EMAIL":
      return PbOutreachChannel.OUTREACH_CHANNEL_EMAIL;
    case "LINKEDIN":
      return PbOutreachChannel.OUTREACH_CHANNEL_LINKEDIN;
    default:
      return PbOutreachChannel.OUTREACH_CHANNEL_UNSPECIFIED;
  }
}

export function mapStringToOutreachStage(stage: string): PbOutreachStage {
  switch (stage) {
    case "CONNECTION_REQUEST":
      return PbOutreachStage.OUTREACH_STAGE_CONNECTION_REQUEST;
    case "POST_ACCEPT_FIRST_MESSAGE":
      return PbOutreachStage.OUTREACH_STAGE_POST_ACCEPT_FIRST_MESSAGE;
    case "LINKEDIN_FOLLOW_UP_1":
      return PbOutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_1;
    case "LINKEDIN_FOLLOW_UP_2":
      return PbOutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_2;
    case "LINKEDIN_CLOSE_LOOP":
      return PbOutreachStage.OUTREACH_STAGE_LINKEDIN_CLOSE_LOOP;
    case "COLD_EMAIL":
      return PbOutreachStage.OUTREACH_STAGE_COLD_EMAIL;
    case "WARM_EMAIL":
      return PbOutreachStage.OUTREACH_STAGE_WARM_EMAIL;
    case "INTRODUCTION_EMAIL":
      return PbOutreachStage.OUTREACH_STAGE_INTRODUCTION_EMAIL;
    case "EMAIL_FOLLOW_UP_1":
      return PbOutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_1;
    case "EMAIL_FOLLOW_UP_2":
      return PbOutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_2;
    case "EMAIL_CLOSE_LOOP":
      return PbOutreachStage.OUTREACH_STAGE_EMAIL_CLOSE_LOOP;
    case "FOLLOW_UP_NO_REPLY":
      return PbOutreachStage.OUTREACH_STAGE_FOLLOW_UP_NO_REPLY;
    case "AFTER_POSITIVE_REPLY":
      return PbOutreachStage.OUTREACH_STAGE_AFTER_POSITIVE_REPLY;
    case "REPLY_TO_QUESTION":
      return PbOutreachStage.OUTREACH_STAGE_REPLY_TO_QUESTION;
    default:
      return PbOutreachStage.OUTREACH_STAGE_UNSPECIFIED;
  }
}

export function mapStringToOutreachTactic(tactic: string): PbOutreachTactic {
  switch (tactic) {
    case "OPTIONS":
      return PbOutreachTactic.OUTREACH_TACTIC_OPTIONS;
    case "MINI_PLAN":
      return PbOutreachTactic.OUTREACH_TACTIC_MINI_PLAN;
    case "TEASE":
      return PbOutreachTactic.OUTREACH_TACTIC_TEASE;
    case "RESOURCE":
      return PbOutreachTactic.OUTREACH_TACTIC_RESOURCE;
    case "SOCIAL_PROOF":
      return PbOutreachTactic.OUTREACH_TACTIC_SOCIAL_PROOF;
    case "CLOSE_LOOP":
      return PbOutreachTactic.OUTREACH_TACTIC_CLOSE_LOOP;
    default:
      return PbOutreachTactic.OUTREACH_TACTIC_UNSPECIFIED;
  }
}
