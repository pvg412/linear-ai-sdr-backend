/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { FinalScoringStep } from "@/modules/pipeline/steps/final-scoring.step";
import type { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import type { ServiceCatalogRepository } from "@/modules/service-catalog/persistence/service-catalog.repository";

import { makeCtx, makeTools, makeLeadRefs } from "./step-test.helpers";

/* ------------------------------------------------------------------ */
/*  Constants (mirrored from FINAL_SCORING_CONSTANTS for assertions)    */
/* ------------------------------------------------------------------ */

const ICP_FIT_WEIGHT = 0.7;
const SIGNAL_STRENGTH_WEIGHT = 0.3;
const SIGNAL_STRENGTH_STUB = 50;

/* ------------------------------------------------------------------ */
/*  Mock factories                                                     */
/* ------------------------------------------------------------------ */

function createMockAiGrpcClient(
  icpOverrides?: Record<string, { icpFit: number; icpReasoning: string }>,
) {
  return {
    scoreLeadFinal: vi.fn().mockImplementation(
      (req: { lead: { id: string } }) => {
        const override = icpOverrides?.[req.lead.id];
        return Promise.resolve({
          requestId: "resp-1",
          icpFit: override?.icpFit ?? 75,
          icpReasoning: override?.icpReasoning ?? "Good ICP fit",
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

function makeCompanyResearch(
  leadId: string,
  opts?: {
    status?: string;
    items?: { date: string; summary: string; sourceUrl: string; category: string; source: string }[];
    createdAt?: Date;
  },
) {
  return {
    id: `cr-${leadId}`,
    leadId,
    status: opts?.status ?? "COMPLETED",
    createdAt: opts?.createdAt ?? new Date("2026-01-15"),
    items: opts?.items ?? [
      {
        date: "2026-01-10",
        summary: "Company raised Series B",
        sourceUrl: "https://example.com/news",
        category: "NEWS",
        source: "perplexity",
      },
      {
        date: "2026-01-05",
        summary: "New product launch",
        sourceUrl: "https://example.com/blog",
        category: "BLOG",
        source: "perplexity",
      },
    ],
  };
}

function createMockPrisma(opts?: {
  leads?: ReturnType<typeof makeDbLead>[];
  companyResearches?: ReturnType<typeof makeCompanyResearch>[];
}) {
  const defaultLeads = Array.from({ length: 30 }, (_, i) => makeDbLead(i));
  const leads = opts?.leads ?? defaultLeads;
  const companyResearches = opts?.companyResearches ?? [];

  return {
    lead: {
      findMany: vi.fn().mockImplementation(
        (args: { where: { id: { in: string[] } } }) => {
          const ids = new Set(args.where.id.in);
          return Promise.resolve(leads.filter((l) => ids.has(l.id)));
        },
      ),
    },
    companyResearch: {
      findMany: vi.fn().mockResolvedValue(companyResearches),
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

  const step = new FinalScoringStep(aiGrpcClient, serviceCatalogRepo);

  Object.defineProperty(step, "prisma", {
    value: mockPrisma,
    writable: true,
  });

  return { step, aiGrpcClient, serviceCatalogRepo, mockPrisma };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("FinalScoringStep", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: scores leads with company research and persists all component fields", async () => {
    const icpOverrides: Record<string, { icpFit: number; icpReasoning: string }> = {
      "lead-0": { icpFit: 90, icpReasoning: "Excellent ICP match" },
      "lead-1": { icpFit: 60, icpReasoning: "Moderate fit" },
      "lead-2": { icpFit: 40, icpReasoning: "Weak fit" },
    };

    const companyResearches = [
      makeCompanyResearch("lead-0"),
      makeCompanyResearch("lead-1"),
    ];

    const { step, aiGrpcClient, mockPrisma } = buildStep({
      aiGrpcClient: createMockAiGrpcClient(icpOverrides),
      prisma: createMockPrisma({ companyResearches }),
    });

    const leads = makeLeadRefs(3);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-final" }, tools);

    // All 3 leads pass through (no filtering)
    expect(result.contextPatch.leads).toHaveLength(3);

    // gRPC called for each lead
    expect(aiGrpcClient.scoreLeadFinal).toHaveBeenCalledTimes(3);

    // lead-0 has company research items passed to gRPC
    const call0 = (aiGrpcClient.scoreLeadFinal as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { lead: { id: string } }).lead.id === "lead-0",
    );
    expect(call0).toBeDefined();
    expect((call0![0] as { companyResearchItems: unknown[] }).companyResearchItems).toHaveLength(2);

    // DB persistence includes all component fields
    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            leadId: "lead-0",
            icpFit: 90,
            signalStrength: SIGNAL_STRENGTH_STUB,
            finalScore: Math.round(90 * ICP_FIT_WEIGHT + SIGNAL_STRENGTH_STUB * SIGNAL_STRENGTH_WEIGHT),
          }),
        ]),
      }),
    );
  });

  it("empty leads returns zero summary with no calls", async () => {
    const { step, aiGrpcClient, mockPrisma } = buildStep();
    const ctx = makeCtx({ data: { leads: [] } });
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(result.outputSummary.total).toBe(0);
    expect(aiGrpcClient.scoreLeadFinal).not.toHaveBeenCalled();
    expect(mockPrisma.leadScore.createMany).not.toHaveBeenCalled();
  });

  it("lead with no company research sends empty items to gRPC", async () => {
    // No company research records at all
    const { step, aiGrpcClient } = buildStep({
      prisma: createMockPrisma({ companyResearches: [] }),
    });

    const leads = makeLeadRefs(1);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(aiGrpcClient.scoreLeadFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        companyResearchItems: [],
      }),
    );
  });

  it("multiple researches per lead uses most recent COMPLETED one", async () => {
    const olderResearch = makeCompanyResearch("lead-0", {
      createdAt: new Date("2026-01-01"),
      items: [{ date: "2025-12-01", summary: "Old news", sourceUrl: "https://old.com", category: "NEWS", source: "perplexity" }],
    });
    const newerResearch = makeCompanyResearch("lead-0", {
      createdAt: new Date("2026-02-01"),
      items: [{ date: "2026-01-20", summary: "Recent news", sourceUrl: "https://recent.com", category: "NEWS", source: "perplexity" }],
    });
    // Newer comes first since findMany orders by createdAt desc
    newerResearch.id = "cr-lead-0-new";

    const { step, aiGrpcClient } = buildStep({
      prisma: createMockPrisma({ companyResearches: [newerResearch, olderResearch] }),
    });

    const leads = makeLeadRefs(1);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    // Only the newer research item should be sent
    const call = (aiGrpcClient.scoreLeadFinal as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const items = (call[0] as { companyResearchItems: { summary: string }[] }).companyResearchItems;
    expect(items).toHaveLength(1);
    expect(items[0].summary).toBe("Recent news");
  });

  it("company research items mapped to proto correctly", async () => {
    const research = makeCompanyResearch("lead-0", {
      items: [
        { date: "2026-01-10", summary: "News item", sourceUrl: "https://news.com", category: "NEWS", source: "perplexity" },
        { date: "", summary: "Blog post", sourceUrl: "https://blog.com", category: "BLOG", source: "linkedin" },
      ],
    });

    const { step, aiGrpcClient } = buildStep({
      prisma: createMockPrisma({ companyResearches: [research] }),
    });

    const leads = makeLeadRefs(1);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    const call = (aiGrpcClient.scoreLeadFinal as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const items = (call[0] as { companyResearchItems: { index: number; sourceName: string; summary: string }[] }).companyResearchItems;
    expect(items).toHaveLength(2);
    // index is 1-based
    expect(items[0].index).toBe(1);
    expect(items[1].index).toBe(2);
    // sourceName mapped from source
    expect(items[0].sourceName).toBe("perplexity");
    expect(items[1].sourceName).toBe("linkedin");
  });

  it("gRPC error on one lead gives icpFit=0 but lead still passes through", async () => {
    const aiGrpcClient = {
      scoreLeadFinal: vi.fn().mockImplementation(
        (req: { lead: { id: string } }) => {
          if (req.lead.id === "lead-1") {
            return Promise.reject(new Error("gRPC timeout"));
          }
          return Promise.resolve({
            requestId: "r",
            icpFit: 80,
            icpReasoning: "Good",
          });
        },
      ),
    } as unknown as AiGrpcClient;

    const { step } = buildStep({ aiGrpcClient });
    const leads = makeLeadRefs(3);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-final" }, tools);

    // All 3 leads pass through (no filtering in final scoring)
    expect(result.contextPatch.leads).toHaveLength(3);
    expect(result.outputSummary.errors).toBe(1);

    // Errored lead should be last (lowest finalScore)
    const outputLeads = result.contextPatch.leads!;
    const erroredLead = outputLeads.find((l) => l.id === "lead-1");
    expect(erroredLead).toBeDefined();
    expect(erroredLead!.icpFit).toBe(0);
  });

  it("signal strength uses SIGNAL_STRENGTH_STUB (50)", async () => {
    const { step, mockPrisma } = buildStep();
    const leads = makeLeadRefs(1);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            signalStrength: 50,
          }),
        ],
      }),
    );
  });

  it("finalScore math: icpFit=80, signal=50 gives round(80*0.7 + 50*0.3) = 71", async () => {
    const { step } = buildStep({
      aiGrpcClient: createMockAiGrpcClient({
        "lead-0": { icpFit: 80, icpReasoning: "Good" },
      }),
    });

    const leads = makeLeadRefs(1);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-final" }, tools);

    const lead = result.contextPatch.leads![0];
    expect(lead.finalScore).toBe(71); // round(80 * 0.7 + 50 * 0.3) = round(56 + 15) = 71
  });

  it("output sorted by finalScore DESC", async () => {
    const icpOverrides: Record<string, { icpFit: number; icpReasoning: string }> = {
      "lead-0": { icpFit: 50, icpReasoning: "Low" },
      "lead-1": { icpFit: 90, icpReasoning: "High" },
      "lead-2": { icpFit: 70, icpReasoning: "Medium" },
    };

    const { step } = buildStep({
      aiGrpcClient: createMockAiGrpcClient(icpOverrides),
    });

    const leads = makeLeadRefs(3);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-final" }, tools);

    const outputLeads = result.contextPatch.leads!;
    expect(outputLeads[0].id).toBe("lead-1"); // highest icpFit=90
    expect(outputLeads[1].id).toBe("lead-2"); // icpFit=70
    expect(outputLeads[2].id).toBe("lead-0"); // icpFit=50
  });

  it("null companyId sends empty service catalogs", async () => {
    const { step, aiGrpcClient, serviceCatalogRepo } = buildStep();
    const leads = makeLeadRefs(1);
    const ctx = makeCtx({ companyId: null, data: { leads } });
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(serviceCatalogRepo.listByCompany).not.toHaveBeenCalled();
    expect(aiGrpcClient.scoreLeadFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceCatalogs: [],
      }),
    );
  });

  it("cancellation mid-batch persists partial scores and returns cancelled result", async () => {
    const { step, mockPrisma } = buildStep();
    const leads = makeLeadRefs(25);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    // checkCancelled calls: (1) before batch loop, (2) before batch 0, (3) before batch 1
    let callCount = 0;
    vi.mocked(tools.checkCancelled).mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount >= 3);
    });

    const result = await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(result.contextPatch.leads).toEqual([]);
    expect(
      (result.contextPatch["scoring-final"] as { cancelled?: boolean }).cancelled,
    ).toBe(true);
    expect(mockPrisma.leadScore.createMany).toHaveBeenCalled();
  });

  it("batching: 25 leads processes in 3 batches with progress per batch", async () => {
    const { step } = buildStep();
    const leads = makeLeadRefs(25);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    const progressCalls = (tools.emitProgress as ReturnType<typeof vi.fn>).mock.calls;
    const batchProgressCalls = progressCalls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].startsWith("Final scored "),
    );
    expect(batchProgressCalls).toHaveLength(3);
  });

  it("score column stores finalScore for backward compatibility", async () => {
    const expectedIcpFit = 80;
    const expectedFinalScore = Math.round(
      expectedIcpFit * ICP_FIT_WEIGHT + SIGNAL_STRENGTH_STUB * SIGNAL_STRENGTH_WEIGHT,
    );

    const { step, mockPrisma } = buildStep({
      aiGrpcClient: createMockAiGrpcClient({
        "lead-0": { icpFit: expectedIcpFit, icpReasoning: "Good" },
      }),
    });

    const leads = makeLeadRefs(1);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            score: expectedFinalScore,
            finalScore: expectedFinalScore,
          }),
        ],
      }),
    );
  });

  it("default stepInstanceId is scoring-final when not in config", async () => {
    const { step } = buildStep();
    const leads = makeLeadRefs(1);
    const ctx = makeCtx({ data: { leads } });
    const tools = makeTools();

    const result = await step.run(ctx, {}, tools);

    expect(result.contextPatch["scoring-final"]).toBeDefined();
    expect(
      (result.contextPatch["scoring-final"] as { scored: number }).scored,
    ).toBe(1);
  });
});
