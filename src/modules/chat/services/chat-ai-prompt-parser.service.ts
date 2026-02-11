// src/modules/chat/parsers/chat-ai-prompt-parser.ts
import { inject, injectable } from "inversify";
import {
  LeadProvider as PrismaLeadProvider,
  LeadSearchKind as PrismaLeadSearchKind,
} from "@prisma/client";

import { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { AI_GRPC_CLIENT_TYPES } from "@/infra/ai-grpc-client/ai-grpc-client.types";
import { ApifyScraperQuerySchema } from "@/capabilities/scraper/scraper.dto";
import { stripMentions } from "@/modules/chat/utils/folder-mentions";
import type { ChatPromptParser } from "@/modules/chat/schemas/chat.dto";

import {
  OutreachChannel as ProtoOutreachChannel,
  LeadResponseType as ProtoLeadResponseType,
} from "@/generated/aisdr/v1/ai_sdr";

import {
  AiLeadDbOutputSchema,
  AiScraperOutputSchema,
  extractQueryFromParseResponse,
  mapKindToProto,
  mapLeadResponseTypeToProto,
  mapOutreachChannelFromProto,
  mapOutreachChannelToProto,
  mapOutreachStageFromProto,
  mapOutreachTacticFromProto,
  mapProviderToProto,
  toApifyScraperQuery,
  toLeadDbQuery,
  toScraperQuery,
} from "./parsers";

@injectable()
export class ChatAiPromptParserService implements ChatPromptParser {
  constructor(
    @inject(AI_GRPC_CLIENT_TYPES.AiGrpcClient)
    private readonly aiGrpcClient: AiGrpcClient,
  ) { }

  async parseOutreachContext(input: {
    text: string;
    userId: string;
    threadId: string;
    leadId: string;
    directoryId?: string;
    hasPreviousMessages?: boolean;
    previousMessagesCount?: number;
    lastLeadResponse?: string;
    suggestedChannel?: string;
    customInstructions?: string;
    debug?: boolean;
  }): Promise<{
    channel: string;
    stage: string;
    dayInSequence: number;
    followUpNumber: number;
    suggestedTactic: string;
    leadId: string;
    directoryId?: string;
    warnings?: Array<{ code: string; message: string }>;
    usedFallbackJsonMode?: boolean;
    rawModelOutput?: string;
  }> {
    const lastLeadResponse = mapLeadResponseTypeToProto(input.lastLeadResponse);
    const suggestedChannel = mapOutreachChannelToProto(input.suggestedChannel);

    console.log(
      "[ChatAiPromptParserService] parseOutreachContext - input mapping",
      {
        inputSuggestedChannel: input.suggestedChannel,
        mappedSuggestedChannel: suggestedChannel,
        inputLastLeadResponse: input.lastLeadResponse,
        mappedLastLeadResponse: lastLeadResponse,
      },
    );

    // Strip @mentions before sending to AI
    const cleanedText = stripMentions(input.text);

    const resp = await this.aiGrpcClient.parseOutreachContext({
      requestId: "",
      userId: input.userId,
      threadId: input.threadId,
      workspaceId: input.userId, // workspace_id = user_id
      leadId: input.leadId,
      directoryId: input.directoryId ?? "",
      text: cleanedText,
      hasPreviousMessages: input.hasPreviousMessages ?? false,
      previousMessagesCount: input.previousMessagesCount ?? 0,
      previousMessages: [], // TODO: Add actual conversation history if needed
      lastLeadResponse:
        lastLeadResponse ??
        ProtoLeadResponseType.LEAD_RESPONSE_TYPE_UNSPECIFIED,
      suggestedChannel:
        suggestedChannel ?? ProtoOutreachChannel.OUTREACH_CHANNEL_UNSPECIFIED,
      debug: input.debug ?? false,
      customInstructions: input.customInstructions ?? "",
    });

    console.log(
      "[ChatAiPromptParserService] parseOutreachContext - gRPC response",
      {
        rawResponse: resp,
        channelEnum: resp.channel,
        stageEnum: resp.stage,
        tacticEnum: resp.suggestedTactic,
      },
    );

    const result = {
      channel: mapOutreachChannelFromProto(resp.channel),
      stage: mapOutreachStageFromProto(resp.stage),
      dayInSequence: resp.dayInSequence,
      followUpNumber: resp.followUpNumber,
      suggestedTactic: mapOutreachTacticFromProto(resp.suggestedTactic),
      leadId: resp.leadId,
      directoryId: resp.directoryId || undefined,
      warnings: resp.warnings?.map((w) => ({
        code: w.code,
        message: w.message,
      })),
      usedFallbackJsonMode: resp.usedFallbackJsonMode,
      rawModelOutput: resp.rawModelOutput || undefined,
    };

    console.log(
      "[ChatAiPromptParserService] parseOutreachContext - mapped result",
      {
        result,
      },
    );

    return result;
  }

  async parsePrompt(input: {
    text: string;
    provider: PrismaLeadProvider;
    kind: PrismaLeadSearchKind;
  }): Promise<{ query: Record<string, unknown>; suggestedLimit?: number }> {
    const { provider, kind, text } = input;

    const resp = await this.aiGrpcClient.parseLeadSearchPrompt({
      requestId: "", // AiGrpcClient will set UUID if empty
      userId: "", // can be passed later if you extend the interface
      threadId: "",
      provider: mapProviderToProto(provider),
      kind: mapKindToProto(kind),
      text,
      defaultLimit: 100,
      maxLimit: 50_000,
      outputLanguage: "en",
      debug: false,
    });

    const extracted = extractQueryFromParseResponse(resp);
    const suggestedLimit = resp.limit > 0 ? resp.limit : undefined;

    if (extracted.kind === "leadDb") {
      const query = toLeadDbQuery(extracted.value);

      // final contract check (limit/query)
      const validated = AiLeadDbOutputSchema.safeParse({
        limit: suggestedLimit,
        query,
      });
      if (!validated.success) {
        throw new Error(
          `AI gRPC LeadDb output failed validation: ${validated.error.message}`,
        );
      }

      return {
        query: validated.data.query,
        suggestedLimit: validated.data.limit,
      };
    }

    // --- SCRAPER ---
    if (provider === PrismaLeadProvider.APIFY) {
      const query = toApifyScraperQuery(extracted.value);

      const parsed = ApifyScraperQuerySchema.safeParse({
        ...query,
        limit: suggestedLimit ?? query.limit ?? 100,
      });

      if (!parsed.success) {
        throw new Error(
          `AI gRPC Apify Scraper output failed validation: ${parsed.error.message}`,
        );
      }

      const { limit, ...queryNoLimit } = parsed.data;

      return {
        query: queryNoLimit,
        suggestedLimit: limit,
      };
    }

    // fallback: other providers keep old contract
    const query = toScraperQuery(extracted.value);

    const validated = AiScraperOutputSchema.safeParse({
      limit: suggestedLimit,
      query,
    });
    if (!validated.success) {
      throw new Error(
        `AI gRPC Scraper output failed validation: ${validated.error.message}`,
      );
    }

    return {
      query: validated.data.query,
      suggestedLimit: validated.data.limit,
    };
  }
}
