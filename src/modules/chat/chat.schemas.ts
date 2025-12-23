import { z } from "zod";
import { LeadProvider, LeadSearchKind } from "@prisma/client";

export const CursorPaginationSchema = z.object({
	limit: z.coerce.number().int().min(1).max(200).default(50),
	cursor: z.cuid().optional(),
});

export const ChatFolderCreateSchema = z.object({
	name: z.string().trim().min(1).max(80),
});

export const ChatFolderRenameSchema = z.object({
	name: z.string().trim().min(1).max(80),
});

export const ChatThreadCreateSchema = z.object({
	folderId: z.cuid().optional(),
	title: z.string().trim().min(1).max(120).optional(),
	defaultProvider: z.enum(LeadProvider).optional(),
	defaultKind: z.enum(LeadSearchKind).optional(),
});

export const ChatThreadPatchSchema = z.object({
	folderId: z.cuid().nullable().optional(),
	title: z.string().trim().min(1).max(120).nullable().optional(),
	defaultProvider: z.enum(LeadProvider).nullable().optional(),
	defaultKind: z.enum(LeadSearchKind).nullable().optional(),
});

export const ChatSendMessageSchema = z.object({
	text: z.string().trim().min(1).max(4000),
});

export const ChatApplyJsonSchema = z.object({
	/**
	 * The final JSON that should be used for the search.
	 * UI can send either AI-produced JSON or user-edited JSON.
	 */
	query: z.record(z.string(), z.unknown()),
	/**
	 * Search limit to store inside LeadSearch.
	 */
	limit: z.coerce.number().int().min(1).max(50_000),
	/**
	 * If omitted, we will take thread defaults.
	 */
	provider: z.enum(LeadProvider).optional(),
	kind: z.enum(LeadSearchKind).optional(),

	/**
	 * Optional: link apply to a specific "parsed JSON" message.
	 */
	parsedMessageId: z.cuid().optional(),
});
