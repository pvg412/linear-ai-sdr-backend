import { z } from "zod";
import { LeadSearchKind } from "@prisma/client";

import { ChatParserIdSchema } from "../parsers/chat.parsers";

const ClientMessageIdSchema = z.string().min(1).max(64).optional();

const QueryWithOptionalLimitSchema = z
  .looseObject({
    // New shape: limit is inside query
    limit: z.coerce.number().int().min(1).max(50_000).optional(),
  })

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
    type: z.literal("assistant.stream"),
    payload: z.object({
      clientMessageId: ClientMessageIdSchema,
      text: z.string().trim().min(1).max(4000),

      // optional: UI can pre-scope directories; will be overridden by @mentions (hard filter)
      defaultDirectoryIds: z.array(z.string().min(1)).optional(),
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
    payload: { requestId: string; clientMessageId?: string | null; userMessageId: string };
  }
  | {
    type: "assistant.delta";
    payload: { requestId: string; clientMessageId?: string | null; delta: string };
  }
  | {
    type: "assistant.final";
    payload: { requestId: string; clientMessageId?: string | null; assistantMessageId: string };
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
