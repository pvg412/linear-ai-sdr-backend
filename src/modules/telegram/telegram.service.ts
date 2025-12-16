import { inject, injectable } from "inversify";
import { SearchTaskStatus } from "@prisma/client";

import { SEARCH_TASK_TYPES } from "../search-task/search-task.types";
import { SearchTaskCommandService } from "../search-task/search-task.commandService";
import { SearchTaskQueryService } from "../search-task/search-task.queryService";

import { SCRAPER_TYPES } from "../scraper/scraper.types";
import { SearchTaskScraperService } from "../scraper/searchTaskScraper.service";

import { LEAD_DB_TYPES } from "../lead-db/lead-db.types";
import { SearchTaskLeadDbService } from "../lead-db/searchTaskLeadDb.service";

import { AI_TYPES } from "../ai/ai.types";
import { AiPromptParserService } from "../ai/aiPromptParser.service";

import { TELEGRAM_TYPES } from "./telegram.types";
import { InlineKeyboardMarkup, TelegramClient } from "./telegram.client";
import { PendingIntent, SearchMethod, TelegramUpdate } from "./telegram.dto";
import { msSince, nowNs, safePreview, type LoggerLike } from "@/infra/observability";
import { getUserFacingMessage } from "@/infra/userFacingError";
import {
  industryToKeywordTokens,
  resolveScraperCityCompanyIndustry,
  shouldMoveIndustryToKeywords,
} from "../lead-db/adapters/scraperCity/scraperCity.companyIndustryResolver";

const CB = {
  methodDb: "method:LEAD_DB",
  methodScrape: "method:SCRAPING",
  start: "start",
  cancel: "cancel",
} as const;

@injectable()
export class TelegramService {
  private readonly pendingIntents = new Map<string, PendingIntent>();
  private static readonly LEAD_DB_MIN_LIMIT = 500;

  constructor(
    @inject(SEARCH_TASK_TYPES.SearchTaskCommandService)
    private readonly searchTaskCommandService: SearchTaskCommandService,

    @inject(SEARCH_TASK_TYPES.SearchTaskQueryService)
    private readonly searchTaskQueryService: SearchTaskQueryService,

    @inject(SCRAPER_TYPES.SearchTaskScraperService)
    private readonly searchTaskScraperService: SearchTaskScraperService,

    @inject(LEAD_DB_TYPES.SearchTaskLeadDbService)
    private readonly searchTaskLeadDbService: SearchTaskLeadDbService,

    @inject(AI_TYPES.AiPromptParserService)
    private readonly promptParser: AiPromptParserService,

    @inject(TELEGRAM_TYPES.TelegramClient)
    private readonly telegramClient: TelegramClient,

    @inject(TELEGRAM_TYPES.AllowedUserIds)
    private readonly allowedUserIds: Set<string>,
  ) {}

  async handleUpdate(update: TelegramUpdate, log?: LoggerLike): Promise<void> {
    const t0 = nowNs();

    if (update.callback_query) {
      await this.handleCallbackUpdate(update.callback_query, log);
      log?.info({ durationMs: msSince(t0) }, "Telegram callback_query handled");
      return;
    }

    await this.handleMessageUpdate(update.message, log);
    log?.info({ durationMs: msSince(t0) }, "Telegram prompt handled");
  }

  private async handleCallbackUpdate(
    q: TelegramUpdate["callback_query"] & { id: string },
    log?: LoggerLike,
  ): Promise<void> {
    const chatId = this.getChatIdFromCallback(q);
    log?.info(
      {
        callbackQueryId: q.id,
        tgFromId: String(q.from?.id ?? ""),
        tgChatId: chatId,
        data: q.data ?? undefined,
      },
      "Telegram callback_query received",
    );

    await this.handleCallback(q, log);
  }

  private async handleMessageUpdate(
    message: TelegramUpdate["message"],
    log?: LoggerLike,
  ): Promise<void> {
    if (!message || typeof message.text !== "string") {
      log?.debug({ hasMessage: Boolean(message) }, "Telegram update ignored (no text)");
      return;
    }

    const userId = message.from?.id;
    if (!userId) {
      log?.debug({}, "Telegram message ignored (no from.id)");
      return;
    }

    if (!this.isAllowedUserId(userId, log, "message")) return;

    const chatId = this.getChatIdFromMessage(message);
    const text = message.text.trim();

    log?.info(
      {
        tgFromId: String(userId),
        tgChatId: chatId,
        textPreview: safePreview(text, 160),
      },
      "Telegram message received",
    );

    if (this.looksLikeJson(text)) {
      await this.handleJsonOverride(chatId, text, log);
      log?.info({ tgChatId: chatId }, "Telegram JSON override handled");
      return;
    }

    if (this.isConfirmation(text)) {
      await this.handleConfirmation(chatId, log);
      log?.info({ tgChatId: chatId }, "Telegram confirmation handled");
      return;
    }

    await this.handleNewPrompt(chatId, text, log);
  }

  private async handleNewPrompt(
    chatId: string,
    prompt: string,
    log?: LoggerLike,
  ): Promise<void> {
    if (!prompt || prompt.length < 3) {
      await this.telegramClient.sendMessage(
        chatId,
        "Please send a request with at least 3 characters, e.g.: *Find 1000 web3 CTOs in the UK*.",
      );
      return;
    }

    try {
      const t0 = nowNs();
      log?.info({ promptPreview: safePreview(prompt, 200) }, "Parsing prompt");

      const params = await this.promptParser.parsePromptToSearchTaskInput({
        chatId,
        text: prompt,
      });

      this.setPendingIntent(chatId, { prompt, params });

      const jsonPreview = this.buildParamsPreviewJson(params);
      log?.info(
        {
          durationMs: msSince(t0),
          limit: params.limit,
          titlesCount: params.titles?.length ?? 0,
          locationsCount: params.locations?.length ?? 0,
          hasIndustry: Boolean(params.industry),
          hasLeadDbFilters: Boolean(params.leadDbFilters),
        },
        "Prompt parsed successfully",
      );

      await this.telegramClient.sendMessage(
        chatId,
        this.buildParsedRequestMessage({ prompt, jsonPreview }),
        { replyMarkup: this.buildChooseMethodKeyboard() },
      );
    } catch (error) {
      log?.error({ err: error }, "Error processing prompt");
      await this.telegramClient.sendMessage(
        chatId,
        "Sorry, I encountered an error processing your request.",
      );
    }
  }

  private async handleCallback(
    q: TelegramUpdate["callback_query"] & { id: string },
    log?: LoggerLike,
  ): Promise<void> {
    const fromId = q.from?.id;
    if (!fromId) {
      log?.debug({}, "Telegram callback ignored (no from.id)");
      return;
    }

    if (!this.isAllowedUserId(fromId, log, "callback")) return;

    const chatId = this.getChatIdFromCallback(q);
    const data = String(q.data ?? "");

    await this.telegramClient.answerCallbackQuery(q.id);

    switch (data) {
      case CB.cancel: {
        await this.cancelPending(chatId, log);
        return;
      }
      case CB.methodDb: {
        await this.selectMethod(chatId, "LEAD_DB", log);
        return;
      }
      case CB.methodScrape: {
        await this.selectMethod(chatId, "SCRAPING", log);
        return;
      }
      case CB.start: {
        await this.startPending(chatId, log);
        return;
      }
      default: {
        log?.debug({ tgChatId: chatId, data }, "Telegram callback ignored (unknown data)");
        return;
      }
    }
  }

  private async handleConfirmation(chatId: string, log?: LoggerLike): Promise<void> {
    // /ok fallback
    log?.info({ tgChatId: chatId }, "Telegram confirmation received (/ok)");
    await this.startPending(chatId, log);
  }

  private async cancelPending(chatId: string, log?: LoggerLike): Promise<void> {
    log?.info({ tgChatId: chatId }, "Telegram intent cancelled");
    this.pendingIntents.delete(chatId);
    await this.telegramClient.sendMessage(chatId, "Cancelled.");
  }

  private async selectMethod(
    chatId: string,
    method: SearchMethod,
    log?: LoggerLike,
  ): Promise<void> {
    const intent = this.pendingIntents.get(chatId);
    if (!intent) {
      log?.warn({ tgChatId: chatId }, "Telegram method selected but no pending intent");
      await this.telegramClient.sendMessage(chatId, "No pending request. Send a new query.");
      return;
    }

    this.setPendingIntent(chatId, { ...intent, method });

    log?.info(
      {
        tgChatId: chatId,
        method,
        promptPreview: safePreview(intent.prompt, 160),
      },
      "Telegram method selected",
    );

    await this.telegramClient.sendMessage(
      chatId,
      `Selected method: *${method === "LEAD_DB" ? "Lead DB" : "Scraping"}*`,
      { replyMarkup: this.buildStartKeyboard() },
    );
  }

  private async startPending(chatId: string, log?: LoggerLike): Promise<void> {
    const intent = this.pendingIntents.get(chatId);

    if (!intent) {
      log?.warn({ tgChatId: chatId }, "Telegram start requested but no pending intent");
      await this.telegramClient.sendMessage(chatId, "There is no pending request. Send a new query.");
      return;
    }

    if (!intent.method) {
      log?.info({ tgChatId: chatId }, "Telegram start requested but method not selected");
      await this.telegramClient.sendMessage(chatId, "Choose method first:", {
        replyMarkup: this.buildChooseMethodKeyboard(),
      });
      return;
    }

    try {
      const t0 = nowNs();
      const effectiveLimit = this.getEffectiveLimit(intent);

      log?.info(
        {
          tgChatId: chatId,
          method: intent.method,
          requestedLimit: intent.params.limit,
          effectiveLimit,
          promptPreview: safePreview(intent.prompt, 200),
        },
        "Creating SearchTask from Telegram intent",
      );

      const task = await this.searchTaskCommandService.createTask({
        ...intent.params,
        limit: effectiveLimit,
      });

      const taskLog = log?.child
        ? log.child({ searchTaskId: task.id, searchMethod: intent.method })
        : log;

      taskLog?.info({ durationMs: msSince(t0) }, "SearchTask created, starting execution");

      await this.telegramClient.sendMessage(
        chatId,
        `Starting *${intent.method === "LEAD_DB" ? "Lead DB" : "Scraping"}* search for *${effectiveLimit}* leads...`,
      );

      if (intent.method === "LEAD_DB") {
        await this.maybeWarnIndustryFallback(chatId, intent);
        await this.searchTaskLeadDbService.run(task.id, taskLog);
      } else {
        await this.searchTaskScraperService.run(task.id, taskLog);
      }

      await this.sendTaskCompletionMessage(chatId, task.id, taskLog);
      this.pendingIntents.delete(chatId);
      taskLog?.info({ durationMs: msSince(t0) }, "Telegram request fully processed");
    } catch (error) {
      log?.error({ err: error, tgChatId: chatId }, "Error starting telegram task");
      const userMsg = getUserFacingMessage(error);
      await this.telegramClient.sendMessage(chatId, userMsg ?? "Failed to start. Try again.");
    }
  }

  private async sendTaskCompletionMessage(
    chatId: string,
    taskId: string,
    log?: LoggerLike,
  ): Promise<void> {
    const task = await this.searchTaskQueryService.getById(taskId);
    if (!task) {
      log?.warn({ searchTaskId: taskId }, "SearchTask completion: task not found");
      await this.telegramClient.sendMessage(
        chatId,
        `Search completed, but task was not found anymore. Task id: \`${taskId}\`.`,
      );
      return;
    }

    const totalLeads = task.totalLeads ?? 0;
    const provider = task.scraperProvider ?? undefined;
    log?.info(
      {
        searchTaskId: task.id,
        status: task.status,
        totalLeads,
        provider,
        runId: task.runId ?? undefined,
        fileName: task.fileName ?? undefined,
      },
      "SearchTask finished",
    );

    if (task.status === SearchTaskStatus.DONE) {
      const details: string[] = [];
      if (provider) details.push(`Provider: \`${provider}\``);
      if (task.runId) details.push(`Run: \`${task.runId}\``);
      if (task.fileName) details.push(`File: \`${task.fileName}\``);

      await this.telegramClient.sendMessage(
        chatId,
        [
          `Done. Found *${totalLeads}* leads.`,
          details.length ? "" : undefined,
          details.length ? details.join("\n") : undefined,
          "",
          `Task id: \`${task.id}\``,
        ]
          .filter((x): x is string => Boolean(x))
          .join("\n"),
      );
      return;
    }

    if (task.status === SearchTaskStatus.DONE_NO_RESULTS) {
      await this.telegramClient.sendMessage(
        chatId,
        [
          "Done. No leads found for this request.",
          "",
          `Task id: \`${task.id}\``,
          "",
          "Try broadening the query: fewer titles, more locations, or a bigger company size range.",
        ].join("\n"),
      );
      return;
    }

    if (task.status === SearchTaskStatus.FAILED) {
      await this.telegramClient.sendMessage(
        chatId,
        [
          "Search failed.",
          task.errorMessage ? `Error: \`${task.errorMessage}\`` : undefined,
          `Task id: \`${task.id}\``,
        ]
          .filter((x): x is string => Boolean(x))
          .join("\n"),
      );
      return;
    }

    await this.telegramClient.sendMessage(
      chatId,
      `Search finished with status *${task.status}*. Task id: \`${task.id}\`.`,
    );
  }

  private async handleJsonOverride(
    chatId: string,
    text: string,
    log?: LoggerLike,
  ): Promise<void> {
    try {
      const raw = JSON.parse(text) as Record<string, unknown>;

      log?.info(
        { tgChatId: chatId, jsonPreview: safePreview(text, 300) },
        "Telegram JSON override received",
      );

      const params = await this.promptParser.parsePromptToSearchTaskInput({
        chatId,
        text: JSON.stringify(raw),
      });

      const current = this.pendingIntents.get(chatId);
      this.setPendingIntent(chatId, {
        prompt: current?.prompt ?? params.prompt,
        params,
        method: current?.method,
      });

      log?.info(
        {
          tgChatId: chatId,
          limit: params.limit,
          titlesCount: params.titles?.length ?? 0,
          locationsCount: params.locations?.length ?? 0,
          hasIndustry: Boolean(params.industry),
          hasLeadDbFilters: Boolean(params.leadDbFilters),
        },
        "Telegram JSON override parsed and stored",
      );

      await this.telegramClient.sendMessage(chatId, "JSON accepted. Now choose method or press Start.", {
        replyMarkup: {
          inline_keyboard: [
            [
              { text: "Lead DB", callback_data: CB.methodDb },
              { text: "Scraping", callback_data: CB.methodScrape },
            ],
            [{ text: "Start", callback_data: CB.start }],
            [{ text: "Cancel", callback_data: CB.cancel }],
          ],
        },
      });
    } catch {
      log?.warn({ tgChatId: chatId }, "Telegram JSON override parse failed");
      await this.telegramClient.sendMessage(chatId, "I couldn't parse your JSON. Make sure it's valid.");
    }
  }

  private isAllowedUserId(
    userId: number,
    log?: LoggerLike,
    source?: "message" | "callback",
  ): boolean {
    if (this.allowedUserIds.size === 0) return true;
    if (this.allowedUserIds.has(String(userId))) return true;
    log?.warn({ tgFromId: String(userId), source }, "Telegram update ignored (user not allowed)");
    return false;
  }

  private looksLikeJson(text: string): boolean {
    return text.trimStart().startsWith("{");
  }

  private isConfirmation(text: string): boolean {
    const lower = text.trim().toLowerCase();
    return lower === "/ok" || lower === "ok" || lower === "yes";
  }

  private getChatIdFromMessage(message: NonNullable<TelegramUpdate["message"]>): string {
    return String(message.chat.id);
  }

  private getChatIdFromCallback(q: TelegramUpdate["callback_query"] & { id: string }): string {
    return String(q.message?.chat.id ?? q.from.id);
  }

  private setPendingIntent(chatId: string, intent: PendingIntent): void {
    this.pendingIntents.set(chatId, intent);
  }

  private buildParsedRequestMessage(input: { prompt: string; jsonPreview: string }): string {
    return [
      "Parsed request:",
      "",
      `Prompt: \`${input.prompt}\``,
      "",
      "You can edit parameters by sending back edited JSON:",
      "",
      "```json",
      input.jsonPreview,
      "```",
      "",
      "Now choose search method:",
    ].join("\n");
  }

  private buildParamsPreviewJson(params: PendingIntent["params"]): string {
    const preview = {
      industry: params.industry ?? null,
      titles: params.titles ?? [],
      locations: params.locations ?? [],
      companySize: params.companySize ?? null,
      limit: params.limit,
      leadDbFilters: params.leadDbFilters ?? null,
    };
    return JSON.stringify(preview, null, 2);
  }

  private buildChooseMethodKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: "Lead DB", callback_data: CB.methodDb },
          { text: "Scraping", callback_data: CB.methodScrape },
        ],
        [{ text: "Cancel", callback_data: CB.cancel }],
      ],
    };
  }

  private buildStartKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{ text: "Start", callback_data: CB.start }],
        [{ text: "Cancel", callback_data: CB.cancel }],
      ],
    };
  }

  private getEffectiveLimit(intent: PendingIntent): number {
    if (intent.method !== "LEAD_DB") return intent.params.limit;
    return Math.max(intent.params.limit, TelegramService.LEAD_DB_MIN_LIMIT);
  }

  private async maybeWarnIndustryFallback(chatId: string, intent: PendingIntent): Promise<void> {
    const requestedIndustry =
      (intent.params.leadDbFilters as { companyIndustry?: string } | undefined)?.companyIndustry ??
      intent.params.industry;

    if (!requestedIndustry) return;

    const resolved = resolveScraperCityCompanyIndustry(requestedIndustry);
    if (resolved && !shouldMoveIndustryToKeywords(requestedIndustry)) return;

    const kw = industryToKeywordTokens(requestedIndustry);
    await this.telegramClient.sendMessage(
      chatId,
      [
        `Note: industry \`${requestedIndustry}\` is not a valid ScraperCity industry and will be used as \`companyKeywords\` instead.`,
        kw.length ? `Keywords: \`${kw.join(", ")}\`` : undefined,
        "",
        "ScraperCity industries follow LinkedIn taxonomy (strict values). Examples: `Computer Software`, `Information Technology & Services`, `Internet`.",
      ]
        .filter((x): x is string => Boolean(x))
        .join("\n"),
    );
  }
}
