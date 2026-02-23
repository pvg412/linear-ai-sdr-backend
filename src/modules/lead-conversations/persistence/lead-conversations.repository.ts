import { injectable } from "inversify";
import { MessageSender } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

import type {
  CreateConversationMessageDto,
  ConversationMessageResponse,
} from "../schemas/lead-conversations.schemas";

export interface CreateConversationMessageInput
  extends CreateConversationMessageDto {
  createdBy: string | null;
  senderType: MessageSender;
  repliedAt?: Date;
}

export interface GetConversationHistoryInput {
  leadId: string;
  limit?: number;
  offset?: number;
}

@injectable()
export class LeadConversationsRepository {
  private get prisma() {
    return getPrisma();
  }

  async createMessage(
    input: CreateConversationMessageInput,
  ): Promise<ConversationMessageResponse> {
    const message = await this.prisma.leadConversationMessage.create({
      data: {
        leadId: input.leadId,
        createdBy: input.createdBy,
        senderType: input.senderType,
        channel: input.channel,
        stage: input.stage,
        subject: input.subject,
        body: input.body,
        characterCount: input.characterCount,
        wordCount: input.wordCount,
        usageNote: input.usageNote,
        tacticUsed: input.tacticUsed,
        chatMessageId: input.chatMessageId,
        sentAt: input.sentAt,
        repliedAt: input.repliedAt,
      },
    });

    return message;
  }

  async findByLeadId(
    input: GetConversationHistoryInput,
  ): Promise<{ messages: ConversationMessageResponse[]; total: number }> {
    const where = {
      leadId: input.leadId,
    };

    const [messages, total] = await Promise.all([
      this.prisma.leadConversationMessage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: input.offset ?? 0,
        take: input.limit ?? 50,
      }),
      this.prisma.leadConversationMessage.count({ where }),
    ]);

    return { messages, total };
  }

  async findById(
    messageId: string,
  ): Promise<ConversationMessageResponse | null> {
    return this.prisma.leadConversationMessage.findUnique({
      where: { id: messageId },
    });
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.prisma.leadConversationMessage.delete({
      where: { id: messageId },
    });
  }

  async findByChatMessageId(
    chatMessageId: string,
  ): Promise<ConversationMessageResponse | null> {
    return this.prisma.leadConversationMessage.findFirst({
      where: { chatMessageId },
    });
  }

  async countByLeadId(leadId: string): Promise<number> {
    return this.prisma.leadConversationMessage.count({
      where: { leadId },
    });
  }

  async getThreadIdByChatMessageId(
    chatMessageId: string,
  ): Promise<string | null> {
    const chatMessage = await this.prisma.chatMessage.findUnique({
      where: { id: chatMessageId },
      select: { threadId: true },
    });

    return chatMessage?.threadId ?? null;
  }

  /**
   * Filter leadIds to only include those WITHOUT any conversation messages
   */
  async filterLeadsWithoutMessages(leadIds: string[]): Promise<string[]> {
    if (leadIds.length === 0) {
      return [];
    }

    // Get all leadIds that HAVE messages
    const leadsWithMessages = await this.prisma.leadConversationMessage.findMany({
      where: {
        leadId: { in: leadIds },
      },
      select: {
        leadId: true,
      },
      distinct: ['leadId'],
    });

    const leadIdsWithMessages = new Set(leadsWithMessages.map(m => m.leadId));

    // Return only leadIds that DON'T have messages
    return leadIds.filter(id => !leadIdsWithMessages.has(id));
  }

  /**
   * Get minimum message count among leads in a directory
   * Returns the smallest number of messages any lead has
   * If directory has no leads or no messages exist, returns 0
   */
  async getMinMessageCountInDirectory(directoryId: string): Promise<number> {
    // Get all leads in the directory
    const directoryLeads = await this.prisma.leadDirectoryLead.findMany({
      where: { directoryId },
      select: { leadId: true },
    });

    if (directoryLeads.length === 0) {
      return 0;
    }

    const leadIds = directoryLeads.map(dl => dl.leadId);

    // Get message counts for each lead
    const messageCounts = await this.prisma.leadConversationMessage.groupBy({
      by: ['leadId'],
      where: {
        leadId: { in: leadIds },
        senderType: MessageSender.SALE_MANAGER, // Only count messages sent by sales manager
      },
      _count: {
        id: true,
      },
    });

    // If no messages exist for any lead, return 0
    if (messageCounts.length === 0) {
      return 0;
    }

    // Create a map of leadId -> message count
    const countMap = new Map(messageCounts.map(mc => [mc.leadId, mc._count.id]));

    // For leads without messages, their count is 0
    const allCounts = leadIds.map(leadId => countMap.get(leadId) ?? 0);

    // Return the minimum count
    return Math.min(...allCounts);
  }

  /**
   * Get minimum message count among specific leads
   * Returns the smallest number of messages any lead has
   * If no leads provided or no messages exist, returns 0
   */
  async getMinMessageCountForLeads(leadIds: string[]): Promise<number> {
    if (leadIds.length === 0) {
      return 0;
    }

    // Get message counts for each lead
    const messageCounts = await this.prisma.leadConversationMessage.groupBy({
      by: ['leadId'],
      where: {
        leadId: { in: leadIds },
        senderType: MessageSender.SALE_MANAGER,
      },
      _count: {
        id: true,
      },
    });

    // Create a map of leadId -> message count
    const countMap = new Map(messageCounts.map(mc => [mc.leadId, mc._count.id]));

    // For leads without messages, their count is 0
    const allCounts = leadIds.map(leadId => countMap.get(leadId) ?? 0);

    // Return the minimum count
    return Math.min(...allCounts);
  }

  /**
   * Filter leads to only include those with the minimum message count
   *
   * Example:
   * - Lead A: 2 messages
   * - Lead B: 2 messages
   * - Lead C: 1 message
   *
   * Result: Only Lead C is returned (has minimum count of 1)
   */
  async filterLeadsWithMinMessageCount(leadIds: string[]): Promise<{
    leadIds: string[];
    minMessageCount: number;
  }> {
    if (leadIds.length === 0) {
      return { leadIds: [], minMessageCount: 0 };
    }

    // Get message counts for each lead
    const messageCounts = await this.prisma.leadConversationMessage.groupBy({
      by: ['leadId'],
      where: {
        leadId: { in: leadIds },
        senderType: MessageSender.SALE_MANAGER,
      },
      _count: {
        id: true,
      },
    });

    // Create a map of leadId -> message count
    const countMap = new Map(messageCounts.map(mc => [mc.leadId, mc._count.id]));

    // For leads without messages, their count is 0
    const leadsWithCounts = leadIds.map(leadId => ({
      leadId,
      count: countMap.get(leadId) ?? 0,
    }));

    // Find the minimum count
    const minCount = Math.min(...leadsWithCounts.map(l => l.count));

    // Filter to only leads with minimum count
    const filteredLeadIds = leadsWithCounts
      .filter(l => l.count === minCount)
      .map(l => l.leadId);

    return {
      leadIds: filteredLeadIds,
      minMessageCount: minCount,
    };
  }

  /**
   * Get the earliest (oldest) last message date among leads with the minimum message count
   * Used to determine when the last follow-up was sent for cadence calculation
   *
   * Returns null if no messages exist for any lead
   */
  async getEarliestLastMessageDate(leadIds: string[]): Promise<Date | null> {
    if (leadIds.length === 0) {
      return null;
    }

    // First, get leads with minimum message count
    const { leadIds: leadsAtMinCount, minMessageCount } =
      await this.filterLeadsWithMinMessageCount(leadIds);

    if (minMessageCount === 0 || leadsAtMinCount.length === 0) {
      // No messages sent yet, no date to return
      return null;
    }

    // For leads at minimum count, get the most recent message date for each
    // Then find the EARLIEST among those (the oldest "last message")
    const lastMessages = await this.prisma.leadConversationMessage.findMany({
      where: {
        leadId: { in: leadsAtMinCount },
        senderType: MessageSender.SALE_MANAGER,
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['leadId'],
      select: {
        leadId: true,
        createdAt: true,
      },
    });

    if (lastMessages.length === 0) {
      return null;
    }

    // Find the earliest (oldest) last message date
    const earliestDate = lastMessages.reduce((earliest, msg) => {
      return msg.createdAt < earliest ? msg.createdAt : earliest;
    }, lastMessages[0].createdAt);

    return earliestDate;
  }

  /**
   * Create a link between a pipeline run and an outreach message
   * in the PipelineRunOutreachMessage junction table.
   */
  async linkToPipelineRun(
    messageId: string,
    pipelineRunId: string,
  ): Promise<void> {
    await this.prisma.pipelineRunOutreachMessage.create({
      data: { pipelineRunId, messageId },
    });
  }

  /**
   * Create links between a pipeline run and multiple outreach messages
   * in a single batch operation.
   */
  async linkManyToPipelineRun(
    messageIds: string[],
    pipelineRunId: string,
  ): Promise<void> {
    if (messageIds.length === 0) return;

    await this.prisma.pipelineRunOutreachMessage.createMany({
      data: messageIds.map((messageId) => ({ pipelineRunId, messageId })),
      skipDuplicates: true,
    });
  }
}
