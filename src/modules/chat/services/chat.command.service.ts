// src/modules/chat/chat.command.service.ts
import { inject, injectable } from "inversify";
import {
  ChatMessageRole,
  ChatMessageType,
  LeadSearchKind,
  Prisma,
} from "@prisma/client";

import { UserFacingError } from "@/infra/userFacingError";
import { getPrisma } from "@/infra/prisma";
import { ChatRepository } from "../persistence/chat.repository";
import { CHAT_TYPES } from "../chat.types";
import type {
  ChatApplyJsonDto,
  ChatSendMessageDto,
  SendMessageResultDto,
  ApplyJsonResultDto,
  ChatPromptParser,
  ParseOutreachPromptDto,
  ParseOutreachPromptResultDto,
  ApplyOutreachContextDto,
  ApplyOutreachContextResultDto,
  OutreachContext,
} from "../schemas/chat.dto";
import { LEAD_SEARCH_TYPES } from "@/modules/lead-search/lead-search.types";
import { LeadSearchRunnerService } from "@/modules/lead-search/lead-search.runner.service";
import {
  resolveInternalFromParserId,
  resolveParserIdFromProvider,
  resolveParserLabelFromProvider,
  type ChatParserId,
} from "../parsers/chat.parsers";
import { stripMentions } from "../utils/folder-mentions";
import { LEAD_CONVERSATIONS_TYPES } from "@/modules/lead-conversations/lead-conversations.types";
import type { LeadConversationsRepository } from "@/modules/lead-conversations/persistence/lead-conversations.repository";
import type { OutreachCadenceService } from "@/modules/lead-conversations/services/outreach-cadence.service";

type Json = Prisma.InputJsonValue;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveLimitFromApplyDto(input: {
  dtoLimit: number | undefined;
  query: unknown;
}): number | null {
  const queryLimit =
    isRecord(input.query) && typeof input.query.limit === "number"
      ? input.query.limit
      : undefined;

  // Prefer new shape (query.limit) if present.
  return queryLimit ?? input.dtoLimit ?? null;
}

@injectable()
export class ChatCommandService {
  constructor(
    @inject(CHAT_TYPES.ChatRepository)
    private readonly chatRepository: ChatRepository,

    @inject(CHAT_TYPES.ChatPromptParser)
    private readonly chatPromptParser: ChatPromptParser,

    @inject(LEAD_SEARCH_TYPES.LeadSearchRunnerService)
    private readonly leadSearchRunnerService: LeadSearchRunnerService,

    @inject(LEAD_CONVERSATIONS_TYPES.LeadConversationsRepository)
    private readonly leadConversationsRepository: LeadConversationsRepository,

    @inject(LEAD_CONVERSATIONS_TYPES.OutreachCadenceService)
    private readonly outreachCadenceService: OutreachCadenceService,
  ) { }

  async createThread(
    userId: string,
    input: {
      title?: string;
      defaultParser?: ChatParserId | null;
      defaultKind?: LeadSearchKind | null;
    },
  ) {
    const parser = input.defaultParser ?? undefined;
    const requestedKind = input.defaultKind ?? undefined;

    if (requestedKind && !parser) {
      throw new UserFacingError({
        code: "CHAT_THREAD_DEFAULTS_MISSING",
        userMessage: "defaultKind cannot be set without defaultParser.",
      });
    }

    if (!parser) {
      // allow thread without defaults (UI can set later)
      return this.chatRepository.createThread({
        ownerId: userId,
        title: input.title,
        defaultProvider: undefined,
        defaultKind: undefined,
      });
    }

    const r = resolveInternalFromParserId(parser);
    const kind = requestedKind ?? r.allowedKinds[0];

    if (!kind) {
      throw new UserFacingError({
        code: "CHAT_PARSER_NOT_CONFIGURED",
        userMessage: "Parser has no allowed kinds configured.",
        debugMessage: `Parser ${r.parser} has empty allowedKinds`,
      });
    }

    if (!r.allowedKinds.includes(kind)) {
      throw new UserFacingError({
        code: "CHAT_PARSER_KIND_NOT_ALLOWED",
        userMessage: "Selected parser does not support this method.",
        debugMessage: `Parser=${r.parser
          } kind=${kind} not in allowedKinds=${r.allowedKinds.join(",")}`,
      });
    }

    return this.chatRepository.createThread({
      ownerId: userId,
      title: input.title,
      defaultProvider: r.provider,
      defaultKind: kind,
    });
  }

  async patchThread(
    userId: string,
    threadId: string,
    patch: {
      title?: string | null;
      defaultParser?: ChatParserId | null;
      defaultKind?: LeadSearchKind | null;
    },
  ) {
    const thread = await this.chatRepository.getThread(userId, threadId);

    const wantsParserChange = patch.defaultParser !== undefined;
    const wantsKindChange = patch.defaultKind !== undefined;

    // Start with existing internal values
    let provider = thread.defaultProvider ?? null;
    let kind = thread.defaultKind ?? null;

    if (wantsParserChange) {
      if (patch.defaultParser == null) {
        // Clear both to avoid inconsistent state
        provider = null;
        kind = null;
      } else {
        const r = resolveInternalFromParserId(patch.defaultParser);
        provider = r.provider;

        const nextKind =
          (wantsKindChange ? patch.defaultKind : kind) ?? r.allowedKinds[0];

        if (!nextKind) {
          throw new UserFacingError({
            code: "CHAT_PARSER_NOT_CONFIGURED",
            userMessage: "Parser has no allowed kinds configured.",
          });
        }

        if (!r.allowedKinds.includes(nextKind)) {
          throw new UserFacingError({
            code: "CHAT_PARSER_KIND_NOT_ALLOWED",
            userMessage: "Selected parser does not support this method.",
          });
        }

        kind = nextKind;
      }
    } else if (wantsKindChange) {
      // kind change without parser change
      if (!provider) {
        throw new UserFacingError({
          code: "CHAT_THREAD_DEFAULTS_MISSING",
          userMessage: "defaultKind cannot be set without defaultParser.",
        });
      }
      kind = patch.defaultKind ?? null;
    }

    return this.chatRepository.patchThread(userId, threadId, {
      title: patch.title,

      // internal persisted
      defaultProvider: provider,
      defaultKind: kind,
    });
  }

  async deleteThread(userId: string, threadId: string) {
    return this.chatRepository.deleteThread(userId, threadId);
  }

  /**
   * USER sends TEXT -> ASSISTANT returns JSON payload { parser, kind, limit, query }
   */
  async sendMessage(
    userId: string,
    threadId: string,
    dto: ChatSendMessageDto,
  ): Promise<SendMessageResultDto> {
    const thread = await this.chatRepository.getThread(userId, threadId);

    const provider = thread.defaultProvider ?? null;
    const kind = thread.defaultKind ?? null;

    if (!provider || !kind) {
      throw new UserFacingError({
        code: "CHAT_THREAD_DEFAULTS_MISSING",
        userMessage:
          "Thread has no default parser/method. UI must set Parser + Method before sending messages.",
      });
    }

    const parser = resolveParserIdFromProvider(provider);
    const parserLabel = resolveParserLabelFromProvider(provider) ?? undefined;

    if (!parser) {
      throw new UserFacingError({
        code: "CHAT_PARSER_NOT_CONFIGURED",
        userMessage: "Selected parser is not configured on server.",
        debugMessage: `No public parser mapping for provider=${provider}`,
      });
    }

    const userMessage = await this.chatRepository.createMessage({
      ownerId: userId,
      threadId,
      role: ChatMessageRole.USER,
      type: ChatMessageType.TEXT,
      text: dto.text,
      payload: null,
      authorUserId: userId,
    });

    const parsed = await this.chatPromptParser.parsePrompt({
      text: dto.text,
      provider,
      kind,
    });

    const limit = parsed.suggestedLimit ?? 100;

    // New shape: limit is embedded into query (still persisted separately in LeadSearch).
    const queryWithLimit: Record<string, unknown> = {
      ...(isRecord(parsed.query) ? parsed.query : {}),
      limit,
    };

    const assistantPayload = {
      parser,
      ...(parserLabel ? { parserLabel } : {}),
      kind,
      query: queryWithLimit,
    };

    const assistantMessage = await this.chatRepository.createMessage({
      ownerId: userId,
      threadId,
      role: ChatMessageRole.ASSISTANT,
      type: ChatMessageType.JSON,
      text: null,
      payload: assistantPayload as unknown as Json,
      authorUserId: null,
    });

    return {
      userMessage,
      assistantMessage,
      parsed: { query: parsed.query, suggestedLimit: limit },
    };
  }

  /**
   * USER applies JSON => create LeadSearch + EVENT "leadSearch.started" (public only)
   */
  async applyJson(
    userId: string,
    threadId: string,
    dto: ChatApplyJsonDto,
  ): Promise<ApplyJsonResultDto> {
    const thread = await this.chatRepository.getThread(userId, threadId);

    const requestedParser = dto.parser ?? undefined;
    const requestedKind = dto.kind ?? undefined;
    const limit = resolveLimitFromApplyDto({
      dtoLimit: dto.limit ?? undefined,
      query: dto.query,
    });

    if (!limit) {
      throw new UserFacingError({
        code: "CHAT_APPLY_JSON_LIMIT_MISSING",
        userMessage: "Limit is missing. Please try again.",
      });
    }

    let provider = thread.defaultProvider ?? null;
    let kind = thread.defaultKind ?? null;

    if (requestedParser) {
      const r = resolveInternalFromParserId(requestedParser);
      provider = r.provider;

      const nextKind = requestedKind ?? kind ?? r.allowedKinds[0] ?? null;
      if (!nextKind) {
        throw new UserFacingError({
          code: "CHAT_THREAD_DEFAULTS_MISSING",
          userMessage: "Method (kind) is missing. Select parser/method again.",
        });
      }
      if (!r.allowedKinds.includes(nextKind)) {
        throw new UserFacingError({
          code: "CHAT_PARSER_KIND_NOT_ALLOWED",
          userMessage: "Selected parser does not support this method.",
        });
      }
      kind = nextKind;
    } else if (requestedKind) {
      if (!provider) {
        throw new UserFacingError({
          code: "CHAT_THREAD_DEFAULTS_MISSING",
          userMessage: "Parser is missing. Select parser first.",
        });
      }
      kind = requestedKind;
    }

    if (!provider || !kind) {
      throw new UserFacingError({
        code: "CHAT_THREAD_DEFAULTS_MISSING",
        userMessage:
          "Parser/method is missing. UI must provide it or set thread defaults.",
      });
    }

    const parser = resolveParserIdFromProvider(provider);
    const parserLabel = resolveParserLabelFromProvider(provider) ?? undefined;

    if (!parser) {
      throw new UserFacingError({
        code: "CHAT_PARSER_NOT_CONFIGURED",
        userMessage: "Selected parser is not configured on server.",
        debugMessage: `No public parser mapping for provider=${provider}`,
      });
    }

    const userJsonMessage = await this.chatRepository.createMessage({
      ownerId: userId,
      threadId,
      role: ChatMessageRole.USER,
      type: ChatMessageType.JSON,
      text: null,
      payload: dto.query as unknown as Json,
      authorUserId: userId,
    });

    const leadSearch = await this.chatRepository.createLeadSearchFromChat({
      createdById: userId,
      threadId,
      provider,
      kind,
      query: dto.query as unknown as Json,
      limit,
    });

    const eventMessage = await this.chatRepository.createMessage({
      ownerId: userId,
      threadId,
      role: ChatMessageRole.ASSISTANT,
      type: ChatMessageType.EVENT,
      text: "We started searching for leads.",
      payload: {
        event: "leadSearch.started",
        leadSearchId: leadSearch.id,
        parser,
        ...(parserLabel ? { parserLabel } : {}),
        kind,
        parsedMessageId: dto.parsedMessageId ?? null,
      } as unknown as Json,
      authorUserId: null,
      leadSearchId: leadSearch.id,
    });

    this.leadSearchRunnerService.dispatch(leadSearch.id, userId);

    return { leadSearchId: leadSearch.id, userJsonMessage, eventMessage };
  }

  /**
   * USER sends TEXT -> ASSISTANT returns JSON payload with outreach context
   */
  async parseOutreachPrompt(
    userId: string,
    threadId: string,
    dto: ParseOutreachPromptDto,
  ): Promise<ParseOutreachPromptResultDto> {
    // Validate directory exists and has leads
    const directory = await this.chatRepository.getDirectoryWithLeads(
      userId,
      dto.directoryId,
    );

    if (!directory) {
      throw new UserFacingError({
        code: "DIRECTORY_NOT_FOUND",
        userMessage: "Directory not found or you don't have access to it.",
      });
    }

    if (directory.leadCount === 0) {
      throw new UserFacingError({
        code: "DIRECTORY_EMPTY",
        userMessage: `Directory "${directory.name}" has no leads. Add leads first.`,
      });
    }

    if (!directory.firstLeadId) {
      throw new UserFacingError({
        code: "DIRECTORY_NO_VERIFIED_LEADS",
        userMessage: `Directory "${directory.name}" has no verified leads.`,
      });
    }

    const userMessage = await this.chatRepository.createMessage({
      ownerId: userId,
      threadId,
      role: ChatMessageRole.USER,
      type: ChatMessageType.TEXT,
      text: dto.text,
      payload: null,
      authorUserId: userId,
    });

    // Load user's custom instructions from DB
    const user = await getPrisma().user.findUnique({
      where: { id: userId },
      select: { customInstructions: true },
    });

    console.log("[parseOutreachPrompt] calling chatPromptParser.parseOutreachContext", {
      suggestedChannel: dto.suggestedChannel,
      leadId: directory.firstLeadId,
      text: dto.text,
      hasCustomInstructions: !!user?.customInstructions,
    });

    const parsed = await this.chatPromptParser.parseOutreachContext({
      text: dto.text,
      userId,
      threadId,
      leadId: directory.firstLeadId,
      directoryId: dto.directoryId,
      suggestedChannel: dto.suggestedChannel,
      customInstructions: user?.customInstructions ?? undefined,
      debug: false,
    });

    console.log("[parseOutreachPrompt] received from parser", {
      parsed,
    });

    // Calculate cadence parameters based on minimum message count in directory
    const minMessageCount = await this.leadConversationsRepository.getMinMessageCountInDirectory(
      dto.directoryId,
    );
    const cadenceParams = this.outreachCadenceService.calculateCadenceParameters(minMessageCount);

    console.log("[parseOutreachPrompt] calculated cadence parameters", {
      minMessageCount,
      calculatedFollowUpNumber: cadenceParams.followUpNumber,
      calculatedDayInSequence: cadenceParams.dayInSequence,
      parsedFollowUpNumber: parsed.followUpNumber,
      parsedDayInSequence: parsed.dayInSequence,
    });

    const context: OutreachContext = {
      channel: parsed.channel,
      stage: parsed.stage,
      // Use calculated values based on minimum message count instead of AI-parsed values
      dayInSequence: cadenceParams.dayInSequence,
      followUpNumber: cadenceParams.followUpNumber,
      suggestedTactic: parsed.suggestedTactic,
      leadId: parsed.leadId,
      directoryId: parsed.directoryId,
      userPrompt: stripMentions(dto.text), // Save user prompt without @mentions
    };

    console.log("[parseOutreachPrompt] created context", {
      context,
    });

    const assistantPayload = {
      type: "outreachContext",
      context,
      warnings: parsed.warnings,
    };

    const assistantMessage = await this.chatRepository.createMessage({
      ownerId: userId,
      threadId,
      role: ChatMessageRole.ASSISTANT,
      type: ChatMessageType.JSON,
      text: null,
      payload: assistantPayload as unknown as Json,
      authorUserId: null,
    });

    return {
      userMessage,
      assistantMessage,
      parsed: context,
    };
  }

  /**
   * USER applies outreach context => trigger outreach generation
   */
  async applyOutreachContext(
    userId: string,
    threadId: string,
    dto: ApplyOutreachContextDto,
  ): Promise<ApplyOutreachContextResultDto> {
    const userJsonMessage = await this.chatRepository.createMessage({
      ownerId: userId,
      threadId,
      role: ChatMessageRole.USER,
      type: ChatMessageType.JSON,
      text: null,
      payload: dto.context as unknown as Json,
      authorUserId: userId,
    });

    return { userJsonMessage };
  }
}
