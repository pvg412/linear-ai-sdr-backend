import { inject, injectable } from "inversify";

import { LEAD_TYPES } from "@/modules/lead/lead.types";
import type { LeadQueryService } from "@/modules/lead/services/lead.query.service";
import { LEAD_SEARCH_TYPES } from "@/modules/lead-search/lead-search.types";
import type { LeadSearchRunnerService } from "@/modules/lead-search/lead-search.runner.service";
import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/**
 * Lead Generation step adapter.
 *
 * Depending on pipeline input, this step either:
 * - Uses pre-supplied `leadIds` (validates they exist, loads details into context)
 * - Triggers a lead search inline (uses existing LeadSearchRunnerService.runInline)
 *
 * Current implementation: thin adapter for the `leadIds` path.
 * The full inline-search path requires creating a LeadSearch record and
 * calling runInline — this is stubbed with a TODO for now.
 */
@injectable()
export class LeadGenerationStep implements PipelineStepHandler {
  readonly type = "lead-generation";

  /**
   * LeadSearchRunnerService is injected for future use:
   * full inline search execution when `input.searchQuery` is provided.
   */
  readonly leadSearchRunner: LeadSearchRunnerService;

  constructor(
    @inject(LEAD_TYPES.LeadQueryService)
    private readonly leadQueryService: LeadQueryService,
    @inject(LEAD_SEARCH_TYPES.LeadSearchRunnerService)
    leadSearchRunner: LeadSearchRunnerService,
  ) {
    this.leadSearchRunner = leadSearchRunner;
  }

  async run(
    ctx: PipelineContext,
    _config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    const leadIds = ctx.input.leadIds;

    if (!leadIds || leadIds.length === 0) {
      tools.log.info(
        { pipelineRunId: ctx.pipelineRunId },
        "No leadIds in input; lead-generation step returning empty set. " +
          "Full inline search integration is a future enhancement.",
      );
      tools.emitProgress("No lead IDs provided; skipping lead generation");

      return {
        contextPatch: { leads: [] },
        outputSummary: { leadsFound: 0, source: "none" },
      };
    }

    tools.emitProgress(`Loading ${leadIds.length} lead(s)...`);

    /* Fetch each lead (validates existence + loads details into context) */
    const leads = [];
    for (const leadId of leadIds) {
      try {
        const detail = await this.leadQueryService.getLeadDetail(
          ctx.createdById,
          leadId,
        );
        leads.push({
          id: detail.id,
          fullName: detail.fullName,
          email: detail.email,
          company: detail.company,
          linkedinUrl: detail.linkedinUrl,
          title: detail.title,
        });
      } catch (err) {
        tools.log.warn(
          { leadId, err: (err as Error).message },
          "Failed to load lead; skipping",
        );
      }

      if (await tools.checkCancelled()) return emptyResult();
    }

    tools.emitProgress(`Loaded ${leads.length} lead(s)`);

    return {
      contextPatch: { leads },
      outputSummary: { leadsFound: leads.length, source: "input" },
    };
  }
}

function emptyResult(): PipelineStepResult {
  return {
    contextPatch: { leads: [] },
    outputSummary: { leadsFound: 0, source: "cancelled" },
  };
}
