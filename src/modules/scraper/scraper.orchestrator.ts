import { injectable, multiInject } from "inversify";
import {
  PrismaClient,
  ScraperProvider,
  ScraperRunStatus,
} from "@prisma/client";

import {
  ScrapeQuery,
  ScraperAdapter,
  ScraperAdapterResult,
  ScraperOrchestratorOptions,
} from "./scraper.dto";
import { SCRAPER_TYPES } from "./scraper.types";
import { getPrisma } from "../../infra/prisma";

@injectable()
export class ScraperOrchestrator {
  private readonly prisma: PrismaClient = getPrisma();

  constructor(
    @multiInject(SCRAPER_TYPES.ScraperAdapter)
    private readonly adapters: ScraperAdapter[],
  ) {}

  private getAdapter(provider: ScraperProvider): ScraperAdapter | undefined {
    return this.adapters.find((a) => a.provider === provider);
  }

  async scrapeWithFallback(
    searchTaskId: string,
    query: ScrapeQuery,
    options: ScraperOrchestratorOptions,
  ): Promise<ScraperAdapterResult> {
    const {
      providersOrder,
      minLeads = 1,
      allowUnderDeliveryFallback = false,
    } = options;

    const errors: Partial<Record<ScraperProvider, string>> = {};

    for (const provider of providersOrder) {
      const adapter = this.getAdapter(provider);
      if (!adapter || !adapter.isEnabled()) {
        continue;
      }

      const run = await this.prisma.scraperRun.create({
        data: {
          searchTaskId,
          provider,
          status: ScraperRunStatus.RUNNING,
        },
      });

      try {
        console.log("scraping with adapter", adapter.provider);
        console.log("query", query);
        const result = await adapter.scrape(query);

        console.log("result", result);

        const leadsCount = result.leads.length;

        await this.prisma.scraperRun.update({
          where: { id: run.id },
          data: {
            status: ScraperRunStatus.SUCCESS,
            leadsCount,
            externalRunId: result.providerRunId ?? null,
            meta: {
              fileNameHint: result.fileNameHint ?? null,
            },
          },
        });

        if (leadsCount >= minLeads || !allowUnderDeliveryFallback) {
          return result;
        }

        errors[provider] = `Under-delivery: got ${leadsCount}, expected >= ${minLeads}`;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);

        await this.prisma.scraperRun.update({
          where: { id: run.id },
          data: {
            status: ScraperRunStatus.FAILED,
            errorMessage: message,
          },
        });

        errors[provider] = message;
      }
    }

    throw new Error(`All scrapers failed: ${JSON.stringify(errors)}`);
  }
}
