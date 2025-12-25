import type { FastifyInstance, FastifyRequest } from "fastify";

import { safePreview } from "@/infra/observability";

import { ChatWsClientCommandSchema } from "../chat.ws.schemas";
import type { ChatControllerDeps } from "./chat.controller.types";
import {
	ensureUserId,
	extractWsSocket,
	wsSend,
	type ChatWsSocket,
	type UnknownRecord,
} from "./chat.controller.helpers";
import { sanitizeMessageToPublic } from "../chat.parsers";

type WsContext = {
	socket: ChatWsSocket;
	threadId: string;
	userId: string;
	tag: string;
	deps: ChatControllerDeps;
};

export function registerChatWsRoutes(
	app: FastifyInstance,
	deps: ChatControllerDeps
): void {
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

		void initializeWsConnection({
			socket,
			req,
			deps,
			tag,
		}).catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);

			wsSend(socket, {
				type: "error",
				payload: { code: "UNAUTHORIZED", message: msg },
			});

			try {
				socket?.close();
			} catch {
				// ignore
			}
		});
	});
}

async function initializeWsConnection(input: {
	socket: ChatWsSocket;
	req: FastifyRequest;
	deps: ChatControllerDeps;
	tag: string;
}): Promise<void> {
	const { socket, req, deps, tag } = input;

	const userId = await ensureUserId(req);
	const params = req.params as { threadId: string };
	const threadId = params.threadId;

	// Access check
	await deps.queryService.getThread(userId, threadId);

	deps.realtimeHub.subscribe(threadId, socket);

	wsSend(socket, {
		type: "thread.ready",
		payload: { threadId, serverTime: new Date().toISOString() },
	});

	socket.on("message", (buf: unknown) => {
		void handleIncomingWsMessage({
			socket,
			buf,
			context: { socket, userId, threadId, tag, deps },
		}).catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(tag, "handler error", { message: msg });
			wsSend(socket, {
				type: "error",
				payload: { code: "INTERNAL", message: msg },
			});
		});
	});
}

async function handleIncomingWsMessage(input: {
	socket: ChatWsSocket;
	buf: unknown;
	context: WsContext;
}): Promise<void> {
	const { socket, buf, context } = input;
	const { tag } = context;

	let parsed: unknown;
	try {
		const txt = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);

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

	await dispatchWsCommand({ socket, cmd: cmd.data, context });
}

async function dispatchWsCommand(input: {
	socket: ChatWsSocket;
	cmd: unknown;
	context: WsContext;
}): Promise<void> {
	const { socket, cmd, context } = input;
	const { deps, threadId, userId } = context;
	const parsed = ChatWsClientCommandSchema.parse(cmd);

	if (parsed.type === "ping") {
		wsSend(socket, { type: "ack", payload: { ok: true } });
		return;
	}

	if (parsed.type === "message.send") {
		const result = await deps.commandService.sendMessage(
			userId,
			threadId,
			parsed.payload
		);

		deps.realtimeHub.broadcast(threadId, {
			type: "message.created",
			payload: {
				message: sanitizeMessageToPublic(
					result.userMessage as unknown as UnknownRecord
				),
			},
		});

		deps.realtimeHub.broadcast(threadId, {
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
				clientMessageId: parsed.payload.clientMessageId ?? undefined,
			},
		});
		return;
	}

	if (parsed.type === "json.apply") {
		const result = await deps.commandService.applyJson(
			userId,
			threadId,
			parsed.payload
		);

		deps.realtimeHub.broadcast(threadId, {
			type: "message.created",
			payload: {
				message: sanitizeMessageToPublic(
					result.userJsonMessage as unknown as UnknownRecord
				),
			},
		});

		deps.realtimeHub.broadcast(threadId, {
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
				clientMessageId: parsed.payload.clientMessageId ?? null,
			},
		});

		return;
	}
}
