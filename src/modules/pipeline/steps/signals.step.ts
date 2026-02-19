import { injectable } from "inversify";

import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/**
 * Signals step — STUB.
 *
 * This step will eventually detect buying signals, intent data,
 * job changes, funding events, etc. for each lead/company.
 *
 * Stub: returns an empty signals array.
 */
@injectable()
export class SignalsStep implements PipelineStepHandler {
  readonly type = "signals";

  run(
    ctx: PipelineContext,
    _config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    const leads = ctx.data.leads ?? [];

    tools.log.info(
      { pipelineRunId: ctx.pipelineRunId, leadCount: leads.length },
      "Signals step: stub — no signals detection implemented yet",
    );

    tools.emitProgress(`Detecting signals for ${leads.length} lead(s) (stub)`);

    const signals = leads.map((lead) => ({
      leadId: lead.id,
      signals: [] as string[],
      note: "placeholder — signals detection not yet implemented",
    }));

    return Promise.resolve({
      contextPatch: { signalsResults: signals },
      outputSummary: {
        leadsAnalyzed: leads.length,
        signalsDetected: 0,
        stub: true,
      },
    });
  }
}
