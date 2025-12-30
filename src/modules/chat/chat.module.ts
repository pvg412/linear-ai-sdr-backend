import type { Container } from "inversify";

import { CHAT_TYPES } from "./chat.types";
import { ChatRepository } from "./persistence/chat.repository";
import { ChatCommandService } from "./services/chat.command.service";
import { ChatQueryService } from "./services/chat.query.service";
import { ChatAiPromptParser } from "./parsers/chat.promptParser.ai";

export function registerChatModule(container: Container) {
	container
		.bind<ChatAiPromptParser>(CHAT_TYPES.ChatPromptParser)
		.to(ChatAiPromptParser)
		.inSingletonScope();

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
}
