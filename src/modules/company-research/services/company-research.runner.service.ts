import { injectable, inject } from "inversify";
import { COMPANY_RESEARCH_TYPES } from "../company-research.types";
import { CompanyResearchRepository } from "../persistence/company-research.repository";
import { PerplexityClient } from "./perplexity.client";
import { LinkedinPostsApifyClient } from "./linkedin-posts-apify.client";
import type { CompanyResearchJobData } from "@/infra/queue/company-research/company-research.queue";
import type { LoggerLike } from "@/infra/observability";
import type { CompanyResearchItemCategory } from "@prisma/client";

@injectable()
export class CompanyResearchRunnerService {
  constructor(
    @inject(COMPANY_RESEARCH_TYPES.CompanyResearchRepository)
    private readonly repository: CompanyResearchRepository,
    @inject(COMPANY_RESEARCH_TYPES.PerplexityClient)
    private readonly perplexityClient: PerplexityClient,
    @inject(COMPANY_RESEARCH_TYPES.LinkedinPostsApifyClient)
    private readonly linkedinPostsClient: LinkedinPostsApifyClient,
  ) { }

  async processJob(
    jobData: CompanyResearchJobData,
    logger: LoggerLike,
  ): Promise<void> {
    const {
      companyResearchId,
      leadId,
      company,
      companyDomains,
      companyLinkedinUrl,
      includeLinkedinPosts,
      recency,
      maxResults,
    } = jobData;

    const lg = logger.child
      ? logger.child({
        companyResearchId,
        leadId,
        company,
      })
      : logger;

    lg.info({}, "Starting company research job");

    try {
      // 1. Update status to PROCESSING
      await this.repository.updateCompanyResearchStatus(
        companyResearchId,
        "PROCESSING",
      );

      // 2. Map recency option to LinkedIn format
      const linkedinRecencyMap: Record<string, "24h" | "week" | "month"> = {
        day: "24h",
        week: "week",
        month: "month",
        year: "month", // LinkedIn max is month, fall back
      };

      // 3. Prepare parallel fetches
      const fetchPromises: Promise<{ source: string; result: unknown }>[] = [];

      // Always fetch from Perplexity
      lg.info({}, "Calling Perplexity API");
      fetchPromises.push(
        this.perplexityClient
          .searchCompanyInfo({
            companyName: company,
            companyDomain: companyDomains[0] ?? null,
            companyWebsites: companyDomains,
            recency,
            maxResults,
          })
          .then((result) => ({ source: "perplexity", result }))
          .catch((error: unknown) => {
            lg.error({ err: error }, "Perplexity API call failed");
            return { source: "perplexity" as const, result: { items: [] } };
          }),
      );

      // Conditionally fetch LinkedIn posts
      if (includeLinkedinPosts && companyLinkedinUrl) {
        lg.info({}, "Calling LinkedIn Posts API");
        fetchPromises.push(
          this.linkedinPostsClient
            .fetchCompanyPosts(companyLinkedinUrl, {
              maxPosts: maxResults,
              postedLimit: linkedinRecencyMap[recency] ?? "month",
            })
            .then((result) => ({ source: "linkedin", result }))
            .catch((error: unknown) => {
              lg.error({ err: error }, "LinkedIn Posts API call failed");
              return { source: "linkedin" as const, result: { items: [] } };
            }),
        );
      }

      // 4. Execute all fetches in parallel
      const results = await Promise.allSettled(fetchPromises);

      // 5. Process results
      const allItems: Array<{
        date: string | null;
        summary: string;
        sourceUrl: string;
        category: CompanyResearchItemCategory;
        source: "perplexity" | "linkedin";
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
                date: item.date,
                summary: item.summary,
                sourceUrl: item.sourceUrl,
                category: item.category.toUpperCase() as CompanyResearchItemCategory,
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
              }>;
            };

            for (const item of linkedinResult.items) {
              allItems.push({
                date: item.date,
                summary: item.summary,
                sourceUrl: item.sourceUrl,
                category: item.category.toUpperCase() as CompanyResearchItemCategory,
                source: "linkedin",
              });
            }
          }
        } else {
          lg.error({ reason: String(result.reason) }, "Research fetch failed");
        }
      }

      lg.info({ itemsCount: allItems.length }, "Collected research items");

      // 6. Save items to database
      if (allItems.length > 0) {
        await this.repository.addResearchItems(companyResearchId, allItems);
      }

      // 7. Mark as completed
      await this.repository.markResearchCompleted(companyResearchId);

      lg.info({}, "Company research job completed successfully");
    } catch (error) {
      lg.error({ err: error }, "Company research job failed");

      await this.repository.updateCompanyResearchStatus(
        companyResearchId,
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
