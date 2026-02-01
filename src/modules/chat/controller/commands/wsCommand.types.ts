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
  tag: string;
  deps: ChatControllerDeps;
  stream: StreamState;
};

export interface WsCommandHandler {
  type: string;
  handle(context: WsContext, payload: unknown): Promise<void>;
}
