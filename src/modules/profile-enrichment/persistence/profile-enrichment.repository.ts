import { injectable } from "inversify";
import type {
  PrismaClient,
  LeadEnrichmentRequest,
  LeadEnrichmentFieldChange,
  LeadEnrichmentStatus,
  EnrichmentFieldStatus,
  Prisma,
} from "@prisma/client";
import { getPrisma } from "@/infra/prisma";
import type { FieldChange } from "../services/profile-enrichment.mapper";

export interface EnrichmentRequestWithFieldChanges extends LeadEnrichmentRequest {
  fieldChanges: LeadEnrichmentFieldChange[];
  requestedBy: {
    id: string;
    email: string;
  };
}

export interface EnrichmentFieldChangeWithReviewer extends LeadEnrichmentFieldChange {
  reviewedBy: {
    id: string;
    email: string;
  } | null;
}

@injectable()
export class ProfileEnrichmentRepository {
  private readonly prisma: PrismaClient = getPrisma();

  async findLeadById(leadId: string) {
    return this.prisma.lead.findUnique({
      where: { id: leadId },
    });
  }

  async findPendingEnrichmentForLead(
    leadId: string,
  ): Promise<EnrichmentRequestWithFieldChanges | null> {
    return this.prisma.leadEnrichmentRequest.findFirst({
      where: {
        leadId,
        status: {
          in: ["PENDING", "PROCESSING", "AWAITING_REVIEW"],
        },
      },
      include: {
        fieldChanges: true,
        requestedBy: {
          select: {
            id: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findEnrichmentRequestById(
    requestId: string,
  ): Promise<EnrichmentRequestWithFieldChanges | null> {
    return this.prisma.leadEnrichmentRequest.findUnique({
      where: { id: requestId },
      include: {
        fieldChanges: true,
        requestedBy: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }

  async createEnrichmentRequest(data: {
    leadId: string;
    requestedById: string;
  }): Promise<LeadEnrichmentRequest> {
    return this.prisma.leadEnrichmentRequest.create({
      data: {
        leadId: data.leadId,
        requestedById: data.requestedById,
        status: "PENDING",
      },
    });
  }

  async updateEnrichmentRequestStatus(
    requestId: string,
    status: LeadEnrichmentStatus,
    extra?: {
      apifyRunId?: string | null;
      apifyDatasetId?: string | null;
      rawResponse?: Prisma.InputJsonValue;
      errorMessage?: string | null;
    },
  ): Promise<void> {
    await this.prisma.leadEnrichmentRequest.update({
      where: { id: requestId },
      data: {
        status,
        ...extra,
      },
    });
  }

  async createFieldChanges(
    requestId: string,
    changes: FieldChange[],
  ): Promise<void> {
    if (changes.length === 0) return;

    await this.prisma.leadEnrichmentFieldChange.createMany({
      data: changes.map((change) => ({
        requestId,
        fieldName: change.fieldName,
        displayName: change.displayName,
        oldValue: change.oldValue,
        newValue: change.newValue,
        status: "PENDING" as EnrichmentFieldStatus,
      })),
    });
  }

  async getFieldChangesForRequest(
    requestId: string,
  ): Promise<EnrichmentFieldChangeWithReviewer[]> {
    return this.prisma.leadEnrichmentFieldChange.findMany({
      where: { requestId },
      include: {
        reviewedBy: {
          select: {
            id: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });
  }

  async updateFieldChangeStatus(
    fieldChangeId: string,
    status: EnrichmentFieldStatus,
    reviewedById: string,
  ): Promise<void> {
    await this.prisma.leadEnrichmentFieldChange.update({
      where: { id: fieldChangeId },
      data: {
        status,
        reviewedById,
        reviewedAt: new Date(),
      },
    });
  }

  async applyFieldChangeToLead(
    leadId: string,
    fieldName: string,
    newValue: string | null,
  ): Promise<void> {
    // Build dynamic update object
    const updateData: Record<string, unknown> = {
      [fieldName]: newValue,
    };

    await this.prisma.lead.update({
      where: { id: leadId },
      data: updateData,
    });
  }

  async addOrUpdateLeadEmail(leadId: string, email: string): Promise<void> {
    // Check if this email already exists for the lead
    const existing = await this.prisma.leadEmail.findUnique({
      where: {
        leadId_email: {
          leadId,
          email,
        },
      },
    });

    if (!existing) {
      // First, unset any existing primary email
      await this.prisma.leadEmail.updateMany({
        where: {
          leadId,
          isPrimary: true,
        },
        data: {
          isPrimary: false,
        },
      });

      // Create new email as primary
      await this.prisma.leadEmail.create({
        data: {
          leadId,
          email,
          isPrimary: true,
        },
      });
    }
  }

  async getEnrichmentHistory(
    leadId: string,
    pagination: { page: number; perPage: number },
  ): Promise<{
    items: Array<{
      id: string;
      status: LeadEnrichmentStatus;
      createdAt: Date;
      requestedBy: { id: string; email: string };
      fieldChangesSummary: {
        total: number;
        approved: number;
        rejected: number;
      };
    }>;
    total: number;
  }> {
    const skip = (pagination.page - 1) * pagination.perPage;

    const [items, total] = await Promise.all([
      this.prisma.leadEnrichmentRequest.findMany({
        where: { leadId },
        include: {
          requestedBy: {
            select: {
              id: true,
              email: true,
            },
          },
          fieldChanges: {
            select: {
              status: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: pagination.perPage,
      }),
      this.prisma.leadEnrichmentRequest.count({
        where: { leadId },
      }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        status: item.status,
        createdAt: item.createdAt,
        requestedBy: item.requestedBy,
        fieldChangesSummary: {
          total: item.fieldChanges.length,
          approved: item.fieldChanges.filter((fc) => fc.status === "APPROVED")
            .length,
          rejected: item.fieldChanges.filter((fc) => fc.status === "REJECTED")
            .length,
        },
      })),
      total,
    };
  }

  async cancelPendingEnrichment(requestId: string): Promise<void> {
    await this.prisma.leadEnrichmentRequest.update({
      where: { id: requestId },
      data: {
        status: "FAILED",
        errorMessage: "Cancelled: superseded by new enrichment request",
      },
    });
  }

  async countFieldChangesByStatus(requestId: string): Promise<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  }> {
    const fieldChanges = await this.prisma.leadEnrichmentFieldChange.findMany({
      where: { requestId },
      select: { status: true },
    });

    return {
      total: fieldChanges.length,
      pending: fieldChanges.filter((fc) => fc.status === "PENDING").length,
      approved: fieldChanges.filter((fc) => fc.status === "APPROVED").length,
      rejected: fieldChanges.filter((fc) => fc.status === "REJECTED").length,
    };
  }

  async findFieldChangeById(fieldChangeId: string) {
    return this.prisma.leadEnrichmentFieldChange.findUnique({
      where: { id: fieldChangeId },
      include: {
        request: true,
      },
    });
  }

  async setLeadPendingEnrichmentFlag(
    leadId: string,
    hasPending: boolean,
  ): Promise<void> {
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        hasPendingEnrichment: hasPending,
      },
    });
  }
}
