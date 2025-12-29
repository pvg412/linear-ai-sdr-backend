import { injectable, multiInject } from "inversify";
import { LeadProvider } from "@prisma/client";

import type { ScraperAdapter } from "./scraper.dto";
import { SCRAPER_TYPES } from "./scraper.types";

export type ScraperAdapterResolve =
  | { ok: true; adapter: ScraperAdapter }
  | { ok: false; reason: "NOT_REGISTERED" | "DISABLED"; message: string };

@injectable()
export class ScraperOrchestrator {
  constructor(
    @multiInject(SCRAPER_TYPES.ScraperAdapter)
    private readonly adapters: ScraperAdapter[],
  ) {}

  getAdapter(provider: LeadProvider): ScraperAdapter | undefined {
    return this.adapters.find((a) => a.provider === provider);
  }

  resolveAdapter(provider: LeadProvider): ScraperAdapterResolve {
    const adapter = this.getAdapter(provider);

    if (!adapter) {
      return {
        ok: false,
        reason: "NOT_REGISTERED",
        message: "Adapter is not registered in DI container",
      };
    }

    if (!adapter.isEnabled()) {
      return {
        ok: false,
        reason: "DISABLED",
        message: "Adapter is disabled (missing API key or disabled flag)",
      };
    }

    return { ok: true, adapter };
  }
}
