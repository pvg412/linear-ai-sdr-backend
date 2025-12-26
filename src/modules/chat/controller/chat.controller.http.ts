import type { FastifyInstance } from "fastify";

import {
	ChatApplyJsonSchema,
	ChatSendMessageSchema,
	ChatThreadCreateSchema,
	ChatThreadPatchSchema,
	CursorPaginationSchema,
} from "../schemas/chat.schemas";
import type { ChatControllerDeps } from "./chat.controller.types";
import {
	sanitizeAny,
	type UnknownRecord,
} from "./chat.controller.helpers";
import { sanitizeMessageToPublic } from "../parsers/chat.parsers";
import { requireRequestUserId } from "@/infra/auth/requestUser";

export function registerChatHttpRoutes(
	app: FastifyInstance,
	deps: ChatControllerDeps
): void {
	registerThreadRoutes(app, deps);
	registerMessageRoutes(app, deps);
}

function registerThreadRoutes(
	app: FastifyInstance,
	deps: ChatControllerDeps
): void {
	app.get("/chat/threads", async (req) => {
		const userId = requireRequestUserId(req);

		const res = await deps.queryService.listThreads(userId);
		return sanitizeAny(res);
	});

	app.post("/chat/threads", async (req) => {
		const userId = requireRequestUserId(req);
		const dto = ChatThreadCreateSchema.parse(req.body);

		const res = await deps.commandService.createThread(userId, {
			title: dto.title,
			defaultParser: dto.defaultParser ?? undefined,
			defaultKind: dto.defaultKind ?? undefined,
		});

		return sanitizeAny(res);
	});

	app.get("/chat/threads/:threadId", async (req) => {
		const userId = requireRequestUserId(req);
		const params = req.params as { threadId: string };

		const res = await deps.queryService.getThread(userId, params.threadId);
		return sanitizeAny(res);
	});

	app.patch("/chat/threads/:threadId", async (req) => {
		const userId = requireRequestUserId(req);
		const params = req.params as { threadId: string };
		const dto = ChatThreadPatchSchema.parse(req.body);

		const res = await deps.commandService.patchThread(userId, params.threadId, {
			title: dto.title,
			defaultParser: dto.defaultParser ?? undefined,
			defaultKind: dto.defaultKind ?? undefined,
		});

		return sanitizeAny(res);
	});

	app.delete("/chat/threads/:threadId", async (req) => {
		const userId = requireRequestUserId(req);
		const params = req.params as { threadId: string };
		return deps.commandService.deleteThread(userId, params.threadId);
	});
}

function registerMessageRoutes(
	app: FastifyInstance,
	deps: ChatControllerDeps
): void {
	app.get("/chat/threads/:threadId/messages", async (req) => {
		const userId = requireRequestUserId(req);
		const params = req.params as { threadId: string };
		const q = CursorPaginationSchema.parse(req.query);

		const res = await deps.queryService.listMessages(userId, params.threadId, {
			limit: q.limit,
			cursor: q.cursor,
		});

		return sanitizeAny(res);
	});

	app.post("/chat/threads/:threadId/messages", async (req) => {
		const userId = requireRequestUserId(req);
		const params = req.params as { threadId: string };
		const dto = ChatSendMessageSchema.parse(req.body);

		const res = await deps.commandService.sendMessage(
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
		const userId = requireRequestUserId(req);
		const params = req.params as { threadId: string };
		const dto = ChatApplyJsonSchema.parse(req.body);

		const res = await deps.commandService.applyJson(
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
}
