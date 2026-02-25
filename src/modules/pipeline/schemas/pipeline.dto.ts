import type { LoggerLike } from "@/infra/observability";

/* ------------------------------------------------------------------ */
/*  Pipeline Definition (data-driven, serializable config)            */
/* ------------------------------------------------------------------ */

export interface PipelineDefinition {
  /** Unique identifier for this pipeline template, e.g. "default-company-pipeline" */
  key: string;
  /** Monotonically increasing version; bumped on structural changes */
  version: number;
  displayName: string;
  description?: string;
  steps: PipelineStepConfig[];
  defaults?: PipelineDefaults;
}

export interface PipelineDefaults {
  onError: OnErrorPolicy;
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
}

export type OnErrorPolicy = "stop" | "continue";

export interface RetryPolicy {
  /** Total attempts including the first run (1 = no retries) */
  maxAttempts: number;
  backoffMs: number;
  backoffType?: "fixed" | "exponential";
}

export interface PipelineStepConfig {
  /** Handler type registered in the step registry, e.g. "lead-generation" */
  type: string;
  /** Unique instance id within the pipeline, e.g. "scoring-initial" */
  id: string;
  displayName: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
  onError?: OnErrorPolicy;
}

/* ------------------------------------------------------------------ */
/*  Pipeline Context (immutable identity passed to every step)        */
/* ------------------------------------------------------------------ */

export interface PipelineContext {
  pipelineRunId: string;
  pipelineKey: string;
  createdById: string;
  companyId: string | null;
}

/* ------------------------------------------------------------------ */
/*  Step Execution Result                                             */
/* ------------------------------------------------------------------ */

export interface PipelineStepResult {
  /** Small JSON-safe summary stored in PipelineStepRun.outputSummary for UI display */
  outputSummary: Record<string, unknown>;

  /**
   * Detailed step output sent via WebSocket but NOT persisted to DB.
   * Shape matches the corresponding section of the GET /pipelines/runs/:id response
   * so the frontend can render results in real-time without polling.
   */
  data?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Tools injected into every step at runtime                         */
/* ------------------------------------------------------------------ */

export interface PipelineTools {
  log: LoggerLike;
  /** Returns true if the run has been marked for cancellation */
  checkCancelled: () => Promise<boolean>;
  /** Emit a progress message to WS subscribers (within-step granularity) */
  emitProgress: (message: string, data?: unknown) => void;
}

/* ------------------------------------------------------------------ */
/*  Progress helper                                                   */
/* ------------------------------------------------------------------ */

export interface ProgressInfo {
  /** Number of completed steps (0-based before first step finishes) */
  current: number;
  total: number;
  /** 0–100, rounded */
  percent: number;
}

export function buildProgress(current: number, total: number): ProgressInfo {
  return {
    current,
    total,
    percent: total > 0 ? Math.round((current / total) * 100) : 0,
  };
}
