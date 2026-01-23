import { injectable, inject } from "inversify";
import { Queue } from "bullmq";
import { PROFILE_ENRICHMENT_TYPES } from "../profile-enrichment.types";
import { ProfileEnrichmentRepository } from "../persistence/profile-enrichment.repository";
import { QUEUE_TYPES } from "@/infra/queue/queue.types";
import type {
  ProfileEnrichmentJobData,
  ProfileEnrichmentJobName,
} from "@/infra/queue/profile-enrichment/profile-enrichment.queue";
import { profileEnrichmentJobOptions } from "@/infra/queue/profile-enrichment/profile-enrichment.queue";
import { UserFacingError } from "@/infra/userFacingError";
import { FIELD_TO_LEAD_PROPERTY } from "./profile-enrichment.mapper";
import type { LeadEnrichmentStatus } from "@prisma/client";

export interface RequestEnrichmentResult {
  enrichmentRequestId: string;
  status: string;
  message: string;
}

export interface ReviewDecision {
  fieldChangeId: string;
  action: "approve" | "reject";
}

export interface ReviewResult {
  updated: number;
  appliedFields: string[];
  rejectedFields: string[];
  enrichmentStatus: LeadEnrichmentStatus;
}

@injectable()
export class ProfileEnrichmentCommandService {
  constructor(
    @inject(PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentRepository)
    private readonly repository: ProfileEnrichmentRepository,
    @inject(QUEUE_TYPES.ProfileEnrichmentQueue)
    private readonly queue: Queue<
      ProfileEnrichmentJobData,
      void,
      ProfileEnrichmentJobName
    >,
  ) {}

  async requestEnrichment(
    userId: string,
    leadId: string,
    force: boolean = false,
  ): Promise<RequestEnrichmentResult> {
    // 1. Find the lead and validate it has linkedinUrl
    const lead = await this.repository.findLeadById(leadId);

    if (!lead) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Lead not found",
      });
    }

    if (!lead.linkedinUrl) {
      throw new UserFacingError({
        code: "VALIDATION_ERROR",
        userMessage: "Lead does not have a LinkedIn URL",
      });
    }

    // 2. Check for existing pending enrichment
    const existingRequest =
      await this.repository.findPendingEnrichmentForLead(leadId);

    if (existingRequest) {
      if (!force) {
        throw new UserFacingError({
          code: "CONFLICT",
          userMessage:
            "There is already a pending enrichment request for this lead. Use force=true to override.",
        });
      }

      // Cancel existing request
      await this.repository.cancelPendingEnrichment(existingRequest.id);
    }

    // 3. Create new enrichment request
    const enrichmentRequest = await this.repository.createEnrichmentRequest({
      leadId,
      requestedById: userId,
    });

    // 4. Add job to queue
    await this.queue.add(
      "profileEnrichment.run",
      {
        enrichmentRequestId: enrichmentRequest.id,
        leadId,
        linkedinUrl: lead.linkedinUrl,
        triggeredById: userId,
      },
      profileEnrichmentJobOptions(),
    );

    return {
      enrichmentRequestId: enrichmentRequest.id,
      status: "PENDING",
      message: "Enrichment job queued",
    };
  }

  async reviewFieldChanges(
    userId: string,
    leadId: string,
    decisions: ReviewDecision[],
  ): Promise<ReviewResult> {
    // 1. Find the pending enrichment for this lead
    const enrichmentRequest =
      await this.repository.findPendingEnrichmentForLead(leadId);

    if (!enrichmentRequest) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "No pending enrichment request found for this lead",
      });
    }

    if (enrichmentRequest.status !== "AWAITING_REVIEW") {
      throw new UserFacingError({
        code: "VALIDATION_ERROR",
        userMessage: `Cannot review enrichment in status: ${enrichmentRequest.status}`,
      });
    }

    // 2. Validate all field change IDs belong to this request
    const fieldChangeIds = new Set(
      enrichmentRequest.fieldChanges.map((fc) => fc.id),
    );

    for (const decision of decisions) {
      if (!fieldChangeIds.has(decision.fieldChangeId)) {
        throw new UserFacingError({
          code: "VALIDATION_ERROR",
          userMessage: `Field change ${decision.fieldChangeId} does not belong to this enrichment request`,
        });
      }
    }

    // 3. Process each decision
    const appliedFields: string[] = [];
    const rejectedFields: string[] = [];

    for (const decision of decisions) {
      const fieldChange = enrichmentRequest.fieldChanges.find(
        (fc) => fc.id === decision.fieldChangeId,
      );

      if (!fieldChange) continue;

      if (fieldChange.status !== "PENDING") {
        // Skip already processed fields
        continue;
      }

      if (decision.action === "approve") {
        // Update field change status
        await this.repository.updateFieldChangeStatus(
          decision.fieldChangeId,
          "APPROVED",
          userId,
        );

        // Apply value to Lead model
        if (FIELD_TO_LEAD_PROPERTY[fieldChange.fieldName]) {
          await this.repository.applyFieldChangeToLead(
            leadId,
            fieldChange.fieldName,
            fieldChange.newValue,
          );

          // If it's an email field, also add to LeadEmail[]
          if (fieldChange.fieldName === "email" && fieldChange.newValue) {
            await this.repository.addOrUpdateLeadEmail(
              leadId,
              fieldChange.newValue,
            );
          }
        }

        appliedFields.push(fieldChange.fieldName);
      } else {
        // Reject
        await this.repository.updateFieldChangeStatus(
          decision.fieldChangeId,
          "REJECTED",
          userId,
        );

        rejectedFields.push(fieldChange.fieldName);
      }
    }

    // 4. Recalculate overall enrichment status
    const counts = await this.repository.countFieldChangesByStatus(
      enrichmentRequest.id,
    );

    let newStatus: LeadEnrichmentStatus = "AWAITING_REVIEW";

    if (counts.pending === 0) {
      // All fields have been processed
      if (counts.approved > 0 && counts.rejected > 0) {
        newStatus = "COMPLETED"; // Mixed decisions
      } else if (counts.approved > 0) {
        newStatus = "COMPLETED"; // All approved
      } else {
        newStatus = "COMPLETED"; // All rejected
      }
    }

    if (newStatus !== enrichmentRequest.status) {
      await this.repository.updateEnrichmentRequestStatus(
        enrichmentRequest.id,
        newStatus,
      );
    }

    // If all fields processed, clear the pending enrichment flag
    if (counts.pending === 0) {
      await this.repository.setLeadPendingEnrichmentFlag(leadId, false);
    }

    return {
      updated: appliedFields.length + rejectedFields.length,
      appliedFields,
      rejectedFields,
      enrichmentStatus: newStatus,
    };
  }
}
