import type { ProgressInfo } from "./pipeline.dto";

/* ------------------------------------------------------------------ */
/*  WebSocket event payloads emitted during pipeline execution        */
/* ------------------------------------------------------------------ */

export interface PipelineStepSummary {
  stepId: string;
  displayName: string;
  stepType: string;
}

/* ---------- Run-level events -------------------------------------- */

export interface PipelineRunStartedEvent {
  type: "pipeline_run_started";
  pipelineRunId: string;
  pipelineKey: string;
  steps: PipelineStepSummary[];
  ts: string;
}

export interface PipelineRunProgressEvent {
  type: "pipeline_run_progress";
  pipelineRunId: string;
  progress: ProgressInfo;
  message: string;
  ts: string;
}

export interface PipelineRunSucceededEvent {
  type: "pipeline_run_succeeded";
  pipelineRunId: string;
  summary: Record<string, unknown>;
  progress: ProgressInfo;
  ts: string;
}

export interface PipelineRunFailedEvent {
  type: "pipeline_run_failed";
  pipelineRunId: string;
  error: string;
  failedStepId?: string;
  progress: ProgressInfo;
  ts: string;
}

export interface PipelineRunCancelledEvent {
  type: "pipeline_run_cancelled";
  pipelineRunId: string;
  cancelledAtStepId?: string;
  progress: ProgressInfo;
  ts: string;
}

/* ---------- Step-level events ------------------------------------- */

export interface PipelineStepStartedEvent {
  type: "pipeline_step_started";
  pipelineRunId: string;
  stepId: string;
  stepType: string;
  displayName: string;
  progress: ProgressInfo;
  ts: string;
}

export interface PipelineStepSucceededEvent {
  type: "pipeline_step_succeeded";
  pipelineRunId: string;
  stepId: string;
  outputSummary: Record<string, unknown>;
  progress: ProgressInfo;
  durationMs: number;
  ts: string;
}

export interface PipelineStepFailedEvent {
  type: "pipeline_step_failed";
  pipelineRunId: string;
  stepId: string;
  error: string;
  progress: ProgressInfo;
  ts: string;
}

export interface PipelineStepSkippedEvent {
  type: "pipeline_step_skipped";
  pipelineRunId: string;
  stepId: string;
  reason: string;
  progress: ProgressInfo;
  ts: string;
}

export interface PipelineStepProgressEvent {
  type: "pipeline_step_progress";
  pipelineRunId: string;
  stepId: string;
  message: string;
  data?: unknown;
  ts: string;
}

/* ---------- Union type -------------------------------------------- */

export type PipelineWsEvent =
  | PipelineRunStartedEvent
  | PipelineRunProgressEvent
  | PipelineRunSucceededEvent
  | PipelineRunFailedEvent
  | PipelineRunCancelledEvent
  | PipelineStepStartedEvent
  | PipelineStepSucceededEvent
  | PipelineStepFailedEvent
  | PipelineStepSkippedEvent
  | PipelineStepProgressEvent;
