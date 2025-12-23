import { inject, injectable } from "inversify";
import {
	ChatMessageRole,
	ChatMessageType,
	LeadProvider,
	LeadSearchKind,
	Prisma,
} from "@prisma/client";

import { UserFacingError } from "@/infra/userFacingError";
import { ChatRepository } from "./chat.repository";
import { CHAT_TYPES } from "./chat.types";
import type {
	ChatApplyJsonDto,
	ChatSendMessageDto,
	SendMessageResultDto,
	ApplyJsonResultDto,
	ChatPromptParser,
} from "./chat.dto";
import { LEAD_SEARCH_TYPES } from "../lead-search/lead-search.types";
import { LeadSearchRunnerService } from "../lead-search/lead-search.runner.service";

type Json = Prisma.InputJsonValue;

@injectable()
export class ChatCommandService {
	constructor(
		@inject(CHAT_TYPES.ChatRepository)
		private readonly chatRepository: ChatRepository,

		@inject(CHAT_TYPES.ChatPromptParser)
		private readonly chatPromptParser: ChatPromptParser,
		@inject(LEAD_SEARCH_TYPES.LeadSearchRunnerService)
    private readonly leadSearchRunnerService: LeadSearchRunnerService,
	) {}

	async createFolder(userId: string, name: string) {
		return this.chatRepository.createFolder(userId, name);
	}

	async renameFolder(userId: string, folderId: string, name: string) {
		return this.chatRepository.renameFolder(userId, folderId, name);
	}

	async deleteFolder(userId: string, folderId: string) {
		return this.chatRepository.deleteFolder(userId, folderId);
	}

	async createThread(
		userId: string,
		input: {
			folderId?: string;
			title?: string;
			defaultProvider?: LeadProvider;
			defaultKind?: LeadSearchKind;
		}
	) {
		return this.chatRepository.createThread({
			ownerId: userId,
			folderId: input.folderId,
			title: input.title,
			defaultProvider: input.defaultProvider,
			defaultKind: input.defaultKind,
		});
	}

	async patchThread(
		userId: string,
		threadId: string,
		patch: {
			folderId?: string | null;
			title?: string | null;
			defaultProvider?: LeadProvider | null;
			defaultKind?: LeadSearchKind | null;
		}
	) {
		return this.chatRepository.patchThread(userId, threadId, patch);
	}

	async deleteThread(userId: string, threadId: string) {
		return this.chatRepository.deleteThread(userId, threadId);
	}

	/**
	 * Step 1 -> 2:
	 * - USER sends TEXT
	 * - ASSISTANT returns JSON payload { provider, kind, limit, query }
	 */
	async sendMessage(
		userId: string,
		threadId: string,
		dto: ChatSendMessageDto
	): Promise<SendMessageResultDto> {
		const thread = await this.chatRepository.getThread(userId, threadId);

		const provider = thread.defaultProvider ?? null;
		const kind = thread.defaultKind ?? null;

		if (!provider || !kind) {
			throw new UserFacingError({
				code: "CHAT_THREAD_DEFAULTS_MISSING",
				userMessage:
					"Thread has no default provider/kind. UI must set Parser Selector + Parser Method before sending messages.",
			});
		}

		const userMessage = await this.chatRepository.createMessage({
			ownerId: userId,
			threadId,
			role: ChatMessageRole.USER,
			type: ChatMessageType.TEXT,
			text: dto.text,
			payload: null,
			authorUserId: userId,
		});

		const parsed = await this.chatPromptParser.parsePrompt({
			text: dto.text,
			provider,
			kind,
		});

		const limit = parsed.suggestedLimit ?? 100;

		const assistantPayload = {
			provider,
			kind,
			limit,
			query: parsed.query,
		};

		const assistantMessage = await this.chatRepository.createMessage({
			ownerId: userId,
			threadId,
			role: ChatMessageRole.ASSISTANT,
			type: ChatMessageType.JSON,
			text: null,
			payload: assistantPayload as unknown as Json,
			authorUserId: null,
		});

		return {
			userMessage,
			assistantMessage,
			parsed: {
				query: parsed.query,
				suggestedLimit: limit,
			},
		};
	}

	/**
	 * Step 3 -> 4:
	 * - USER applies JSON => create LeadSearch
	 * - Store USER JSON message (audit)
	 * - Store ASSISTANT EVENT "We started searching..."
	 */
	async applyJson(
		userId: string,
		threadId: string,
		dto: ChatApplyJsonDto
	): Promise<ApplyJsonResultDto> {
		const thread = await this.chatRepository.getThread(userId, threadId);

		const provider = dto.provider ?? thread.defaultProvider ?? undefined;
		const kind = dto.kind ?? thread.defaultKind ?? undefined;

		if (!provider || !kind) {
			throw new UserFacingError({
				code: "CHAT_THREAD_DEFAULTS_MISSING",
				userMessage:
					"Provider/kind is missing. UI must provide it or set thread defaults.",
			});
		}

		const userJsonMessage = await this.chatRepository.createMessage({
			ownerId: userId,
			threadId,
			role: ChatMessageRole.USER,
			type: ChatMessageType.JSON,
			text: null,
			payload: dto.query as unknown as Json,
			authorUserId: userId,
		});

		const leadSearch = await this.chatRepository.createLeadSearchFromChat({
			createdById: userId,
			threadId,
			provider,
			kind,
			query: dto.query as unknown as Json,
			limit: dto.limit,
		});

		const eventMessage = await this.chatRepository.createMessage({
			ownerId: userId,
			threadId,
			role: ChatMessageRole.ASSISTANT,
			type: ChatMessageType.EVENT,
			text: "We started searching for leads.",
			payload: {
				event: "leadSearch.started",
				leadSearchId: leadSearch.id,
				provider,
				kind,
				parsedMessageId: dto.parsedMessageId ?? null,
			} as unknown as Json,
			authorUserId: null,
			leadSearchId: leadSearch.id,
		});

		this.leadSearchRunnerService.dispatch(leadSearch.id, userId);

		return {
			leadSearchId: leadSearch.id,
			userJsonMessage,
			eventMessage,
		};
	}
}
