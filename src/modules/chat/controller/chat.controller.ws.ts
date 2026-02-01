import type { FastifyInstance, FastifyRequest } from "fastify";

import { safePreview } from "@/infra/observability";

import { ChatWsClientCommandSchema } from "../schemas/chat.ws.schemas";
import type { ChatControllerDeps } from "./chat.controller.types";
import {
  ensureUserId,
  extractWsSocket,
  wsSend,
  type ChatWsSocket,
  type UnknownRecord,
} from "./chat.controller.helpers";
import { sanitizeMessageToPublic } from "../parsers/chat.parsers";
import {
  outreachChannelToJSON,
  outreachStageToJSON,
} from "@/generated/aisdr/v1/ai_sdr";

type StreamState = {
  abortController: AbortController | null;
};

type WsContext = {
  socket: ChatWsSocket;
  threadId: string;
  userId: string;
  tag: string;
  deps: ChatControllerDeps;
  stream: StreamState;
};

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
      context: { socket, userId, threadId, tag, deps, stream },
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
  const { deps, threadId, userId, tag, stream } = context;

  const parsed = ChatWsClientCommandSchema.parse(cmd);

  if (parsed.type === "ping") {
    wsSend(socket, { type: "ack", payload: { ok: true } });
    return;
  }

  // -------------------------
  // Existing: parse-only flow
  // -------------------------
  if (parsed.type === "leadSearch.prompt.parse") {
    const result = await deps.commandService.sendMessage(
      userId,
      threadId,
      parsed.payload,
    );

    deps.realtimeHub.broadcast(threadId, {
      type: "message.created",
      payload: {
        message: sanitizeMessageToPublic(
          result.userMessage as unknown as UnknownRecord,
        ),
      },
    });

    deps.realtimeHub.broadcast(threadId, {
      type: "message.created",
      payload: {
        message: sanitizeMessageToPublic(
          result.assistantMessage as unknown as UnknownRecord,
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

  // -------------------------
  // Existing: apply json -> lead search
  // -------------------------
  if (parsed.type === "leadSearch.prompt.apply") {
    const result = await deps.commandService.applyJson(
      userId,
      threadId,
      parsed.payload,
    );

    deps.realtimeHub.broadcast(threadId, {
      type: "message.created",
      payload: {
        message: sanitizeMessageToPublic(
          result.userJsonMessage as unknown as UnknownRecord,
        ),
      },
    });

    deps.realtimeHub.broadcast(threadId, {
      type: "message.created",
      payload: {
        message: sanitizeMessageToPublic(
          result.eventMessage as unknown as UnknownRecord,
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

  // -------------------------
  // Outreach: parse prompt -> JSON context
  // -------------------------
  if (parsed.type === "outreach.prompt.parse") {
    const suggestedChannel = parsed.payload.suggestedChannel
      ? outreachChannelToJSON(parsed.payload.suggestedChannel)
      : undefined;

    console.log(tag, "outreach.prompt.parse - input", {
      suggestedChannelRaw: parsed.payload.suggestedChannel,
      suggestedChannelConverted: suggestedChannel,
      text: parsed.payload.text,
      directoryId: parsed.payload.directoryId,
    });

    const result = await deps.commandService.parseOutreachPrompt(
      userId,
      threadId,
      {
        text: parsed.payload.text,
        directoryId: parsed.payload.directoryId,
        suggestedChannel,
      },
    );

    console.log(tag, "outreach.prompt.parse - result", {
      parsed: result.parsed,
      assistantMessagePayload: result.assistantMessage.payload,
    });

    deps.realtimeHub.broadcast(threadId, {
      type: "message.created",
      payload: {
        message: sanitizeMessageToPublic(
          result.userMessage as unknown as UnknownRecord,
        ),
      },
    });

    deps.realtimeHub.broadcast(threadId, {
      type: "message.created",
      payload: {
        message: sanitizeMessageToPublic(
          result.assistantMessage as unknown as UnknownRecord,
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

  // -------------------------
  // Outreach: apply context -> trigger generation
  // -------------------------
  if (parsed.type === "outreach.prompt.apply") {
    const context = {
      channel: outreachChannelToJSON(parsed.payload.context.channel),
      stage: outreachStageToJSON(parsed.payload.context.stage),
      dayInSequence: parsed.payload.context.dayInSequence,
      followUpNumber: parsed.payload.context.followUpNumber,
      suggestedTactic: parsed.payload.context.suggestedTactic,
      leadResponseType: parsed.payload.context.leadResponseType,
      customInstructions: parsed.payload.context.customInstructions,
      leadId: parsed.payload.context.leadId,
      userPrompt: parsed.payload.context.userPrompt,
    };

    const result = await deps.commandService.applyOutreachContext(
      userId,
      threadId,
      {
        context,
        parsedMessageId: parsed.payload.parsedMessageId,
        defaultDirectoryIds: parsed.payload.defaultDirectoryIds,
      },
    );

    deps.realtimeHub.broadcast(threadId, {
      type: "message.created",
      payload: {
        message: sanitizeMessageToPublic(
          result.userJsonMessage as unknown as UnknownRecord,
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

    // Now trigger the AI stream with the context
    const ac = new AbortController();
    stream.abortController = ac;

    const defaultDirectoryIds = parsed.payload.defaultDirectoryIds ?? [];
    const userPrompt = parsed.payload.context.userPrompt ?? "";

    void deps.aiStreamService
      .streamAssistantReply({
        userId,
        threadId,
        text: userPrompt, // Use original user prompt from context
        clientMessageId: parsed.payload.clientMessageId ?? undefined,
        defaultDirectoryIds,
        mode: 2, // ChatMode.CHAT_MODE_OUTREACH
        outreachContext: context,
        signal: ac.signal,
      })
      .catch((err) => {
        if (ac.signal.aborted) return;

        const msg = err instanceof Error ? err.message : String(err);
        console.error(tag, "ai stream failed", { message: msg });

        wsSend(socket, {
          type: "error",
          payload: { code: "AI_STREAM_FAILED", message: msg },
        });
      })
      .finally(() => {
        if (stream.abortController === ac) {
          stream.abortController = null;
        }
      });

    return;
  }

  if (parsed.type === "assistant.stream") {
    // ack immediately so UI gets confirmation
    wsSend(socket, {
      type: "ack",
      payload: {
        ok: true,
        clientMessageId: parsed.payload.clientMessageId ?? null,
      },
    });

    // abort previous stream on this socket
    if (stream.abortController) {
      try {
        stream.abortController.abort();
      } catch (e) {
        console.warn(tag, "failed to abort previous AI stream", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const ac = new AbortController();
    stream.abortController = ac;

    const defaultDirectoryIds = parsed.payload.defaultDirectoryIds ?? [];
    const mode = parsed.payload.mode;

    // fire-and-forget; service itself should broadcast message.created + deltas
    void deps.aiStreamService
      .streamAssistantReply({
        userId,
        threadId,
        text: parsed.payload.text,
        clientMessageId: parsed.payload.clientMessageId ?? undefined,
        defaultDirectoryIds,
        mode,
        signal: ac.signal,
      })
      .catch((err) => {
        // If aborted (client sent another stream or socket closed) — silence.
        if (ac.signal.aborted) return;

        const msg = err instanceof Error ? err.message : String(err);
        console.error(tag, "ai stream failed", { message: msg });

        // Send structured error to this socket (not broadcast to whole thread)
        wsSend(socket, {
          type: "error",
          payload: { code: "AI_STREAM_FAILED", message: msg },
        });
      })
      .finally(() => {
        // Clear only if this is still the active controller
        if (stream.abortController === ac) {
          stream.abortController = null;
        }
      });

    return;
  }
}
