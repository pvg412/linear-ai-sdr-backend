import { z } from "zod";
import { LeadProvider, LeadSearchKind } from "@prisma/client";

import { ChatSendMessageSchema } from "./chat.schemas";

export const ChatWsJsonApplyPayloadSchema = z.object({
  clientMessageId: z.string().min(1),

  query: z.record(z.string(), z.unknown()),
  limit: z.coerce.number().int().min(1).max(50_000),

  provider: z.enum(LeadProvider).optional(),
  kind: z.enum(LeadSearchKind).optional(),

  parsedMessageId: z.cuid().optional(),
});

/**
 * Client -> Server commands.
 * Keep it explicit and versionable.
 */
export const ChatWsClientCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ping"),
  }),

  z.object({
    type: z.literal("message.send"),
    payload: ChatSendMessageSchema.extend({
      clientMessageId: z.string().min(1).optional(),
    }),
  }),

  z.object({
    type: z.literal("json.apply"),
    payload: ChatWsJsonApplyPayloadSchema,
  }),
]);

export type ChatWsClientCommand = z.infer<typeof ChatWsClientCommandSchema>;

/**
 * Server -> Client events.
 * (No need to zod-validate on server side; we control output.)
 */
export type ChatWsServerEvent =
  | {
      type: "thread.ready";
      payload: { threadId: string; serverTime: string };
    }
  | {
      type: "message.created";
      payload: { messageId: string };
    }
  | {
      type: "ack";
      payload: { clientMessageId?: string; ok: true };
    }
  | {
      type: "error";
      payload: { code: string; message: string; details?: unknown };
    };
