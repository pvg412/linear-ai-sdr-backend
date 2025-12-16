import axios from "axios";
import { injectable } from "inversify";

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

@injectable()
export class TelegramClient {
  private readonly baseUrl: string;

  constructor(private readonly botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async sendMessage(
    chatId: string | number,
    text: string,
    opts?: { replyMarkup?: InlineKeyboardMarkup },
  ): Promise<void> {
    await axios.post(`${this.baseUrl}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      ...(opts?.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
    });
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
  ): Promise<void> {
    await axios.post(`${this.baseUrl}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }
}
