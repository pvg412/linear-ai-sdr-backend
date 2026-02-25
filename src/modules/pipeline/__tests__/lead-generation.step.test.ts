/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-misused-promises */
import { LeadProvider, LeadSearchKind } from "@prisma/client";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { LeadGenerationStep } from "@/modules/pipeline/steps/lead-generation.step";
import type {
  PipelineContext,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";
import type { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import type { ServiceCatalogRepository } from "@/modules/service-catalog/persistence/service-catalog.repository";
import type { ScraperOrchestrator } from "@/capabilities/scraper/scraper.orchestrator";
import type { ScraperAdapter } from "@/capabilities/scraper/scraper.dto";
import type { LeadSearchRepository } from "@/modules/lead-search/persistence/lead-search.repository";
import type { LeadSearchRunRepository } from "@/modules/lead-search/persistence/lead-search-run.repository";
import type { LeadSearchLeadPersisterService } from "@/modules/lead-search/services/lead-search.lead-persister.service";
import type { NormalizedLead } from "@/capabilities/shared/leadValidate";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    pipelineRunId: "run-1",
    pipelineKey: "test-pipeline",
    createdById: "user-1",
    companyId: "company-1",
    ...overrides,
  };
}

function makeTools(opts?: { cancelled?: boolean }): PipelineTools {
  return {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    checkCancelled: vi.fn().mockResolvedValue(opts?.cancelled ?? false),
    emitProgress: vi.fn(),
  };
}

function makeLead(i: number): NormalizedLead {
  return {
    source: LeadProvider.APIFY,
    fullName: `Lead ${i}`,
    firstName: `First${i}`,
    lastName: `Last${i}`,
    email: `lead${i}@example.com`,
    linkedinUrl: `https://www.linkedin.com/in/lead-${i}/`,
    title: "CTO",
    company: `Company ${i}`,
    externalId: `ext-${i}`,
    raw: { id: `ext-${i}` },
  };
}

const FAKE_GRPC_RESPONSE = {
  requestId: "req-1",
  provider: 5, // LEAD_PROVIDER_APIFY
  kind: 2, // LEAD_SEARCH_KIND_SCRAPER
  limit: 100,
  scraperQuery: {
    industry: "Technology",
    titles: ["CTO"],
    locations: ["United States"],
    companySize: 0,
    companyKeywords: [],
  },
  warnings: [],
  usedFallbackJsonMode: false,
  rawModelOutput: "",
};

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

function createMockAdapter(): ScraperAdapter {
  return {
    provider: LeadProvider.APIFY,
    pollIntervalMs: 1000,
    maxPollAttempts: 10,
    isEnabled: vi.fn().mockReturnValue(true),
    start: vi.fn().mockResolvedValue({ providerRunId: "apify-run-1" }),
    checkStatus: vi.fn().mockResolvedValue({ status: "SUCCEEDED" }),
    fetchLeads: vi.fn().mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => makeLead(i)),
    ),
  };
}

function createMockOrchestrator(adapter: ScraperAdapter): ScraperOrchestrator {
  return {
    getAdapter: vi.fn().mockReturnValue(adapter),
    resolveAdapter: vi.fn().mockReturnValue({ ok: true, adapter }),
  } as unknown as ScraperOrchestrator;
}

function createMockAiGrpcClient() {
  return {
    parseLeadSearchPromptWithServiceCatalogs: vi.fn().mockResolvedValue(FAKE_GRPC_RESPONSE),
  } as unknown as AiGrpcClient;
}

function createMockServiceCatalogRepo() {
  return {
    listByCompany: vi.fn().mockResolvedValue([
      {
        id: "sc-1",
        name: "Web Development",
        companyId: "company-1",
        subServices: [
          {
            id: "ss-1",
            name: "Frontend",
            priority: 8,
            budgetMin: 5000,
            budgetMax: 50000,
            companyServiceCatalogId: "sc-1",
          },
        ],
      },
    ]),
  } as unknown as ServiceCatalogRepository;
}

function createMockLeadSearchRepo() {
  return {
    createSearch: vi.fn().mockResolvedValue({
      id: "ls-1",
      createdById: "user-1",
      provider: LeadProvider.APIFY,
      kind: LeadSearchKind.SCRAPER,
      status: "PENDING",
    }),
    markRunning: vi.fn().mockResolvedValue(undefined),
    markDone: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  } as unknown as LeadSearchRepository;
}

function createMockLeadSearchRunRepo() {
  return {
    getNextAttempt: vi.fn().mockResolvedValue(1),
    createRun: vi.fn().mockResolvedValue({
      id: "lsr-1",
      leadSearchId: "ls-1",
      provider: LeadProvider.APIFY,
      attempt: 1,
      status: "RUNNING",
    }),
    ensureExternalRunId: vi.fn().mockResolvedValue(undefined),
    markRunSuccess: vi.fn().mockResolvedValue(undefined),
    markRunFailed: vi.fn().mockResolvedValue(undefined),
  } as unknown as LeadSearchRunRepository;
}

function createMockPersister() {
  return {
    persistLeadsAndRelations: vi.fn().mockImplementation(
      (input: { leads: NormalizedLead[] }) =>
        Promise.resolve(input.leads.map((_, i) => `lead-id-${i}`)),
    ),
  } as unknown as LeadSearchLeadPersisterService;
}

function buildStep(overrides?: {
  aiGrpcClient?: AiGrpcClient;
  serviceCatalogRepo?: ServiceCatalogRepository;
  scraperOrchestrator?: ScraperOrchestrator;
  leadSearchRepo?: LeadSearchRepository;
  leadSearchRunRepo?: LeadSearchRunRepository;
  persister?: LeadSearchLeadPersisterService;
}) {
  const adapter = createMockAdapter();
  const step = new LeadGenerationStep(
    overrides?.aiGrpcClient ?? createMockAiGrpcClient(),
    overrides?.serviceCatalogRepo ?? createMockServiceCatalogRepo(),
    overrides?.scraperOrchestrator ?? createMockOrchestrator(adapter),
    overrides?.leadSearchRepo ?? createMockLeadSearchRepo(),
    overrides?.leadSearchRunRepo ?? createMockLeadSearchRunRepo(),
    overrides?.persister ?? createMockPersister(),
  );

  const mockPrisma = {
    pipelineRunLead: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    lead: {
      findMany: vi.fn().mockImplementation(
        (args: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            args.where.id.in.map((id, i) => ({
              id,
              fullName: `Lead ${i}`,
              email: `lead${i}@example.com`,
              company: `Company ${i}`,
            })),
          ),
      ),
    },
  };

  Object.defineProperty(step, "prisma", {
    value: mockPrisma,
    writable: true,
  });

  return { step, adapter, mockPrisma };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("LeadGenerationStep", () => {
  // Override the sleep module to avoid real delays in tests
  beforeEach(() => {
    vi.mock("@/capabilities/shared/polling", () => ({
      sleep: vi.fn().mockResolvedValue(undefined),
    }));
  });

  it("happy path: fetches leads via scraper and returns them in context", async () => {
    const persister = createMockPersister();
    const leadSearchRepo = createMockLeadSearchRepo();
    const leadSearchRunRepo = createMockLeadSearchRunRepo();
    const { step, mockPrisma } = buildStep({ persister, leadSearchRepo, leadSearchRunRepo });
    const tools = makeTools();

    const result = await step.run(makeCtx(), {}, tools);

    // Should persist 10 leads to PipelineRunLead
    expect(mockPrisma.pipelineRunLead.createMany).toHaveBeenCalledWith({
      data: Array.from({ length: 10 }, (_, i) => ({
        pipelineRunId: "run-1",
        leadId: `lead-id-${i}`,
      })),
      skipDuplicates: true,
    });
    expect(result.outputSummary).toEqual(
      expect.objectContaining({
        leadsFound: 10,
        source: "scraper",
        leadSearchId: "ls-1",
      }),
    );

    // Persister should have been called with the leads
    expect(persister.persistLeadsAndRelations).toHaveBeenCalledWith(
      expect.objectContaining({
        leadSearchId: "ls-1",
        runId: "lsr-1",
        provider: LeadProvider.APIFY,
        createdById: "user-1",
      }),
    );

    // LeadSearch should be marked done
    expect(leadSearchRepo.markDone).toHaveBeenCalledWith("ls-1", 10);
    expect(leadSearchRunRepo.markRunSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "lsr-1",
        leadsCount: 10,
        externalRunId: "apify-run-1",
      }),
    );
  });

  it("proceeds with empty service catalogs when companyId is null", async () => {
    const aiGrpcClient = createMockAiGrpcClient();
    const { step } = buildStep({ aiGrpcClient });
    const tools = makeTools();

    const ctx = makeCtx({ companyId: null });
    await step.run(ctx, {}, tools);

    // gRPC should be called with empty service catalogs
    expect(aiGrpcClient.parseLeadSearchPromptWithServiceCatalogs).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceCatalogs: [],
      }),
    );
  });

  it("maps service catalogs to proto format correctly", async () => {
    const aiGrpcClient = createMockAiGrpcClient();
    const serviceCatalogRepo = createMockServiceCatalogRepo();
    const { step } = buildStep({ aiGrpcClient, serviceCatalogRepo });
    const tools = makeTools();

    await step.run(makeCtx(), {}, tools);

    // Verify service catalogs are mapped correctly
    expect(aiGrpcClient.parseLeadSearchPromptWithServiceCatalogs).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceCatalogs: [
          {
            id: "sc-1",
            name: "Web Development",
            subServices: [
              {
                id: "ss-1",
                name: "Frontend",
                priority: 8,
                budgetMin: 5000,
                budgetMax: 50000,
              },
            ],
          },
        ],
      }),
    );
  });

  it("throws when lead search adapter is not available", async () => {
    const orchestrator = {
      getAdapter: vi.fn().mockReturnValue(undefined),
      resolveAdapter: vi.fn().mockReturnValue({
        ok: false,
        reason: "DISABLED",
        message: "Adapter is disabled (missing API key or disabled flag)",
      }),
    } as unknown as ScraperOrchestrator;

    const { step } = buildStep({ scraperOrchestrator: orchestrator });
    const tools = makeTools();

    await expect(step.run(makeCtx(), {}, tools)).rejects.toThrow(
      "Lead search provider is temporarily unavailable",
    );
  });

  it("propagates gRPC error when AI parsing fails", async () => {
    const aiGrpcClient = {
      parseLeadSearchPromptWithServiceCatalogs: vi.fn().mockRejectedValue(
        new Error("gRPC UNAVAILABLE: connection refused"),
      ),
    } as unknown as AiGrpcClient;

    const { step } = buildStep({ aiGrpcClient });
    const tools = makeTools();

    await expect(step.run(makeCtx(), {}, tools)).rejects.toThrow(
      "gRPC UNAVAILABLE: connection refused",
    );
  });

  it("marks search as failed when lead search run fails", async () => {
    const adapter = createMockAdapter();
    (adapter.checkStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "FAILED",
      raw: { statusMessage: "Rate limit exceeded" },
    });

    const orchestrator = createMockOrchestrator(adapter);
    const leadSearchRepo = createMockLeadSearchRepo();
    const leadSearchRunRepo = createMockLeadSearchRunRepo();
    const { step } = buildStep({
      scraperOrchestrator: orchestrator,
      leadSearchRepo,
      leadSearchRunRepo,
    });
    const tools = makeTools();

    await expect(step.run(makeCtx(), {}, tools)).rejects.toThrow(
      "Lead search run failed",
    );

    // Both search and run should be marked as failed
    expect(leadSearchRunRepo.markRunFailed).toHaveBeenCalledWith(
      "lsr-1",
      expect.stringContaining("APIFY run failed"),
    );
    expect(leadSearchRepo.markFailed).toHaveBeenCalledWith(
      "ls-1",
      expect.stringContaining("APIFY run failed"),
    );
  });

  it("marks search as failed when adapter start() throws", async () => {
    const adapter = createMockAdapter();
    (adapter.start as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Apify token invalid"),
    );

    const orchestrator = createMockOrchestrator(adapter);
    const leadSearchRepo = createMockLeadSearchRepo();
    const leadSearchRunRepo = createMockLeadSearchRunRepo();
    const { step } = buildStep({
      scraperOrchestrator: orchestrator,
      leadSearchRepo,
      leadSearchRunRepo,
    });
    const tools = makeTools();

    await expect(step.run(makeCtx(), {}, tools)).rejects.toThrow(
      "Apify token invalid",
    );

    expect(leadSearchRunRepo.markRunFailed).toHaveBeenCalledWith(
      "lsr-1",
      "Apify token invalid",
    );
    expect(leadSearchRepo.markFailed).toHaveBeenCalledWith(
      "ls-1",
      "Apify token invalid",
    );
  });

  it("returns early when cancelled during poll loop", async () => {
    const adapter = createMockAdapter();
    // Return RUNNING status so we enter the poll loop
    (adapter.checkStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "RUNNING",
    });

    const orchestrator = createMockOrchestrator(adapter);
    const leadSearchRepo = createMockLeadSearchRepo();
    const leadSearchRunRepo = createMockLeadSearchRunRepo();

    const tools = makeTools();
    // Cancel after the first poll check
    let pollCallCount = 0;
    (tools.checkCancelled as ReturnType<typeof vi.fn>).mockImplementation(() => {
      pollCallCount++;
      // First 3 calls (adapter resolve, after gRPC, start of poll loop) return false,
      // then cancel
      return Promise.resolve(pollCallCount > 3);
    });

    const { step } = buildStep({
      scraperOrchestrator: orchestrator,
      leadSearchRepo,
      leadSearchRunRepo,
    });

    const result = await step.run(makeCtx(), {}, tools);

    expect(result.outputSummary.leadsFound).toBe(0);
    expect(result.outputSummary.source).toBe("cancelled");

    // Search should be marked as failed with "Cancelled"
    expect(leadSearchRepo.markFailed).toHaveBeenCalledWith("ls-1", "Cancelled");
    expect(leadSearchRunRepo.markRunFailed).toHaveBeenCalledWith("lsr-1", "Cancelled");
  });

  it("handles provider returning fewer than LEAD_LIMIT leads", async () => {
    const adapter = createMockAdapter();
    const partialLeads = Array.from({ length: 7 }, (_, i) => makeLead(i));
    (adapter.fetchLeads as ReturnType<typeof vi.fn>).mockResolvedValue(partialLeads);

    const orchestrator = createMockOrchestrator(adapter);
    const persister = createMockPersister();
    const { step } = buildStep({
      scraperOrchestrator: orchestrator,
      persister,
    });
    const tools = makeTools();

    const result = await step.run(makeCtx(), {}, tools);

    expect(result.outputSummary.leadsFound).toBe(7);
    expect(result.outputSummary.source).toBe("scraper");
  });

  it("times out when lead search run stays in RUNNING state", async () => {
    const adapter = createMockAdapter();
    (adapter.checkStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "RUNNING",
    });

    const orchestrator = createMockOrchestrator(adapter);
    const leadSearchRepo = createMockLeadSearchRepo();
    const leadSearchRunRepo = createMockLeadSearchRunRepo();
    const { step } = buildStep({
      scraperOrchestrator: orchestrator,
      leadSearchRepo,
      leadSearchRunRepo,
    });
    const tools = makeTools();

    await expect(step.run(makeCtx(), {}, tools)).rejects.toThrow(
      "Lead search timed out",
    );

    expect(leadSearchRunRepo.markRunFailed).toHaveBeenCalledWith(
      "lsr-1",
      expect.stringContaining("poll timeout"),
    );
    expect(leadSearchRepo.markFailed).toHaveBeenCalledWith(
      "ls-1",
      expect.stringContaining("poll timeout"),
    );
  });
});
