import { inject, injectable } from "inversify";
import { randomUUID } from "crypto";
import { ChatMessageRole, ChatMessageType, Prisma } from "@prisma/client";

import { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { AI_GRPC_CLIENT_TYPES } from "@/infra/ai-grpc-client/ai-grpc-client.types";

import { ChatRepository } from "../persistence/chat.repository";
import { CHAT_TYPES } from "../chat.types";

import { extractFolderMentions } from "../utils/folder-mentions";
import { sanitizeMessageToPublic } from "../parsers/chat.parsers";

import { RealtimeHub } from "@/infra/realtime/realtimeHub";
import { REALTIME_TYPES } from "@/infra/realtime/realtime.types";

import type {
	ChatStreamEvent,
	ChatStreamRequest,
} from "@/generated/aisdr/v1/ai_sdr";
import {
	ChatMessageRole as PbRole,
	ChatMessageType as PbType,
} from "@/generated/aisdr/v1/ai_sdr";

import { LEAD_DIRECTORY_TYPES } from "@/modules/lead-directory/lead-directory.types";
import type {
	LeadDirectoryMentionResolver,
	ResolveMentionsResult,
} from "@/modules/lead-directory/services/lead-directory-mention-resolver.service";

type Json = Prisma.InputJsonValue;
type UnknownRecord = Record<string, unknown>;

type Citation = {
	documentId: string;
	leadId?: string;
	directoryId?: string;
	score?: number;
	snippet?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readString(
	obj: Record<string, unknown>,
	key: string
): string | undefined {
	const v = obj[key];
	return typeof v === "string" ? v : undefined;
}

function readNumber(
	obj: Record<string, unknown>,
	key: string
): number | undefined {
	const v = obj[key];
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseCitations(itemsUnknown: unknown): Citation[] {
	if (!Array.isArray(itemsUnknown)) return [];

	const out: Citation[] = [];
	for (const it of itemsUnknown) {
		if (!isRecord(it)) continue;

		const documentId =
			readString(it, "documentId") ?? readString(it, "document_id");
		if (!documentId) continue;

		const leadId = readString(it, "leadId") ?? readString(it, "lead_id");
		const directoryId =
			readString(it, "directoryId") ?? readString(it, "directory_id");
		const score = readNumber(it, "score");
		const snippet = readString(it, "snippet");

		out.push({ documentId, leadId, directoryId, score, snippet });
	}

	return out;
}

function getEventPayload(ev: ChatStreamEvent): {
	kind: string;
	data?: Record<string, unknown>;
} {
	const u: unknown = ev;
	if (!isRecord(u)) return { kind: "unknown" };

	// oneof=unions => ev.payload?.$case
	const payload = u["payload"];
	if (isRecord(payload)) {
		const kase = payload["$case"];
		if (typeof kase === "string") {
			const dataUnknown = payload[kase];
			return isRecord(dataUnknown)
				? { kind: kase, data: dataUnknown }
				: { kind: kase };
		}
	}

	// oneof=properties fallback
	for (const k of [
		"ack",
		"token",
		"retrieval",
		"final",
		"error",
		"heartbeat",
	]) {
		const maybe = u[k];
		if (isRecord(maybe)) return { kind: k, data: maybe };
	}

	return { kind: "unknown" };
}

function formatMentionError(res: ResolveMentionsResult): {
	code: string;
	message: string;
} {
	if (res.ambiguous.length > 0) {
		return {
			code: "CHAT_DIRECTORY_MENTION_AMBIGUOUS",
			message: `Ambiguous folder mention(s): ${res.ambiguous
				.map((m) => `@${m}`)
				.join(", ")}. Rename folders or mention by directory id.`,
		};
	}
	if (res.missing.length > 0) {
		return {
			code: "CHAT_DIRECTORY_MENTION_NOT_FOUND",
			message: `Unknown folder mention(s): ${res.missing
				.map((m) => `@${m}`)
				.join(", ")}. Create the folder or remove the mention.`,
		};
	}
	return {
		code: "CHAT_DIRECTORY_MENTION_ERROR",
		message: "Failed to resolve folder mentions.",
	};
}

@injectable()
export class ChatAiStreamService {
	constructor(
		@inject(AI_GRPC_CLIENT_TYPES.AiGrpcClient)
		private readonly ai: AiGrpcClient,

		@inject(CHAT_TYPES.ChatRepository)
		private readonly chatRepo: ChatRepository,

		@inject(REALTIME_TYPES.RealtimeHub)
		private readonly realtimeHub: RealtimeHub,

		@inject(LEAD_DIRECTORY_TYPES.LeadDirectoryMentionResolver)
		private readonly dirResolver: LeadDirectoryMentionResolver
	) {}

	async streamAssistantReply(input: {
		userId: string;
		threadId: string;
		text: string;

		clientMessageId?: string;
		defaultDirectoryIds?: string[];

		signal?: AbortSignal;
	}): Promise<void> {
		const requestId = randomUUID();
		const workspaceId = input.userId;

		// 1) persist USER message
		const userMsg = await this.chatRepo.createMessage({
			ownerId: input.userId,
			threadId: input.threadId,
			role: ChatMessageRole.USER,
			type: ChatMessageType.TEXT,
			text: input.text,
			payload: null,
			authorUserId: input.userId,
		});

		this.realtimeHub.broadcast(input.threadId, {
			type: "message.created",
			payload: {
				message: sanitizeMessageToPublic(userMsg as unknown as UnknownRecord),
			},
		});

		// 2) @folder => directoryIds (HARD FILTER)
		const { cleanedText, mentions } = extractFolderMentions(input.text);

		let directoryIds: string[] = input.defaultDirectoryIds ?? [];

		if (mentions.length > 0) {
			const resolved = await this.dirResolver.resolve(input.userId, mentions);

			if (resolved.ambiguous.length > 0 || resolved.missing.length > 0) {
				const err = formatMentionError(resolved);

				const errMsg = await this.chatRepo.createMessage({
					ownerId: input.userId,
					threadId: input.threadId,
					role: ChatMessageRole.ASSISTANT,
					type: ChatMessageType.EVENT,
					text: err.message,
					payload: {
						event: "chat.directory.scope.error",
						requestId,
						code: err.code,
						missing: resolved.missing,
						ambiguous: resolved.ambiguous,
						mentions,
					} as unknown as Json,
					authorUserId: null,
				});

				this.realtimeHub.broadcast(input.threadId, {
					type: "message.created",
					payload: {
						message: sanitizeMessageToPublic(
							errMsg as unknown as UnknownRecord
						),
					},
				});

				this.realtimeHub.broadcast(input.threadId, {
					type: "assistant.error",
					payload: {
						requestId,
						clientMessageId: input.clientMessageId ?? null,
						code: err.code,
						message: err.message,
						retryable: false,
					},
				});

				return;
			}

			directoryIds = resolved.directoryIds;
		}

    const LIMIT_MESSAGES_FOR_AI = 15;

		const history = await this.chatRepo.listRecentMessagesForAi(
			input.userId,
			input.threadId,
			LIMIT_MESSAGES_FOR_AI
		);

		const pbHistory = history
			.filter(
				(m) =>
					m.type === ChatMessageType.TEXT &&
					typeof m.text === "string" &&
					m.text.trim().length > 0
			)
			.map((m) => ({
				messageId: m.id,
				role:
					m.role === ChatMessageRole.USER
						? PbRole.CHAT_MESSAGE_ROLE_USER
						: PbRole.CHAT_MESSAGE_ROLE_ASSISTANT,
				type: PbType.CHAT_MESSAGE_TYPE_TEXT,
				text: m.text ?? "",
				createdAtMs: String(Date.parse(m.createdAt)),
			}));

		const req: ChatStreamRequest = {
			requestId,
			workspaceId,
			threadId: input.threadId,
			userId: input.userId,

			userMessage: {
				messageId: userMsg.id,
				role: PbRole.CHAT_MESSAGE_ROLE_USER,
				type: PbType.CHAT_MESSAGE_TYPE_TEXT,
				text: cleanedText.length > 0 ? cleanedText : input.text,
				createdAtMs: String(Date.now()),
			},

			history: pbHistory,

			context: {
				directoryIds,
				leadIds: [],
				leadSearchId: "",
			},

			retrieval: {
				k: 5,
				minScore: 0,
				maxChunksPerLead: 3,
				maxContextChars: 4000,
			},

			generation: {
				model: "gpt-5-mini",
				temperature: 1,
				maxOutputTokens: 1000,
				jsonMode: false,
				language: "en",
			},

			debug: false,
		};

		// ✅ notify start
		this.realtimeHub.broadcast(input.threadId, {
			type: "assistant.started",
			payload: {
				requestId,
				clientMessageId: input.clientMessageId ?? null,
				userMessageId: userMsg.id,
			},
		});

		// 4) stream
		let accText = "";
		let lastCitations: Citation[] = [];
		let finalized = false;

		// delta batching (so you don’t spam WS per-token)
		let pendingDelta = "";
		let lastFlushAt = Date.now();
		const flush = () => {
			const delta = pendingDelta;
			if (!delta) return;
			pendingDelta = "";
			lastFlushAt = Date.now();

			this.realtimeHub.broadcast(input.threadId, {
				type: "assistant.delta",
				payload: {
					requestId,
					clientMessageId: input.clientMessageId ?? null,
					delta,
				},
			});
		};

		try {
			for await (const ev of this.ai.chatStream(req, {
				signal: input.signal,
			})) {
				const p = getEventPayload(ev);

				if (p.kind === "token" && p.data) {
					const delta = readString(p.data, "text") ?? "";
					if (delta) {
						accText += delta;
						pendingDelta += delta;

						const now = Date.now();
						// flush at ~50ms or if big chunk
						if (pendingDelta.length >= 64 || now - lastFlushAt >= 50) {
							flush();
						}
					}
					continue;
				}

				if (p.kind === "retrieval" && p.data) {
					lastCitations = parseCitations(p.data["items"]);
					continue;
				}

				if (p.kind === "final" && p.data && !finalized) {
					finalized = true;

					flush();

					const text = readString(p.data, "text") ?? accText;

					const citations = parseCitations(p.data["citations"]);
					const finalCitations =
						citations.length > 0 ? citations : lastCitations;

					const assistantMsg = await this.chatRepo.createMessage({
						ownerId: input.userId,
						threadId: input.threadId,
						role: ChatMessageRole.ASSISTANT,
						type: ChatMessageType.TEXT,
						text,
						payload: { citations: finalCitations } as unknown as Json,
						authorUserId: null,
					});

					this.realtimeHub.broadcast(input.threadId, {
						type: "message.created",
						payload: {
							message: sanitizeMessageToPublic(
								assistantMsg as unknown as UnknownRecord
							),
						},
					});

					this.realtimeHub.broadcast(input.threadId, {
						type: "assistant.final",
						payload: {
							requestId,
							clientMessageId: input.clientMessageId ?? null,
							assistantMessageId: assistantMsg.id,
						},
					});

					continue;
				}

				if (p.kind === "error" && p.data && !finalized) {
					finalized = true;

					flush();

					const code = readString(p.data, "code") ?? "AI_STREAM_ERROR";
					const message = readString(p.data, "message") ?? "AI stream error";
					const retryable = Boolean(p.data["retryable"]);

					const errMsg = await this.chatRepo.createMessage({
						ownerId: input.userId,
						threadId: input.threadId,
						role: ChatMessageRole.ASSISTANT,
						type: ChatMessageType.EVENT,
						text: message,
						payload: {
							event: "assistant.error",
							requestId,
							code,
							retryable,
						} as unknown as Json,
						authorUserId: null,
					});

					this.realtimeHub.broadcast(input.threadId, {
						type: "message.created",
						payload: {
							message: sanitizeMessageToPublic(
								errMsg as unknown as UnknownRecord
							),
						},
					});

					this.realtimeHub.broadcast(input.threadId, {
						type: "assistant.error",
						payload: {
							requestId,
							clientMessageId: input.clientMessageId ?? null,
							code,
							message,
							retryable,
						},
					});

					continue;
				}
			}

			// flush leftovers if stream ends without final (rare)
			if (!finalized) flush();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);

			const errMsg = await this.chatRepo.createMessage({
				ownerId: input.userId,
				threadId: input.threadId,
				role: ChatMessageRole.ASSISTANT,
				type: ChatMessageType.EVENT,
				text: msg,
				payload: {
					event: "assistant.error",
					requestId,
					code: "INTERNAL",
				} as unknown as Json,
				authorUserId: null,
			});

			this.realtimeHub.broadcast(input.threadId, {
				type: "message.created",
				payload: {
					message: sanitizeMessageToPublic(errMsg as unknown as UnknownRecord),
				},
			});

			this.realtimeHub.broadcast(input.threadId, {
				type: "assistant.error",
				payload: {
					requestId,
					clientMessageId: input.clientMessageId ?? null,
					code: "INTERNAL",
					message: msg,
					retryable: false,
				},
			});
		}
	}
}
