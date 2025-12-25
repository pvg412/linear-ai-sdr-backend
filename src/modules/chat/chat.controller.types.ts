import type { ChatCommandService } from "./chat.command.service";
import type { ChatQueryService } from "./chat.queryService";
import type { RealtimeHub } from "@/infra/realtime/realtimeHub";

export type ChatControllerDeps = {
	queryService: ChatQueryService;
	commandService: ChatCommandService;
	realtimeHub: RealtimeHub;
};
