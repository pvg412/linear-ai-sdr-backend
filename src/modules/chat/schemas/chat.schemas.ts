import { z } from "zod";
import { LeadSearchKind } from "@prisma/client";

import { ChatParserIdSchema } from "../parsers/chat.parsers";

export const CursorPaginationSchema = z.object({
	limit: z.coerce.number().int().min(1).max(200).default(50),
	cursor: z.cuid().optional(),
});

export const ChatThreadCreateSchema = z.object({
	title: z.string().trim().min(1).max(120).optional(),

	defaultParser: ChatParserIdSchema.nullable().optional(),
	defaultKind: z.enum(LeadSearchKind).nullable().optional(),
});

export const ChatThreadPatchSchema = z.object({
	title: z.string().trim().min(1).max(120).nullable().optional(),

	defaultParser: ChatParserIdSchema.nullable().optional(),
	defaultKind: z.enum(LeadSearchKind).nullable().optional(),
});

export const ChatSendMessageSchema = z.object({
	text: z.string().trim().min(1).max(4000),
});

export const ChatApplyJsonSchema = z.object({
	query: z.record(z.string(), z.unknown()),
	limit: z.coerce.number().int().min(1).max(50_000),

	parser: ChatParserIdSchema.nullable().optional(),
	kind: z.enum(LeadSearchKind).nullable().optional(),

	parsedMessageId: z.cuid().optional(),
});
