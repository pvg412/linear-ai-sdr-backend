import { inject, injectable } from "inversify";
import { ChatMessageType } from "@prisma/client";

import { CHAT_TYPES } from "../chat.types";
import { ChatRepository } from "../persistence/chat.repository";

@injectable()
export class ChatQueryService {
  constructor(
    @inject(CHAT_TYPES.ChatRepository)
    private readonly chatRepository: ChatRepository,
  ) { }

  listThreads(userId: string, opts: { limit: number; cursor?: string }) {
    return this.chatRepository.listThreads(userId, opts);
  }

  getThread(userId: string, threadId: string) {
    return this.chatRepository.getThread(userId, threadId);
  }

  async listMessages(
    userId: string,
    threadId: string,
    opts: { limit: number; cursor?: string },
  ) {
    const result = await this.chatRepository.listMessages(userId, threadId, opts);

    // For OUTREACH messages, check if we can continue
    const messagesWithCanContinue = await Promise.all(
      result.messages.map(async (msg) => {
        if (msg.type === ChatMessageType.OUTREACH && msg.directoryId) {
          // Check if there are more leads without messages in this directory
          const leadsWithoutMessages = await this.chatRepository.getLeadIdsFromDirectories(
            userId,
            [msg.directoryId],
            { excludeWithMessages: true },
          );

          return {
            ...msg,
            canContinue: leadsWithoutMessages.length > 0,
          };
        }

        return msg;
      }),
    );

    return {
      messages: messagesWithCanContinue,
      nextCursor: result.nextCursor,
    };
  }
}
