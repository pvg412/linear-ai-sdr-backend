// Lead Search Prompt Apply command handler

import { LeadSearchKind } from "@prisma/client";

import { wsSend, type UnknownRecord } from "../chat.controller.helpers";
import { sanitizeMessageToPublic, type ChatParserId } from "../../parsers/chat.parsers";
import type { WsCommandHandler, WsContext } from "./wsCommand.types";

interface LeadSearchPromptApplyPayload {
  query: Record<string, unknown> & { limit?: number };
  limit?: number;
  parser?: ChatParserId | null;
  kind?: LeadSearchKind | null;
  parsedMessageId?: string;
  clientMessageId?: string;
}

export class LeadSearchPromptApplyCommandHandler implements WsCommandHandler {
  readonly type = "leadSearch.prompt.apply";

  async handle(context: WsContext, payload: unknown): Promise<void> {
    const { socket, deps, threadId, userId } = context;
    const typedPayload = payload as LeadSearchPromptApplyPayload;

    const result = await deps.commandService.applyJson(
      userId,
      threadId,
      typedPayload,
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
        clientMessageId: typedPayload.clientMessageId ?? null,
      },
    });
  }
}
