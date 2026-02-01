// Ping command handler

import { wsSend } from "../chat.controller.helpers";
import type { WsCommandHandler, WsContext } from "./wsCommand.types";

export class PingCommandHandler implements WsCommandHandler {
  readonly type = "ping";

  handle(context: WsContext, _payload: unknown): Promise<void> {
    wsSend(context.socket, { type: "ack", payload: { ok: true } });
    return Promise.resolve();
  }
}
