import { inject, injectable } from "inversify";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";
import { COMPANY_RESEARCH_TYPES } from "../company-research.types";
import { PerplexityClient } from "./perplexity.client";
import type {
  CompanyResearchQuery,
  CompanyResearchResponse,
} from "../schemas/company-research.schemas";

@injectable()
export class CompanyResearchQueryService {
  constructor(
    @inject(COMPANY_RESEARCH_TYPES.PerplexityClient)
    private readonly perplexityClient: PerplexityClient,
  ) {}

  async getCompanyResearch(
    userId: string,
    leadId: string,
    options: CompanyResearchQuery,
  ): Promise<CompanyResearchResponse> {
    const prisma = getPrisma();

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "User not found",
      });
    }

    // Fetch lead with company websites
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        companyWebsites: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!lead) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Lead not found",
      });
    }

    // Require company name for search
    if (!lead.company) {
      throw new UserFacingError({
        code: "VALIDATION_ERROR",
        userMessage: "Lead does not have company information",
      });
    }

    // Collect all company websites
    const companyWebsites: string[] = [];
    if (lead.companyUrl) companyWebsites.push(lead.companyUrl);
    if (lead.companyLinkedinUrl) companyWebsites.push(lead.companyLinkedinUrl);
    for (const website of lead.companyWebsites) {
      companyWebsites.push(website.url);
    }

    // Search using Perplexity
    const searchResult = await this.perplexityClient.searchCompanyInfo({
      companyName: lead.company,
      companyDomain: lead.companyDomain,
      companyWebsites,
      recency: options.recency,
      maxResults: options.maxResults,
    });

    // Save results to database
    const savedResearch = await prisma.companyResearch.create({
      data: {
        leadId: lead.id,
        requestedById: userId,
        company: lead.company,
        companyDomain: lead.companyDomain,
        recency: options.recency || null,
        maxResults: options.maxResults,
        searchedAt: new Date(),
        relatedQuestions: [],
        items: {
          create: searchResult.items.map((item) => ({
            date: item.date,
            summary: item.summary,
            sourceUrl: item.sourceUrl,
            category: item.category.toUpperCase() as
              | "NEWS"
              | "BLOG"
              | "ACTIVITY"
              | "WEBSITE",
          })),
        },
      },
      include: {
        items: true,
      },
    });

    // Sort items by date (newest first, nulls last)
    const sortedItems = savedResearch.items
      .map((item) => ({
        date: item.date,
        summary: item.summary,
        sourceUrl: item.sourceUrl,
        category: item.category.toLowerCase() as
          | "news"
          | "blog"
          | "activity"
          | "website",
      }))
      .sort((a, b) => {
        // Items without dates go to the end
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        // Sort by date descending (newest first)
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

    return {
      leadId: lead.id,
      company: lead.company,
      companyDomain: lead.companyDomain,
      searchedAt: savedResearch.searchedAt.toISOString(),
      items: sortedItems,
    };
  }

  async getCompanyResearchHistory(
    userId: string,
    leadId: string,
  ): Promise<CompanyResearchResponse[]> {
    const prisma = getPrisma();

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "User not found",
      });
    }

    // Fetch research history for the lead
    const researches = await prisma.companyResearch.findMany({
      where: { leadId },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return researches.map((research) => {
      // Sort items by date (newest first, nulls last)
      const sortedItems = research.items
        .map((item) => ({
          date: item.date,
          summary: item.summary,
          sourceUrl: item.sourceUrl,
          category: item.category.toLowerCase() as
            | "news"
            | "blog"
            | "activity"
            | "website",
        }))
        .sort((a, b) => {
          // Items without dates go to the end
          if (!a.date && !b.date) return 0;
          if (!a.date) return 1;
          if (!b.date) return -1;
          // Sort by date descending (newest first)
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        });

      return {
        leadId: research.leadId,
        company: research.company,
        companyDomain: research.companyDomain,
        searchedAt: research.searchedAt.toISOString(),
        items: sortedItems,
      };
    });
  }
}
