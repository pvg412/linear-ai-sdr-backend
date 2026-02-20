/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserFacingError } from "@/infra/userFacingError";
import { PipelineCommandService } from "@/modules/pipeline/services/pipeline.command.service";
import type { PipelineRepository } from "@/modules/pipeline/persistence/pipeline.repository";
import type { PipelineExecutor } from "@/modules/pipeline/engine/pipeline.executor";
import type { PipelineBroadcaster } from "@/modules/pipeline/engine/pipeline.broadcaster";
import type { PipelineStepRegistry } from "@/modules/pipeline/engine/pipeline.registry";

/* ------------------------------------------------------------------ */
/*  Mock factories                                                     */
/* ------------------------------------------------------------------ */

/** All step types present in the default-company-pipeline definition */
const KNOWN_STEP_TYPES = new Set([
  "lead-generation",
  "scoring",
  "final-scoring",
  "enrichment",
  "signals",
  "decision-maker",
  "outreach",
]);

function createMockRepo() {
  return {
    getRunById: vi.fn(),
    getRunByIdOrThrow: vi.fn(),
    getRunForUser: vi.fn(),
    listRunsForUser: vi.fn(),
    countRunningGlobal: vi.fn().mockResolvedValue(0),
    countRunningForCompany: vi.fn().mockResolvedValue(0),
    createRun: vi.fn().mockResolvedValue({ id: "run-123" }),
    updateRunStatus: vi.fn().mockResolvedValue({}),
    updateRunCurrentStep: vi.fn().mockResolvedValue({}),
    updateRunContext: vi.fn().mockResolvedValue({}),
    updateStepStatus: vi.fn().mockResolvedValue({}),
    cancelRemainingSteps: vi.fn().mockResolvedValue({}),
  } as unknown as PipelineRepository;
}

function createMockExecutor() {
  return {
    executePipeline: vi.fn(),
    isCancelled: vi.fn().mockResolvedValue(false),
    markCancelled: vi.fn().mockResolvedValue(undefined),
  } as unknown as PipelineExecutor;
}

function createMockBroadcaster() {
  return {
    subscribe: vi.fn(),
    emitRunStarted: vi.fn(),
    emitRunSucceeded: vi.fn(),
    emitRunFailed: vi.fn(),
    emitRunCancelled: vi.fn(),
    emitStepStarted: vi.fn(),
    emitStepSucceeded: vi.fn(),
    emitStepFailed: vi.fn(),
    emitStepSkipped: vi.fn(),
    emitStepProgress: vi.fn(),
  } as unknown as PipelineBroadcaster;
}

function createMockRegistry() {
  return {
    register: vi.fn(),
    get: vi.fn(),
    has: vi.fn().mockImplementation((type: string) => KNOWN_STEP_TYPES.has(type)),
    listTypes: vi.fn().mockReturnValue([...KNOWN_STEP_TYPES]),
  } as unknown as PipelineStepRegistry;
}

function createMockQueue() {
  return { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
}

function createMockPrisma() {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        companyId: "company-1",
      }),
    },
    companyServiceCatalog: {
      count: vi.fn().mockResolvedValue(1),
    },
  };
}

/** Builds a run object as returned by repo.getRunForUser */
function makeDbRun(overrides?: Record<string, unknown>) {
  return {
    id: "run-123",
    status: "RUNNING",
    createdById: "user-1",
    companyId: "company-1",
    currentStepId: "enrichment",
    currentStepIndex: 2,
    stepRuns: [
      { id: "sr-0", stepId: "lead-generation", status: "SUCCEEDED" },
      { id: "sr-1", stepId: "scoring-initial", status: "SUCCEEDED" },
      { id: "sr-2", stepId: "enrichment", status: "RUNNING" },
      { id: "sr-3", stepId: "signals", status: "QUEUED" },
      { id: "sr-4", stepId: "decision-maker", status: "QUEUED" },
      { id: "sr-5", stepId: "scoring-final", status: "QUEUED" },
      { id: "sr-6", stepId: "outreach", status: "QUEUED" },
    ],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("PipelineCommandService", () => {
  let service: PipelineCommandService;
  let repo: ReturnType<typeof createMockRepo>;
  let executor: ReturnType<typeof createMockExecutor>;
  let broadcaster: ReturnType<typeof createMockBroadcaster>;
  let registry: ReturnType<typeof createMockRegistry>;
  let queue: ReturnType<typeof createMockQueue>;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    repo = createMockRepo();
    executor = createMockExecutor();
    broadcaster = createMockBroadcaster();
    registry = createMockRegistry();
    queue = createMockQueue();
    mockPrisma = createMockPrisma();

    service = new PipelineCommandService(
      repo,
      executor as unknown as PipelineExecutor,
      broadcaster as unknown as PipelineBroadcaster,
      registry as unknown as PipelineStepRegistry,
      queue as never,
    );

    /* Override the prisma field initialised via getPrisma() */
    Object.defineProperty(service, "prisma", {
      value: mockPrisma,
      writable: true,
    });
  });

  /* ---------------------------------------------------------------- */
  /*  startPipeline                                                    */
  /* ---------------------------------------------------------------- */

  describe("startPipeline", () => {
    it("creates a run, enqueues a job, and returns the run id", async () => {
      const result = await service.startPipeline(
        "user-1",
        "default-company-pipeline",
        { leadIds: ["lead-1"] },
      );

      expect(result).toEqual({ pipelineRunId: "run-123" });

      /* User lookup */
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: { id: true, companyId: true },
      });

      /* Concurrency check */
      expect(repo.countRunningForCompany).toHaveBeenCalledWith("company-1");

      /* Run creation */
      expect(repo.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineKey: "default-company-pipeline",
          pipelineVersion: 1,
          createdById: "user-1",
          companyId: "company-1",
        }),
      );

      /* BullMQ job */
      expect(queue.add).toHaveBeenCalledWith(
        "pipeline.execute",
        { pipelineRunId: "run-123" },
        expect.objectContaining({ jobId: "run-123" }),
      );
    });

    it("uses user.id as companyId when user has no company", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-solo",
        companyId: null,
      });

      await service.startPipeline("user-solo", "default-company-pipeline", {});

      expect(repo.countRunningForCompany).toHaveBeenCalledWith("user-solo");
      expect(repo.createRun).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: "user-solo" }),
      );
    });

    it("throws for an unknown pipeline key", async () => {
      await expect(
        service.startPipeline("user-1", "nonexistent-pipeline", {}),
      ).rejects.toThrow(UserFacingError);

      /* Should not proceed to user lookup or DB calls */
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(repo.createRun).not.toHaveBeenCalled();
    });

    it("throws when a step type is not registered", async () => {
      (registry.has as ReturnType<typeof vi.fn>).mockImplementation(
        (type: string) => type !== "scoring",
      );

      await expect(
        service.startPipeline("user-1", "default-company-pipeline", {}),
      ).rejects.toThrow("is not registered");

      expect(repo.createRun).not.toHaveBeenCalled();
    });

    it("throws when user is not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.startPipeline("user-1", "default-company-pipeline", {}),
      ).rejects.toThrow("User not found");

      expect(repo.createRun).not.toHaveBeenCalled();
    });

    it("throws when company concurrency limit is exceeded", async () => {
      (repo.countRunningForCompany as ReturnType<typeof vi.fn>)
        .mockResolvedValue(999);

      await expect(
        service.startPipeline("user-1", "default-company-pipeline", {}),
      ).rejects.toThrow("Too many concurrent pipeline runs");

      expect(repo.createRun).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("validates each step type in order", async () => {
      await service.startPipeline("user-1", "default-company-pipeline", {});

      /* registry.has() should have been called for each step */
      const hasCalls = (registry.has as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      expect(hasCalls.length).toBeGreaterThanOrEqual(KNOWN_STEP_TYPES.size);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  cancelPipeline                                                   */
  /* ---------------------------------------------------------------- */

  describe("cancelPipeline", () => {
    it("cancels a RUNNING pipeline: marks redis, updates DB, broadcasts", async () => {
      const run = makeDbRun();
      (repo.getRunForUser as ReturnType<typeof vi.fn>).mockResolvedValue(run);

      await service.cancelPipeline("user-1", "run-123");

      /* Redis cancel flag */
      expect(executor.markCancelled).toHaveBeenCalledWith("run-123");

      /* DB status → CANCELLED */
      expect(repo.updateRunStatus).toHaveBeenCalledWith(
        "run-123",
        "CANCELLED",
        expect.objectContaining({ finishedAt: expect.any(Date) }),
      );

      /* Remaining QUEUED steps cancelled */
      expect(repo.cancelRemainingSteps).toHaveBeenCalledWith("run-123", 0);

      /* Broadcast: 2 SUCCEEDED out of 7 total */
      expect(broadcaster.emitRunCancelled).toHaveBeenCalledWith(
        "run-123",
        { current: 2, total: 7, percent: 29 },
        "enrichment",
      );
    });

    it("cancels a PENDING pipeline before any step runs", async () => {
      const run = makeDbRun({
        status: "PENDING",
        currentStepId: null,
        stepRuns: [
          { id: "sr-0", stepId: "lead-generation", status: "QUEUED" },
          { id: "sr-1", stepId: "scoring-initial", status: "QUEUED" },
        ],
      });
      (repo.getRunForUser as ReturnType<typeof vi.fn>).mockResolvedValue(run);

      await service.cancelPipeline("user-1", "run-123");

      expect(executor.markCancelled).toHaveBeenCalledWith("run-123");
      expect(repo.updateRunStatus).toHaveBeenCalledWith(
        "run-123",
        "CANCELLED",
        expect.any(Object),
      );

      /* 0 completed out of 2 */
      expect(broadcaster.emitRunCancelled).toHaveBeenCalledWith(
        "run-123",
        { current: 0, total: 2, percent: 0 },
        undefined,
      );
    });

    it("throws when cancelling a SUCCEEDED run", async () => {
      (repo.getRunForUser as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeDbRun({ status: "SUCCEEDED" }),
      );

      await expect(
        service.cancelPipeline("user-1", "run-123"),
      ).rejects.toThrow('Cannot cancel a pipeline run with status "SUCCEEDED"');

      expect(executor.markCancelled).not.toHaveBeenCalled();
      expect(repo.updateRunStatus).not.toHaveBeenCalled();
    });

    it("throws when cancelling a FAILED run", async () => {
      (repo.getRunForUser as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeDbRun({ status: "FAILED" }),
      );

      await expect(
        service.cancelPipeline("user-1", "run-123"),
      ).rejects.toThrow('Cannot cancel a pipeline run with status "FAILED"');

      expect(executor.markCancelled).not.toHaveBeenCalled();
    });

    it("throws when cancelling an already CANCELLED run", async () => {
      (repo.getRunForUser as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeDbRun({ status: "CANCELLED" }),
      );

      await expect(
        service.cancelPipeline("user-1", "run-123"),
      ).rejects.toThrow('Cannot cancel a pipeline run with status "CANCELLED"');

      expect(executor.markCancelled).not.toHaveBeenCalled();
    });
  });
});
