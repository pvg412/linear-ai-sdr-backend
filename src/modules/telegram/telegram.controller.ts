import { FastifyInstance } from "fastify";

import { container } from "../../container";
import { TelegramService } from "./telegram.service";
import { TELEGRAM_TYPES } from "./telegram.types";
import { TelegramUpdate } from "./telegram.dto";

export function registerTelegramRoutes(app: FastifyInstance) {
  const service = container.get<TelegramService>(
    TELEGRAM_TYPES.TelegramService,
  );

  app.post("/telegram/webhook", async (request, reply) => {
    const update = request.body as TelegramUpdate;

    await service.handleUpdate(update);

    reply.code(200).send();
  });
}
