import type { ChatCommandService } from "../services/chat.command.service";
import type { ChatQueryService } from "../services/chat.query.service";
import type { RealtimeHub } from "@/infra/realtime/realtimeHub";
import type { ChatAiStreamService } from "../services/chat-ai-stream.service";
import type { BillingService } from "@/modules/balance/services/billing.service";

export type ChatControllerDeps = {
  queryService: ChatQueryService;
  commandService: ChatCommandService;
  realtimeHub: RealtimeHub;
  aiStreamService: ChatAiStreamService;
  billingService: BillingService;
};
