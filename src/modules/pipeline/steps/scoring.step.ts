import { injectable } from "inversify";

import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/**
 * Scoring step — STUB.
 *
 * This step will eventually score leads based on ICP fit, engagement
 * signals, and other criteria. Can appear multiple times in a pipeline
 * (e.g., initial scoring + final scoring after enrichment/signals).
 *
 * Stub: assigns a placeholder score of 0.5 to all leads.
 */
@injectable()
export class ScoringStep implements PipelineStepHandler {
  readonly type = "scoring";

  run(
    ctx: PipelineContext,
    config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    const leads = ctx.data.leads ?? [];
    const model = (config.model as string) ?? "default";
    const stepInstanceId = config._stepId as string | undefined;

    tools.log.info(
      {
        pipelineRunId: ctx.pipelineRunId,
        model,
        leadCount: leads.length,
      },
      "Scoring step: stub — assigning placeholder scores",
    );

    tools.emitProgress(`Scoring ${leads.length} lead(s) with model "${model}" (stub)`);

    const scores = leads.map((lead) => ({
      leadId: lead.id,
      score: 0.5,
      model,
      reason: "placeholder — scoring not yet implemented",
    }));

    /* Use step instance id as context key so multiple scoring steps don't overwrite */
    const contextKey = stepInstanceId ?? "scoringResults";

    return Promise.resolve({
      contextPatch: { [contextKey]: scores },
      outputSummary: {
        leadsScored: scores.length,
        averageScore: 0.5,
        model,
        stub: true,
      },
    });
  }
}
