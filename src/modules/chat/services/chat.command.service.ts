// src/modules/chat/chat.command.service.ts
import { inject, injectable } from "inversify";
import {
	ChatMessageRole,
	ChatMessageType,
	LeadSearchKind,
	Prisma,
} from "@prisma/client";

import { UserFacingError } from "@/infra/userFacingError";
import { ChatRepository } from "../persistence/chat.repository";
import { CHAT_TYPES } from "../chat.types";
import type {
	ChatApplyJsonDto,
	ChatSendMessageDto,
	SendMessageResultDto,
	ApplyJsonResultDto,
	ChatPromptParser,
} from "../schemas/chat.dto";
import { LEAD_SEARCH_TYPES } from "@/modules/lead-search/lead-search.types";
import { LeadSearchRunnerService } from "@/modules/lead-search/lead-search.runner.service";
import {
	resolveInternalFromParserId,
	resolveParserIdFromProvider,
	resolveParserLabelFromProvider,
	type ChatParserId,
} from "../parsers/chat.parsers";

type Json = Prisma.InputJsonValue;

@injectable()
export class ChatCommandService {
	constructor(
		@inject(CHAT_TYPES.ChatRepository)
		private readonly chatRepository: ChatRepository,

		@inject(CHAT_TYPES.ChatPromptParser)
		private readonly chatPromptParser: ChatPromptParser,

		@inject(LEAD_SEARCH_TYPES.LeadSearchRunnerService)
		private readonly leadSearchRunnerService: LeadSearchRunnerService
	) {}

	async createThread(
		userId: string,
		input: {
			title?: string;
			defaultParser?: ChatParserId | null;
			defaultKind?: LeadSearchKind | null;
		}
	) {
		const parser = input.defaultParser ?? undefined;
		const requestedKind = input.defaultKind ?? undefined;

		if (requestedKind && !parser) {
			throw new UserFacingError({
				code: "CHAT_THREAD_DEFAULTS_MISSING",
				userMessage: "defaultKind cannot be set without defaultParser.",
			});
		}

		if (!parser) {
			// allow thread without defaults (UI can set later)
			return this.chatRepository.createThread({
				ownerId: userId,
				title: input.title,
				defaultProvider: undefined,
				defaultKind: undefined,
			});
		}

		const r = resolveInternalFromParserId(parser);
		const kind = requestedKind ?? r.allowedKinds[0];

		if (!kind) {
			throw new UserFacingError({
				code: "CHAT_PARSER_NOT_CONFIGURED",
				userMessage: "Parser has no allowed kinds configured.",
				debugMessage: `Parser ${r.parser} has empty allowedKinds`,
			});
		}

		if (!r.allowedKinds.includes(kind)) {
			throw new UserFacingError({
				code: "CHAT_PARSER_KIND_NOT_ALLOWED",
				userMessage: "Selected parser does not support this method.",
				debugMessage: `Parser=${
					r.parser
				} kind=${kind} not in allowedKinds=${r.allowedKinds.join(",")}`,
			});
		}

		return this.chatRepository.createThread({
			ownerId: userId,
			title: input.title,
			defaultProvider: r.provider,
			defaultKind: kind,
		});
	}

	async patchThread(
		userId: string,
		threadId: string,
		patch: {
			title?: string | null;
			defaultParser?: ChatParserId | null;
			defaultKind?: LeadSearchKind | null;
		}
	) {
		const thread = await this.chatRepository.getThread(userId, threadId);

		const wantsParserChange = patch.defaultParser !== undefined;
		const wantsKindChange = patch.defaultKind !== undefined;

		// Start with existing internal values
		let provider = thread.defaultProvider ?? null;
		let kind = thread.defaultKind ?? null;

		if (wantsParserChange) {
			if (patch.defaultParser == null) {
				// Clear both to avoid inconsistent state
				provider = null;
				kind = null;
			} else {
				const r = resolveInternalFromParserId(patch.defaultParser);
				provider = r.provider;

				const nextKind =
					(wantsKindChange ? patch.defaultKind : kind) ?? r.allowedKinds[0];

				if (!nextKind) {
					throw new UserFacingError({
						code: "CHAT_PARSER_NOT_CONFIGURED",
						userMessage: "Parser has no allowed kinds configured.",
					});
				}

				if (!r.allowedKinds.includes(nextKind)) {
					throw new UserFacingError({
						code: "CHAT_PARSER_KIND_NOT_ALLOWED",
						userMessage: "Selected parser does not support this method.",
					});
				}

				kind = nextKind;
			}
		} else if (wantsKindChange) {
			// kind change without parser change
			if (!provider) {
				throw new UserFacingError({
					code: "CHAT_THREAD_DEFAULTS_MISSING",
					userMessage: "defaultKind cannot be set without defaultParser.",
				});
			}
			kind = patch.defaultKind ?? null;
		}

		return this.chatRepository.patchThread(userId, threadId, {
			title: patch.title,

			// internal persisted
			defaultProvider: provider,
			defaultKind: kind,
		});
	}

	async deleteThread(userId: string, threadId: string) {
		return this.chatRepository.deleteThread(userId, threadId);
	}

	/**
	 * USER sends TEXT -> ASSISTANT returns JSON payload { parser, kind, limit, query }
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
					"Thread has no default parser/method. UI must set Parser + Method before sending messages.",
			});
		}

		const parser = resolveParserIdFromProvider(provider);
		const parserLabel = resolveParserLabelFromProvider(provider) ?? undefined;

		if (!parser) {
			throw new UserFacingError({
				code: "CHAT_PARSER_NOT_CONFIGURED",
				userMessage: "Selected parser is not configured on server.",
				debugMessage: `No public parser mapping for provider=${provider}`,
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
			parser,
			...(parserLabel ? { parserLabel } : {}),
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
			parsed: { query: parsed.query, suggestedLimit: limit },
		};
	}

	/**
	 * USER applies JSON => create LeadSearch + EVENT "leadSearch.started" (public only)
	 */
	async applyJson(
		userId: string,
		threadId: string,
		dto: ChatApplyJsonDto
	): Promise<ApplyJsonResultDto> {
		const thread = await this.chatRepository.getThread(userId, threadId);

		const requestedParser = dto.parser ?? undefined;
		const requestedKind = dto.kind ?? undefined;

		let provider = thread.defaultProvider ?? null;
		let kind = thread.defaultKind ?? null;

		if (requestedParser) {
			const r = resolveInternalFromParserId(requestedParser);
			provider = r.provider;

			const nextKind = requestedKind ?? kind ?? r.allowedKinds[0] ?? null;
			if (!nextKind) {
				throw new UserFacingError({
					code: "CHAT_THREAD_DEFAULTS_MISSING",
					userMessage: "Method (kind) is missing. Select parser/method again.",
				});
			}
			if (!r.allowedKinds.includes(nextKind)) {
				throw new UserFacingError({
					code: "CHAT_PARSER_KIND_NOT_ALLOWED",
					userMessage: "Selected parser does not support this method.",
				});
			}
			kind = nextKind;
		} else if (requestedKind) {
			if (!provider) {
				throw new UserFacingError({
					code: "CHAT_THREAD_DEFAULTS_MISSING",
					userMessage: "Parser is missing. Select parser first.",
				});
			}
			kind = requestedKind;
		}

		if (!provider || !kind) {
			throw new UserFacingError({
				code: "CHAT_THREAD_DEFAULTS_MISSING",
				userMessage:
					"Parser/method is missing. UI must provide it or set thread defaults.",
			});
		}

		const parser = resolveParserIdFromProvider(provider);
		const parserLabel = resolveParserLabelFromProvider(provider) ?? undefined;

		if (!parser) {
			throw new UserFacingError({
				code: "CHAT_PARSER_NOT_CONFIGURED",
				userMessage: "Selected parser is not configured on server.",
				debugMessage: `No public parser mapping for provider=${provider}`,
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
				parser,
				...(parserLabel ? { parserLabel } : {}),
				kind,
				parsedMessageId: dto.parsedMessageId ?? null,
			} as unknown as Json,
			authorUserId: null,
			leadSearchId: leadSearch.id,
		});

		this.leadSearchRunnerService.dispatch(leadSearch.id, userId);

		return { leadSearchId: leadSearch.id, userJsonMessage, eventMessage };
	}
}
