import axios from "axios";
import { injectable } from "inversify";

@injectable()
export class TelegramClient {
  private readonly baseUrl: string;

  constructor(private readonly botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async sendMessage(chatId: string | number, text: string): Promise<void> {
    await axios.post(`${this.baseUrl}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    });
  }
}
