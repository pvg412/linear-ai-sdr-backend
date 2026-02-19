import { injectable } from "inversify";

import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/**
 * Decision Maker step — STUB.
 *
 * This step will eventually identify the best decision-maker contact
 * within each company based on seniority, department, and org-chart data.
 *
 * Stub: passes through all leads unchanged (all are "approved").
 */
@injectable()
export class DecisionMakerStep implements PipelineStepHandler {
  readonly type = "decision-maker";

  run(
    ctx: PipelineContext,
    _config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    const leads = ctx.data.leads ?? [];

    tools.log.info(
      { pipelineRunId: ctx.pipelineRunId, leadCount: leads.length },
      "Decision-maker step: stub — all leads pass through",
    );

    tools.emitProgress(
      `Evaluating decision-makers for ${leads.length} lead(s) (stub)`,
    );

    const decisions = leads.map((lead) => ({
      leadId: lead.id,
      isDecisionMaker: true,
      confidence: 1.0,
      note: "placeholder — decision-maker detection not yet implemented",
    }));

    return Promise.resolve({
      contextPatch: { decisionMakerResults: decisions },
      outputSummary: {
        leadsEvaluated: leads.length,
        decisionMakersFound: leads.length,
        stub: true,
      },
    });
  }
}
