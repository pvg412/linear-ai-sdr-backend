import type { FastifyInstance, FastifyRequest } from "fastify";

import { UserFacingError } from "@/infra/userFacingError";
import { container } from "@/container";

import { CHAT_TYPES } from "./chat.types";
import { ChatCommandService } from "./chat.commandService";
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

/**
 * Minimal WS connection shape we rely on.
 * We keep it structural to avoid type-resolution issues with @fastify/websocket/ws
 * that can cause `conn`/`conn.socket` to become a TS `error` type under ESLint.
 */
type ChatWsSocket = {
	readonly readyState: number;
	send(data: string): void;
	close(): void;
	on(event: "message", listener: (data: unknown) => void): void;
	on(event: "close" | "error", listener: () => void): void;
};

type ChatWsConn = {
	socket: ChatWsSocket;
};

function requireUserId(req: FastifyRequest): string {
	const userId = req.user?.id;
	if (typeof userId === "string" && userId.length > 0) return userId;

	throw new UserFacingError({
		code: "UNAUTHORIZED",
		userMessage: "Unauthorized.",
	});
}

/**
 * WS handshake may not have req.user populated unless jwtVerify ran.
 * We try to verify token if possible.
 */
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

function wsSend(conn: ChatWsConn, event: ChatWsServerEvent): void {
	try {
		conn.socket.send(JSON.stringify(event));
	} catch {
		// ignore
	}
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
		return chatQueryService.listThreads(userId, folder);
	});

	app.post("/chat/threads", async (req) => {
		const userId = requireUserId(req);
		const dto = ChatThreadCreateSchema.parse(req.body);

		return chatCommandService.createThread(userId, {
			folderId: dto.folderId,
			title: dto.title,
			defaultProvider: dto.defaultProvider,
			defaultKind: dto.defaultKind,
		});
	});

	app.get("/chat/threads/:threadId", async (req) => {
		const userId = requireUserId(req);
		const params = req.params as { threadId: string };
		return chatQueryService.getThread(userId, params.threadId);
	});

	app.patch("/chat/threads/:threadId", async (req) => {
		const userId = requireUserId(req);
		const params = req.params as { threadId: string };
		const dto = ChatThreadPatchSchema.parse(req.body);

		return chatCommandService.patchThread(userId, params.threadId, {
			folderId: dto.folderId,
			title: dto.title,
			defaultProvider: dto.defaultProvider,
			defaultKind: dto.defaultKind,
		});
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

		return chatQueryService.listMessages(userId, params.threadId, {
			limit: q.limit,
			cursor: q.cursor,
		});
	});

	// REST: send (keep for debug/backward compatibility)
	app.post("/chat/threads/:threadId/messages", async (req) => {
		const userId = requireUserId(req);
		const params = req.params as { threadId: string };
		const dto = ChatSendMessageSchema.parse(req.body);

		return chatCommandService.sendMessage(userId, params.threadId, dto);
	});

	// REST: Apply JSON (creates LeadSearch + event)
	app.post("/chat/threads/:threadId/apply", async (req) => {
		const userId = requireUserId(req);
		const params = req.params as { threadId: string };
		const dto = ChatApplyJsonSchema.parse(req.body);

		return chatCommandService.applyJson(userId, params.threadId, dto);
	});

	// -------------------------
	// WS: realtime chat
	// -------------------------
	app.get("/ws/chat/threads/:threadId", { websocket: true }, (conn, req) => {
		const wsConn = conn as unknown as ChatWsConn;
		void (async () => {
			const userId = await ensureUserId(req);
			const params = req.params as { threadId: string };
			const threadId = params.threadId;

			// Access check (must throw if not owned / not found)
			await chatQueryService.getThread(userId, threadId);

			realtimeHub.subscribe(threadId, wsConn.socket);

			wsSend(wsConn, {
				type: "thread.ready",
				payload: { threadId, serverTime: new Date().toISOString() },
			});

			wsConn.socket.on("message", (buf: unknown) => {
				void (async () => {
					let parsed: unknown;
					try {
						const txt = Buffer.isBuffer(buf)
							? buf.toString("utf8")
							: String(buf);
						parsed = JSON.parse(txt);
					} catch {
						wsSend(wsConn, {
							type: "error",
							payload: { code: "BAD_JSON", message: "Invalid JSON." },
						});
						return;
					}

					const cmd = ChatWsClientCommandSchema.safeParse(parsed);
					if (!cmd.success) {
						wsSend(wsConn, {
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
						wsSend(wsConn, { type: "ack", payload: { ok: true } });
						return;
					}

					if (cmd.data.type === "message.send") {
						await chatCommandService.sendMessage(
							userId,
							threadId,
							cmd.data.payload
						);
						wsSend(wsConn, {
							type: "ack",
							payload: {
								ok: true,
								clientMessageId: cmd.data.payload.clientMessageId,
							},
						});
						return;
					}

					if (cmd.data.type === "json.apply") {
						await chatCommandService.applyJson(
							userId,
							threadId,
							cmd.data.payload
						);
						wsSend(wsConn, {
							type: "ack",
							payload: {
								ok: true,
								clientMessageId: cmd.data.payload.clientMessageId,
							},
						});
						return;
					}
				})().catch((err) => {
					const msg = err instanceof Error ? err.message : String(err);
					wsSend(wsConn, {
						type: "error",
						payload: { code: "INTERNAL", message: msg },
					});
				});
			});
		})().catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);
			wsSend(wsConn, {
				type: "error",
				payload: { code: "UNAUTHORIZED", message: msg },
			});
			try {
				wsConn.socket.close();
			} catch {
				// ignore
			}
		});
	});
}
