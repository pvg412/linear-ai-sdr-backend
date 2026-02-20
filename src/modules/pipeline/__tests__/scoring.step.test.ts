/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ScoringStep } from "@/modules/pipeline/steps/scoring.step";
import type { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import type { ServiceCatalogRepository } from "@/modules/service-catalog/persistence/service-catalog.repository";

import { makeCtx, makeTools, makeLeadRefs } from "./step-test.helpers";

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

/**
 * Build a mock Prisma that covers lead.findMany + leadScore.createMany.
 * Returns lead records whose ids match the requested set.
 */
function createMockPrisma(leadRecords?: Record<string, unknown>[]) {
  const defaultLeads = Array.from({ length: 30 }, (_, i) => ({
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
  }));

  const leads = leadRecords ?? defaultLeads;

  return {
    lead: {
      findMany: vi.fn().mockImplementation(
        (args: { where: { id: { in: string[] } } }) => {
          const ids = new Set(args.where.id.in);
          return Promise.resolve(leads.filter((l) => ids.has(l.id as string)));
        },
      ),
    },
    leadScore: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function buildStep(overrides?: {
  aiGrpcClient?: AiGrpcClient;
  serviceCatalogRepo?: ServiceCatalogRepository;
  prisma?: ReturnType<typeof createMockPrisma>;
}) {
  const aiGrpcClient = overrides?.aiGrpcClient ?? createMockAiGrpcClient();
  const serviceCatalogRepo =
    overrides?.serviceCatalogRepo ?? createMockServiceCatalogRepo();
  const mockPrisma = overrides?.prisma ?? createMockPrisma();

  const step = new ScoringStep(aiGrpcClient, serviceCatalogRepo);

  Object.defineProperty(step, "prisma", {
    value: mockPrisma,
    writable: true,
  });

  return { step, aiGrpcClient, serviceCatalogRepo, mockPrisma };
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
    });

    const leads = makeLeadRefs(3);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    // 2 leads pass threshold (60), 1 rejected
    expect(result.contextPatch.leads).toHaveLength(2);
    expect(result.outputSummary).toEqual(
      expect.objectContaining({
        passedCount: 2,
        rejectedCount: 1,
        total: 3,
      }),
    );

    // Sorted by score DESC: lead-0 (85) before lead-2 (70)
    const passed = result.contextPatch.leads!;
    expect(passed[0].id).toBe("lead-0");
    expect(passed[1].id).toBe("lead-2");

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
  });

  it("empty leads array returns zero summary with no calls", async () => {
    const { step, aiGrpcClient, mockPrisma } = buildStep();
    const ctx = makeCtx({ data: { leads: [] } });
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

    const { step } = buildStep({ aiGrpcClient });
    const leads = makeLeadRefs(3);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    // lead-1 rejected (score=0), lead-0 and lead-2 pass
    expect(result.contextPatch.leads).toHaveLength(2);
    expect(result.outputSummary.errors).toBe(1);

    // The errored lead details should contain the error
    const details = (
      result.contextPatch["scoring-initial"] as { details: { leadId: string; error?: string }[] }
    ).details;
    const erroredLead = details.find((d) => d.leadId === "lead-1");
    expect(erroredLead?.error).toContain("gRPC UNAVAILABLE");
  });

  it("all leads below threshold results in empty leads array", async () => {
    const scores: Record<string, { score: number; reasoning: string }> = {
      "lead-0": { score: 30, reasoning: "Low" },
      "lead-1": { score: 50, reasoning: "Below" },
    };

    const { step } = buildStep({
      aiGrpcClient: createMockAiGrpcClient(scores),
    });

    const leads = makeLeadRefs(2);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    expect(result.contextPatch.leads).toHaveLength(0);
    expect(result.outputSummary.passedCount).toBe(0);
    expect(result.outputSummary.rejectedCount).toBe(2);
  });

  it("null companyId sends empty service catalogs to gRPC", async () => {
    const { step, aiGrpcClient, serviceCatalogRepo } = buildStep();
    const leads = makeLeadRefs(1);
    const ctx = makeCtx({ companyId: null, data: { leads } });
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
    });

    const leads = makeLeadRefs(1);
    const ctx = makeCtx({ data: { leads } });
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
    const { step, mockPrisma } = buildStep();
    const leads = makeLeadRefs(25); // 3 batches of 10
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    // checkCancelled is called: (1) before batch loop, (2) before batch 0, (3) before batch 1
    // We want batch 0 to complete, then cancel before batch 1
    let callCount = 0;
    vi.mocked(tools.checkCancelled).mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount >= 3);
    });

    const result = await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    expect(result.contextPatch.leads).toEqual([]);
    expect(
      (result.contextPatch["scoring-initial"] as { cancelled?: boolean }).cancelled,
    ).toBe(true);

    // Partial scores should have been persisted (first batch of 10)
    expect(mockPrisma.leadScore.createMany).toHaveBeenCalled();
  });

  it("batching: 25 leads processes in 3 batches with progress per batch", async () => {
    const { step } = buildStep();
    const leads = makeLeadRefs(25);
    const ctx = makeCtx({ data: { leads } });
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

  it("DB lead missing falls back to LeadReference fields", async () => {
    // Prisma returns no leads — forces fallback to ref fields
    const mockPrisma = createMockPrisma([]);

    const { step, aiGrpcClient } = buildStep({ prisma: mockPrisma });
    const leads = makeLeadRefs(1);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    // gRPC should still be called with ref-based profile
    expect(aiGrpcClient.scoreLead).toHaveBeenCalledWith(
      expect.objectContaining({
        lead: expect.objectContaining({
          id: "lead-0",
          fullName: "Lead 0",
          company: "Company 0",
          // Fields that come from DB should be empty strings
          title: "",
          headline: "",
        }),
      }),
    );
  });

  it("config._stepId used as context key", async () => {
    const { step } = buildStep();
    const leads = makeLeadRefs(1);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-initial" }, tools);

    expect(result.contextPatch["scoring-initial"]).toBeDefined();
    expect(
      (result.contextPatch["scoring-initial"] as { scored: number }).scored,
    ).toBe(1);
  });
});
