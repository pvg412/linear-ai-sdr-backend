import { z } from "zod";
import { LeadSearchKind } from "@prisma/client";

import { ChatParserIdSchema } from "../parsers/chat.parsers";
import {
  ChatMode,
  OutreachChannel,
  OutreachStage
} from "@/generated/aisdr/v1/ai_sdr";

const ClientMessageIdSchema = z.string().min(1).max(64).optional();

// Map frontend string enum to proto numeric enum
const ChatModeSchema = z
  .union([
    z.literal("CHAT_MODE_ASSISTANCE"),
    z.literal("CHAT_MODE_OUTREACH"),
    z.enum(ChatMode),
  ])
  .transform((val) => {
    if (typeof val === "string") {
      if (val === "CHAT_MODE_ASSISTANCE") return ChatMode.CHAT_MODE_ASSISTANCE;
      if (val === "CHAT_MODE_OUTREACH") return ChatMode.CHAT_MODE_OUTREACH;
    }
    return val as ChatMode;
  })
  .default(ChatMode.CHAT_MODE_ASSISTANCE)
  .optional();

// Map frontend string enum to proto numeric enum for OutreachChannel
export const OutreachChannelSchema = z
  .union([
    z.literal("OUTREACH_CHANNEL_EMAIL"),
    z.literal("OUTREACH_CHANNEL_LINKEDIN"),
    z.enum(OutreachChannel),
  ])
  .transform((val) => {
    if (typeof val === "string") {
      if (val === "OUTREACH_CHANNEL_EMAIL") return OutreachChannel.OUTREACH_CHANNEL_EMAIL;
      if (val === "OUTREACH_CHANNEL_LINKEDIN") return OutreachChannel.OUTREACH_CHANNEL_LINKEDIN;
    }
    return val as OutreachChannel;
  });

// Map frontend string enum to proto numeric enum for OutreachStage
export const OutreachStageSchema = z
  .union([
    z.literal("OUTREACH_STAGE_CONNECTION_REQUEST"),
    z.literal("OUTREACH_STAGE_POST_ACCEPT_FIRST_MESSAGE"),
    z.literal("OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_1"),
    z.literal("OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_2"),
    z.literal("OUTREACH_STAGE_LINKEDIN_CLOSE_LOOP"),
    z.literal("OUTREACH_STAGE_COLD_EMAIL"),
    z.literal("OUTREACH_STAGE_WARM_EMAIL"),
    z.literal("OUTREACH_STAGE_INTRODUCTION_EMAIL"),
    z.literal("OUTREACH_STAGE_EMAIL_FOLLOW_UP_1"),
    z.literal("OUTREACH_STAGE_EMAIL_FOLLOW_UP_2"),
    z.literal("OUTREACH_STAGE_EMAIL_CLOSE_LOOP"),
    z.literal("OUTREACH_STAGE_FOLLOW_UP_NO_REPLY"),
    z.literal("OUTREACH_STAGE_AFTER_POSITIVE_REPLY"),
    z.literal("OUTREACH_STAGE_REPLY_TO_QUESTION"),
    z.enum(OutreachStage),
  ])
  .transform((val) => {
    if (typeof val === "string") {
      if (val === "OUTREACH_STAGE_CONNECTION_REQUEST") return OutreachStage.OUTREACH_STAGE_CONNECTION_REQUEST;
      if (val === "OUTREACH_STAGE_POST_ACCEPT_FIRST_MESSAGE") return OutreachStage.OUTREACH_STAGE_POST_ACCEPT_FIRST_MESSAGE;
      if (val === "OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_1") return OutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_1;
      if (val === "OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_2") return OutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_2;
      if (val === "OUTREACH_STAGE_LINKEDIN_CLOSE_LOOP") return OutreachStage.OUTREACH_STAGE_LINKEDIN_CLOSE_LOOP;
      if (val === "OUTREACH_STAGE_COLD_EMAIL") return OutreachStage.OUTREACH_STAGE_COLD_EMAIL;
      if (val === "OUTREACH_STAGE_WARM_EMAIL") return OutreachStage.OUTREACH_STAGE_WARM_EMAIL;
      if (val === "OUTREACH_STAGE_INTRODUCTION_EMAIL") return OutreachStage.OUTREACH_STAGE_INTRODUCTION_EMAIL;
      if (val === "OUTREACH_STAGE_EMAIL_FOLLOW_UP_1") return OutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_1;
      if (val === "OUTREACH_STAGE_EMAIL_FOLLOW_UP_2") return OutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_2;
      if (val === "OUTREACH_STAGE_EMAIL_CLOSE_LOOP") return OutreachStage.OUTREACH_STAGE_EMAIL_CLOSE_LOOP;
      if (val === "OUTREACH_STAGE_FOLLOW_UP_NO_REPLY") return OutreachStage.OUTREACH_STAGE_FOLLOW_UP_NO_REPLY;
      if (val === "OUTREACH_STAGE_AFTER_POSITIVE_REPLY") return OutreachStage.OUTREACH_STAGE_AFTER_POSITIVE_REPLY;
      if (val === "OUTREACH_STAGE_REPLY_TO_QUESTION") return OutreachStage.OUTREACH_STAGE_REPLY_TO_QUESTION;
    }
    return val as OutreachStage;
  });

const QueryWithOptionalLimitSchema = z.looseObject({
  // New shape: limit is inside query
  limit: z.coerce.number().int().min(1).max(50_000).optional(),
});

const OutreachContextSchema = z.object({
  channel: OutreachChannelSchema,
  stage: OutreachStageSchema,
  dayInSequence: z.number().int().min(0).optional(),
  followUpNumber: z.number().int().min(0).optional(),
  suggestedTactic: z.string().optional(),
  leadResponseType: z.string().optional(),
  customInstructions: z.string().optional(),
  leadId: z.string().optional(),
  userPrompt: z.string().optional(),
});

export const ChatWsClientCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ping"),
    payload: z.object({}).optional(),
  }),

  z.object({
    type: z.literal("leadSearch.prompt.parse"),
    payload: z.object({
      clientMessageId: ClientMessageIdSchema,
      text: z.string().trim().min(1).max(4000),
    }),
  }),

  z.object({
    type: z.literal("leadSearch.prompt.apply"),
    payload: z.object({
      clientMessageId: ClientMessageIdSchema,
      query: QueryWithOptionalLimitSchema,

      // Legacy shape: limit is top-level. Still accepted for backwards compatibility.
      limit: z.coerce.number().int().min(1).max(50_000).optional(),

      parser: ChatParserIdSchema.nullable().optional(),
      kind: z.enum(LeadSearchKind).nullable().optional(),

      parsedMessageId: z.string().optional(),
    }),
  }),

  z.object({
    type: z.literal("outreach.prompt.parse"),
    payload: z.object({
      clientMessageId: ClientMessageIdSchema,
      text: z.string().trim().min(1).max(4000),
      directoryId: z.string().min(1),
      suggestedChannel: OutreachChannelSchema.optional(),
    }),
  }),

  z.object({
    type: z.literal("outreach.prompt.apply"),
    payload: z.object({
      clientMessageId: ClientMessageIdSchema,
      context: OutreachContextSchema,
      parsedMessageId: z.string().optional(),
      defaultDirectoryIds: z.array(z.string().min(1)).optional(),
    }),
  }),

  z.object({
    type: z.literal("assistant.stream"),
    payload: z.object({
      clientMessageId: ClientMessageIdSchema,
      text: z.string().trim().min(1).max(4000),

      // optional: UI can pre-scope directories; will be overridden by @mentions (hard filter)
      defaultDirectoryIds: z.array(z.string().min(1)).optional(),

      // Chat mode: ASSISTANCE or OUTREACH
      mode: ChatModeSchema,
    }),
  }),
]);

export type ChatWsClientCommand = z.infer<typeof ChatWsClientCommandSchema>;

// Server -> client events (typed for wsSend/realtime)
export type ChatWsServerEvent =
  | { type: "thread.ready"; payload: { threadId: string; serverTime: string } }
  | { type: "ack"; payload: { ok: boolean; clientMessageId?: string | null } }
  | {
    type: "error";
    payload: { code: string; message: string; details?: unknown };
  }
  | {
    type: "message.created";
    payload: { message: unknown };
  }
  | {
    type: "assistant.started";
    payload: {
      requestId: string;
      clientMessageId?: string | null;
      userMessageId: string;
    };
  }
  | {
    type: "assistant.delta";
    payload: {
      requestId: string;
      clientMessageId?: string | null;
      delta: string;
    };
  }
  | {
    type: "assistant.final";
    payload: {
      requestId: string;
      clientMessageId?: string | null;
      assistantMessageId: string;
    };
  }
  | {
    type: "assistant.error";
    payload: {
      requestId: string;
      clientMessageId?: string | null;
      code: string;
      message: string;
      retryable?: boolean;
    };
  };
