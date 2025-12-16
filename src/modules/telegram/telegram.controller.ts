import { FastifyInstance } from "fastify";

import { container } from "@/container";
import { TelegramService } from "./telegram.service";
import { TELEGRAM_TYPES } from "./telegram.types";
import { TelegramUpdate } from "./telegram.dto";
import { msSince, nowNs } from "@/infra/observability";

export function registerTelegramRoutes(app: FastifyInstance) {
  const service = container.get<TelegramService>(
    TELEGRAM_TYPES.TelegramService,
  );

  app.post("/telegram/webhook", async (request, reply) => {
    try {
      const update = request.body as TelegramUpdate;
      const chatId =
        update.message?.chat?.id ??
        update.callback_query?.message?.chat?.id ??
        update.callback_query?.from?.id;

      const log = request.log.child({
        tgUpdateId: update.update_id,
        tgChatId: chatId ? String(chatId) : undefined,
      });

      const t0 = nowNs();
      log.info(
        {
          hasMessage: Boolean(update.message),
          hasCallbackQuery: Boolean(update.callback_query),
        },
        "Telegram webhook received",
      );

      void service
        .handleUpdate(update, log)
        .then(() => {
          log.info({ durationMs: msSince(t0) }, "Telegram update handled");
        })
        .catch((error) => {
          log.error({ err: error, durationMs: msSince(t0) }, "Error handling telegram update");
        });

      reply.code(200).send();
    } catch (error) {
      request.log.error({ err: error }, "Error handling telegram update");
      // Always respond 200 to prevent Telegram retries.
      reply.code(200).send();
    }
  });
}
