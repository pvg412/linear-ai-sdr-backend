// WebSocket Command Registry
// Implements Open/Closed Principle - open for extension, closed for modification

import type { WsCommandHandler, WsContext } from "./wsCommand.types";
import { PingCommandHandler } from "./ping.command";
import { LeadSearchPromptParseCommandHandler } from "./leadSearchPromptParse.command";
import { LeadSearchPromptApplyCommandHandler } from "./leadSearchPromptApply.command";
import { OutreachPromptParseCommandHandler } from "./outreachPromptParse.command";
import { OutreachPromptApplyCommandHandler } from "./outreachPromptApply.command";
import { OutreachContinueCommandHandler } from "./outreachContinue.command";
import { AssistantStreamCommandHandler } from "./assistantStream.command";

class WsCommandRegistry {
  private handlers = new Map<string, WsCommandHandler>();

  register(handler: WsCommandHandler): void {
    this.handlers.set(handler.type, handler);
  }

  getHandler(type: string): WsCommandHandler | undefined {
    return this.handlers.get(type);
  }

  hasHandler(type: string): boolean {
    return this.handlers.has(type);
  }

  async dispatch(
    type: string,
    context: WsContext,
    payload: unknown,
  ): Promise<boolean> {
    const handler = this.handlers.get(type);
    if (!handler) {
      return false;
    }
    await handler.handle(context, payload);
    return true;
  }
}

// Create and populate the registry
const registry = new WsCommandRegistry();

// Register all command handlers
registry.register(new PingCommandHandler());
registry.register(new LeadSearchPromptParseCommandHandler());
registry.register(new LeadSearchPromptApplyCommandHandler());
registry.register(new OutreachPromptParseCommandHandler());
registry.register(new OutreachPromptApplyCommandHandler());
registry.register(new OutreachContinueCommandHandler());
registry.register(new AssistantStreamCommandHandler());

export { registry as wsCommandRegistry };
export type { WsCommandHandler, WsContext };
