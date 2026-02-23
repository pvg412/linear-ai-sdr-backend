import { inject, injectable } from "inversify";
import { LeadProvider, LeadSearchKind, Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { AI_GRPC_CLIENT_TYPES } from "@/infra/ai-grpc-client/ai-grpc-client.types";
import { UserFacingError } from "@/infra/userFacingError";

import { SERVICE_CATALOG_TYPES } from "@/modules/service-catalog/service-catalog.types";
import type { ServiceCatalogRepository } from "@/modules/service-catalog/persistence/service-catalog.repository";

import { SCRAPER_TYPES } from "@/capabilities/scraper/scraper.types";
import type { ScraperOrchestrator } from "@/capabilities/scraper/scraper.orchestrator";
import type { ScraperAdapter } from "@/capabilities/scraper/scraper.dto";
import { ApifyScraperQuerySchema } from "@/capabilities/scraper/scraper.dto";
import { sleep } from "@/capabilities/shared/polling";

import { LEAD_SEARCH_TYPES } from "@/modules/lead-search/lead-search.types";
import type { LeadSearchRepository } from "@/modules/lead-search/persistence/lead-search.repository";
import type { LeadSearchRunRepository } from "@/modules/lead-search/persistence/lead-search-run.repository";
import type { LeadSearchLeadPersisterService } from "@/modules/lead-search/services/lead-search.lead-persister.service";

import {
  extractQueryFromParseResponse,
  mapKindToProto,
  mapProviderToProto,
  toApifyScraperQuery,
} from "@/modules/chat/services/parsers";

import type {
  ServiceCatalogProto,
  ServiceCatalogSubServiceProto,
} from "@/generated/aisdr/v1/ai_sdr";

import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const HARDCODED_USER_TEXT = "Can you find 10 CTOs?";
const LEAD_LIMIT = 10;
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const MAX_POLL_ATTEMPTS = 30; // 30 × 30s = 15 min max

/* ------------------------------------------------------------------ */
/*  Step implementation                                                */
/* ------------------------------------------------------------------ */

/**
 * Lead Generation pipeline step.
 *
 * Uses APIFY as the sole lead source:
 * 1. Fetches company service catalogs from DB
 * 2. Calls AI gRPC to parse user text + catalogs into APIFY search params
 * 3. Starts an APIFY actor run, polls for completion
 * 4. Fetches, normalizes and persists exactly 100 leads
 */
@injectable()
export class LeadGenerationStep implements PipelineStepHandler {
  readonly type = "lead-generation";
  private readonly prisma: PrismaClient = getPrisma();

  constructor(
    @inject(AI_GRPC_CLIENT_TYPES.AiGrpcClient)
    private readonly aiGrpcClient: AiGrpcClient,
    @inject(SERVICE_CATALOG_TYPES.ServiceCatalogRepository)
    private readonly serviceCatalogRepo: ServiceCatalogRepository,
    @inject(SCRAPER_TYPES.ScraperOrchestrator)
    private readonly scraperOrchestrator: ScraperOrchestrator,
    @inject(LEAD_SEARCH_TYPES.LeadSearchRepository)
    private readonly leadSearchRepo: LeadSearchRepository,
    @inject(LEAD_SEARCH_TYPES.LeadSearchRunRepository)
    private readonly leadSearchRunRepo: LeadSearchRunRepository,
    @inject(LEAD_SEARCH_TYPES.LeadSearchLeadPersisterService)
    private readonly persister: LeadSearchLeadPersisterService,
  ) {}

  async run(
    ctx: PipelineContext,
    _config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    // ── Step 1: Resolve APIFY adapter ────────────────────────────────
    const resolved = this.scraperOrchestrator.resolveAdapter(LeadProvider.APIFY);
    if (!resolved.ok) {
      throw new UserFacingError({
        code: "LEAD_SEARCH_UNAVAILABLE",
        userMessage: "Lead search provider is temporarily unavailable",
      });
    }
    const adapter: ScraperAdapter = resolved.adapter;

    // ── Step 2: Fetch service catalogs ───────────────────────────────
    tools.emitProgress("Fetching service catalogs...");

    let serviceCatalogsProto: ServiceCatalogProto[] = [];
    if (ctx.companyId) {
      const catalogs = await this.serviceCatalogRepo.listByCompany(ctx.companyId);
      serviceCatalogsProto = catalogs.map((cat) => ({
        id: cat.id,
        name: cat.name,
        subServices: (cat.subServices ?? []).map(
          (sub): ServiceCatalogSubServiceProto => ({
            id: sub.id,
            name: sub.name,
            priority: sub.priority,
            budgetMin: sub.budgetMin,
            budgetMax: sub.budgetMax,
          }),
        ),
      }));
    }

    tools.log.info(
      { companyId: ctx.companyId, catalogCount: serviceCatalogsProto.length },
      "Service catalogs loaded",
    );

    // ── Step 3: Call AI gRPC to get APIFY search params ──────────────
    tools.emitProgress("Parsing search criteria via AI...");

    const grpcResp = await this.aiGrpcClient.parseLeadSearchPromptWithServiceCatalogs({
      base: {
        requestId: "",
        userId: ctx.createdById,
        threadId: "",
        provider: mapProviderToProto(LeadProvider.APIFY),
        kind: mapKindToProto(LeadSearchKind.SCRAPER),
        text: HARDCODED_USER_TEXT,
        defaultLimit: LEAD_LIMIT,
        maxLimit: LEAD_LIMIT,
        outputLanguage: "en",
        debug: false,
      },
      serviceCatalogs: serviceCatalogsProto,
    });

    const extracted = extractQueryFromParseResponse(grpcResp);
    if (extracted.kind !== "scraper") {
      throw new Error(
        `Expected scraper query from AI, got ${extracted.kind}`,
      );
    }

    const rawQuery = toApifyScraperQuery(extracted.value);
    const parsed = ApifyScraperQuerySchema.safeParse({
      ...rawQuery,
      limit: LEAD_LIMIT, // force 100
    });

    if (!parsed.success) {
      throw new Error(
        `AI gRPC returned invalid APIFY query: ${parsed.error.message}`,
      );
    }

    const apifyQuery = parsed.data;
    tools.log.info(
      { titles: apifyQuery.titles, industry: apifyQuery.industry },
      "AI parsed APIFY search criteria",
    );
    tools.emitProgress("AI parsed search criteria");

    if (await tools.checkCancelled()) return cancelledResult();

    // ── Step 4: Create LeadSearch + LeadSearchRun DB records ─────────
    const leadSearch = await this.leadSearchRepo.createSearch({
      createdById: ctx.createdById,
      provider: LeadProvider.APIFY,
      kind: LeadSearchKind.SCRAPER,
      query: apifyQuery as unknown as Prisma.InputJsonValue,
      limit: LEAD_LIMIT,
      prompt: HARDCODED_USER_TEXT,
    });

    await this.leadSearchRepo.markRunning(leadSearch.id);

    const attempt = await this.leadSearchRunRepo.getNextAttempt(
      leadSearch.id,
      LeadProvider.APIFY,
    );

    const run = await this.leadSearchRunRepo.createRun({
      leadSearchId: leadSearch.id,
      provider: LeadProvider.APIFY,
      attempt,
      triggeredById: ctx.createdById,
      requestPayload: apifyQuery as unknown as Prisma.InputJsonValue,
    });

    // ── Step 5: Start APIFY actor run ────────────────────────────────
    tools.emitProgress("Starting lead search...");
    let providerRunId: string;

    try {
      const startResult = await adapter.start(apifyQuery);
      providerRunId = startResult.providerRunId;
      await this.leadSearchRunRepo.ensureExternalRunId(run.id, providerRunId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.leadSearchRunRepo.markRunFailed(run.id, msg);
      await this.leadSearchRepo.markFailed(leadSearch.id, msg);
      throw err;
    }

    tools.log.info({ providerRunId }, "APIFY actor run started");
    tools.emitProgress("Lead search started");

    // ── Step 6: Inline poll loop ─────────────────────────────────────
    for (let pollAttempt = 1; pollAttempt <= MAX_POLL_ATTEMPTS; pollAttempt++) {
      if (await tools.checkCancelled()) {
        await this.leadSearchRunRepo.markRunFailed(run.id, "Cancelled");
        await this.leadSearchRepo.markFailed(leadSearch.id, "Cancelled");
        return cancelledResult();
      }

      await sleep(POLL_INTERVAL_MS);

      const status = await adapter.checkStatus(providerRunId);

      if (status.status === "SUCCEEDED") {
        tools.emitProgress("Lead search completed");
        break;
      }

      if (status.status === "FAILED") {
        const msg = `APIFY run failed: ${JSON.stringify(status.raw ?? "unknown")}`;
        await this.leadSearchRunRepo.markRunFailed(run.id, msg);
        await this.leadSearchRepo.markFailed(leadSearch.id, msg);
        throw new UserFacingError({
          code: "LEAD_SEARCH_RUN_FAILED",
          userMessage: "Lead search run failed",
          debugMessage: msg,
        });
      }

      tools.emitProgress(`Searching for leads... attempt ${pollAttempt}/${MAX_POLL_ATTEMPTS}`);

      if (pollAttempt === MAX_POLL_ATTEMPTS) {
        const msg = `APIFY poll timeout after ${MAX_POLL_ATTEMPTS} attempts`;
        await this.leadSearchRunRepo.markRunFailed(run.id, msg);
        await this.leadSearchRepo.markFailed(leadSearch.id, msg);
        throw new UserFacingError({
          code: "LEAD_SEARCH_POLL_TIMEOUT",
          userMessage: "Lead search timed out",
          debugMessage: msg,
        });
      }
    }

    if (await tools.checkCancelled()) {
      await this.leadSearchRunRepo.markRunFailed(run.id, "Cancelled");
      await this.leadSearchRepo.markFailed(leadSearch.id, "Cancelled");
      return cancelledResult();
    }

    // ── Step 7: Fetch + normalize leads ──────────────────────────────
    tools.emitProgress("Fetching leads...");

    const normalizedLeads = await adapter.fetchLeads({
      providerRunId,
      query: apifyQuery,
    });

    // Trim to exactly LEAD_LIMIT
    const trimmed = normalizedLeads.slice(0, LEAD_LIMIT);

    tools.log.info(
      { fetched: normalizedLeads.length, trimmed: trimmed.length },
      "Leads fetched and normalized",
    );
    tools.emitProgress(`Fetched ${trimmed.length} leads`);

    // ── Step 8: Persist leads ────────────────────────────────────────
    tools.emitProgress("Saving leads...");

    const leadIds = await this.persister.persistLeadsAndRelations({
      leadSearchId: leadSearch.id,
      runId: run.id,
      provider: LeadProvider.APIFY,
      leads: trimmed,
      createdById: ctx.createdById,
      log: tools.log,
    });

    await this.leadSearchRunRepo.markRunSuccess({
      runId: run.id,
      leadsCount: leadIds.length,
      externalRunId: providerRunId,
    });

    await this.leadSearchRepo.markDone(leadSearch.id, leadIds.length);

    // Insert leads into PipelineRunLead for downstream steps
    await this.prisma.pipelineRunLead.createMany({
      data: leadIds.map((leadId) => ({
        pipelineRunId: ctx.pipelineRunId,
        leadId,
      })),
      skipDuplicates: true,
    });

    tools.emitProgress(`Saved ${leadIds.length} leads`);

    // ── Step 9: Return result ────────────────────────────────────────
    return {
      outputSummary: {
        leadsFound: leadIds.length,
        source: "scraper",
        leadSearchId: leadSearch.id,
      },
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function cancelledResult(): PipelineStepResult {
  return {
    outputSummary: { leadsFound: 0, source: "cancelled" },
  };
}
