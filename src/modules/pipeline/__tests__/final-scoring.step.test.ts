/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { FinalScoringStep } from "@/modules/pipeline/steps/final-scoring.step";
import type { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import type { ServiceCatalogRepository } from "@/modules/service-catalog/persistence/service-catalog.repository";

import { makeCtx, makeTools } from "./step-test.helpers";

/* ------------------------------------------------------------------ */
/*  Constants (mirrored from FINAL_SCORING_CONSTANTS for assertions)    */
/* ------------------------------------------------------------------ */

const ICP_FIT_WEIGHT = 0.7;
const SIGNAL_STRENGTH_WEIGHT = 0.3;

/** Default signal strength returned by the mock gRPC when no override is set */
const DEFAULT_SIGNAL_STRENGTH = 40;

/** Default ICP score stored in mock initial LeadScore records */
const DEFAULT_ICP_SCORE = 75;

/* ------------------------------------------------------------------ */
/*  Mock factories                                                     */
/* ------------------------------------------------------------------ */

interface SignalOverride {
  signalStrength?: number;
  signalReasoning?: string;
}

function createMockAiGrpcClient(
  overrides?: Record<string, SignalOverride>,
) {
  return {
    scoreLeadFinal: vi.fn().mockImplementation(
      (req: { lead: { id: string } }) => {
        const override = overrides?.[req.lead.id];
        return Promise.resolve({
          requestId: "resp-1",
          signalStrength: override?.signalStrength ?? DEFAULT_SIGNAL_STRENGTH,
          signalReasoning: override?.signalReasoning ?? "Moderate hiring activity",
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
          signalCategories: [],
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

/** Hiring signal factory for test data */
function makeHiringSignal(leadId: string, opts?: {
  openJobCount?: number;
  departments?: string[];
  topJobTitles?: string[];
  providerKey?: string;
  companyName?: string;
  jobs?: {
    jobTitle?: string;
    team?: string;
    datePosted?: string;
    skills?: string[];
    technologies?: string[];
    jobCategories?: string[];
    locations?: { city?: string; region?: string; country?: string }[];
  }[];
}) {
  return {
    id: `hs-${leadId}`,
    createdAt: new Date(),
    leadId,
    pipelineRunId: "run-1",
    providerKey: opts?.providerKey ?? "test-provider",
    companyName: opts?.companyName ?? "Test Company",
    openJobCount: opts?.openJobCount ?? 5,
    departments: opts?.departments ?? ["Engineering"],
    topJobTitles: opts?.topJobTitles ?? ["Software Engineer"],
    jobs: (opts?.jobs ?? [{ jobTitle: "Software Engineer", datePosted: "2026-02-01" }]).map((j, idx) => ({
      id: `hsj-${leadId}-${idx}`,
      createdAt: new Date(),
      hiringSignalId: `hs-${leadId}`,
      externalId: null,
      jobTitle: j.jobTitle ?? null,
      team: j.team ?? null,
      jobType: null,
      locationType: null,
      datePosted: j.datePosted ?? null,
      companyName: null,
      companySlug: null,
      requirementsSummary: null,
      skills: j.skills ?? [],
      technologies: j.technologies ?? [],
      jobCategories: j.jobCategories ?? [],
      locations: (j.locations ?? []).map((l, li) => ({
        id: `hsjl-${leadId}-${idx}-${li}`,
        jobId: `hsj-${leadId}-${idx}`,
        city: l.city ?? null,
        region: l.region ?? null,
        country: l.country ?? null,
      })),
    })),
  };
}

/**
 * Build initial scoring LeadScore records. By default, creates one
 * per lead with DEFAULT_ICP_SCORE and a reasoning string.
 */
function makeInitialScores(
  leads: ReturnType<typeof makeDbLead>[],
  overrides?: Record<string, { score: number; reasoning: string }>,
) {
  return leads.map((l) => {
    const ovr = overrides?.[l.id];
    return {
      id: `ls-init-${l.id}`,
      createdAt: new Date(),
      leadId: l.id,
      pipelineRunId: "run-1",
      stepInstanceId: "scoring-initial",
      score: ovr?.score ?? DEFAULT_ICP_SCORE,
      reasoning: ovr?.reasoning ?? "Good ICP fit",
      icpFit: null,
      signalStrength: null,
      finalScore: null,
    };
  });
}

function createMockPrisma(opts?: {
  leadCount?: number;
  leads?: ReturnType<typeof makeDbLead>[];
  companyResearches?: ReturnType<typeof makeCompanyResearch>[];
  hiringSignals?: ReturnType<typeof makeHiringSignal>[];
  /** Override initial ICP scores per lead. If omitted, all leads get DEFAULT_ICP_SCORE. */
  initialScoreOverrides?: Record<string, { score: number; reasoning: string }>;
  /** Set to true to simulate leads without initial scores. */
  noInitialScores?: boolean;
}) {
  const leads = opts?.leads
    ?? Array.from({ length: opts?.leadCount ?? 30 }, (_, i) => makeDbLead(i));
  const runLeads = makeRunLeads(leads.length, leads);
  const companyResearches = opts?.companyResearches ?? [];
  const hiringSignals = opts?.hiringSignals ?? [];
  const initialScores = opts?.noInitialScores
    ? []
    : makeInitialScores(leads, opts?.initialScoreOverrides);

  return {
    lead: {
      findMany: vi.fn().mockImplementation(
        (args: { where: { id: { in: string[] } } }) => {
          const ids = new Set(args.where.id.in);
          return Promise.resolve(leads.filter((l) => ids.has(l.id)));
        },
      ),
    },
    pipelineRunLead: {
      findMany: vi.fn().mockResolvedValue(runLeads),
    },
    companyResearch: {
      findMany: vi.fn().mockResolvedValue(companyResearches),
    },
    hiringSignal: {
      findMany: vi.fn().mockResolvedValue(hiringSignals),
    },
    redditSignal: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    crunchbaseSignal: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    leadScore: {
      findMany: vi.fn().mockResolvedValue(initialScores),
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

  it("happy path: combines ICP from initial scoring with signal strength from AI", async () => {
    const companyResearches = [
      makeCompanyResearch("lead-0"),
      makeCompanyResearch("lead-1"),
    ];

    const { step, aiGrpcClient, mockPrisma } = buildStep({
      aiGrpcClient: createMockAiGrpcClient({
        "lead-0": { signalStrength: 60 },
        "lead-1": { signalStrength: 30 },
      }),
      prisma: createMockPrisma({
        leadCount: 3,
        companyResearches,
        initialScoreOverrides: {
          "lead-0": { score: 90, reasoning: "Excellent ICP match" },
          "lead-1": { score: 60, reasoning: "Moderate fit" },
          "lead-2": { score: 40, reasoning: "Weak fit" },
        },
      }),
    });

    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-final" }, tools);

    // All 3 leads pass through (no filtering)
    expect(result.outputSummary.total).toBe(3);

    // gRPC called for each lead (signal strength evaluation)
    expect(aiGrpcClient.scoreLeadFinal).toHaveBeenCalledTimes(3);

    // lead-0 has company research items passed to gRPC
    const call0 = (aiGrpcClient.scoreLeadFinal as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { lead: { id: string } }).lead.id === "lead-0",
    );
    expect(call0).toBeDefined();
    expect((call0![0] as { companyResearchItems: unknown[] }).companyResearchItems).toHaveLength(2);

    // DB persistence includes all component fields: ICP from initial scoring + signal from AI
    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            leadId: "lead-0",
            icpFit: 90,
            signalStrength: 60,
            finalScore: Math.round(90 * ICP_FIT_WEIGHT + 60 * SIGNAL_STRENGTH_WEIGHT),
          }),
        ]),
      }),
    );
  });

  it("empty leads returns zero summary with no calls", async () => {
    const { step, aiGrpcClient, mockPrisma } = buildStep({
      prisma: createMockPrisma({ leadCount: 0 }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(result.outputSummary.total).toBe(0);
    expect(aiGrpcClient.scoreLeadFinal).not.toHaveBeenCalled();
    expect(mockPrisma.leadScore.createMany).not.toHaveBeenCalled();
  });

  it("lead with no company research sends empty items to gRPC", async () => {
    const { step, aiGrpcClient } = buildStep({
      prisma: createMockPrisma({ leadCount: 1, companyResearches: [] }),
    });

    const ctx = makeCtx();
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
    newerResearch.id = "cr-lead-0-new";

    const { step, aiGrpcClient } = buildStep({
      prisma: createMockPrisma({ leadCount: 1, companyResearches: [newerResearch, olderResearch] }),
    });

    const ctx = makeCtx();
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

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
      prisma: createMockPrisma({ leadCount: 1, companyResearches: [research] }),
    });

    const ctx = makeCtx();
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    const call = (aiGrpcClient.scoreLeadFinal as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const items = (call[0] as { companyResearchItems: { index: number; sourceName: string; summary: string }[] }).companyResearchItems;
    expect(items).toHaveLength(2);
    expect(items[0].index).toBe(1);
    expect(items[1].index).toBe(2);
    expect(items[0].sourceName).toBe("perplexity");
    expect(items[1].sourceName).toBe("linkedin");
  });

  it("gRPC error preserves ICP fit from initial scoring, sets signalStrength=0", async () => {
    const aiGrpcClient = {
      scoreLeadFinal: vi.fn().mockImplementation(
        (req: { lead: { id: string } }) => {
          if (req.lead.id === "lead-1") {
            return Promise.reject(new Error("gRPC timeout"));
          }
          return Promise.resolve({
            requestId: "r",
            signalStrength: 40,
            signalReasoning: "Some hiring",
          });
        },
      ),
    } as unknown as AiGrpcClient;

    const { step, mockPrisma } = buildStep({
      aiGrpcClient,
      prisma: createMockPrisma({
        leadCount: 3,
        initialScoreOverrides: {
          "lead-1": { score: 85, reasoning: "Great ICP" },
        },
      }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-final" }, tools);

    // All 3 leads pass through
    expect(result.outputSummary.total).toBe(3);
    expect(result.outputSummary.errors).toBe(1);

    // Errored lead (lead-1) keeps its ICP fit (85), signalStrength=0
    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            leadId: "lead-1",
            icpFit: 85,
            signalStrength: 0,
            finalScore: Math.round(85 * ICP_FIT_WEIGHT + 0 * SIGNAL_STRENGTH_WEIGHT),
          }),
        ]),
      }),
    );
  });

  it("signal strength comes from gRPC response", async () => {
    const { step, mockPrisma } = buildStep({
      aiGrpcClient: createMockAiGrpcClient({
        "lead-0": { signalStrength: 80, signalReasoning: "Strong hiring" },
      }),
      prisma: createMockPrisma({ leadCount: 1 }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            signalStrength: 80,
          }),
        ],
      }),
    );
  });

  it("ICP fit comes from initial scoring LeadScore, not from gRPC", async () => {
    const { step, mockPrisma } = buildStep({
      prisma: createMockPrisma({
        leadCount: 1,
        initialScoreOverrides: {
          "lead-0": { score: 92, reasoning: "Perfect ICP match" },
        },
      }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            icpFit: 92,
            reasoning: "Perfect ICP match",
          }),
        ],
      }),
    );
  });

  it("lead without initial score defaults to icpFit=0", async () => {
    const { step, mockPrisma } = buildStep({
      prisma: createMockPrisma({ leadCount: 1, noInitialScores: true }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            icpFit: 0,
            signalStrength: DEFAULT_SIGNAL_STRENGTH,
            finalScore: Math.round(0 * ICP_FIT_WEIGHT + DEFAULT_SIGNAL_STRENGTH * SIGNAL_STRENGTH_WEIGHT),
          }),
        ],
      }),
    );
  });

  it("finalScore math: icpFit=80, signal=60 gives round(80*0.7 + 60*0.3) = 74", async () => {
    const { step, mockPrisma } = buildStep({
      aiGrpcClient: createMockAiGrpcClient({
        "lead-0": { signalStrength: 60 },
      }),
      prisma: createMockPrisma({
        leadCount: 1,
        initialScoreOverrides: {
          "lead-0": { score: 80, reasoning: "Good" },
        },
      }),
    });

    const ctx = makeCtx();
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            leadId: "lead-0",
            finalScore: 74, // round(80 * 0.7 + 60 * 0.3) = round(56 + 18) = 74
          }),
        ],
      }),
    );
  });

  it("all leads persisted with correct ICP scores from initial scoring", async () => {
    const { step, mockPrisma } = buildStep({
      prisma: createMockPrisma({
        leadCount: 3,
        initialScoreOverrides: {
          "lead-0": { score: 50, reasoning: "Low" },
          "lead-1": { score: 90, reasoning: "High" },
          "lead-2": { score: 70, reasoning: "Medium" },
        },
      }),
    });

    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(result.outputSummary.total).toBe(3);
    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ leadId: "lead-0", icpFit: 50 }),
          expect.objectContaining({ leadId: "lead-1", icpFit: 90 }),
          expect.objectContaining({ leadId: "lead-2", icpFit: 70 }),
        ]),
      }),
    );
  });

  it("null companyId sends empty service catalogs", async () => {
    const { step, aiGrpcClient, serviceCatalogRepo } = buildStep({
      prisma: createMockPrisma({ leadCount: 1 }),
    });
    const ctx = makeCtx({ companyId: null });
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
    const { step, mockPrisma } = buildStep({
      prisma: createMockPrisma({ leadCount: 25 }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    // checkCancelled calls:
    //   (1) after company research loaded
    //   (2) after hiring signals loaded
    //   (3) before batch 0
    //   (4) before batch 1 — cancel here
    let callCount = 0;
    vi.mocked(tools.checkCancelled).mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount >= 4);
    });

    const result = await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(result.outputSummary.total).toBe(0);
    expect(result.outputSummary.cancelled).toBe(true);
    expect(mockPrisma.leadScore.createMany).toHaveBeenCalled();
  });

  it("batching: 25 leads processes in 3 batches with progress per batch", async () => {
    const { step } = buildStep({
      prisma: createMockPrisma({ leadCount: 25 }),
    });
    const ctx = makeCtx();
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
    const expectedSignalStrength = 70;
    const expectedFinalScore = Math.round(
      expectedIcpFit * ICP_FIT_WEIGHT + expectedSignalStrength * SIGNAL_STRENGTH_WEIGHT,
    );

    const { step, mockPrisma } = buildStep({
      aiGrpcClient: createMockAiGrpcClient({
        "lead-0": { signalStrength: expectedSignalStrength },
      }),
      prisma: createMockPrisma({
        leadCount: 1,
        initialScoreOverrides: {
          "lead-0": { score: expectedIcpFit, reasoning: "Good" },
        },
      }),
    });

    const ctx = makeCtx();
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

  it("hiring signals are loaded from DB and passed to gRPC", async () => {
    const signals = [
      makeHiringSignal("lead-0", {
        openJobCount: 8,
        departments: ["Engineering", "Product"],
        topJobTitles: ["Backend Engineer", "PM"],
        jobs: [
          { jobTitle: "Backend Engineer", datePosted: "2026-02-20", skills: ["Node.js"], technologies: ["AWS"] },
        ],
      }),
    ];

    const { step, aiGrpcClient } = buildStep({
      prisma: createMockPrisma({ leadCount: 2, hiringSignals: signals }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    // lead-0 should have hiringSignals populated
    const call0 = (aiGrpcClient.scoreLeadFinal as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { lead: { id: string } }).lead.id === "lead-0",
    );
    expect(call0).toBeDefined();
    const req0 = call0![0] as { hiringSignals?: { openJobCount: number; departments: string[] } };
    expect(req0.hiringSignals).toBeDefined();
    expect(req0.hiringSignals!.openJobCount).toBe(8);
    expect(req0.hiringSignals!.departments).toEqual(["Engineering", "Product"]);

    // lead-1 should have no hiring signals (undefined)
    const call1 = (aiGrpcClient.scoreLeadFinal as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { lead: { id: string } }).lead.id === "lead-1",
    );
    expect(call1).toBeDefined();
    const req1 = call1![0] as { hiringSignals?: unknown };
    expect(req1.hiringSignals).toBeUndefined();
  });

  it("lead with no hiring signals gets signalStrength from AI (may be 0)", async () => {
    const { step, mockPrisma } = buildStep({
      aiGrpcClient: createMockAiGrpcClient({
        "lead-0": { signalStrength: 0, signalReasoning: "No hiring signals" },
      }),
      prisma: createMockPrisma({
        leadCount: 1,
        hiringSignals: [],
        initialScoreOverrides: {
          "lead-0": { score: 80, reasoning: "Good" },
        },
      }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            signalStrength: 0,
            finalScore: Math.round(80 * ICP_FIT_WEIGHT + 0 * SIGNAL_STRENGTH_WEIGHT),
          }),
        ],
      }),
    );
  });

  it("default stepInstanceId is scoring-final when not in config", async () => {
    const { step, mockPrisma } = buildStep({
      prisma: createMockPrisma({ leadCount: 1 }),
    });
    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, {}, tools);

    expect(result.outputSummary.total).toBe(1);
    expect(mockPrisma.leadScore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            stepInstanceId: "scoring-final",
          }),
        ],
      }),
    );
  });
});
