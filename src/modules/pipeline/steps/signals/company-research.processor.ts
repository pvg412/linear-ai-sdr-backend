import { randomUUID } from "crypto";
import type { PrismaClient, CompanyResearchItemCategory } from "@prisma/client";

import type { PerplexityClient } from "@/modules/company-research/services/perplexity.client";
import type { LinkedinPostsApifyClient } from "@/modules/company-research/services/linkedin-posts-apify.client";
import type { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { mapCategoryToProto } from "@/modules/company-research/utils/category-mapping";
import type { PipelineTools } from "@/modules/pipeline/schemas/pipeline.dto";
import { PIPELINE_CONFIG } from "@/modules/pipeline/pipeline.config";

import type { CompanyGroup, LeadInfo } from "./signals.helpers";
import { runWithConcurrency } from "./signals.helpers";

/* ------------------------------------------------------------------ */
/*  Constants (sourced from PIPELINE_CONFIG)                           */
/* ------------------------------------------------------------------ */

const COMPANY_CONCURRENCY = PIPELINE_CONFIG.signals.companyConcurrency;

export type CompanyResearchLeadDetail = {
  companyResearchId: string;
  company: string;
  perplexityItems: Array<{
    date: string | null;
    summary: string;
    sourceUrl: string;
    category: string;
  }>;
  linkedinPostItems: Array<{
    date: string | null;
    summary: string;
    sourceUrl: string;
  }>;
};

export type CompanyResearchPhaseResult = {
  companiesChecked: number;
  companiesWithPerplexity: number;
  companiesWithLinkedinPosts: number;
  totalLinkedinPosts: number;
  detailsByLead: Map<string, CompanyResearchLeadDetail>;
};

export type CompanyResearchProcessorConfig = {
  includeLinkedinPosts: boolean;
  recency: "day" | "week" | "month" | "year";
  maxResults: number;
};

/* ------------------------------------------------------------------ */
/*  Processor                                                           */
/* ------------------------------------------------------------------ */

export class CompanyResearchProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly perplexityClient: PerplexityClient,
    private readonly linkedinPostsClient: LinkedinPostsApifyClient,
    private readonly aiGrpcClient: AiGrpcClient,
  ) {}

  async process(
    companyGroups: Map<string, CompanyGroup>,
    leads: Map<string, LeadInfo & { companyLinkedinUrl?: string | null }>,
    userId: string,
    _pipelineRunId: string,
    tools: PipelineTools,
    config: CompanyResearchProcessorConfig,
  ): Promise<CompanyResearchPhaseResult> {
    let companiesChecked = 0;
    let companiesWithPerplexity = 0;
    let companiesWithLinkedinPosts = 0;
    let totalLinkedinPosts = 0;
    const detailsByLead = new Map<string, CompanyResearchLeadDetail>();
    const uniqueCompanies = companyGroups.size;

    const linkedinRecencyMap: Record<string, "24h" | "week" | "month"> = {
      day: "24h",
      week: "week",
      month: "month",
      year: "month",
    };

    const processCompany = async (group: CompanyGroup): Promise<void> => {
      if (!group.companyName) return;

      // Resolve the LinkedIn URL from any lead in the group that has one
      let companyLinkedinUrl: string | null = null;
      for (const leadId of group.leadIds) {
        const lead = leads.get(leadId);
        if (lead?.companyLinkedinUrl) {
          companyLinkedinUrl = lead.companyLinkedinUrl;
          break;
        }
      }

      // ── 1. Create CompanyResearch record ─────────────────────────────
      // Use the first lead in the group as the record owner
      const primaryLeadId = group.leadIds[0];
      if (!primaryLeadId) return;

      const research = await this.prisma.companyResearch.create({
        data: {
          leadId: primaryLeadId,
          requestedById: userId,
          company: group.companyName,
          companyDomain: group.companyDomain ?? null,
          recency: config.recency,
          maxResults: config.maxResults,
          status: "PROCESSING",
          relatedQuestions: [],
        },
      });

      const allItems: Array<{
        date: string | null;
        summary: string;
        sourceUrl: string;
        category: CompanyResearchItemCategory;
        source: "perplexity" | "linkedin";
      }> = [];

      // ── 2. Parallel: Perplexity + LinkedIn ───────────────────────────
      const fetchPromises: Promise<void>[] = [];

      fetchPromises.push(
        this.perplexityClient
          .searchCompanyInfo({
            companyName: group.companyName,
            companyDomain: group.companyDomain ?? null,
            companyWebsites: group.companyDomain ? [group.companyDomain] : [],
            recency: config.recency,
            maxResults: config.maxResults,
          })
          .then((result) => {
            for (const item of result.items) {
              allItems.push({
                date: item.date,
                summary: item.summary,
                sourceUrl: item.sourceUrl,
                category: item.category.toUpperCase() as CompanyResearchItemCategory,
                source: "perplexity",
              });
            }
          })
          .catch((err: unknown) => {
            tools.log.warn(
              { company: group.companyName, err: (err as Error).message },
              "Company research: Perplexity failed (non-fatal)",
            );
          }),
      );

      if (config.includeLinkedinPosts && companyLinkedinUrl) {
        fetchPromises.push(
          this.linkedinPostsClient
            .fetchCompanyPosts(companyLinkedinUrl, {
              maxPosts: config.maxResults,
              postedLimit: linkedinRecencyMap[config.recency] ?? "month",
              maxContentChars: PIPELINE_CONFIG.signals.linkedinPostContentMaxChars,
            })
            .then((result) => {
              for (const item of result.items) {
                allItems.push({
                  date: item.date,
                  summary: item.summary,
                  sourceUrl: item.sourceUrl,
                  category: "LINKEDIN_POST",
                  source: "linkedin",
                });
              }

              // LinkedIn posts billing is covered by the pipeline flat fee
              // (BILLING.PIPELINE_RUN_CENTS). Per-post billing only applies
              // to standalone company research triggered outside the pipeline.
            })
            .catch((err: unknown) => {
              tools.log.warn(
                { company: group.companyName, err: (err as Error).message },
                "Company research: LinkedIn posts fetch failed (non-fatal)",
              );
            }),
        );
      }

      await Promise.allSettled(fetchPromises);

      // ── 3. Persist items ─────────────────────────────────────────────
      if (allItems.length > 0) {
        await this.prisma.companyResearchItem.createMany({
          data: allItems.map((item) => ({
            researchId: research.id,
            date: item.date,
            summary: item.summary,
            sourceUrl: item.sourceUrl,
            category: item.category,
            source: item.source,
          })),
        });
      }

      // ── 4. Mark completed ────────────────────────────────────────────
      await this.prisma.companyResearch.update({
        where: { id: research.id },
        data: { status: "COMPLETED", searchedAt: new Date() },
      });

      // ── 5. RAG indexing ──────────────────────────────────────────────
      try {
        await this.indexInAi(research.id, primaryLeadId, group.companyName, group.companyDomain ?? null, userId, allItems);
      } catch (err) {
        tools.log.warn(
          { company: group.companyName, err: (err as Error).message },
          "Company research: AI indexing failed (non-fatal)",
        );
      }

      // ── 6. Aggregate stats & WS details ─────────────────────────────
      const perplexityItems = allItems.filter((i) => i.source === "perplexity");
      const linkedinPostItems = allItems.filter((i) => i.source === "linkedin");

      if (perplexityItems.length > 0) companiesWithPerplexity++;
      if (linkedinPostItems.length > 0) {
        companiesWithLinkedinPosts++;
        totalLinkedinPosts += linkedinPostItems.length;
      }

      const detail: CompanyResearchLeadDetail = {
        companyResearchId: research.id,
        company: group.companyName,
        perplexityItems: perplexityItems.map((i) => ({
          date: i.date,
          summary: i.summary,
          sourceUrl: i.sourceUrl,
          category: i.category.toLowerCase(),
        })),
        linkedinPostItems: linkedinPostItems.map((i) => ({
          date: i.date,
          summary: i.summary,
          sourceUrl: i.sourceUrl,
        })),
      };

      // Map the detail to ALL leads in this company group
      for (const leadId of group.leadIds) {
        detailsByLead.set(leadId, detail);
      }

      companiesChecked++;
      tools.emitProgress(
        `Researching companies — ${companiesChecked} of ${uniqueCompanies}`,
        { checked: companiesChecked, total: uniqueCompanies },
      );
    };

    await runWithConcurrency(
      Array.from(companyGroups.values()),
      COMPANY_CONCURRENCY,
      processCompany,
    );

    return {
      companiesChecked,
      companiesWithPerplexity,
      companiesWithLinkedinPosts,
      totalLinkedinPosts,
      detailsByLead,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  WS detail builder                                                */
  /* ---------------------------------------------------------------- */

  static buildWsDetails(
    detailsByLead: Map<string, CompanyResearchLeadDetail>,
    leadById: Map<string, LeadInfo>,
  ) {
    const details = Array.from(detailsByLead.entries()).map(([leadId, d]) => {
      const lead = leadById.get(leadId);
      return {
        leadId,
        fullName: lead?.fullName ?? null,
        company: d.company,
        perplexityItems: d.perplexityItems,
        linkedinPosts: d.linkedinPostItems,
      };
    });

    // Sort: most content first
    details.sort(
      (a, b) =>
        b.perplexityItems.length +
        b.linkedinPosts.length -
        (a.perplexityItems.length + a.linkedinPosts.length),
    );

    return details;
  }

  /* ---------------------------------------------------------------- */
  /*  Internal                                                          */
  /* ---------------------------------------------------------------- */

  private async indexInAi(
    researchId: string,
    leadId: string,
    company: string,
    companyDomain: string | null,
    userId: string,
    items: Array<{
      date: string | null;
      summary: string;
      sourceUrl: string;
      category: CompanyResearchItemCategory;
      source: "perplexity" | "linkedin";
    }>,
  ): Promise<void> {
    // Fetch the lead for name/title context
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { fullName: true, firstName: true, lastName: true, title: true, headline: true },
    });

    await this.aiGrpcClient.upsertCompanyResearch({
      requestId: randomUUID(),
      workspaceId: userId,
      researchId,
      leadId,
      leadName: lead?.fullName ?? `${lead?.firstName ?? ""} ${lead?.lastName ?? ""}`.trim(),
      leadTitle: lead?.title ?? lead?.headline ?? "",
      company,
      companyDomain: companyDomain ?? "",
      recency: "",
      searchedAtMs: String(Date.now()),
      items: items.map((item, idx) => ({
        index: idx,
        date: item.date ?? "",
        summary: item.summary,
        sourceUrl: item.sourceUrl,
        category: mapCategoryToProto(item.category),
        sourceName: item.source,
      })),
      invalidatePrevious: true,
    });
  }
}
