import type { FastifyInstance } from "fastify";

import { container } from "@/container";

import { CHAT_TYPES } from "./chat.types";
import { ChatCommandService } from "./services/chat.command.service";
import { ChatQueryService } from "./services/chat.query.service";
import { registerChatHttpRoutes } from "./controller/chat.controller.http";
import { registerChatWsRoutes } from "./controller/chat.controller.ws";
import type { ChatControllerDeps } from "./controller/chat.controller.types";
import { REALTIME_TYPES } from "@/infra/realtime/realtime.types";
import { RealtimeHub } from "@/infra/realtime/realtimeHub";
import { ChatAiStreamService } from "./services/chat-ai-stream.service";
import { BALANCE_TYPES } from "@/modules/balance/balance.types";
import type { BillingService } from "@/modules/balance/services/billing.service";

const deps: ChatControllerDeps = {
  queryService: container.get<ChatQueryService>(CHAT_TYPES.ChatQueryService),
  commandService: container.get<ChatCommandService>(
    CHAT_TYPES.ChatCommandService,
  ),
  realtimeHub: container.get<RealtimeHub>(REALTIME_TYPES.RealtimeHub),
  aiStreamService: container.get<ChatAiStreamService>(
    CHAT_TYPES.ChatAiStreamService,
  ),
  billingService: container.get<BillingService>(BALANCE_TYPES.BillingService),
};

export function registerChatRoutes(app: FastifyInstance): void {
  registerChatHttpRoutes(app, deps);
  registerChatWsRoutes(app, deps);
}
