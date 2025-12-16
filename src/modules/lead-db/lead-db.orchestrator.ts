import { injectable, multiInject } from "inversify";
import {
  PrismaClient,
  ScraperProvider,
  ScraperRunStatus,
} from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import {
  LeadDbAdapter,
  LeadDbAdapterResult,
  LeadDbOrchestratorOptions,
  LeadDbOrchestratorResult,
  LeadDbQuery,
} from "./lead-db.dto";
import { LEAD_DB_TYPES } from "./lead-db.types";
import { msSince, nowNs, type LoggerLike } from "@/infra/observability";

@injectable()
export class LeadDbOrchestrator {
  private readonly prisma: PrismaClient = getPrisma();

  constructor(
    @multiInject(LEAD_DB_TYPES.LeadDbAdapter)
    private readonly adapters: LeadDbAdapter[],
  ) {}

  private getAdapter(provider: ScraperProvider): LeadDbAdapter | undefined {
    return this.adapters.find((a) => a.provider === provider);
  }

  async scrapeParallel(
    searchTaskId: string,
    query: LeadDbQuery,
    options: LeadDbOrchestratorOptions,
    log?: LoggerLike,
  ): Promise<LeadDbOrchestratorResult> {
    const t0 = nowNs();
    const { providersOrder } = options;

    const errors: Partial<Record<ScraperProvider, string>> = {};

    log?.info(
      {
        searchTaskId,
        providersOrder,
        limit: query.limit,
      },
      "Lead DB orchestrator: starting providers",
    );

    const tasks = providersOrder.map((provider) => ({
      provider,
      promise: this.runProvider(
        searchTaskId,
        provider,
        query,
        log?.child ? log.child({ provider }) : log,
      ),
    }));

    const settled = await Promise.allSettled(tasks.map((t) => t.promise));

    const resultsByProvider = new Map<ScraperProvider, LeadDbAdapterResult>();

    for (let i = 0; i < settled.length; i++) {
      const provider = tasks[i]?.provider;
      const item = settled[i];

      if (item.status === "fulfilled") {
        resultsByProvider.set(provider, item.value);
        log?.info(
          {
            searchTaskId,
            provider,
            leads: item.value.leads.length,
            providerRunId: item.value.providerRunId ?? undefined,
            fileNameHint: item.value.fileNameHint ?? undefined,
          },
          "Lead DB provider succeeded",
        );
      } else {
        const err: unknown = item.reason;
        const message =
          err instanceof Error ? err.message : String(err);
        errors[provider] = message;
        log?.error(
          { err, searchTaskId, provider },
          "Lead DB provider failed",
        );
      }
    }

    // Keep ordering
    const providerResults: LeadDbAdapterResult[] = [];
    for (const p of providersOrder) {
      const r = resultsByProvider.get(p);
      if (r) providerResults.push(r);
    }

    if (providerResults.length === 0) {
      throw new Error(`All lead DB providers failed: ${JSON.stringify(errors)}`);
    }

    log?.info(
      {
        searchTaskId,
        durationMs: msSince(t0),
        succeededProviders: providerResults.map((r) => r.provider),
        failedProviders: Object.keys(errors),
      },
      "Lead DB orchestrator: finished",
    );

    return { providerResults, errors };
  }

  private async runProvider(
    searchTaskId: string,
    provider: ScraperProvider,
    query: LeadDbQuery,
    log?: LoggerLike,
  ): Promise<LeadDbAdapterResult> {
    const t0 = nowNs();
    const adapter = this.getAdapter(provider);

    if (!adapter) {
      log?.error(
        { searchTaskId, provider },
        "Lead DB adapter not registered in DI container",
      );
      await this.prisma.scraperRun.create({
        data: {
          searchTaskId,
          provider,
          status: ScraperRunStatus.FAILED,
          errorMessage: "Adapter is not registered in DI container",
          leadsCount: 0,
        },
      });
      throw new Error(`Adapter not registered: ${provider}`);
    }

    if (!adapter.isEnabled()) {
      log?.warn({ searchTaskId, provider }, "Lead DB adapter disabled");
      await this.prisma.scraperRun.create({
        data: {
          searchTaskId,
          provider,
          status: ScraperRunStatus.FAILED,
          errorMessage: "Adapter is disabled (missing API key or disabled flag)",
          leadsCount: 0,
        },
      });
      throw new Error(`Adapter disabled: ${provider}`);
    }

    const run = await this.prisma.scraperRun.create({
      data: {
        searchTaskId,
        provider,
        status: ScraperRunStatus.RUNNING,
      },
    });

    try {
      log?.info(
        { searchTaskId, provider, scraperRunId: run.id, limit: query.limit },
        "Lead DB adapter scrape started",
      );
      const result = await adapter.scrape(query);

      await this.prisma.scraperRun.update({
        where: { id: run.id },
        data: {
          status: ScraperRunStatus.SUCCESS,
          leadsCount: result.leads.length,
          externalRunId: result.providerRunId ?? null,
          meta: {
            fileNameHint: result.fileNameHint ?? null,
          },
        },
      });

      log?.info(
        {
          searchTaskId,
          provider,
          scraperRunId: run.id,
          durationMs: msSince(t0),
          leads: result.leads.length,
          externalRunId: result.providerRunId ?? undefined,
        },
        "Lead DB adapter scrape completed",
      );

      return result;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);

      await this.prisma.scraperRun.update({
        where: { id: run.id },
        data: {
          status: ScraperRunStatus.FAILED,
          errorMessage: message,
          leadsCount: 0,
        },
      });

      log?.error(
        { err: e, searchTaskId, provider, scraperRunId: run.id, durationMs: msSince(t0) },
        "Lead DB adapter scrape failed",
      );
      throw e;
    }
  }
}
