/* eslint-disable @typescript-eslint/unbound-method */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnrichmentStep } from "@/modules/pipeline/steps/enrichment.step";
import type { ProfileEnrichmentCommandService } from "@/modules/profile-enrichment/services/profile-enrichment.command.service";

import { makeCtx, makeTools } from "./step-test.helpers";

/* ------------------------------------------------------------------ */
/*  Mock factories                                                     */
/* ------------------------------------------------------------------ */

function createMockProfileEnrichment() {
  return {
    requestEnrichment: vi.fn().mockImplementation(
      (_userId: string, leadId: string) =>
        Promise.resolve({
          enrichmentRequestId: `enr-${leadId}`,
          status: "PENDING",
          message: "Enqueued",
        }),
    ),
    reviewFieldChanges: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProfileEnrichmentCommandService;
}

/**
 * Create a mock Prisma for enrichment polling.
 *
 * @param enrichmentStatuses Map of enrichmentRequestId -> status progression
 *
 * Each call to findMany pops the next status from the progression array.
 */
function createMockPrisma(opts?: {
  enrichmentStatuses?: Record<string, string[]>;
}) {
  const enrichmentStatuses = opts?.enrichmentStatuses ?? {};

  let enrichmentPollCount = 0;

  return {
    pipelineRunLead: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    leadEnrichmentRequest: {
      findMany: vi.fn().mockImplementation(
        (args: { where: { id: { in: string[] }; status?: string }; include?: unknown }) => {
          // Phase 2.5 auto-approve query: status === "AWAITING_REVIEW" with include fieldChanges
          if (args.where.status === "AWAITING_REVIEW") {
            return Promise.resolve([]);
          }

          // Phase 2 polling query: select { id, status }
          const idx = enrichmentPollCount++;
          return Promise.resolve(
            args.where.id.in.map((id) => {
              const statuses = enrichmentStatuses[id] ?? ["COMPLETED"];
              const status = statuses[Math.min(idx, statuses.length - 1)];
              return { id, status };
            }),
          );
        },
      ),
    },
  };
}

function buildStep(overrides?: {
  profileEnrichment?: ProfileEnrichmentCommandService;
  prisma?: ReturnType<typeof createMockPrisma>;
}) {
  const profileEnrichment =
    overrides?.profileEnrichment ?? createMockProfileEnrichment();
  const mockPrisma = overrides?.prisma ?? createMockPrisma();

  const step = new EnrichmentStep(profileEnrichment);

  Object.defineProperty(step, "prisma", {
    value: mockPrisma,
    writable: true,
  });

  return { step, profileEnrichment, mockPrisma };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("EnrichmentStep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("happy path: enqueues profile enrichment, polls until COMPLETED", async () => {
    const { step, profileEnrichment, mockPrisma } = buildStep();

    mockPrisma.pipelineRunLead.findMany.mockResolvedValue(
      Array.from({ length: 2 }, (_, i) => ({
        id: `prl-${i}`,
        createdAt: new Date(),
        pipelineRunId: "run-1",
        leadId: `lead-${i}`,
        lead: {
          id: `lead-${i}`,
          fullName: `Lead ${i}`,
          email: `lead${i}@example.com`,
          company: `Company ${i}`,
          linkedinUrl: `https://linkedin.com/in/lead-${i}`,
          title: `Title ${i}`,
        },
        excluded: false,
        excludedByStepId: null,
      })),
    );

    const ctx = makeCtx();
    const tools = makeTools();

    const runPromise = step.run(ctx, {}, tools);

    await vi.advanceTimersByTimeAsync(10_000);

    const result = await runPromise;

    expect(profileEnrichment.requestEnrichment).toHaveBeenCalledTimes(2);
    expect(mockPrisma.leadEnrichmentRequest.findMany).toHaveBeenCalled();

    expect(result.outputSummary).toEqual(
      expect.objectContaining({
        totalLeads: 2,
        profileRequests: 2,
        errors: 0,
      }),
    );
  });

  it("empty leads array returns zero summary with no calls", async () => {
    const { step, profileEnrichment } = buildStep();
    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, {}, tools);

    expect(result.outputSummary.totalLeads).toBe(0);
    expect(profileEnrichment.requestEnrichment).not.toHaveBeenCalled();
  });

  it("lead without linkedinUrl skips profile enrichment", async () => {
    const { step, profileEnrichment, mockPrisma } = buildStep();

    mockPrisma.pipelineRunLead.findMany.mockResolvedValue([
      {
        id: "prl-0",
        createdAt: new Date(),
        pipelineRunId: "run-1",
        leadId: "lead-0",
        lead: {
          id: "lead-0",
          fullName: "Lead 0",
          email: "lead0@example.com",
          company: "Company 0",
          linkedinUrl: undefined,
          title: "Title 0",
        },
        excluded: false,
        excludedByStepId: null,
      },
    ]);

    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, {}, tools);

    expect(profileEnrichment.requestEnrichment).not.toHaveBeenCalled();
    expect(result.outputSummary.profileRequests).toBe(0);
  });

  it("lead without linkedinUrl but with company: still no profile enrichment", async () => {
    const { step, profileEnrichment, mockPrisma } = buildStep();

    mockPrisma.pipelineRunLead.findMany.mockResolvedValue([
      {
        id: "prl-0",
        createdAt: new Date(),
        pipelineRunId: "run-1",
        leadId: "lead-0",
        lead: {
          id: "lead-0",
          fullName: "Lead 0",
          email: "lead0@example.com",
          company: "Company 0",
          linkedinUrl: undefined,
          title: "Title 0",
        },
        excluded: false,
        excludedByStepId: null,
      },
    ]);

    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, {}, tools);

    expect(profileEnrichment.requestEnrichment).not.toHaveBeenCalled();
    expect(result.outputSummary.profileRequests).toBe(0);
    // No IDs to poll — should not enter poll loop
    expect(mockPrisma.leadEnrichmentRequest.findMany).not.toHaveBeenCalled();
  });

  it("profile enrichment throws — error recorded, step does not throw", async () => {
    const profileEnrichment = {
      requestEnrichment: vi.fn().mockRejectedValue(
        new Error("CONFLICT: pending enrichment exists"),
      ),
      reviewFieldChanges: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProfileEnrichmentCommandService;

    const { step, mockPrisma } = buildStep({ profileEnrichment });

    mockPrisma.pipelineRunLead.findMany.mockResolvedValue(
      Array.from({ length: 1 }, (_, i) => ({
        id: `prl-${i}`,
        createdAt: new Date(),
        pipelineRunId: "run-1",
        leadId: `lead-${i}`,
        lead: {
          id: `lead-${i}`,
          fullName: `Lead ${i}`,
          email: `lead${i}@example.com`,
          company: `Company ${i}`,
          linkedinUrl: `https://linkedin.com/in/lead-${i}`,
          title: `Title ${i}`,
        },
        excluded: false,
        excludedByStepId: null,
      })),
    );

    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, {}, tools);

    expect(result.outputSummary.profileRequests).toBe(0);
    expect(result.outputSummary.errors).toBe(1);
  });

  it("includeProfileEnrichment: false skips profile enrichment entirely", async () => {
    const { step, profileEnrichment, mockPrisma } = buildStep();

    mockPrisma.pipelineRunLead.findMany.mockResolvedValue(
      Array.from({ length: 1 }, (_, i) => ({
        id: `prl-${i}`,
        createdAt: new Date(),
        pipelineRunId: "run-1",
        leadId: `lead-${i}`,
        lead: {
          id: `lead-${i}`,
          fullName: `Lead ${i}`,
          email: `lead${i}@example.com`,
          company: `Company ${i}`,
          linkedinUrl: `https://linkedin.com/in/lead-${i}`,
          title: `Title ${i}`,
        },
        excluded: false,
        excludedByStepId: null,
      })),
    );

    const ctx = makeCtx();
    const tools = makeTools();

    const result = await step.run(ctx, { includeProfileEnrichment: false }, tools);

    expect(profileEnrichment.requestEnrichment).not.toHaveBeenCalled();
    expect(result.outputSummary.profileRequests).toBe(0);
  });

  it("poll: AWAITING_REVIEW treated as terminal for enrichment", async () => {
    const mockPrisma = createMockPrisma({
      enrichmentStatuses: { "enr-lead-0": ["AWAITING_REVIEW"] },
    });

    const { step } = buildStep({ prisma: mockPrisma });

    mockPrisma.pipelineRunLead.findMany.mockResolvedValue(
      Array.from({ length: 1 }, (_, i) => ({
        id: `prl-${i}`,
        createdAt: new Date(),
        pipelineRunId: "run-1",
        leadId: `lead-${i}`,
        lead: {
          id: `lead-${i}`,
          fullName: `Lead ${i}`,
          email: `lead${i}@example.com`,
          company: `Company ${i}`,
          linkedinUrl: `https://linkedin.com/in/lead-${i}`,
          title: `Title ${i}`,
        },
        excluded: false,
        excludedByStepId: null,
      })),
    );

    const ctx = makeCtx();
    const tools = makeTools();

    const runPromise = step.run(ctx, {}, tools);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await runPromise;

    // 1 poll cycle + 1 Phase 2.5 auto-approve query
    expect(mockPrisma.leadEnrichmentRequest.findMany).toHaveBeenCalledTimes(2);
    expect(result.outputSummary.totalLeads).toBe(1);
  });

  it("poll: mixed statuses (one COMPLETED, one PROCESSING) keeps polling", async () => {
    const mockPrisma = createMockPrisma({
      enrichmentStatuses: {
        "enr-lead-0": ["COMPLETED"],
        "enr-lead-1": ["PROCESSING", "COMPLETED"],
      },
    });

    const { step } = buildStep({ prisma: mockPrisma });

    mockPrisma.pipelineRunLead.findMany.mockResolvedValue(
      Array.from({ length: 2 }, (_, i) => ({
        id: `prl-${i}`,
        createdAt: new Date(),
        pipelineRunId: "run-1",
        leadId: `lead-${i}`,
        lead: {
          id: `lead-${i}`,
          fullName: `Lead ${i}`,
          email: `lead${i}@example.com`,
          company: `Company ${i}`,
          linkedinUrl: `https://linkedin.com/in/lead-${i}`,
          title: `Title ${i}`,
        },
        excluded: false,
        excludedByStepId: null,
      })),
    );

    const ctx = makeCtx();
    const tools = makeTools();

    const runPromise = step.run(ctx, {}, tools);

    // First poll: lead-0 done, lead-1 still processing
    await vi.advanceTimersByTimeAsync(10_000);
    // Second poll: lead-1 now completed
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await runPromise;

    // Enrichment polled twice (second poll for remaining lead-1) + 1 Phase 2.5 auto-approve query
    expect(mockPrisma.leadEnrichmentRequest.findMany).toHaveBeenCalledTimes(3);
    expect(result.outputSummary.totalLeads).toBe(2);
  });

  it("poll: all FAILED exits poll", async () => {
    const mockPrisma = createMockPrisma({
      enrichmentStatuses: { "enr-lead-0": ["FAILED"] },
    });

    const { step } = buildStep({ prisma: mockPrisma });

    mockPrisma.pipelineRunLead.findMany.mockResolvedValue(
      Array.from({ length: 1 }, (_, i) => ({
        id: `prl-${i}`,
        createdAt: new Date(),
        pipelineRunId: "run-1",
        leadId: `lead-${i}`,
        lead: {
          id: `lead-${i}`,
          fullName: `Lead ${i}`,
          email: `lead${i}@example.com`,
          company: `Company ${i}`,
          linkedinUrl: `https://linkedin.com/in/lead-${i}`,
          title: `Title ${i}`,
        },
        excluded: false,
        excludedByStepId: null,
      })),
    );

    const ctx = makeCtx();
    const tools = makeTools();

    const runPromise = step.run(ctx, {}, tools);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await runPromise;

    // 1 poll cycle + 1 Phase 2.5 auto-approve query
    expect(mockPrisma.leadEnrichmentRequest.findMany).toHaveBeenCalledTimes(2);
    expect(result.outputSummary.totalLeads).toBe(1);
  });

  it("cancellation during poll returns immediately", async () => {
    const mockPrisma = createMockPrisma({
      // Never reach terminal — stays PROCESSING forever
      enrichmentStatuses: { "enr-lead-0": ["PROCESSING", "PROCESSING", "PROCESSING"] },
    });

    const { step } = buildStep({ prisma: mockPrisma });

    mockPrisma.pipelineRunLead.findMany.mockResolvedValue(
      Array.from({ length: 1 }, (_, i) => ({
        id: `prl-${i}`,
        createdAt: new Date(),
        pipelineRunId: "run-1",
        leadId: `lead-${i}`,
        lead: {
          id: `lead-${i}`,
          fullName: `Lead ${i}`,
          email: `lead${i}@example.com`,
          company: `Company ${i}`,
          linkedinUrl: `https://linkedin.com/in/lead-${i}`,
          title: `Title ${i}`,
        },
        excluded: false,
        excludedByStepId: null,
      })),
    );

    const ctx = makeCtx();
    const tools = makeTools();

    // checkCancelled: false for enqueueing, true on poll iteration
    let callCount = 0;
    vi.mocked(tools.checkCancelled).mockImplementation(() => {
      callCount++;
      // First call is during batch loop (false), second is in poll loop (true → cancel)
      return Promise.resolve(callCount >= 2);
    });

    const runPromise = step.run(ctx, {}, tools);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await runPromise;

    // Should have returned without waiting for completion
    expect(result.outputSummary.totalLeads).toBe(1);
    expect(result.outputSummary.profileRequests).toBe(1);

    expect(tools.log.info).toHaveBeenCalledWith(
      {},
      "Enrichment polling cancelled",
    );
  });

  it("batching: 12 leads with BATCH_SIZE=5 processes in 3 batches", async () => {
    const { step, mockPrisma } = buildStep();

    mockPrisma.pipelineRunLead.findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        id: `prl-${i}`,
        createdAt: new Date(),
        pipelineRunId: "run-1",
        leadId: `lead-${i}`,
        lead: {
          id: `lead-${i}`,
          fullName: `Lead ${i}`,
          email: `lead${i}@example.com`,
          company: `Company ${i}`,
          linkedinUrl: `https://linkedin.com/in/lead-${i}`,
          title: `Title ${i}`,
        },
        excluded: false,
        excludedByStepId: null,
      })),
    );

    const ctx = makeCtx();
    const tools = makeTools();

    const runPromise = step.run(ctx, {}, tools);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await runPromise;

    expect(result.outputSummary.totalLeads).toBe(12);

    // Batch progress messages: 3 batches (5 + 5 + 2)
    const progressCalls = (tools.emitProgress as ReturnType<typeof vi.fn>).mock.calls;
    const batchProgressCalls = progressCalls.filter(
      (c: unknown[]) =>
        typeof c[0] === "string" && c[0].includes("enqueued"),
    );
    expect(batchProgressCalls).toHaveLength(3);
  });
});
