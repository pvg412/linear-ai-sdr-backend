import { z } from "zod";
import { ChatSendMessageSchema, ChatApplyJsonSchema } from "./chat.schemas";

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
    payload: ChatApplyJsonSchema.extend({
      clientMessageId: z.string().min(1).optional(),
    }),
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
