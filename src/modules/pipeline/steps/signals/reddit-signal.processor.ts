import { createHash } from "crypto";

import type { PrismaClient } from "@prisma/client";

import type {
  RedditSignalProvider,
  RedditSignalResult,
  RedditSignalPostDto,
  RedditSignalCompanyInfo,
} from "@/capabilities/reddit-signals/reddit-signal-provider.dto";
import type { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { LeadDocumentKind } from "@/generated/aisdr/v1/ai_sdr";
import type { LeadDocument } from "@/generated/aisdr/v1/ai_sdr";
import { RAG_CONSTANTS } from "@/config/constants";
import type { PipelineTools } from "@/modules/pipeline/schemas/pipeline.dto";
import { PIPELINE_CONFIG } from "@/modules/pipeline/pipeline.config";

import type { CompanyGroup, LeadInfo } from "./signals.helpers";
import { createBatches } from "./signals.helpers";
import {
  redditPostToRagText,
  redditSignalSummaryText,
  signalDocId,
  signalItemKey,
} from "./signal-rag-text";

/* ------------------------------------------------------------------ */
/*  Constants (sourced from PIPELINE_CONFIG)                           */
/* ------------------------------------------------------------------ */

const REDDIT_COMPANY_BATCH_SIZE = PIPELINE_CONFIG.signals.redditBatchSize;

export type RedditLeadDetail = {
  totalMentions: number;
  subredditsFound: Set<string>;
  posts: RedditSignalPostDto[];
};

export type RedditPhaseResult = {
  cancelled: boolean;
  companiesWithSignals: number;
  totalMentions: number;
  detailsByLead: Map<string, RedditLeadDetail>;
};

/* ------------------------------------------------------------------ */
/*  Processor                                                           */
/* ------------------------------------------------------------------ */

export class RedditSignalProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providers: RedditSignalProvider[],
    private readonly aiGrpcClient: AiGrpcClient | null = null,
  ) {}

  async process(
    companyGroups: Map<string, CompanyGroup>,
    activeSubreddits: string[],
    pipelineRunId: string,
    tools: PipelineTools,
    userId?: string,
  ): Promise<RedditPhaseResult> {
    let companiesWithSignals = 0;
    let totalMentions = 0;
    let cancelled = false;
    const detailsByLead = new Map<string, RedditLeadDetail>();
    const companies = Array.from(companyGroups.values());
    const uniqueCompanies = companies.length;
    const batches = createBatches(companies, REDDIT_COMPANY_BATCH_SIZE);

    for (const batch of batches) {
      if (cancelled || (await tools.checkCancelled())) {
        cancelled = true;
        tools.log.info(
          { pipelineRunId },
          "Signals step: cancelled during Reddit batch",
        );
        break;
      }

      for (const provider of this.providers) {
        try {
          const redditResults = await this.fetchBatch(
            batch,
            provider,
            activeSubreddits,
            tools,
          );

          // Process results for each company in batch
          for (const group of batch) {
            const key = group.companyName.trim().toLowerCase();
            const result = redditResults.get(key);

            if (result) {
              const hasAnyMentions = result.totalMentions > 0 || result.totalActivities > 0;
              if (hasAnyMentions) companiesWithSignals++;

              totalMentions += result.totalMentions;

              const allSubreddits = new Set(result.subredditsFound);
              const allPosts = result.posts;

              for (const leadId of group.leadIds) {
                const existing = detailsByLead.get(leadId);
                if (existing) {
                  existing.totalMentions += result.totalMentions;
                  allSubreddits.forEach((s) => existing.subredditsFound.add(s));
                  existing.posts.push(...allPosts);
                } else {
                  detailsByLead.set(leadId, {
                    totalMentions: result.totalMentions,
                    subredditsFound: new Set(allSubreddits),
                    posts: [...allPosts],
                  });
                }
              }

              // Persist Reddit results for this company
              await this.persistSignals([result], group.leadIds, pipelineRunId);

              // RAG indexing — fire-and-forget per lead, non-fatal
              for (const leadId of group.leadIds) {
                const detail = detailsByLead.get(leadId);
                if (!detail) continue;
                try {
                  await this.indexInAi(leadId, group.companyName, detail, userId ?? "");
                } catch (err) {
                  tools.log.warn(
                    { leadId, company: group.companyName, err: (err as Error).message },
                    "Signals step: Reddit RAG indexing failed (non-fatal)",
                  );
                }
              }
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          tools.log.warn(
            { err: msg, batchSize: batch.length },
            "Signals step: Reddit batch error, skipping batch",
          );
        }
      }

      tools.emitProgress(
        `Checking Reddit signals — processed ${Math.min(
          companies.indexOf(batch[batch.length - 1]) + 1,
          uniqueCompanies,
        )} of ${uniqueCompanies} companies`,
        { checked: Math.min(companies.indexOf(batch[batch.length - 1]) + 1, uniqueCompanies), total: uniqueCompanies },
      );
    }

    return { cancelled, companiesWithSignals, totalMentions, detailsByLead };
  }

  /* ---------------------------------------------------------------- */
  /*  WS detail builder                                                */
  /* ---------------------------------------------------------------- */

  static buildWsDetails(
    detailsByLead: Map<string, RedditLeadDetail>,
    leadById: Map<string, LeadInfo>,
  ) {
    const details = Array.from(detailsByLead.entries()).map(([leadId, sig]) => {
      const lead = leadById.get(leadId);
      return {
        leadId,
        fullName: lead?.fullName ?? null,
        company: lead?.company ?? null,
        totalMentions: sig.totalMentions,
        subredditsFound: Array.from(sig.subredditsFound),
        posts: sig.posts.map((p) => ({
          subreddit: p.subreddit,
          postType: p.postType,
          signalType: p.signalType,
          title: p.title ?? null,
          content: p.content ?? null,
          author: p.author ?? null,
          url: p.url ?? null,
          score: p.score ?? null,
          numComments: p.numComments ?? null,
          createdUtc: p.createdUtc ?? null,
        })),
      };
    });

    details.sort((a, b) => b.totalMentions - a.totalMentions);
    return details;
  }

  /* ---------------------------------------------------------------- */
  /*  Internal                                                          */
  /* ---------------------------------------------------------------- */

  private async indexInAi(
    leadId: string,
    companyName: string,
    detail: RedditLeadDetail,
    workspaceId: string,
  ): Promise<void> {
    if (!this.aiGrpcClient) return;

    const nowMs = String(Date.now());

    const makeDoc = (documentId: string, text: string): LeadDocument => ({
      documentId,
      leadId,
      kind: LeadDocumentKind.LEAD_DOCUMENT_KIND_REDDIT_SIGNAL,
      text,
      metadata: { leadId, signalType: "reddit", companyName },
      updatedAtMs: nowMs,
      contentHash: createHash("sha256").update(text).digest("hex"),
    });

    // 1. Summary document (aggregate stats, no individual posts)
    const documents: LeadDocument[] = [
      makeDoc(
        signalDocId("reddit", leadId),
        redditSignalSummaryText(companyName, detail),
      ),
    ];

    // 2. One document per Reddit post/comment
    for (const post of detail.posts) {
      const key = signalItemKey([
        post.url,
        // fallback: derive key from content when url is absent
        post.url == null
          ? `${post.subreddit}|${post.title ?? ""}|${post.createdUtc ?? ""}`
          : null,
      ]);
      documents.push(makeDoc(signalDocId("reddit", leadId, key), redditPostToRagText(companyName, post)));
    }

    // 3. Send in batches of RAG_CONSTANTS.SIGNAL_BATCH_SIZE
    for (let i = 0; i < documents.length; i += RAG_CONSTANTS.SIGNAL_BATCH_SIZE) {
      const batch = documents.slice(i, i + RAG_CONSTANTS.SIGNAL_BATCH_SIZE);
      await this.aiGrpcClient.upsertLeadDocuments({
        requestId: "",
        workspaceId,
        allowPartial: true,
        documents: batch,
      });
    }
  }

  private async fetchSingle(
    group: CompanyGroup,
    providers: RedditSignalProvider[],
    subreddits: string[],
    tools: PipelineTools,
  ): Promise<RedditSignalResult[]> {
    if (!group.companyName) return [];

    const results: RedditSignalResult[] = [];

    for (const provider of providers) {
      try {
        const result = await provider.detectRedditSignals({
          companyName: group.companyName,
          companyDomain: group.companyDomain,
          leadId: group.leadIds[0] ?? "",
          subreddits,
        });

        if (result === null) {
          tools.log.info(
            { company: group.companyName },
            "Signals step: Reddit provider limit reached, skipping",
          );
          continue;
        }

        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        tools.log.warn(
          { company: group.companyName, err: msg },
          "Signals step: Reddit provider error, skipping",
        );
      }
    }

    return results;
  }

  private async fetchBatch(
    groups: CompanyGroup[],
    provider: RedditSignalProvider,
    subreddits: string[],
    tools: PipelineTools,
  ): Promise<Map<string, RedditSignalResult>> {
    // If provider supports batch API, use it
    if (provider.detectRedditSignalsBatch) {
      const companies: RedditSignalCompanyInfo[] = groups.map((g) => ({
        companyName: g.companyName,
        companyDomain: g.companyDomain,
        leadIds: g.leadIds,
      }));

      try {
        const results = await provider.detectRedditSignalsBatch({
          companies,
          subreddits,
          maxPostsPerSubreddit: PIPELINE_CONFIG.signals.redditMaxPostsPerSubreddit,
          maxPostsPerCompany: PIPELINE_CONFIG.signals.redditMaxPostsPerCompany,
        });

        if (!results || results.size === 0) {
          tools.log.info(
            { companyCount: groups.length },
            "Signals step: Reddit batch provider returned no results",
          );
        }

        return results;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        tools.log.warn(
          { companyCount: groups.length, err: msg },
          "Signals step: Reddit batch provider error",
        );
        return new Map();
      }
    }

    // Fallback: per-company calls
    tools.log.info(
      { companyCount: groups.length },
      "Signals step: Reddit provider doesn't support batch, falling back to per-company",
    );

    const resultsMap = new Map<string, RedditSignalResult>();

    for (const group of groups) {
      const results = await this.fetchSingle(group, [provider], subreddits, tools);
      if (results.length > 0) {
        const key = group.companyName.trim().toLowerCase();
        resultsMap.set(key, results[0]);
      }
    }

    return resultsMap;
  }

  private async persistSignals(
    results: RedditSignalResult[],
    leadIds: string[],
    pipelineRunId: string,
  ): Promise<void> {
    if (results.length === 0 || leadIds.length === 0) return;

    const existing = await this.prisma.redditSignal.findMany({
      where: {
        pipelineRunId,
        leadId: { in: leadIds },
        providerKey: { in: results.map((r) => r.providerKey) },
      },
      select: { leadId: true, providerKey: true },
    });

    const existingKeys = new Set(
      existing.map((e: { leadId: string; providerKey: string }) => `${e.leadId}:${e.providerKey}`),
    );

    const creates = results.flatMap((result) =>
      leadIds
        .filter(
          (leadId) => !existingKeys.has(`${leadId}:${result.providerKey}`),
        )
        .map((leadId) =>
          this.prisma.redditSignal.create({
            data: {
              lead: { connect: { id: leadId } },
              pipelineRunId,
              providerKey: result.providerKey,
              companyName: result.companyName,
              totalMentions: result.totalMentions,
              totalActivities: result.totalActivities,
              subredditsFound: result.subredditsFound,
              posts: {
                create: result.posts.map((post) => ({
                  subreddit: post.subreddit,
                  postType: post.postType,
                  signalType: post.signalType,
                  title: post.title,
                  content: post.content,
                  author: post.author,
                  url: post.url,
                  score: post.score,
                  numComments: post.numComments,
                  createdUtc: post.createdUtc,
                })),
              },
            },
          }),
        ),
    );

    if (creates.length > 0) {
      await this.prisma.$transaction(creates);
    }
  }
}
