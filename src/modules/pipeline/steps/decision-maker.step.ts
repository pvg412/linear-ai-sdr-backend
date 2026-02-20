import { injectable } from "inversify";

import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/**
 * Decision Maker step — DISABLED.
 *
 * This step is currently disabled in the pipeline definition (`enabled: false`)
 * and will not be executed or shown on the frontend.
 *
 * When re-enabled, it will identify the best decision-maker contact
 * within each company based on seniority, department, and org-chart data.
 */
@injectable()
export class DecisionMakerStep implements PipelineStepHandler {
  readonly type = "decision-maker";

  run(
    _ctx: PipelineContext,
    _config: Record<string, unknown>,
    _tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    // --- Original stub logic (commented out while step is disabled) ---
    // const leads = ctx.data.leads ?? [];
    //
    // tools.log.info(
    //   { pipelineRunId: ctx.pipelineRunId, leadCount: leads.length },
    //   "Decision-maker step: stub — all leads pass through",
    // );
    //
    // tools.emitProgress(
    //   `Evaluating decision-makers for ${leads.length} lead(s) (stub)`,
    // );
    //
    // const decisions = leads.map((lead) => ({
    //   leadId: lead.id,
    //   isDecisionMaker: true,
    //   confidence: 1.0,
    //   note: "placeholder — decision-maker detection not yet implemented",
    // }));
    //
    // return Promise.resolve({
    //   contextPatch: { decisionMakerResults: decisions },
    //   outputSummary: {
    //     leadsEvaluated: leads.length,
    //     decisionMakersFound: leads.length,
    //     stub: true,
    //   },
    // });

    return Promise.resolve({
      contextPatch: {},
      outputSummary: { disabled: true },
    });
  }
}
