import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/**
 * Contract that every pipeline step handler must implement.
 *
 * Steps are **stateless** — all mutable state lives in the PipelineContext.
 * The registry maps a `type` string to exactly one handler instance.
 */
export interface PipelineStepHandler {
  /** Unique handler type string, e.g. "lead-generation", "scoring" */
  readonly type: string;

  /**
   * Execute the step.
   *
   * @param ctx    Current pipeline context (read from `ctx.data`, write via return)
   * @param config Per-instance configuration from the pipeline definition
   * @param tools  Logger, cancellation check, progress emitter
   * @returns      Context patch + a small output summary for the UI
   */
  run(
    ctx: PipelineContext,
    config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult>;

  /**
   * Optional: validate step-specific config before pipeline execution starts.
   * Throw UserFacingError if config is invalid.
   */
  validateConfig?(config: Record<string, unknown>): void;

  /**
   * Optional: estimate the cost (in USD) of running this step.
   * Used for budget-based gating before pipeline launch.
   */
  estimateCost?(config: Record<string, unknown>): Promise<{ estimateUsd: number }>;
}
