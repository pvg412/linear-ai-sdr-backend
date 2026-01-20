import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config();

import { buildServer } from "./server";
import { startWorkers } from "./infra/queue/start-workers";
import { container } from "./container";
import { LEAD_SEARCH_TYPES } from "./modules/lead-search/lead-search.types";
import { LeadSearchRecoveryService } from "./modules/lead-search/services/lead-search.recovery.service";

async function start() {
  const { app, env } = await buildServer();

  const workers = startWorkers(app.log);

  // Recover any stuck RUNNING LeadSearch jobs (e.g. lost Redis state)
  // Only run in production to avoid side effects in dev/test
  if (env.NODE_ENV === "production") {
    setImmediate(() => {
      void (async () => {
        try {
          const recovery = container.get<LeadSearchRecoveryService>(
            LEAD_SEARCH_TYPES.LeadSearchRecoveryService,
          );
          await recovery.recover(app.log);
        } catch (err) {
          app.log.error({ err }, "LeadSearch recovery failed on startup");
        }
      })();
    });
  }

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, "Graceful shutdown started");

    try {
      await workers?.close();
    } catch (err) {
      app.log.error({ err }, "Workers shutdown failed");
    }

    try {
      await app.close();
    } catch (err) {
      app.log.error({ err }, "App close failed");
    }

    app.log.info({}, "Graceful shutdown finished");

    if (signal === "SIGUSR2") {
      process.kill(process.pid, "SIGUSR2");
      return;
    }

    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGUSR2", () => void shutdown("SIGUSR2"));
  process.once("uncaughtException", (err) => {
    app.log.error({ err }, "uncaughtException");
    void shutdown("uncaughtException");
  });
  process.once("unhandledRejection", (err) => {
    app.log.error({ err }, "unhandledRejection");
    void shutdown("unhandledRejection");
  });

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`Server listening on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
