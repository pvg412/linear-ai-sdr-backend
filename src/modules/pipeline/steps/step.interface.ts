import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/**
 * Contract that every pipeline step handler must implement.
 *
 * Steps write inter-step data directly to the database (e.g. PipelineRunLead,
 * LeadScore, LeadConversationMessage). The returned PipelineStepResult only
 * carries a small outputSummary for the UI.
 */
export interface PipelineStepHandler {
  /** Unique handler type string, e.g. "lead-generation", "scoring" */
  readonly type: string;

  /**
   * Execute the step.
   *
   * @param ctx    Immutable pipeline identity (runId, key, userId, companyId)
   * @param config Per-instance configuration from the pipeline definition
   * @param tools  Logger, cancellation check, progress emitter
   * @returns      A small output summary for the UI (stored in PipelineStepRun.outputSummary)
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
