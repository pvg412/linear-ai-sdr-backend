// Lead Search Prompt Parse command handler

import { wsSend, type UnknownRecord } from "../chat.controller.helpers";
import { sanitizeMessageToPublic } from "../../parsers/chat.parsers";
import type { WsCommandHandler, WsContext } from "./wsCommand.types";

interface LeadSearchPromptParsePayload {
  text: string;
  clientMessageId?: string;
}

export class LeadSearchPromptParseCommandHandler implements WsCommandHandler {
  readonly type = "leadSearch.prompt.parse";

  async handle(context: WsContext, payload: unknown): Promise<void> {
    const { socket, deps, threadId, userId } = context;
    const typedPayload = payload as LeadSearchPromptParsePayload;

    const result = await deps.commandService.sendMessage(
      userId,
      threadId,
      typedPayload,
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
        clientMessageId: typedPayload.clientMessageId ?? undefined,
      },
    });
  }
}
