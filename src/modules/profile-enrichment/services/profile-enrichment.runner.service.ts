import { injectable, inject } from "inversify";
import { PROFILE_ENRICHMENT_TYPES } from "../profile-enrichment.types";
import { ProfileEnrichmentRepository } from "../persistence/profile-enrichment.repository";
import { ProfileEnrichmentApifyClient } from "./profile-enrichment-apify.client";
import { mapApifyResponseToFieldChanges } from "./profile-enrichment.mapper";
import type { ProfileEnrichmentJobData } from "@/infra/queue/profile-enrichment/profile-enrichment.queue";
import type { LoggerLike } from "@/infra/observability";

@injectable()
export class ProfileEnrichmentRunnerService {
  constructor(
    @inject(PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentRepository)
    private readonly repository: ProfileEnrichmentRepository,
    @inject(PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentApifyClient)
    private readonly apifyClient: ProfileEnrichmentApifyClient,
  ) {}

  async processJob(
    jobData: ProfileEnrichmentJobData,
    logger: LoggerLike,
  ): Promise<void> {
    const { enrichmentRequestId, leadId, linkedinUrl } = jobData;

    const lg = logger.child
      ? logger.child({
          enrichmentRequestId,
          leadId,
          linkedinUrl,
        })
      : logger;

    lg.info({}, "Starting profile enrichment job");

    try {
      // 1. Update status to PROCESSING
      await this.repository.updateEnrichmentRequestStatus(
        enrichmentRequestId,
        "PROCESSING",
      );

      // 2. Fetch the current lead data
      const lead = await this.repository.findLeadById(leadId);

      if (!lead) {
        throw new Error(`Lead not found: ${leadId}`);
      }

      // 3. Call Apify to enrich the profile
      lg.info({}, "Calling Apify profile enrichment");

      const apifyResult = await this.apifyClient.enrichProfile(linkedinUrl);

      if (!apifyResult.success || !apifyResult.data) {
        lg.warn(
          { error: apifyResult.error },
          "Apify enrichment returned no data",
        );

        await this.repository.updateEnrichmentRequestStatus(
          enrichmentRequestId,
          "FAILED",
          {
            errorMessage: apifyResult.error ?? "No enrichment data found",
          },
        );
        return;
      }

      lg.info({}, "Apify enrichment successful, mapping field changes");

      // 4. Store raw response
      await this.repository.updateEnrichmentRequestStatus(
        enrichmentRequestId,
        "PROCESSING",
        {
          rawResponse: apifyResult.data as object,
        },
      );

      // 5. Map response to field changes
      const fieldChanges = mapApifyResponseToFieldChanges(
        apifyResult.data,
        lead,
      );

      lg.info(
        { fieldChangesCount: fieldChanges.length },
        "Mapped field changes",
      );

      if (fieldChanges.length === 0) {
        // No changes to review - mark as completed
        lg.info({}, "No field changes detected, marking as completed");

        await this.repository.updateEnrichmentRequestStatus(
          enrichmentRequestId,
          "COMPLETED",
          {
            errorMessage: "Profile is already up to date",
          },
        );
        return;
      }

      // 6. Create field change records
      await this.repository.createFieldChanges(
        enrichmentRequestId,
        fieldChanges,
      );

      // 7. Update status to AWAITING_REVIEW and set hasPendingEnrichment flag
      await this.repository.updateEnrichmentRequestStatus(
        enrichmentRequestId,
        "AWAITING_REVIEW",
      );

      await this.repository.setLeadPendingEnrichmentFlag(leadId, true);

      lg.info({}, "Profile enrichment job completed, awaiting review");
    } catch (error) {
      lg.error({ err: error }, "Profile enrichment job failed");

      await this.repository.updateEnrichmentRequestStatus(
        enrichmentRequestId,
        "FAILED",
        {
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        },
      );

      throw error;
    }
  }
}
