import type { Container } from "inversify";
import type { Queue } from "bullmq";

import { LEAD_SEARCH_TYPES } from "./lead-search.types";
import { QUEUE_TYPES } from "@/infra/queue/queue.types";

import { LeadSearchRunnerService } from "./lead-search.runner.service";
import { LeadSearchRunRepository } from "./persistence/lead-search-run.repository";
import { LeadSearchRepository } from "./persistence/lead-search.repository";
import { LeadDbLeadSearchHandler } from "./services/lead-db.lead-search.handler";
import { LeadSearchLeadPersisterService } from "./services/lead-search.lead-persister.service";
import { LeadSearchNotifierService } from "./services/lead-search.notifier.service";
import { LeadSearchQueryService } from "./services/lead-search.query.service";
import { ScraperInlineLeadSearchHandler } from "./services/scraper-inline.lead-search.handler";
import { ScraperStepLeadSearchHandler } from "./services/scraper-step.lead-search.handler";
import { LeadSearchRecoveryService } from "./services/lead-search.recovery.service";
import type {
  LeadSearchJobData,
  LeadSearchJobName,
} from "@/infra/queue/lead-search/lead-search.queue";

export function registerLeadSearchModule(container: Container) {
  container
    .bind<LeadSearchRunnerService>(LEAD_SEARCH_TYPES.LeadSearchRunnerService)
    .toDynamicValue((ctx) => {
      const leadSearchRepository = ctx.get<LeadSearchRepository>(
        LEAD_SEARCH_TYPES.LeadSearchRepository,
      );
      const leadDbHandler = ctx.get<LeadDbLeadSearchHandler>(
        LEAD_SEARCH_TYPES.LeadDbLeadSearchHandler,
      );
      const scraperInlineHandler = ctx.get<ScraperInlineLeadSearchHandler>(
        LEAD_SEARCH_TYPES.ScraperInlineLeadSearchHandler,
      );
      const scraperStepHandler = ctx.get<ScraperStepLeadSearchHandler>(
        LEAD_SEARCH_TYPES.ScraperStepLeadSearchHandler,
      );

      let queue: Queue<LeadSearchJobData, void, LeadSearchJobName> | undefined;
      try {
        queue = ctx.get<Queue<LeadSearchJobData, void, LeadSearchJobName>>(
          QUEUE_TYPES.LeadSearchQueue,
        );
      } catch {
        // Queue not registered (Redis not configured) - will run inline
        queue = undefined;
      }

      return new LeadSearchRunnerService({
        leadSearchRepository,
        leadDbHandler,
        scraperInlineHandler,
        scraperStepHandler,
        queue,
      });
    })
    .inSingletonScope();

  container
    .bind<LeadSearchQueryService>(LEAD_SEARCH_TYPES.LeadSearchQueryService)
    .to(LeadSearchQueryService)
    .inSingletonScope();

  container
    .bind<LeadSearchRunRepository>(LEAD_SEARCH_TYPES.LeadSearchRunRepository)
    .to(LeadSearchRunRepository)
    .inSingletonScope();

  container
    .bind<LeadSearchNotifierService>(
      LEAD_SEARCH_TYPES.LeadSearchNotifierService,
    )
    .to(LeadSearchNotifierService)
    .inSingletonScope();

  container
    .bind<LeadSearchLeadPersisterService>(
      LEAD_SEARCH_TYPES.LeadSearchLeadPersisterService,
    )
    .to(LeadSearchLeadPersisterService)
    .inSingletonScope();

  container
    .bind<LeadDbLeadSearchHandler>(LEAD_SEARCH_TYPES.LeadDbLeadSearchHandler)
    .to(LeadDbLeadSearchHandler)
    .inSingletonScope();

  container
    .bind<ScraperInlineLeadSearchHandler>(
      LEAD_SEARCH_TYPES.ScraperInlineLeadSearchHandler,
    )
    .to(ScraperInlineLeadSearchHandler)
    .inSingletonScope();

  container
    .bind<ScraperStepLeadSearchHandler>(
      LEAD_SEARCH_TYPES.ScraperStepLeadSearchHandler,
    )
    .to(ScraperStepLeadSearchHandler)
    .inSingletonScope();

  container
    .bind<LeadSearchRepository>(LEAD_SEARCH_TYPES.LeadSearchRepository)
    .to(LeadSearchRepository)
    .inSingletonScope();
  container
    .bind<LeadSearchRecoveryService>(
      LEAD_SEARCH_TYPES.LeadSearchRecoveryService,
    )
    .toDynamicValue((ctx) => {
      const leadSearchRepository = ctx.get<LeadSearchRepository>(
        LEAD_SEARCH_TYPES.LeadSearchRepository,
      );

      let queue: Queue<LeadSearchJobData, void, LeadSearchJobName> | undefined;
      try {
        queue = ctx.get<Queue<LeadSearchJobData, void, LeadSearchJobName>>(
          QUEUE_TYPES.LeadSearchQueue,
        );
      } catch {
        // Queue not registered (Redis not configured) - will skip recovery
        queue = undefined;
      }

      return new LeadSearchRecoveryService({ leadSearchRepository, queue });
    })
    .inSingletonScope();
}
