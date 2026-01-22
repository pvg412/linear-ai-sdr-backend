import { inject, injectable } from "inversify";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";
import { COMPANY_RESEARCH_TYPES } from "../company-research.types";
import { PerplexityClient } from "./perplexity.client";
import { LinkedinPostsApifyClient } from "./linkedin-posts-apify.client";
import type {
  CompanyResearchQuery,
  CompanyResearchResponse,
  CompanyResearchItem,
} from "../schemas/company-research.schemas";

@injectable()
export class CompanyResearchQueryService {
  constructor(
    @inject(COMPANY_RESEARCH_TYPES.PerplexityClient)
    private readonly perplexityClient: PerplexityClient,
    @inject(COMPANY_RESEARCH_TYPES.LinkedinPostsApifyClient)
    private readonly linkedinPostsClient: LinkedinPostsApifyClient,
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

    // Map recency option to LinkedIn format
    const linkedinRecencyMap: Record<string, "24h" | "week" | "month"> = {
      day: "24h",
      week: "week",
      month: "month",
      year: "month", // LinkedIn max is month, fall back
    };

    // Prepare parallel fetches
    const fetchPromises: Promise<{ source: string; result: unknown }>[] = [];

    // Always fetch from Perplexity
    fetchPromises.push(
      this.perplexityClient
        .searchCompanyInfo({
          companyName: lead.company,
          companyDomain: lead.companyDomain,
          companyWebsites,
          recency: options.recency,
          maxResults: options.maxResults,
        })
        .then((result) => ({ source: "perplexity", result })),
    );

    // Conditionally fetch LinkedIn posts
    const shouldFetchLinkedin =
      options.includeLinkedinPosts && lead.companyLinkedinUrl;

    if (shouldFetchLinkedin) {
      fetchPromises.push(
        this.linkedinPostsClient
          .fetchCompanyPosts(lead.companyLinkedinUrl!, {
            maxPosts: options.maxResults,
            postedLimit: options.recency
              ? linkedinRecencyMap[options.recency]
              : "month",
          })
          .then((result) => ({ source: "linkedin", result }))
          .catch((error) => {
            // Log but don't fail - graceful degradation
            console.error("LinkedIn posts fetch failed:", error);
            return { source: "linkedin", result: { items: [] } };
          }),
      );
    }

    // Execute all fetches in parallel
    const results = await Promise.allSettled(fetchPromises);

    // Process results
    const allItems: Array<{
      date: string | null;
      summary: string;
      sourceUrl: string;
      category: string;
      source: "perplexity" | "linkedin";
      engagement?: { likes: number; comments: number; shares: number };
    }> = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { source, result: data } = result.value;

        if (source === "perplexity") {
          const perplexityResult = data as {
            items: Array<{
              date: string | null;
              summary: string;
              sourceUrl: string;
              category: string;
            }>;
          };

          for (const item of perplexityResult.items) {
            allItems.push({
              ...item,
              source: "perplexity",
            });
          }
        } else if (source === "linkedin") {
          const linkedinResult = data as {
            items: Array<{
              date: string | null;
              summary: string;
              sourceUrl: string;
              category: string;
              engagement?: { likes: number; comments: number; shares: number };
            }>;
          };

          for (const item of linkedinResult.items) {
            allItems.push({
              ...item,
              source: "linkedin",
            });
          }
        }
      } else {
        console.error("Research fetch failed:", result.reason);
      }
    }

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
          create: allItems.map((item) => ({
            date: item.date,
            summary: item.summary,
            sourceUrl: item.sourceUrl,
            category: item.category.toUpperCase() as
              | "NEWS"
              | "BLOG"
              | "ACTIVITY"
              | "WEBSITE"
              | "LINKEDIN_POST",
            source: item.source,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    // Sort items by date (newest first, nulls last)
    const sortedItems = savedResearch.items
      .map((item) => {
        const baseItem: CompanyResearchItem = {
          date: item.date,
          summary: item.summary,
          sourceUrl: item.sourceUrl,
          category: item.category.toLowerCase() as
            | "news"
            | "blog"
            | "activity"
            | "website"
            | "linkedin_post",
        };

        // Find engagement data from original items if LinkedIn
        if (item.source === "linkedin") {
          const originalItem = allItems.find(
            (i) => i.sourceUrl === item.sourceUrl && i.source === "linkedin",
          );
          if (originalItem?.engagement) {
            baseItem.engagement = originalItem.engagement;
          }
        }

        return baseItem;
      })
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

    // Fetch only the latest research for the lead
    const latestResearch = await prisma.companyResearch.findFirst({
      where: { leadId },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!latestResearch) {
      return [];
    }

    // Sort items by date (newest first, nulls last)
    const sortedItems = latestResearch.items
      .map((item) => ({
        date: item.date,
        summary: item.summary,
        sourceUrl: item.sourceUrl,
        category: item.category.toLowerCase() as
          | "news"
          | "blog"
          | "activity"
          | "website"
          | "linkedin_post",
      }))
      .sort((a, b) => {
        // Items without dates go to the end
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        // Sort by date descending (newest first)
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

    return [
      {
        leadId: latestResearch.leadId,
        company: latestResearch.company,
        companyDomain: latestResearch.companyDomain,
        searchedAt: latestResearch.searchedAt.toISOString(),
        items: sortedItems,
      },
    ];
  }
}
