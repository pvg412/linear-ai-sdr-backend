import {
	ChatMessageRole,
	ChatMessageType,
	LeadProvider,
	LeadSearchKind,
	Prisma,
} from "@prisma/client";
import type { z } from "zod";

import type {
	ChatFolderCreateSchema,
	ChatFolderRenameSchema,
	ChatThreadCreateSchema,
	ChatThreadPatchSchema,
	ChatSendMessageSchema,
	ChatApplyJsonSchema,
} from "./chat.schemas";

export type ChatFolderCreateDto = z.infer<typeof ChatFolderCreateSchema>;
export type ChatFolderRenameDto = z.infer<typeof ChatFolderRenameSchema>;

export type ChatThreadCreateDto = z.infer<typeof ChatThreadCreateSchema>;
export type ChatThreadPatchDto = z.infer<typeof ChatThreadPatchSchema>;

export type ChatSendMessageDto = z.infer<typeof ChatSendMessageSchema>;
export type ChatApplyJsonDto = z.infer<typeof ChatApplyJsonSchema>;

export interface ChatPromptParser {
	parsePrompt(input: {
		text: string;
		provider: LeadProvider;
		kind: LeadSearchKind;
	}): Promise<{
		/**
		 * Provider/capability-specific query payload that will be shown to the user.
		 * Must be JSON-serializable.
		 */
		query: Record<string, unknown>;
		/**
		 * Optional suggested limit (UI can override).
		 */
		suggestedLimit?: number;
	}>;
}

export interface ChatFolderDto {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
}

export interface ChatThreadDto {
	id: string;
	folderId: string | null;
	title: string | null;

	defaultProvider: string | null;
	defaultKind: string | null;

	lastMessageAt: string | null;

	createdAt: string;
	updatedAt: string;
}

export interface ChatMessageDto {
	id: string;
	threadId: string;

	role: ChatMessageRole;
	type: ChatMessageType;

	text: string | null;
	payload: Prisma.InputJsonValue | null;

	leadSearchId: string | null;

	createdAt: string;
	updatedAt: string;
}

export interface SendMessageResultDto {
	userMessage: ChatMessageDto;
	assistantMessage: ChatMessageDto;
	parsed: {
		query: Record<string, unknown>;
		suggestedLimit?: number;
	};
}

export interface ApplyJsonResultDto {
	leadSearchId: string;
	userJsonMessage: ChatMessageDto;
	eventMessage: ChatMessageDto;
}
