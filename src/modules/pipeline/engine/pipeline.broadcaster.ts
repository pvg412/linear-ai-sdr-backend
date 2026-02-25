import { inject, injectable } from "inversify";

import { REALTIME_TYPES } from "@/infra/realtime/realtime.types";
import { RealtimeHub } from "@/infra/realtime/realtimeHub";
import type { ProgressInfo } from "@/modules/pipeline/schemas/pipeline.dto";
import type {
  PipelineWsEvent,
  PipelineStepSummary,
} from "@/modules/pipeline/schemas/pipeline.events";

/**
 * Thin wrapper over RealtimeHub that constructs typed pipeline events
 * and broadcasts them to the correct room (`pipeline:{runId}`).
 */
@injectable()
export class PipelineBroadcaster {
  constructor(
    @inject(REALTIME_TYPES.RealtimeHub)
    private readonly hub: RealtimeHub,
  ) {}

  /* ---------------------------------------------------------------- */
  /*  Room key                                                        */
  /* ---------------------------------------------------------------- */

  private roomKey(pipelineRunId: string): string {
    return `pipeline:${pipelineRunId}`;
  }

  /* ---------------------------------------------------------------- */
  /*  Public: subscribe / unsubscribe (delegated to hub)              */
  /* ---------------------------------------------------------------- */

  subscribe(
    pipelineRunId: string,
    socket: Parameters<RealtimeHub["subscribe"]>[1],
  ): void {
    this.hub.subscribe(this.roomKey(pipelineRunId), socket);
  }

  /* ---------------------------------------------------------------- */
  /*  Run-level events                                                */
  /* ---------------------------------------------------------------- */

  emitRunStarted(
    pipelineRunId: string,
    pipelineKey: string,
    steps: PipelineStepSummary[],
  ): void {
    this.emit(pipelineRunId, {
      type: "pipeline_run_started",
      pipelineRunId,
      pipelineKey,
      steps,
      ts: now(),
    });
  }

  emitRunSucceeded(
    pipelineRunId: string,
    summary: Record<string, unknown>,
    progress: ProgressInfo,
  ): void {
    this.emit(pipelineRunId, {
      type: "pipeline_run_succeeded",
      pipelineRunId,
      summary,
      progress,
      ts: now(),
    });
  }

  emitRunFailed(
    pipelineRunId: string,
    error: string,
    progress: ProgressInfo,
    failedStepId?: string,
  ): void {
    this.emit(pipelineRunId, {
      type: "pipeline_run_failed",
      pipelineRunId,
      error,
      failedStepId,
      progress,
      ts: now(),
    });
  }

  emitRunCancelled(
    pipelineRunId: string,
    progress: ProgressInfo,
    cancelledAtStepId?: string,
  ): void {
    this.emit(pipelineRunId, {
      type: "pipeline_run_cancelled",
      pipelineRunId,
      cancelledAtStepId,
      progress,
      ts: now(),
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Step-level events                                               */
  /* ---------------------------------------------------------------- */

  emitStepStarted(
    pipelineRunId: string,
    stepId: string,
    stepType: string,
    displayName: string,
    progress: ProgressInfo,
  ): void {
    this.emit(pipelineRunId, {
      type: "pipeline_step_started",
      pipelineRunId,
      stepId,
      stepType,
      displayName,
      progress,
      ts: now(),
    });
  }

  emitStepSucceeded(
    pipelineRunId: string,
    stepId: string,
    outputSummary: Record<string, unknown>,
    data: Record<string, unknown> | undefined,
    progress: ProgressInfo,
    durationMs: number,
  ): void {
    this.emit(pipelineRunId, {
      type: "pipeline_step_succeeded",
      pipelineRunId,
      stepId,
      outputSummary,
      ...(data ? { data } : {}),
      progress,
      durationMs,
      ts: now(),
    });
  }

  emitStepFailed(
    pipelineRunId: string,
    stepId: string,
    error: string,
    progress: ProgressInfo,
  ): void {
    this.emit(pipelineRunId, {
      type: "pipeline_step_failed",
      pipelineRunId,
      stepId,
      error,
      progress,
      ts: now(),
    });
  }

  emitStepSkipped(
    pipelineRunId: string,
    stepId: string,
    reason: string,
    progress: ProgressInfo,
  ): void {
    this.emit(pipelineRunId, {
      type: "pipeline_step_skipped",
      pipelineRunId,
      stepId,
      reason,
      progress,
      ts: now(),
    });
  }

  emitStepProgress(
    pipelineRunId: string,
    stepId: string,
    message: string,
    data?: unknown,
  ): void {
    this.emit(pipelineRunId, {
      type: "pipeline_step_progress",
      pipelineRunId,
      stepId,
      message,
      data,
      ts: now(),
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Internal                                                        */
  /* ---------------------------------------------------------------- */

  private emit(pipelineRunId: string, event: PipelineWsEvent): void {
    this.hub.broadcast(this.roomKey(pipelineRunId), event);
  }
}

function now(): string {
  return new Date().toISOString();
}
