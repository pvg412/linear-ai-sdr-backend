// src/modules/chat/chat.routes.ts
import type { FastifyInstance, FastifyRequest } from "fastify";

import { UserFacingError } from "@/infra/userFacingError";
import { container } from "@/container";

import { CHAT_TYPES } from "./chat.types";
import { ChatCommandService } from "./chat.command.service";
import { ChatQueryService } from "./chat.queryService";

import {
	CursorPaginationSchema,
	ChatFolderCreateSchema,
	ChatFolderRenameSchema,
	ChatThreadCreateSchema,
	ChatThreadPatchSchema,
	ChatSendMessageSchema,
	ChatApplyJsonSchema,
} from "./chat.schemas";

import {
	ChatWsClientCommandSchema,
	type ChatWsServerEvent,
} from "./chat.ws.schemas";

import { REALTIME_TYPES } from "@/infra/realtime/realtime.types";
import { RealtimeHub } from "@/infra/realtime/realtimeHub";
import { safePreview } from "@/infra/observability";

import {
	sanitizeMessageToPublic,
	sanitizeThreadToPublic,
} from "./chat.parsers";

/**
 * Minimal WS connection shape we rely on.
 */
type ChatWsSocket = {
	readonly readyState: number;
	send(data: string): void;
	close(): void;
	on(event: "message", listener: (data: unknown) => void): void;
	on(event: "close" | "error", listener: (...args: unknown[]) => void): void;
};

type UnknownRecord = Record<string, unknown>;
function isRecord(v: unknown): v is UnknownRecord {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractWsSocket(conn: unknown): ChatWsSocket {
	const candidate = isRecord(conn) && "socket" in conn ? conn.socket : conn;

	if (!isRecord(candidate)) {
		const keys = isRecord(conn) ? Object.keys(conn) : [];
		throw new Error(`WS socket is not an object (connKeys=${keys.join(",")})`);
	}

	const send = candidate.send;
	const on = candidate.on;
	const close = candidate.close;
	const readyState = candidate.readyState;

	if (
		typeof send !== "function" ||
		typeof on !== "function" ||
		typeof close !== "function"
	) {
		const keys = Object.keys(candidate);
		throw new Error(`WS socket has invalid shape (keys=${keys.join(",")})`);
	}

	if (typeof readyState !== "number") {
		throw new Error("WS socket readyState is not a number");
	}

	return candidate as unknown as ChatWsSocket;
}

function requireUserId(req: FastifyRequest): string {
	const userId = req.user?.id;
	if (typeof userId === "string" && userId.length > 0) return userId;

	throw new UserFacingError({
		code: "UNAUTHORIZED",
		userMessage: "Unauthorized.",
	});
}

async function ensureUserId(req: FastifyRequest): Promise<string> {
	const existing = req.user?.id;
	if (typeof existing === "string" && existing.length > 0) return existing;

	const jwtVerify = (req as unknown as { jwtVerify?: () => Promise<void> })
		.jwtVerify;
	if (typeof jwtVerify === "function") {
		await jwtVerify();
	}

	const userId = req.user?.id;
	if (typeof userId === "string" && userId.length > 0) return userId;

	throw new UserFacingError({
		code: "UNAUTHORIZED",
		userMessage: "Unauthorized.",
	});
}

function wsSend(socket: ChatWsSocket, event: ChatWsServerEvent): void {
	try {
		socket.send(JSON.stringify(event));
	} catch {
		// ignore
	}
}

// Generic sanitizer for REST responses (threads/messages)
function sanitizeAny(v: unknown): unknown {
	if (Array.isArray(v)) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return v.map((x) => (isRecord(x) ? sanitizeThreadToPublic(x) : x));
	}
	if (!isRecord(v)) return v;

	// threads list
	if (
		Array.isArray(v.items) &&
		v.items.length &&
		isRecord(v.items[0]) &&
		("defaultProvider" in v.items[0] || "defaultParser" in v.items[0])
	) {
		return {
			...v,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			items: v.items.map((x) => (isRecord(x) ? sanitizeThreadToPublic(x) : x)),
		};
	}

	// messages list
	if (
		Array.isArray(v.items) &&
		v.items.length &&
		isRecord(v.items[0]) &&
		"payload" in v.items[0]
	) {
		return {
			...v,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			items: v.items.map((x) => (isRecord(x) ? sanitizeMessageToPublic(x) : x)),
		};
	}

	// single thread
	if ("defaultProvider" in v) return sanitizeThreadToPublic(v);

	return v;
}

const chatQueryService = container.get<ChatQueryService>(
	CHAT_TYPES.ChatQueryService
);
const chatCommandService = container.get<ChatCommandService>(
	CHAT_TYPES.ChatCommandService
);
const realtimeHub = container.get<RealtimeHub>(REALTIME_TYPES.RealtimeHub);

export function registerChatRoutes(app: FastifyInstance): void {
	// -------------------------
	// REST: Folders
	// -------------------------
	app.get("/chat/folders", async (req) => {
		const userId = requireUserId(req);
		return chatQueryService.listFolders(userId);
	});

	app.post("/chat/folders", async (req) => {
		const userId = requireUserId(req);
		const dto = ChatFolderCreateSchema.parse(req.body);
		return chatCommandService.createFolder(userId, dto.name);
	});

	app.patch("/chat/folders/:folderId", async (req) => {
		const userId = requireUserId(req);
		const params = req.params as { folderId: string };
		const dto = ChatFolderRenameSchema.parse(req.body);
		return chatCommandService.renameFolder(userId, params.folderId, dto.name);
	});

	app.delete("/chat/folders/:folderId", async (req) => {
		const userId = requireUserId(req);
		const params = req.params as { folderId: string };
		return chatCommandService.deleteFolder(userId, params.folderId);
	});

	// -------------------------
	// REST: Threads
	// -------------------------
	app.get("/chat/threads", async (req) => {
		const userId = requireUserId(req);
		const folderId = (req.query as { folderId?: string } | undefined)?.folderId;
		const folder =
			typeof folderId === "string" && folderId.length > 0
				? folderId
				: undefined;

		const res = await chatQueryService.listThreads(userId, folder);
		return sanitizeAny(res);
	});

	app.post("/chat/threads", async (req) => {
		const userId = requireUserId(req);
		const dto = ChatThreadCreateSchema.parse(req.body);

		const res = await chatCommandService.createThread(userId, {
			folderId: dto.folderId,
			title: dto.title,
			defaultParser: dto.defaultParser ?? undefined,
			defaultKind: dto.defaultKind ?? undefined,
		});

		return sanitizeAny(res);
	});

	app.get("/chat/threads/:threadId", async (req) => {
		const userId = requireUserId(req);
		const params = req.params as { threadId: string };

		const res = await chatQueryService.getThread(userId, params.threadId);
		return sanitizeAny(res);
	});

	app.patch("/chat/threads/:threadId", async (req) => {
		const userId = requireUserId(req);
		const params = req.params as { threadId: string };
		const dto = ChatThreadPatchSchema.parse(req.body);

		const res = await chatCommandService.patchThread(userId, params.threadId, {
			folderId: dto.folderId,
			title: dto.title,
			defaultParser: dto.defaultParser ?? undefined,
			defaultKind: dto.defaultKind ?? undefined,
		});

		return sanitizeAny(res);
	});

	app.delete("/chat/threads/:threadId", async (req) => {
		const userId = requireUserId(req);
		const params = req.params as { threadId: string };
		return chatCommandService.deleteThread(userId, params.threadId);
	});

	// -------------------------
	// REST: Messages history
	// -------------------------
	app.get("/chat/threads/:threadId/messages", async (req) => {
		const userId = requireUserId(req);
		const params = req.params as { threadId: string };
		const q = CursorPaginationSchema.parse(req.query);

		const res = await chatQueryService.listMessages(userId, params.threadId, {
			limit: q.limit,
			cursor: q.cursor,
		});

		return sanitizeAny(res);
	});

	app.post("/chat/threads/:threadId/messages", async (req) => {
		const userId = requireUserId(req);
		const params = req.params as { threadId: string };
		const dto = ChatSendMessageSchema.parse(req.body);

		const res = await chatCommandService.sendMessage(
			userId,
			params.threadId,
			dto
		);
		return {
			...res,
			userMessage: sanitizeMessageToPublic(
				res.userMessage as unknown as UnknownRecord
			),
			assistantMessage: sanitizeMessageToPublic(
				res.assistantMessage as unknown as UnknownRecord
			),
		};
	});

	app.post("/chat/threads/:threadId/apply", async (req) => {
		const userId = requireUserId(req);
		const params = req.params as { threadId: string };
		const dto = ChatApplyJsonSchema.parse(req.body);

		const res = await chatCommandService.applyJson(
			userId,
			params.threadId,
			dto
		);
		return {
			...res,
			userJsonMessage: sanitizeMessageToPublic(
				res.userJsonMessage as unknown as UnknownRecord
			),
			eventMessage: sanitizeMessageToPublic(
				res.eventMessage as unknown as UnknownRecord
			),
		};
	});

	// -------------------------
	// WS: realtime chat
	// -------------------------
	app.get("/ws/chat/threads/:threadId", { websocket: true }, (conn, req) => {
		let socket: ChatWsSocket | null = null;

		try {
			socket = extractWsSocket(conn);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.warn("[ws/chat] failed to extract socket", { message: msg });
			return;
		}

		const connId = `${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 7)}`;
		const tag = `[ws/chat ${connId}]`;

		console.log(tag, "connection accepted");

		void (async () => {
			const userId = await ensureUserId(req);
			const params = req.params as { threadId: string };
			const threadId = params.threadId;

			// Access check
			await chatQueryService.getThread(userId, threadId);

			realtimeHub.subscribe(threadId, socket);

			wsSend(socket, {
				type: "thread.ready",
				payload: { threadId, serverTime: new Date().toISOString() },
			});

			socket.on("message", (buf: unknown) => {
				void (async () => {
					let parsed: unknown;
					try {
						const txt = Buffer.isBuffer(buf)
							? buf.toString("utf8")
							: String(buf);

						console.log(tag, "incoming message raw", {
							isBuffer: Buffer.isBuffer(buf),
							length: txt.length,
							preview: safePreview(txt),
						});

						parsed = JSON.parse(txt);
					} catch {
						wsSend(socket, {
							type: "error",
							payload: { code: "BAD_JSON", message: "Invalid JSON." },
						});
						return;
					}

					const cmd = ChatWsClientCommandSchema.safeParse(parsed);
					if (!cmd.success) {
						wsSend(socket, {
							type: "error",
							payload: {
								code: "BAD_COMMAND",
								message: "Invalid WS command schema.",
								details: cmd.error.issues,
							},
						});
						return;
					}

					if (cmd.data.type === "ping") {
						wsSend(socket, { type: "ack", payload: { ok: true } });
						return;
					}

					if (cmd.data.type === "message.send") {
						const result = await chatCommandService.sendMessage(
							userId,
							threadId,
							cmd.data.payload
						);

						realtimeHub.broadcast(threadId, {
							type: "message.created",
							payload: {
								message: sanitizeMessageToPublic(
									result.userMessage as unknown as UnknownRecord
								),
							},
						});

						realtimeHub.broadcast(threadId, {
							type: "message.created",
							payload: {
								message: sanitizeMessageToPublic(
									result.assistantMessage as unknown as UnknownRecord
								),
							},
						});

						wsSend(socket, {
							type: "ack",
							payload: {
								ok: true,
								clientMessageId: cmd.data.payload.clientMessageId ?? undefined,
							},
						});
						return;
					}

					if (cmd.data.type === "json.apply") {
						const result = await chatCommandService.applyJson(
							userId,
							threadId,
							cmd.data.payload
						);

						realtimeHub.broadcast(threadId, {
							type: "message.created",
							payload: {
								message: sanitizeMessageToPublic(
									result.userJsonMessage as unknown as UnknownRecord
								),
							},
						});

						realtimeHub.broadcast(threadId, {
							type: "message.created",
							payload: {
								message: sanitizeMessageToPublic(
									result.eventMessage as unknown as UnknownRecord
								),
							},
						});

						wsSend(socket, {
							type: "ack",
							payload: {
								ok: true,
								clientMessageId: cmd.data.payload.clientMessageId ?? null,
							},
						});

						return;
					}
				})().catch((err) => {
					const msg = err instanceof Error ? err.message : String(err);
					console.error(tag, "handler error", { message: msg });
					wsSend(socket, {
						type: "error",
						payload: { code: "INTERNAL", message: msg },
					});
				});
			});
		})().catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);

			wsSend(socket, {
				type: "error",
				payload: { code: "UNAUTHORIZED", message: msg },
			});

			try {
				socket.close();
			} catch {
				// ignore
			}
		});
	});
}
