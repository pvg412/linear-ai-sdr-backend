/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ScoringStep } from "@/modules/pipeline/steps/scoring.step";
import type { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import type { ServiceCatalogRepository } from "@/modules/service-catalog/persistence/service-catalog.repository";
import type { LeadRagIndexSyncService } from "@/modules/lead-rag/services/lead-rag-index-sync.service";

import { makeCtx, makeTools } from "./step-test.helpers";

/* ------------------------------------------------------------------ */
/*  Mock factories                                                     */
/* ------------------------------------------------------------------ */

function createMockAiGrpcClient(
  scoreOverrides?: Record<string, { score: number; reasoning: string }>,
) {
  return {
    scoreLead: vi.fn().mockImplementation(
      (req: { lead: { id: string } }) => {
        const override = scoreOverrides?.[req.lead.id];
        return Promise.resolve({
          requestId: "resp-1",
          score: override?.score ?? 75,
          reasoning: override?.reasoning ?? "Good fit",
        });
      },
    ),
  } as unknown as AiGrpcClient;
}

function createMockServiceCatalogRepo(catalogs?: unknown[]) {
  return {
    listByCompany: vi.fn().mockResolvedValue(
      catalogs ?? [
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
    ),
  } as unknown as ServiceCatalogRepository;
}

function makeDbLead(i: number) {
  return {
    id: `lead-${i}`,
    fullName: `Lead ${i}`,
    title: `Title ${i}`,
    headline: `Headline ${i}`,
    company: `Company ${i}`,
    companyIndustry: "Technology",
    companySize: "MEDIUM_51_200",
    companyDomain: `company${i}.com`,
    location: "New York",
    companyLocation: "US",
    seniorityLevel: "SENIOR",
    department: "Engineering",
    linkedinUrl: `https://linkedin.com/in/lead-${i}`,
    yearsInPosition: 3,
    yearsInCompany: 5,
    totalExperienceYears: 10,
    currentPosition: `Position ${i}`,
  };
}

function makeRunLeads(count: number, leads?: ReturnType<typeof makeDbLead>[]) {
  const dbLeads = leads ?? Array.from({ length: count }, (_, i) => makeDbLead(i));
  return dbLeads.map((l) => ({
    id: `prl-${l.id}`,
    createdAt: new Date(),
    pipelineRunId: "run-1",
    leadId: l.id,
    lead: l,
    excluded: false,
    excludedByStepId: null,
  }));
}

/**
 * Build a mock Prisma that covers pipelineRunLead.findMany + lead.findMany + leadScore.createMany.
 */
function createMockRagSync() {
  return {
    enqueueUpsertLead: vi.fn().mockResolvedValue(undefined),
    enqueueUpsertLeads: vi.fn().mockResolvedValue(undefined),
    enqueueDeleteLead: vi.fn().mockResolvedValue(undefined),
  } as unknown as LeadRagIndexSyncService;
}

function createMockPrisma(opts?: {
  leadCount?: number;
  leadRecords?: ReturnType<typeof makeDbLead>[];
}) {
  const leads = opts?.leadRecords
    ?? Array.from({ length: opts?.leadCount ?? 30 }, (_, i) => makeDbLead(i));
  const runLeads = makeRunLeads(leads.length, leads);

  return {
    lead: {
      findMany: vi.fn().mockImplementation(
        (args: { where: { id: { in: string[] } } }) => {
          const ids = new Set(args.where.id.in);
          return Promise.resolve(leads.filter((l) => ids.has(l.id)));
        },
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    pipelineRunLead: {
      findMany: vi.fn().mockResolvedValue(runLeads),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    leadScore: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function buildStep(overrides?: {
  aiGrpcClient?: AiGrpcClient;
  serviceCatalogRepo?: ServiceCatalogRepository;
  ragSync?: LeadRagIndexSyncService;
  prisma?: ReturnType<typeof createMockPrisma>;
}) {
  const aiGrpcClient = overrides?.aiGrpcClient ?? createMockAiGrpcClient();
  const serviceCatalogRepo =
    overrides?.serviceCatalogRepo ?? createMockServiceCatalogRepo();
  const ragSync = overrides?.ragSync ?? createMockRagSync();
  const mockPrisma = overrides?.prisma ?? createMockPrisma();

  const step = new ScoringStep(aiGrpcClient, serviceCatalogRepo, ragSync);

  Object.defineProperty(step, "prisma", {
    value: mockPrisma,
    writable: true,
  });

  return { step, aiGrpcClient, serviceCatalogRepo, ragSync, mockPrisma };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("ScoringStep", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: scores leads, filters by threshold, sorts DESC", async () => {
    const scores: Record<string, { score: number; reasoning: string }> = {
      "lead-0": { score: 85, reasoning: "Excellent fit" },
      "lead-1": { score: 45, reasoning: "Poor fit" },
      "lead-2": { score: 70, reasoning: "Good fit" },
    };

    const { step, mockPrisma } = buildStep({
      aiGrpcClient: createMockAiGrpcClient(scores),
      prisma: createMockPrisma({ leadCount: 3 }),
    });

    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    // 2 leads pass threshold (60), 1 rejected
    expect(result.outputSummary).toEqual(
      expect.objectContaining({
        passedCount: 2,
        rejectedCount: 1,
        total: 3,
      }),
    );

    // DB persistence
    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ leadId: "lead-0", score: 85 }),
          expect.objectContaining({ leadId: "lead-1", score: 45 }),
          expect.objectContaining({ leadId: "lead-2", score: 70 }),
        ]),
      }),
    );

    // Rejected leads excluded in PipelineRunLead
    expect(mockPrisma.pipelineRunLead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leadId: { in: ["lead-1"] },
        }),
        data: { excluded: true, excludedByStepId: "scoring-initial" },
      }),
    );
  });

  it("empty leads array returns zero summary with no calls", async () => {
    const mockPrisma = createMockPrisma({ leadCount: 0 });
    const { step, aiGrpcClient } = buildStep({ prisma: mockPrisma });
    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    expect(result.outputSummary.total).toBe(0);
    expect(result.outputSummary.passedCount).toBe(0);
    expect(aiGrpcClient.scoreLead).not.toHaveBeenCalled();
    expect(mockPrisma.leadScore.createMany).not.toHaveBeenCalled();
  });

  it("gRPC error on one lead gives score=0, others succeed", async () => {
    const aiGrpcClient = {
      scoreLead: vi.fn().mockImplementation(
        (req: { lead: { id: string } }) => {
          if (req.lead.id === "lead-1") {
            return Promise.reject(new Error("gRPC UNAVAILABLE"));
          }
          return Promise.resolve({
            requestId: "r",
            score: 80,
            reasoning: "Good",
          });
        },
      ),
    } as unknown as AiGrpcClient;

    const { step } = buildStep({
      aiGrpcClient,
      prisma: createMockPrisma({ leadCount: 3 }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    // lead-1 rejected (score=0), lead-0 and lead-2 pass
    expect(result.outputSummary.passedCount).toBe(2);
    expect(result.outputSummary.rejectedCount).toBe(1);
    expect(result.outputSummary.errors).toBe(1);
  });

  it("all leads below threshold results in all rejected", async () => {
    const scores: Record<string, { score: number; reasoning: string }> = {
      "lead-0": { score: 30, reasoning: "Low" },
      "lead-1": { score: 50, reasoning: "Below" },
    };

    const { step } = buildStep({
      aiGrpcClient: createMockAiGrpcClient(scores),
      prisma: createMockPrisma({ leadCount: 2 }),
    });

    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    expect(result.outputSummary.passedCount).toBe(0);
    expect(result.outputSummary.rejectedCount).toBe(2);
  });

  it("null companyId sends empty service catalogs to gRPC", async () => {
    const { step, aiGrpcClient, serviceCatalogRepo } = buildStep({
      prisma: createMockPrisma({ leadCount: 1 }),
    });
    const ctx = makeCtx({ companyId: null });
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    expect(serviceCatalogRepo.listByCompany).not.toHaveBeenCalled();
    expect(aiGrpcClient.scoreLead).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceCatalogs: [],
      }),
    );
  });

  it("maps service catalogs to proto format correctly", async () => {
    const catalogs = [
      {
        id: "sc-1",
        name: "AI Services",
        subServices: [
          {
            id: "ss-1",
            name: "NLP",
            priority: 9,
            budgetMin: 10000,
            budgetMax: 100000,
          },
          {
            id: "ss-2",
            name: "Vision",
            priority: 5,
            budgetMin: 5000,
            budgetMax: 50000,
          },
        ],
      },
    ];

    const { step, aiGrpcClient } = buildStep({
      serviceCatalogRepo: createMockServiceCatalogRepo(catalogs),
      prisma: createMockPrisma({ leadCount: 1 }),
    });

    const ctx = makeCtx();
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    expect(aiGrpcClient.scoreLead).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceCatalogs: [
          {
            id: "sc-1",
            name: "AI Services",
            subServices: [
              { id: "ss-1", name: "NLP", priority: 9, budgetMin: 10000, budgetMax: 100000 },
              { id: "ss-2", name: "Vision", priority: 5, budgetMin: 5000, budgetMax: 50000 },
            ],
          },
        ],
      }),
    );
  });

  it("cancellation mid-batch persists partial scores and returns cancelled result", async () => {
    const { step, mockPrisma } = buildStep({
      prisma: createMockPrisma({ leadCount: 25 }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    // checkCancelled is called: (1) before batch loop, (2) before batch 0, (3) before batch 1
    // We want batch 0 to complete, then cancel before batch 1
    let callCount = 0;
    vi.mocked(tools.checkCancelled).mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount >= 3);
    });

    const result = await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    expect(result.outputSummary.cancelled).toBe(true);

    // Partial scores should have been persisted (first batch of 10)
    expect(mockPrisma.leadScore.createMany).toHaveBeenCalled();
  });

  it("batching: 25 leads processes in 3 batches with progress per batch", async () => {
    const { step } = buildStep({
      prisma: createMockPrisma({ leadCount: 25 }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    // emitProgress is called for: loading profiles, loading catalogs,
    // "Scoring leads via AI", 3 batch updates, saving to DB, final summary
    const progressCalls = (tools.emitProgress as ReturnType<typeof vi.fn>).mock.calls;
    const batchProgressCalls = progressCalls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].startsWith("Scored "),
    );
    expect(batchProgressCalls).toHaveLength(3);
  });

  it("DB lead missing falls back to empty fields", async () => {
    // pipelineRunLead returns a lead with null lead record
    const mockPrisma = createMockPrisma({ leadCount: 1 });
    // Override pipelineRunLead.findMany to return a record with no lead
    vi.mocked(mockPrisma.pipelineRunLead.findMany).mockResolvedValue([
      {
        id: "prl-lead-0",
        createdAt: new Date(),
        pipelineRunId: "run-1",
        leadId: "lead-0",
        lead: undefined,
        excluded: false,
        excludedByStepId: null,
      },
    ]);

    const { step, aiGrpcClient } = buildStep({ prisma: mockPrisma });
    const ctx = makeCtx();
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    // gRPC should still be called with empty-string fallback profile
    expect(aiGrpcClient.scoreLead).toHaveBeenCalledWith(
      expect.objectContaining({
        lead: expect.objectContaining({
          id: "lead-0",
          fullName: "",
          title: "",
          headline: "",
        }),
      }),
    );
  });

  it("outputSummary contains scored count", async () => {
    const { step } = buildStep({
      prisma: createMockPrisma({ leadCount: 1 }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    expect(result.outputSummary).toBeDefined();
    expect(result.outputSummary.total).toBe(1);
  });
});
