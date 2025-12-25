import type { FastifyInstance } from "fastify";

import { container } from "@/container";

import { CHAT_TYPES } from "./chat.types";
import { ChatCommandService } from "./services/chat.command.service";
import { ChatQueryService } from "./services/chat.query.service";
import { registerChatHttpRoutes } from "./controller/chat.controller.http";
import { registerChatWsRoutes } from "./controller/chat.controller.ws";
import { REALTIME_TYPES } from "@/infra/realtime/realtime.types";
import { RealtimeHub } from "@/infra/realtime/realtimeHub";
import type { ChatControllerDeps } from "./controller/chat.controller.types";

const deps: ChatControllerDeps = {
	queryService: container.get<ChatQueryService>(CHAT_TYPES.ChatQueryService),
	commandService: container.get<ChatCommandService>(
		CHAT_TYPES.ChatCommandService
	),
	realtimeHub: container.get<RealtimeHub>(REALTIME_TYPES.RealtimeHub),
};

export function registerChatRoutes(app: FastifyInstance): void {
	registerChatHttpRoutes(app, deps);
	registerChatWsRoutes(app, deps);
}
