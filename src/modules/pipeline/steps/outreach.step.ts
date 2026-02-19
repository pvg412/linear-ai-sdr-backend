import { injectable } from "inversify";

import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/**
 * Outreach step adapter.
 *
 * Outreach generation in the current system is tightly coupled to the
 * chat/WS flow (ChatAiStreamService + outreach commands). Decoupling it
 * for headless pipeline execution requires a dedicated outreach generation
 * service — this is planned but not yet built.
 *
 * Current implementation: thin adapter that records which leads are ready
 * for outreach and returns a summary. The actual outreach generation
 * should be triggered separately (e.g., via the chat UI) until the
 * headless outreach service is available.
 */
@injectable()
export class OutreachStep implements PipelineStepHandler {
  readonly type = "outreach";

  run(
    ctx: PipelineContext,
    config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    const leads = ctx.data.leads ?? [];
    const channel = (config.channel as string) ?? "email";

    tools.emitProgress(
      `Preparing outreach for ${leads.length} lead(s) via ${channel}`,
    );

    tools.log.info(
      {
        pipelineRunId: ctx.pipelineRunId,
        leadCount: leads.length,
        channel,
      },
      "Outreach step: headless outreach generation not yet implemented. " +
        "Recording leads as outreach-ready.",
    );

    const outreachReady = leads.map((lead) => ({
      leadId: lead.id,
      fullName: lead.fullName ?? null,
      channel,
      status: "pending_generation" as const,
    }));

    tools.emitProgress(
      `${outreachReady.length} lead(s) marked as outreach-ready`,
    );

    return Promise.resolve({
      contextPatch: {
        outreachDrafts: outreachReady,
      },
      outputSummary: {
        leadsReady: outreachReady.length,
        channel,
        note: "Headless outreach generation pending. Use chat UI to generate messages.",
      },
    });
  }
}
