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

/**
 * Minimal mock Prisma for FinalScoringStep.
 *
 * NOTE: The new implementation no longer loads signals (company research,
 * hiring, Reddit, Crunchbase) from the DB — the AI service retrieves them
 * from ChromaDB using workspace_id + lead_id. Only pipelineRunLead and
 * leadScore are needed.
 */
function createMockPrisma(opts?: {
  leadCount?: number;
  leads?: ReturnType<typeof makeDbLead>[];
  /** Override initial ICP scores per lead. If omitted, all leads get DEFAULT_ICP_SCORE. */
  initialScoreOverrides?: Record<string, { score: number; reasoning: string }>;
  /** Set to true to simulate leads without initial scores. */
  noInitialScores?: boolean;
}) {
  const leads = opts?.leads
    ?? Array.from({ length: opts?.leadCount ?? 30 }, (_, i) => makeDbLead(i));
  const runLeads = makeRunLeads(leads.length, leads);
  const initialScores = opts?.noInitialScores
    ? []
    : makeInitialScores(leads, opts?.initialScoreOverrides);

  return {
    pipelineRunLead: {
      findMany: vi.fn().mockResolvedValue(runLeads),
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
    const { step, aiGrpcClient, mockPrisma } = buildStep({
      aiGrpcClient: createMockAiGrpcClient({
        "lead-0": { signalStrength: 60 },
        "lead-1": { signalStrength: 30 },
      }),
      prisma: createMockPrisma({
        leadCount: 3,
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

    // Each gRPC call passes workspaceId and leadId for ChromaDB retrieval.
    // The AI service uses these to look up signals (company research, hiring, etc.)
    // from ChromaDB — the backend no longer loads and sends them directly.
    const call0 = (aiGrpcClient.scoreLeadFinal as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { lead: { id: string } }).lead.id === "lead-0",
    );
    expect(call0).toBeDefined();
    expect((call0![0] as { workspaceId: string }).workspaceId).toBe("company-1");
    expect((call0![0] as { leadId: string }).leadId).toBe("lead-0");

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

  it("sends workspaceId and leadId to gRPC for ChromaDB signal retrieval", async () => {
    // The new protocol: instead of loading signals from DB and passing them
    // to gRPC, the backend sends workspace_id + lead_id so the AI service can
    // retrieve signals from ChromaDB on its own.
    const { step, aiGrpcClient } = buildStep({
      prisma: createMockPrisma({ leadCount: 1 }),
    });

    const ctx = makeCtx(); // companyId: "company-1"
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(aiGrpcClient.scoreLeadFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "company-1",
        leadId: "lead-0",
      }),
    );
  });

  it("workspaceId falls back to createdById when companyId is null", async () => {
    const { step, aiGrpcClient } = buildStep({
      prisma: createMockPrisma({ leadCount: 1 }),
    });

    // companyId: null → workspaceId should be createdById ("user-1")
    const ctx = makeCtx({ companyId: null });
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(aiGrpcClient.scoreLeadFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "user-1",
        leadId: "lead-0",
      }),
    );
  });

  it("each lead gets its own leadId in the gRPC call", async () => {
    const { step, aiGrpcClient } = buildStep({
      prisma: createMockPrisma({ leadCount: 3 }),
    });

    const ctx = makeCtx();
    const tools = makeTools();

    await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(aiGrpcClient.scoreLeadFinal).toHaveBeenCalledTimes(3);

    const calls = (aiGrpcClient.scoreLeadFinal as ReturnType<typeof vi.fn>).mock.calls;
    const leadIds = calls.map((c: unknown[]) => (c[0] as { leadId: string }).leadId);
    expect(leadIds).toContain("lead-0");
    expect(leadIds).toContain("lead-1");
    expect(leadIds).toContain("lead-2");
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

    // checkCancelled is called 5 times total for 25 leads (BATCH_SIZE=10, 3 batches):
    //   call 1: after service catalogs loaded
    //   call 2: after initial ICP scores loaded
    //   call 3: before batch 0 → false → batch 0 processes (10 leads scored)
    //   call 4: before batch 1 → true  → partial scores persisted, return cancelled
    //   call 5: before batch 2 (never reached)
    let callCount = 0;
    vi.mocked(tools.checkCancelled).mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount >= 4);
    });

    const result = await step.run(ctx, { _stepId: "scoring-final" }, tools);

    expect(result.outputSummary.total).toBe(0);
    expect(result.outputSummary.cancelled).toBe(true);
    // Partial scores from batch 0 should have been persisted
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

  it("lead with zero signal strength gets correct finalScore", async () => {
    // Verifies the gRPC response signalStrength=0 is used in computation, not
    // silently treated as "missing". This replaces the old "no hiring signals" test
    // which checked DB-loaded signals — now the AI handles signal retrieval.
    const { step, mockPrisma } = buildStep({
      aiGrpcClient: createMockAiGrpcClient({
        "lead-0": { signalStrength: 0, signalReasoning: "No relevant signals found in index" },
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
