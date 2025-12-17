import { injectable, multiInject } from "inversify";
import { PrismaClient, ScraperProvider, ScraperRunStatus } from "@prisma/client";

import type {
  ScrapeQuery,
  ScraperAdapter,
  ScraperAdapterResult,
  ScraperOrchestratorOptions,
} from "./scraper.dto";
import { SCRAPER_TYPES } from "./scraper.types";
import { getPrisma } from "@/infra/prisma";

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
    const { providersOrder, minLeads = 1, allowUnderDeliveryFallback = false } =
      options;

    const errors: Partial<Record<ScraperProvider, string>> = {};

    let bestResult: ScraperAdapterResult | undefined;
    let bestLeadsCount = -1;

    const enabledProviders = providersOrder.filter((provider) => {
      const adapter = this.getAdapter(provider);
      return adapter && adapter.isEnabled();
    });

    if (enabledProviders.length === 0) {
      throw new Error(
        `No enabled scraper adapters for providers: ${providersOrder.join(", ")}`,
      );
    }

    for (const provider of providersOrder) {
      const adapter = this.getAdapter(provider);
      if (!adapter || !adapter.isEnabled()) {
        errors[provider] = "Adapter not registered or disabled";
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
        const result = await adapter.scrape(query);
        const leadsCount = result.leads.length;

        if (leadsCount > bestLeadsCount) {
          bestLeadsCount = leadsCount;
          bestResult = result;
        }

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

    if (bestResult) return bestResult;

    throw new Error(`All scrapers failed: ${JSON.stringify(errors)}`);
  }
}
