import { inject, injectable } from "inversify";

import { SEARCH_TASK_TYPES } from "../search-task/search-task.types";
import { SearchTaskCommandService } from "../search-task/search-task.commandService";
import { SCRAPER_TYPES } from "../scraper/scraper.types";
import { SearchTaskScraperService } from "../scraper/searchTaskScraper.service";
import { AI_TYPES } from "../ai/ai.types";
import { AiPromptParserService } from "../ai/aiPromptParser.service";
import { TELEGRAM_TYPES } from "./telegram.types";
import { TelegramClient } from "./telegram.client";
import { PendingIntent, TelegramUpdate } from "./telegram.dto";


@injectable()
export class TelegramService {
  private readonly pendingIntents = new Map<string, PendingIntent>();

  constructor(
    @inject(SEARCH_TASK_TYPES.SearchTaskCommandService)
    private readonly searchTaskCommandService: SearchTaskCommandService,

    @inject(SCRAPER_TYPES.SearchTaskScraperService)
    private readonly searchTaskScraperService: SearchTaskScraperService,

    @inject(AI_TYPES.AiPromptParserService)
    private readonly promptParser: AiPromptParserService,

    @inject(TELEGRAM_TYPES.TelegramClient)
    private readonly telegramClient: TelegramClient,

    @inject(TELEGRAM_TYPES.AllowedUserIds)
    private readonly allowedUserIds: Set<string>,
  ) {}

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message || typeof message.text !== "string") return;

    const userId = message.from?.id;
    if (!userId) {
      return;
    }

    if (this.allowedUserIds.size > 0 && !this.allowedUserIds.has(String(userId))) {
      return;
    }

    const textRaw = message.text;
    const text = textRaw.trim();

    const chatId = String(message.chat.id);
    // const telegramMessageId = message.message_id;

    // 1. JSON-override: user sent edited JSON
    if (text.startsWith("{")) {
      await this.handleJsonOverride(chatId, text);
      return;
    }

    const lower = text.toLowerCase();

    // 2. Confirmation of the last intent: "/ok", "ok", "yes"
    if (lower === "/ok" || lower === "ok" || lower === "yes") {
      await this.handleConfirmation(chatId);
      return;
    }

    // 3. New request (prompt)
    await this.handleNewPrompt(chatId, text);
  }

  private async handleNewPrompt(chatId: string, prompt: string): Promise<void> {
    if (!prompt) {
      await this.telegramClient.sendMessage(
        chatId,
        "Please send a request like: *Find 100 web3 CTOs in the UK*.",
      );
      return;
    }

    const params = await this.promptParser.parsePromptToSearchTaskInput({
      chatId,
      text: prompt,
    });

    this.pendingIntents.set(chatId, { prompt, params });

    const preview = {
      industry: params.industry ?? null,
      titles: params.titles ?? [],
      locations: params.locations ?? [],
      companySize: params.companySize ?? null,
      limit: params.limit,
    };

    const jsonPreview = JSON.stringify(preview, null, 2);

    const lines = [
      "Here is how I understood your request:",
      "",
      `Prompt: \`${prompt}\``,
      "",
      "You can edit the search parameters by changing the JSON below and sending it back to me:",
      "",
      "```json",
      jsonPreview,
      "```",
      "",
      'If this looks correct, reply with "yes" or "/ok".',
      "If you want to change something, you can paste an edited JSON in your reply.",
    ];

    const messageText = lines.join("\n");

    await this.telegramClient.sendMessage(chatId, messageText);
  }

  private async handleConfirmation(chatId: string): Promise<void> {
    const intent = this.pendingIntents.get(chatId);

    if (!intent) {
      await this.telegramClient.sendMessage(
        chatId,
        "There is no pending search request. Please send a new query.",
      );
      return;
    }

    const task = await this.searchTaskCommandService.createTask(intent.params);

    await this.telegramClient.sendMessage(
      chatId,
      `Got it. Starting search for *${intent.params.limit}* leads...`,
    );

    await this.searchTaskScraperService.run(task.id);

    this.pendingIntents.delete(chatId);
  }

  private async handleJsonOverride(chatId: string, text: string): Promise<void> {
    try {
      const raw = JSON.parse(text) as Record<string, unknown>;

      const params = await this.promptParser.parsePromptToSearchTaskInput({
        chatId,
        text: JSON.stringify(raw),
      });

      const task = await this.searchTaskCommandService.createTask(params);

      await this.telegramClient.sendMessage(
        chatId,
        "JSON accepted. Starting search...",
      );

      await this.searchTaskScraperService.run(task.id);
      this.pendingIntents.delete(chatId);
    } catch {
      await this.telegramClient.sendMessage(
        chatId,
        "I couldn't parse your JSON. Please make sure it's valid.",
      );
    }
  }
}
