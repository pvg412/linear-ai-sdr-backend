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
 * Current behaviour: passes all leads through unchanged with
 * a skip message. No signals are detected or scored.
 */
@injectable()
export class SignalsStep implements PipelineStepHandler {
  readonly type = "signals";

  run(
    ctx: PipelineContext,
    _config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    tools.log.info(
      { pipelineRunId: ctx.pipelineRunId },
      "Signals step skipped — not yet implemented",
    );

    tools.emitProgress("Signals detection not yet available — skipping");

    return Promise.resolve({
      outputSummary: {
        signalsDetected: 0,
        skipped: true,
      },
    });
  }
}
