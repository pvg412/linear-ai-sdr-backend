/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi } from "vitest";

import { PipelineExecutor } from "@/modules/pipeline/engine/pipeline.executor";
import { PipelineStepRegistry } from "@/modules/pipeline/engine/pipeline.registry";
import type { PipelineStepHandler } from "@/modules/pipeline/steps/step.interface";
import type { PipelineRepository } from "@/modules/pipeline/persistence/pipeline.repository";
import type { PipelineBroadcaster } from "@/modules/pipeline/engine/pipeline.broadcaster";
import type { PipelineDefinition } from "@/modules/pipeline/schemas/pipeline.dto";

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

const TEST_PIPELINE_DEF: PipelineDefinition = {
  key: "test-pipeline",
  version: 1,
  displayName: "Test Pipeline",
  steps: [
    { type: "step-a", id: "step-a", displayName: "Step A" },
    { type: "step-b", id: "step-b", displayName: "Step B" },
    { type: "step-c", id: "step-c", displayName: "Step C" },
  ],
  defaults: { onError: "stop" },
};

function makeDbRun(overrides?: Record<string, unknown>) {
  return {
    id: "run-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    pipelineKey: "test-pipeline",
    pipelineVersion: 1,
    createdById: "user-1",
    companyId: "company-1",
    status: "PENDING" as const,
    currentStepId: null,
    currentStepIndex: null,
    input: {},
    context: {},
    definition: TEST_PIPELINE_DEF,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    errorStepId: null,
    stepRuns: TEST_PIPELINE_DEF.steps.map((s, i) => ({
      id: `sr-${i}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      pipelineRunId: "run-1",
      stepId: s.id,
      stepType: s.type,
      stepIndex: i,
      displayName: s.displayName,
      status: "QUEUED" as const,
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      outputSummary: null,
      errorMessage: null,
    })),
    ...overrides,
  };
}

function makeStubHandler(
  type: string,
  behavior?: "succeed" | "fail",
): PipelineStepHandler {
  return {
    type,
    run: vi.fn().mockImplementation(() => {
      if (behavior === "fail") return Promise.reject(new Error(`${type} failed intentionally`));
      return Promise.resolve({
        contextPatch: { [type]: { done: true } },
        outputSummary: { step: type },
      });
    }),
  };
}

function createMockRepo() {
  const repo = {
    getRunById: vi.fn(),
    getRunByIdOrThrow: vi.fn(),
    getRunForUser: vi.fn(),
    listRunsForUser: vi.fn(),
    countRunningForCompany: vi.fn(),
    createRun: vi.fn(),
    updateRunStatus: vi.fn().mockResolvedValue({}),
    updateRunCurrentStep: vi.fn().mockResolvedValue({}),
    updateRunContext: vi.fn().mockResolvedValue({}),
    updateStepStatus: vi.fn().mockResolvedValue({}),
    cancelRemainingSteps: vi.fn().mockResolvedValue({}),
  } as unknown as PipelineRepository;
  return repo;
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

function createMockRedis(cancelledRuns = new Set<string>()) {
  return {
    get: vi.fn().mockImplementation((key: string) => {
      const runId = key.replace("pipeline:cancel:", "");
      return Promise.resolve(cancelledRuns.has(runId) ? "1" : null);
    }),
    set: vi.fn().mockResolvedValue("OK"),
  };
}

function buildExecutor(opts: {
  repo: PipelineRepository;
  registry: PipelineStepRegistry;
  broadcaster: PipelineBroadcaster;
  redis?: ReturnType<typeof createMockRedis>;
}) {
  const executor = new PipelineExecutor(
    opts.repo,
    opts.registry,
    opts.broadcaster,
    (opts.redis ?? createMockRedis()) as never,
  );
  return executor;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("PipelineExecutor", () => {
  it("runs steps in sequential order and emits correct events", async () => {
    const handlerA = makeStubHandler("step-a");
    const handlerB = makeStubHandler("step-b");
    const handlerC = makeStubHandler("step-c");

    const registry = new PipelineStepRegistry();
    registry.register(handlerA);
    registry.register(handlerB);
    registry.register(handlerC);

    const repo = createMockRepo();
    const run = makeDbRun();
    (repo.getRunById as ReturnType<typeof vi.fn>).mockResolvedValue(run);

    const broadcaster = createMockBroadcaster();

    const executor = buildExecutor({ repo, registry, broadcaster });
    await executor.executePipeline("run-1");

    /* All three steps should have been called */
    expect(handlerA.run).toHaveBeenCalledTimes(1);
    expect(handlerB.run).toHaveBeenCalledTimes(1);
    expect(handlerC.run).toHaveBeenCalledTimes(1);

    /* Called in order */
    const orderA = (handlerA.run as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const orderB = (handlerB.run as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const orderC = (handlerC.run as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(orderA).toBeLessThan(orderB);
    expect(orderB).toBeLessThan(orderC);

    /* Run started + succeeded events */
    expect(broadcaster.emitRunStarted).toHaveBeenCalledTimes(1);
    expect(broadcaster.emitRunSucceeded).toHaveBeenCalledTimes(1);
    expect(broadcaster.emitRunFailed).not.toHaveBeenCalled();

    /* Step events: 3 started + 3 succeeded */
    expect(broadcaster.emitStepStarted).toHaveBeenCalledTimes(3);
    expect(broadcaster.emitStepSucceeded).toHaveBeenCalledTimes(3);

    /* Run marked RUNNING then SUCCEEDED */
    expect(repo.updateRunStatus).toHaveBeenCalledWith(
      "run-1",
      "RUNNING",
      expect.objectContaining({ startedAt: expect.any(Date) }),
    );
    expect(repo.updateRunStatus).toHaveBeenCalledWith(
      "run-1",
      "SUCCEEDED",
      expect.objectContaining({ finishedAt: expect.any(Date) }),
    );
  });

  it("stops on step failure when onError=stop", async () => {
    const handlerA = makeStubHandler("step-a");
    const handlerB = makeStubHandler("step-b", "fail");
    const handlerC = makeStubHandler("step-c");

    const registry = new PipelineStepRegistry();
    registry.register(handlerA);
    registry.register(handlerB);
    registry.register(handlerC);

    const repo = createMockRepo();
    const run = makeDbRun();
    (repo.getRunById as ReturnType<typeof vi.fn>).mockResolvedValue(run);

    const broadcaster = createMockBroadcaster();

    const executor = buildExecutor({ repo, registry, broadcaster });
    await executor.executePipeline("run-1");

    /* Step A succeeded, Step B failed, Step C never called */
    expect(handlerA.run).toHaveBeenCalledTimes(1);
    expect(handlerB.run).toHaveBeenCalledTimes(1);
    expect(handlerC.run).not.toHaveBeenCalled();

    /* Run marked as FAILED */
    expect(repo.updateRunStatus).toHaveBeenCalledWith(
      "run-1",
      "FAILED",
      expect.objectContaining({
        errorStepId: "step-b",
      }),
    );
    expect(broadcaster.emitRunFailed).toHaveBeenCalledTimes(1);
    expect(broadcaster.emitRunSucceeded).not.toHaveBeenCalled();

    /* Remaining steps cancelled */
    expect(repo.cancelRemainingSteps).toHaveBeenCalledWith("run-1", 2);
  });

  it("continues past failure when onError=continue", async () => {
    const def: PipelineDefinition = {
      ...TEST_PIPELINE_DEF,
      steps: TEST_PIPELINE_DEF.steps.map((s) => ({
        ...s,
        onError: "continue" as const,
      })),
    };

    const handlerA = makeStubHandler("step-a");
    const handlerB = makeStubHandler("step-b", "fail");
    const handlerC = makeStubHandler("step-c");

    const registry = new PipelineStepRegistry();
    registry.register(handlerA);
    registry.register(handlerB);
    registry.register(handlerC);

    const repo = createMockRepo();
    const run = makeDbRun({ definition: def });
    (repo.getRunById as ReturnType<typeof vi.fn>).mockResolvedValue(run);

    const broadcaster = createMockBroadcaster();

    const executor = buildExecutor({ repo, registry, broadcaster });
    await executor.executePipeline("run-1");

    /* All three handlers called despite B failing */
    expect(handlerA.run).toHaveBeenCalledTimes(1);
    expect(handlerB.run).toHaveBeenCalledTimes(1);
    expect(handlerC.run).toHaveBeenCalledTimes(1);

    /* Pipeline still succeeds overall */
    expect(broadcaster.emitRunSucceeded).toHaveBeenCalledTimes(1);
    expect(broadcaster.emitStepFailed).toHaveBeenCalledTimes(1);
  });

  it("skips disabled steps", async () => {
    const def: PipelineDefinition = {
      ...TEST_PIPELINE_DEF,
      steps: [
        TEST_PIPELINE_DEF.steps[0],
        { ...TEST_PIPELINE_DEF.steps[1], enabled: false },
        TEST_PIPELINE_DEF.steps[2],
      ],
    };

    const handlerA = makeStubHandler("step-a");
    const handlerB = makeStubHandler("step-b");
    const handlerC = makeStubHandler("step-c");

    const registry = new PipelineStepRegistry();
    registry.register(handlerA);
    registry.register(handlerB);
    registry.register(handlerC);

    const repo = createMockRepo();
    const run = makeDbRun({ definition: def });
    (repo.getRunById as ReturnType<typeof vi.fn>).mockResolvedValue(run);

    const broadcaster = createMockBroadcaster();

    const executor = buildExecutor({ repo, registry, broadcaster });
    await executor.executePipeline("run-1");

    /* Step B was silently skipped — no broadcast, no DB status update */
    expect(handlerA.run).toHaveBeenCalledTimes(1);
    expect(handlerB.run).not.toHaveBeenCalled();
    expect(handlerC.run).toHaveBeenCalledTimes(1);

    expect(broadcaster.emitStepSkipped).not.toHaveBeenCalled();
    /* Disabled steps are invisible: not in emitRunStarted step list */
    const startedCall = (broadcaster.emitRunStarted as ReturnType<typeof vi.fn>).mock.calls[0];
    const emittedSteps = startedCall[2] as Array<{ stepId: string }>;
    expect(emittedSteps.map((s) => s.stepId)).toEqual(["step-a", "step-c"]);
  });

  it("stops when cancellation flag is set", async () => {
    const cancelled = new Set(["run-1"]);
    const redis = createMockRedis(cancelled);

    const handlerA = makeStubHandler("step-a");
    const handlerB = makeStubHandler("step-b");

    const registry = new PipelineStepRegistry();
    registry.register(handlerA);
    registry.register(handlerB);

    const def: PipelineDefinition = {
      ...TEST_PIPELINE_DEF,
      steps: TEST_PIPELINE_DEF.steps.slice(0, 2),
    };

    const repo = createMockRepo();
    const run = makeDbRun({ definition: def });
    (repo.getRunById as ReturnType<typeof vi.fn>).mockResolvedValue(run);

    const broadcaster = createMockBroadcaster();

    const executor = buildExecutor({ repo, registry, broadcaster, redis });
    await executor.executePipeline("run-1");

    /* No steps should run — cancellation checked before first step */
    expect(handlerA.run).not.toHaveBeenCalled();
    expect(handlerB.run).not.toHaveBeenCalled();

    expect(broadcaster.emitRunCancelled).toHaveBeenCalledTimes(1);
    expect(repo.updateRunStatus).toHaveBeenCalledWith(
      "run-1",
      "CANCELLED",
      expect.objectContaining({ finishedAt: expect.any(Date) }),
    );
  });

  it("retries a failing step per retryPolicy", async () => {
    let callCount = 0;
    const handlerFlaky: PipelineStepHandler = {
      type: "step-a",
      run: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) return Promise.reject(new Error("transient error"));
        return Promise.resolve({ contextPatch: {}, outputSummary: { recovered: true } });
      }),
    };

    const def: PipelineDefinition = {
      ...TEST_PIPELINE_DEF,
      steps: [
        {
          type: "step-a",
          id: "step-a",
          displayName: "Flaky Step",
          retryPolicy: { maxAttempts: 3, backoffMs: 10, backoffType: "fixed" },
        },
      ],
    };

    const registry = new PipelineStepRegistry();
    registry.register(handlerFlaky);

    const repo = createMockRepo();
    const run = makeDbRun({ definition: def });
    (repo.getRunById as ReturnType<typeof vi.fn>).mockResolvedValue(run);

    const broadcaster = createMockBroadcaster();

    const executor = buildExecutor({ repo, registry, broadcaster });
    await executor.executePipeline("run-1");

    /* Handler called 3 times (2 failures + 1 success) */
    expect(handlerFlaky.run).toHaveBeenCalledTimes(3);
    expect(broadcaster.emitStepSucceeded).toHaveBeenCalledTimes(1);
    expect(broadcaster.emitRunSucceeded).toHaveBeenCalledTimes(1);
  });

  it("does not execute if run is already completed", async () => {
    const handlerA = makeStubHandler("step-a");

    const registry = new PipelineStepRegistry();
    registry.register(handlerA);

    const repo = createMockRepo();
    const run = makeDbRun({ status: "SUCCEEDED" });
    (repo.getRunById as ReturnType<typeof vi.fn>).mockResolvedValue(run);

    const broadcaster = createMockBroadcaster();

    const executor = buildExecutor({ repo, registry, broadcaster });
    await executor.executePipeline("run-1");

    /* No handlers called, no events emitted */
    expect(handlerA.run).not.toHaveBeenCalled();
    expect(broadcaster.emitRunStarted).not.toHaveBeenCalled();
  });

  it("handles step timeout", async () => {
    const handlerSlow: PipelineStepHandler = {
      type: "step-a",
      run: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000)),
      ),
    };

    const def: PipelineDefinition = {
      ...TEST_PIPELINE_DEF,
      steps: [
        {
          type: "step-a",
          id: "step-a",
          displayName: "Slow Step",
          timeoutMs: 50, // very short timeout
        },
      ],
    };

    const registry = new PipelineStepRegistry();
    registry.register(handlerSlow);

    const repo = createMockRepo();
    const run = makeDbRun({ definition: def });
    (repo.getRunById as ReturnType<typeof vi.fn>).mockResolvedValue(run);

    const broadcaster = createMockBroadcaster();

    const executor = buildExecutor({ repo, registry, broadcaster });
    await executor.executePipeline("run-1");

    /* Step should fail due to timeout */
    expect(broadcaster.emitStepFailed).toHaveBeenCalledTimes(1);
    expect(broadcaster.emitRunFailed).toHaveBeenCalledTimes(1);
  });
});
