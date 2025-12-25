import type { ChatCommandService } from "../services/chat.command.service";
import type { ChatQueryService } from "../services/chat.query.service";
import type { RealtimeHub } from "@/infra/realtime/realtimeHub";

export type ChatControllerDeps = {
	queryService: ChatQueryService;
	commandService: ChatCommandService;
	realtimeHub: RealtimeHub;
};
