import { inject, injectable } from "inversify";

import { COMPANY_RESEARCH_TYPES } from "@/modules/company-research/company-research.types";
import type { CompanyResearchCommandService } from "@/modules/company-research/services/company-research.command.service";
import { PROFILE_ENRICHMENT_TYPES } from "@/modules/profile-enrichment/profile-enrichment.types";
import type { ProfileEnrichmentCommandService } from "@/modules/profile-enrichment/services/profile-enrichment.command.service";
import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/**
 * Enrichment step adapter.
 *
 * For each lead in context, enqueues:
 * - Company research (via CompanyResearchCommandService)
 * - Profile enrichment (via ProfileEnrichmentCommandService)
 *
 * These requests are dispatched to their own BullMQ queues.
 * This adapter fires the requests and reports what was enqueued.
 * Full completion tracking (polling for all enrichments to finish)
 * is a future enhancement.
 */
@injectable()
export class EnrichmentStep implements PipelineStepHandler {
  readonly type = "enrichment";

  constructor(
    @inject(COMPANY_RESEARCH_TYPES.CompanyResearchCommandService)
    private readonly companyResearch: CompanyResearchCommandService,
    @inject(PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentCommandService)
    private readonly profileEnrichment: ProfileEnrichmentCommandService,
  ) {}

  async run(
    ctx: PipelineContext,
    config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    const leads = ctx.data.leads ?? [];

    if (leads.length === 0) {
      tools.emitProgress("No leads to enrich");
      return {
        contextPatch: {
          [ctx.pipelineRunId + ":enrichment"]: { enriched: 0 },
        },
        outputSummary: { enrichmentRequests: 0, profileRequests: 0 },
      };
    }

    const includeCompanyResearch = config.includeCompanyResearch !== false;
    const includeProfileEnrichment = config.includeProfileEnrichment !== false;

    let companyResearchCount = 0;
    let profileEnrichmentCount = 0;
    const errors: string[] = [];

    for (const lead of leads) {
      if (await tools.checkCancelled()) break;

      /* Company Research */
      if (includeCompanyResearch && lead.company) {
        try {
          await this.companyResearch.requestCompanyResearch(
            ctx.createdById,
            lead.id,
            { recency: "month", maxResults: 5, includeLinkedinPosts: false },
          );
          companyResearchCount++;
        } catch (err) {
          const msg = `Company research failed for lead ${lead.id}: ${(err as Error).message}`;
          tools.log.warn({ leadId: lead.id, err: msg }, msg);
          errors.push(msg);
        }
      }

      /* Profile Enrichment */
      if (includeProfileEnrichment && lead.linkedinUrl) {
        try {
          await this.profileEnrichment.requestEnrichment(
            ctx.createdById,
            lead.id,
          );
          profileEnrichmentCount++;
        } catch (err) {
          const msg = `Profile enrichment failed for lead ${lead.id}: ${(err as Error).message}`;
          tools.log.warn({ leadId: lead.id, err: msg }, msg);
          errors.push(msg);
        }
      }

      tools.emitProgress(
        `Enriching leads: ${companyResearchCount + profileEnrichmentCount} requests sent`,
      );
    }

    return {
      contextPatch: {
        enrichmentResults: {
          companyResearchCount,
          profileEnrichmentCount,
          errors: errors.length > 0 ? errors : undefined,
        },
      },
      outputSummary: {
        enrichmentRequests: companyResearchCount,
        profileRequests: profileEnrichmentCount,
        totalLeads: leads.length,
        errors: errors.length,
      },
    };
  }
}
