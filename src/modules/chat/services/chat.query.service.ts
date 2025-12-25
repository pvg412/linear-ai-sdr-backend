import { inject, injectable } from "inversify";

import { CHAT_TYPES } from "../chat.types";
import { ChatRepository } from "../persistence/chat.repository";

@injectable()
export class ChatQueryService {
	constructor(
		@inject(CHAT_TYPES.ChatRepository)
		private readonly chatRepository: ChatRepository
	) {}

	listFolders(userId: string) {
		return this.chatRepository.listFolders(userId);
	}

	listThreads(userId: string, folderId?: string) {
		return this.chatRepository.listThreads(userId, folderId);
	}

	getThread(userId: string, threadId: string) {
		return this.chatRepository.getThread(userId, threadId);
	}

	listMessages(
		userId: string,
		threadId: string,
		opts: { limit: number; cursor?: string }
	) {
		return this.chatRepository.listMessages(userId, threadId, opts);
	}
}
