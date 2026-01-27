import { injectable } from "inversify";
import {
  PrismaClient,
  CompanyResearch,
  CompanyResearchStatus,
  CompanyResearchItemCategory,
  Lead,
} from "@prisma/client";
import { getPrisma } from "@/infra/prisma";

export interface CompanyResearchWithItems extends CompanyResearch {
  lead: Lead;
  items: Array<{
    id: string;
    date: string | null;
    summary: string;
    sourceUrl: string;
    category: CompanyResearchItemCategory;
    source: string | null;
  }>;
}

export interface CreateCompanyResearchItemInput {
  date: string | null;
  summary: string;
  sourceUrl: string;
  category: CompanyResearchItemCategory;
  source: "perplexity" | "linkedin";
}

@injectable()
export class CompanyResearchRepository {
  private readonly prisma: PrismaClient = getPrisma();

  async findLeadById(leadId: string) {
    return this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        companyWebsites: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  async createCompanyResearch(data: {
    leadId: string;
    requestedById: string;
    company: string;
    companyDomain: string | null;
    recency: string | null;
    maxResults: number;
  }): Promise<CompanyResearch> {
    return this.prisma.companyResearch.create({
      data: {
        leadId: data.leadId,
        requestedById: data.requestedById,
        company: data.company,
        companyDomain: data.companyDomain,
        recency: data.recency,
        maxResults: data.maxResults,
        status: CompanyResearchStatus.PENDING,
        relatedQuestions: [],
      },
    });
  }

  async updateCompanyResearchStatus(
    researchId: string,
    status: CompanyResearchStatus,
    extra?: {
      errorMessage?: string | null;
    },
  ): Promise<void> {
    await this.prisma.companyResearch.update({
      where: { id: researchId },
      data: {
        status,
        ...extra,
      },
    });
  }

  async addResearchItems(
    researchId: string,
    items: CreateCompanyResearchItemInput[],
  ): Promise<void> {
    if (items.length === 0) return;

    await this.prisma.companyResearchItem.createMany({
      data: items.map((item) => ({
        researchId,
        date: item.date,
        summary: item.summary,
        sourceUrl: item.sourceUrl,
        category: item.category,
        source: item.source,
      })),
    });
  }

  async markResearchCompleted(researchId: string): Promise<void> {
    await this.prisma.companyResearch.update({
      where: { id: researchId },
      data: {
        status: CompanyResearchStatus.COMPLETED,
        searchedAt: new Date(),
      },
    });
  }

  async findCompanyResearchById(
    researchId: string,
  ): Promise<CompanyResearchWithItems | null> {
    return this.prisma.companyResearch.findUnique({
      where: { id: researchId },
      include: {
        lead: true,
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  async findPendingResearchForLead(
    leadId: string,
  ): Promise<CompanyResearch | null> {
    return this.prisma.companyResearch.findFirst({
      where: {
        leadId,
        status: {
          in: [CompanyResearchStatus.PENDING, CompanyResearchStatus.PROCESSING],
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async cancelPendingResearch(researchId: string): Promise<void> {
    await this.prisma.companyResearch.update({
      where: { id: researchId },
      data: {
        status: "FAILED",
        errorMessage: "Cancelled: superseded by new research request",
      },
    });
  }
}
