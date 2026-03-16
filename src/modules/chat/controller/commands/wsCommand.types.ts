// WebSocket Command Handler Types

import type { ChatWsSocket } from "../chat.controller.helpers";
import type { ChatControllerDeps } from "../chat.controller.types";

export type StreamState = {
  abortController: AbortController | null;
};

export type WsContext = {
  socket: ChatWsSocket;
  threadId: string;
  userId: string;
  /** Company-level workspace ID for RAG scoping.
   *  COMPANY role: null (their own userId serves as the workspace).
   *  SALE_MANAGER role: the parent company's user ID.
   *  Consumers should resolve effective workspace as: companyId ?? userId */
  companyId: string | null;
  tag: string;
  deps: ChatControllerDeps;
  stream: StreamState;
};

export interface WsCommandHandler {
  type: string;
  handle(context: WsContext, payload: unknown): Promise<void>;
}
