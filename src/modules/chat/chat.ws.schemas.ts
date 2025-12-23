import { z } from "zod";
import { LeadSearchKind } from "@prisma/client";

import { ChatParserIdSchema } from "./chat.parsers";

const ClientMessageIdSchema = z.string().min(1).max(64).optional();

export const ChatWsClientCommandSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("ping"),
		payload: z.object({}).optional(),
	}),
	z.object({
		type: z.literal("message.send"),
		payload: z.object({
			clientMessageId: ClientMessageIdSchema,
			text: z.string().trim().min(1).max(4000),
		}),
	}),
	z.object({
		type: z.literal("json.apply"),
		payload: z.object({
			clientMessageId: ClientMessageIdSchema,
			query: z.record(z.string(), z.unknown()),
			limit: z.coerce.number().int().min(1).max(50_000),

			parser: ChatParserIdSchema.nullable().optional(),
			kind: z.nativeEnum(LeadSearchKind).nullable().optional(),

			parsedMessageId: z.string().optional(),
		}),
	}),
]);

export type ChatWsClientCommand = z.infer<typeof ChatWsClientCommandSchema>;

export type ChatWsServerEvent =
	| { type: "thread.ready"; payload: { threadId: string; serverTime: string } }
	| { type: "ack"; payload: { ok: boolean; clientMessageId?: string | null } }
	| {
			type: "error";
			payload: { code: string; message: string; details?: unknown };
	  };
