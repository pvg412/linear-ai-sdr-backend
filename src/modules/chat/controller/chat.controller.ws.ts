import type { FastifyInstance, FastifyRequest } from "fastify";

import { safePreview } from "@/infra/observability";

import { ChatWsClientCommandSchema } from "../schemas/chat.ws.schemas";
import type { ChatControllerDeps } from "./chat.controller.types";
import {
  ensureUserId,
  extractWsSocket,
  wsSend,
  type ChatWsSocket,
} from "./chat.controller.helpers";
import { wsCommandRegistry, type StreamState, type WsContext } from "./commands";

export function registerChatWsRoutes(
  app: FastifyInstance,
  deps: ChatControllerDeps,
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
  // companyId is set on req.user by the auth guard from the JWT payload.
  // SALE_MANAGER: companyId points to the parent COMPANY account.
  // COMPANY: companyId is null (their own userId serves as the workspace).
  const companyId = req.user?.companyId ?? null;

  const params = req.params as { threadId: string };
  const threadId = params.threadId;

  // Access check
  await deps.queryService.getThread(userId, threadId);

  deps.realtimeHub.subscribe(threadId, socket);

  wsSend(socket, {
    type: "thread.ready",
    payload: { threadId, serverTime: new Date().toISOString() },
  });

  // ✅ important: mutable stream state, so we always abort the current controller
  const stream: StreamState = { abortController: null };

  const abortCurrent = (reason: string) => {
    const ac = stream.abortController;
    if (!ac) return;
    stream.abortController = null;
    try {
      ac.abort();
    } catch (e) {
      console.error(tag, "failed to abort current AI stream", {
        reason,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  socket.on("close", () => abortCurrent("socket_close"));
  socket.on("error", () => abortCurrent("socket_error"));

  socket.on("message", (buf: unknown) => {
    void handleIncomingWsMessage({
      socket,
      buf,
      context: { socket, userId, companyId, threadId, tag, deps, stream },
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

  await dispatchWsCommand({ cmd: cmd.data, context });
}

async function dispatchWsCommand(input: {
  cmd: unknown;
  context: WsContext;
}): Promise<void> {
  const { cmd, context } = input;
  const { socket } = context;

  const parsed = ChatWsClientCommandSchema.parse(cmd);

  // Use the command registry to dispatch the command
  const handled = await wsCommandRegistry.dispatch(
    parsed.type,
    context,
    parsed.payload,
  );

  if (!handled) {
    wsSend(socket, {
      type: "error",
      payload: {
        code: "UNKNOWN_COMMAND",
        message: `Unknown command type: ${parsed.type}`,
      },
    });
  }
}
