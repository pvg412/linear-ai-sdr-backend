import { inject, injectable } from "inversify";
import { LeadSearchKind, LeadSearchStatus, Prisma } from "@prisma/client";

import {
  ensureLogger,
  msSince,
  nowNs,
  type LoggerLike,
} from "@/infra/observability";

import { LEAD_DB_TYPES } from "@/capabilities/lead-db/lead-db.types";
import { LeadDbOrchestrator } from "@/capabilities/lead-db/lead-db.orchestrator";
import { mergeAndTrimLeadDbResults } from "@/capabilities/lead-db/lead-db.merger";
import { LeadDbCanonicalFiltersSchema } from "@/capabilities/lead-db/lead-db.dto";

import { LEAD_SEARCH_TYPES } from "@/modules/lead-search/lead-search.types";
import { LeadSearchRepository } from "@/modules/lead-search/persistence/lead-search.repository";
import { LeadSearchRunRepository } from "@/modules/lead-search/persistence/lead-search-run.repository";
import { LeadSearchLeadPersisterService } from "@/modules/lead-search/services/lead-search.lead-persister.service";
import { LeadSearchNotifierService } from "@/modules/lead-search/services/lead-search.notifier.service";
import { withLeadSearchAsyncContext } from "@/infra/async-context/leadSearchAsyncContext";
import { getUserFacingMessage } from "@/infra/userFacingError";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLeadDbProviderRunIds(responseMeta: unknown): string[] {
  if (!isRecord(responseMeta)) return [];
  const leadDb = responseMeta.leadDb;
  if (!isRecord(leadDb)) return [];
  const ids = leadDb.providerRunIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((v): v is string => typeof v === "string" && v.length > 0);
}

@injectable()
export class LeadDbLeadSearchHandler {
  constructor(
    @inject(LEAD_SEARCH_TYPES.LeadSearchRepository)
    private readonly leadSearchRepository: LeadSearchRepository,

    @inject(LEAD_SEARCH_TYPES.LeadSearchRunRepository)
    private readonly leadSearchRunRepository: LeadSearchRunRepository,

    @inject(LEAD_DB_TYPES.LeadDbOrchestrator)
    private readonly leadDbOrchestrator: LeadDbOrchestrator,

    @inject(LEAD_SEARCH_TYPES.LeadSearchLeadPersisterService)
    private readonly persister: LeadSearchLeadPersisterService,

    @inject(LEAD_SEARCH_TYPES.LeadSearchNotifierService)
    private readonly notifier: LeadSearchNotifierService,
  ) {}

  async run(
    leadSearchId: string,
    triggeredById?: string,
    log?: LoggerLike,
  ): Promise<void> {
    const lg = ensureLogger(log);
    const t0 = nowNs();
    const userFinalMessage =
      "Failed to search: external service not responding. Please try again later.";

    const leadSearch = await this.leadSearchRepository.getById(leadSearchId);
    if (!leadSearch) throw new Error("LeadSearch not found");

    if (leadSearch.kind !== LeadSearchKind.LEAD_DB) {
      throw new Error(
        `LeadDbLeadSearchHandler called for kind=${leadSearch.kind}`,
      );
    }

    const provider = leadSearch.provider;
    const kind = leadSearch.kind;

    const parsedQuery = LeadDbCanonicalFiltersSchema.safeParse(
      leadSearch.query,
    );
    if (!parsedQuery.success) {
      const issues = parsedQuery.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));

      const msg = `Invalid LeadSearch.query schema: ${JSON.stringify(issues)}`;
      await this.leadSearchRepository.markFailed(leadSearchId, msg);

      await this.notifier.postEvent({
        threadId: leadSearch.threadId,
        leadSearchId,
        text: "Lead search failed: invalid JSON schema.",
        payload: {
          event: "leadSearch.failed",
          leadSearchId,
          status: LeadSearchStatus.FAILED,
          ...this.notifier.publicParserMeta(provider),
          kind,
          errorMessage: "Invalid JSON schema.",
          errorDetails: issues,
          durationMs: msSince(t0),
        },
      });

      throw new Error(msg);
    }

    const existingRun = await this.leadSearchRunRepository.findLatestRunningRun(
      leadSearchId,
      provider,
    );

    const attempt = existingRun
      ? existingRun.attempt
      : await this.leadSearchRunRepository.getNextAttempt(
          leadSearchId,
          provider,
        );

    const run = existingRun
      ? existingRun
      : await this.leadSearchRunRepository.createRun({
          leadSearchId,
          provider,
          attempt,
          triggeredById,
          requestPayload: {
            limit: leadSearch.limit,
            query: parsedQuery.data,
          } as Prisma.InputJsonValue,
        });

    // Ensure top-level LeadSearch is RUNNING (idempotent).
    await this.leadSearchRepository.markRunning(leadSearchId);

    lg.info(
      { leadSearchId, provider, attempt, limit: leadSearch.limit },
      "LeadSearch (LEAD_DB) run started",
    );

    try {
      let lastThrottleAtMs = 0;
      const metaIds = readLeadDbProviderRunIds(run.responseMeta);
      const resumeProviderRunIds =
        metaIds.length > 0
          ? metaIds
          : typeof run.externalRunId === "string" &&
              run.externalRunId.length > 0
            ? [run.externalRunId]
            : [];

      if (existingRun) {
        lg.info(
          {
            leadSearchId,
            runId: run.id,
            externalRunId: run.externalRunId ?? null,
            resumeProviderRunIdsCount: resumeProviderRunIds.length,
          },
          "LeadSearch (LEAD_DB) resuming existing RUNNING run",
        );
      }

      const { providerResults, errors } = await withLeadSearchAsyncContext(
        {
          onThrottle: (t) => {
            // Debounce to avoid WS spam during long waits.
            const now = Date.now();
            if (now - lastThrottleAtMs < 30_000) return;
            lastThrottleAtMs = now;

            void this.notifier.postEvent({
              threadId: leadSearch.threadId,
              leadSearchId,
              text: t.message,
              payload: {
                event: "leadSearch.throttled",
                leadSearchId,
                status: LeadSearchStatus.RUNNING,
                ...this.notifier.publicParserMeta(provider),
                kind,
                attempt,
                reason: t.reason,
                retryAfterMs: t.retryAfterMs,
                updatedAt: new Date().toISOString(),
              },
            });
          },
          onProviderRunId: async ({ providerRunId }) => {
            // Persist early to survive restarts between start() and completion polling.
            await this.leadSearchRunRepository.ensureExternalRunId(
              run.id,
              providerRunId,
            );
            await this.leadSearchRunRepository.appendLeadDbProviderRunId(
              run.id,
              providerRunId,
            );
          },
          resumeProviderRunIds:
            resumeProviderRunIds.length > 0 ? resumeProviderRunIds : undefined,
        },
        async () =>
          this.leadDbOrchestrator.scrape(
            leadSearchId,
            {
              limit: leadSearch.limit,
              filters: parsedQuery.data,
              fileName: `lead_search_${leadSearchId}`,
            },
            { providersOrder: [provider] },
            lg.child ? lg.child({ component: "LeadDbOrchestrator" }) : lg,
          ),
      );

      const merged = mergeAndTrimLeadDbResults(
        providerResults,
        leadSearch.limit,
      );

      const insertedLeadIds = await this.persister.persistLeadsAndRelations({
        leadSearchId,
        runId: run.id,
        provider,
        leads: merged,
        createdById: triggeredById,
        log: lg,
      });

      await this.leadSearchRunRepository.markRunSuccess({
        runId: run.id,
        leadsCount: insertedLeadIds.length,
        externalRunId: providerResults[0]?.providerRunId ?? null,
        responseMeta: {
          providerResults: providerResults.map((r) => ({
            provider: r.provider,
            providerRunId: r.providerRunId ?? null,
            fileNameHint: r.fileNameHint ?? null,
            leads: r.leads.length,
          })),
          errors,
        } as Prisma.InputJsonValue,
      });

      await this.leadSearchRepository.markDone(
        leadSearchId,
        insertedLeadIds.length,
      );

      const total = insertedLeadIds.length;
      const status =
        total > 0 ? LeadSearchStatus.DONE : LeadSearchStatus.DONE_NO_RESULTS;

      const durationMs = msSince(t0);
      const previewLimit = 100;
      const shown = Math.min(total, previewLimit);

      const previewLeads = merged.slice(0, shown).map((l, idx) => ({
        leadId: insertedLeadIds[idx] ?? null,
        fullName: l.fullName ?? null,
        title: l.title ?? null,
        company: l.company ?? null,
        email: l.email ?? null,
        linkedinUrl: l.linkedinUrl ?? null,
        companyDomain: l.companyDomain ?? null,
        location: l.location ?? null,
      }));

      await this.notifier.postEvent({
        threadId: leadSearch.threadId,
        leadSearchId,
        text:
          status === LeadSearchStatus.DONE_NO_RESULTS
            ? "No leads found for these filters"
            : `Lead search completed. Found ${total} leads`,
        payload: {
          event: "leadSearch.completed",
          leadSearchId,
          status,
          ...this.notifier.publicParserMeta(provider),
          kind,
          attempt,
          totalLeads: total,
          shownLeads: shown,
          previewLimit,
          previewLeads,
          durationMs,
        },
      });

      lg.info(
        { leadSearchId, provider, attempt, totalLeads: total, durationMs },
        "LeadSearch (LEAD_DB) run finished",
      );
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const publicMessage = getUserFacingMessage(err) ?? userFinalMessage;

      lg.warn(
        { leadSearchId, provider, runId: run.id, err: rawMessage },
        "LeadSearch (LEAD_DB) run failed",
      );

      await this.leadSearchRunRepository.markRunFailed(run.id, publicMessage);
      await this.leadSearchRepository.markFailed(leadSearchId, publicMessage);

      await this.notifier.postEvent({
        threadId: leadSearch.threadId,
        leadSearchId,
        text: "Lead search failed.",
        payload: {
          event: "leadSearch.failed",
          leadSearchId,
          status: LeadSearchStatus.FAILED,
          ...this.notifier.publicParserMeta(provider),
          kind,
          attempt,
          errorMessage: publicMessage,
          durationMs: msSince(t0),
        },
      });

      lg.error(
        { err, leadSearchId, provider, attempt },
        "LeadSearch (LEAD_DB) run failed",
      );
      throw err;
    }
  }
}
