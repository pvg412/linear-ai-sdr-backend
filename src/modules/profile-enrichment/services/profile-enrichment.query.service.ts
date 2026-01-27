import { injectable, inject } from "inversify";
import { PROFILE_ENRICHMENT_TYPES } from "../profile-enrichment.types";
import { ProfileEnrichmentRepository } from "../persistence/profile-enrichment.repository";
import { UserFacingError } from "@/infra/userFacingError";
import type { LeadEnrichmentStatus, EnrichmentFieldStatus } from "@prisma/client";
import { getPrisma } from "@/infra/prisma";

export interface PendingEnrichmentResponse {
  request: {
    id: string;
    status: LeadEnrichmentStatus;
    createdAt: string;
    requestedBy: { id: string; email: string };
  } | null;
  fieldChanges: Array<{
    id: string;
    fieldName: string;
    displayName: string;
    oldValue: string | null;
    newValue: string | null;
    status: EnrichmentFieldStatus;
    reviewedBy?: { id: string; email: string };
    reviewedAt?: string;
  }>;
  summary: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
}

export interface EnrichmentHistoryResponse {
  items: Array<{
    id: string;
    status: LeadEnrichmentStatus;
    createdAt: string;
    requestedBy: { id: string; email: string };
    summary: { total: number; approved: number; rejected: number };
  }>;
  total: number;
}

@injectable()
export class ProfileEnrichmentQueryService {
  constructor(
    @inject(PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentRepository)
    private readonly repository: ProfileEnrichmentRepository,
  ) { }

  async getPendingEnrichment(
    userId: string,
    leadId: string,
  ): Promise<PendingEnrichmentResponse> {
    const prisma = getPrisma();

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "User not found",
      });
    }

    // Verify lead exists
    const lead = await this.repository.findLeadById(leadId);

    if (!lead) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Lead not found",
      });
    }

    // Find the most recent pending/awaiting_review enrichment
    const enrichmentRequest =
      await this.repository.findPendingEnrichmentForLead(leadId);

    if (!enrichmentRequest) {
      return {
        request: null,
        fieldChanges: [],
        summary: {
          total: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
        },
      };
    }

    // Get field changes with reviewer info
    const fieldChanges = await this.repository.getFieldChangesForRequest(
      enrichmentRequest.id,
    );

    // Calculate summary
    const summary = {
      total: fieldChanges.length,
      pending: fieldChanges.filter((fc) => fc.status === "PENDING").length,
      approved: fieldChanges.filter((fc) => fc.status === "APPROVED").length,
      rejected: fieldChanges.filter((fc) => fc.status === "REJECTED").length,
    };

    return {
      request: {
        id: enrichmentRequest.id,
        status: enrichmentRequest.status,
        createdAt: enrichmentRequest.createdAt.toISOString(),
        requestedBy: enrichmentRequest.requestedBy,
      },
      fieldChanges: fieldChanges.map((fc) => ({
        id: fc.id,
        fieldName: fc.fieldName,
        displayName: fc.displayName,
        oldValue: fc.oldValue,
        newValue: fc.newValue,
        status: fc.status,
        reviewedBy: fc.reviewedBy ?? undefined,
        reviewedAt: fc.reviewedAt?.toISOString(),
      })),
      summary,
    };
  }

  async getEnrichmentHistory(
    userId: string,
    leadId: string,
    pagination: { page: number; perPage: number },
  ): Promise<EnrichmentHistoryResponse> {
    const prisma = getPrisma();

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "User not found",
      });
    }

    // Verify lead exists
    const lead = await this.repository.findLeadById(leadId);

    if (!lead) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Lead not found",
      });
    }

    const result = await this.repository.getEnrichmentHistory(
      leadId,
      pagination,
    );

    return {
      items: result.items.map((item) => ({
        id: item.id,
        status: item.status,
        createdAt: item.createdAt.toISOString(),
        requestedBy: item.requestedBy,
        summary: item.fieldChangesSummary,
      })),
      total: result.total,
    };
  }

  async getEnrichmentStatus(
    userId: string,
    leadId: string,
    enrichmentRequestId: string,
  ): Promise<{
    id: string;
    status: LeadEnrichmentStatus;
    errorMessage: string | null;
    fieldChangesCount: number;
  }> {
    const prisma = getPrisma();

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "User not found",
      });
    }

    // Verify lead exists
    const lead = await this.repository.findLeadById(leadId);

    if (!lead) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Lead not found",
      });
    }

    const enrichmentRequest =
      await this.repository.findEnrichmentRequestById(enrichmentRequestId);

    if (!enrichmentRequest) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Enrichment request not found",
      });
    }

    if (enrichmentRequest.leadId !== leadId) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Enrichment request not found for this lead",
      });
    }

    return {
      id: enrichmentRequest.id,
      status: enrichmentRequest.status,
      errorMessage: enrichmentRequest.errorMessage,
      fieldChangesCount: enrichmentRequest.fieldChanges.length,
    };
  }
}
