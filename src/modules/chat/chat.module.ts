import type { Container } from "inversify";

import { CHAT_TYPES } from "./chat.types";
import { ChatRepository } from "./persistence/chat.repository";
import { ChatCommandService } from "./services/chat.command.service";
import { ChatQueryService } from "./services/chat.query.service";
import { ChatPromptParser } from "./schemas/chat.dto";
import { ChatAiPromptParserService } from "./services/chat-ai-prompt-parser.service";
import { ChatAiStreamService } from "./services/chat-ai-stream.service";

export function registerChatModule(container: Container) {
  container
    .bind<ChatRepository>(CHAT_TYPES.ChatRepository)
    .to(ChatRepository)
    .inSingletonScope();

  container
    .bind<ChatCommandService>(CHAT_TYPES.ChatCommandService)
    .to(ChatCommandService)
    .inSingletonScope();

  container
    .bind<ChatQueryService>(CHAT_TYPES.ChatQueryService)
    .to(ChatQueryService)
    .inSingletonScope();

  container
    .bind<ChatPromptParser>(CHAT_TYPES.ChatPromptParser)
    .to(ChatAiPromptParserService)
    .inSingletonScope();

  container
    .bind<ChatAiStreamService>(CHAT_TYPES.ChatAiStreamService)
    .to(ChatAiStreamService)
    .inSingletonScope();
}
