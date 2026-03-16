import { inject, injectable } from "inversify";
import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { PIPELINE_TYPES } from "@/modules/pipeline/pipeline.types";
import type { PipelineRepository } from "@/modules/pipeline/persistence/pipeline.repository";
import {
  getPipelineDefinition,
  listPipelineDefinitions,
} from "@/modules/pipeline/engine/pipeline.definitions";
import type { PipelineDefinition } from "@/modules/pipeline/schemas/pipeline.dto";

/* ------------------------------------------------------------------ */

@injectable()
export class PipelineQueryService {
  private readonly prisma: PrismaClient = getPrisma();

  constructor(
    @inject(PIPELINE_TYPES.PipelineRepository)
    private readonly repo: PipelineRepository,
  ) {}

  /* ---------------------------------------------------------------- */
  /*  Get single run (with ownership check)                           */
  /* ---------------------------------------------------------------- */

  async getRun(userId: string, pipelineRunId: string) {
    const run = await this.repo.getRunForUser(userId, pipelineRunId);

    /* Build definition from code (was stored as JSON blob before) */
    const codeDef = getPipelineDefinition(run.pipelineKey);
    const definition = codeDef
      ? {
          key: codeDef.key,
          version: codeDef.version,
          displayName: codeDef.displayName,
          steps: codeDef.steps.map((s) => ({
            type: s.type,
            id: s.id,
            displayName: s.displayName,
          })),
        }
      : {
          key: run.pipelineKey,
          version: run.pipelineVersion,
          displayName: run.pipelineDisplayName,
          steps: run.stepRuns.map((sr) => ({
            type: sr.stepType,
            id: sr.stepId,
            displayName: sr.displayName,
          })),
        };

    /* Fetch leads from PipelineRunLead + latest LeadScore */
    const runLeads = await this.prisma.pipelineRunLead.findMany({
      where: { pipelineRunId },
      include: {
        lead: {
          select: {
            id: true,
            fullName: true,
            email: true,
            company: true,
            linkedinUrl: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    /* Fetch final scores for these leads from this run */
    const leadIds = runLeads.map((rl) => rl.leadId);
    const scores = leadIds.length > 0
      ? await this.prisma.leadScore.findMany({
          where: {
            pipelineRunId,
            leadId: { in: leadIds },
            stepInstanceId: "scoring-final",
          },
        })
      : [];
    const scoreMap = new Map(scores.map((s) => [s.leadId, s]));

    /* Also fetch initial scoring stats for the run */
    const initialScores = leadIds.length > 0
      ? await this.prisma.leadScore.findMany({
          where: {
            pipelineRunId,
            leadId: { in: leadIds },
            stepInstanceId: "scoring-initial",
          },
        })
      : [];

    const runLeadMap = new Map(runLeads.map((rl) => [rl.leadId, rl]));

    const leads = runLeads.map((rl) => {
      const score = scoreMap.get(rl.leadId);
      return {
        id: rl.lead.id,
        fullName: rl.lead.fullName,
        email: rl.lead.email,
        company: rl.lead.company,
        linkedinUrl: rl.lead.linkedinUrl,
        excluded: rl.excluded,
        finalScore: score?.finalScore ?? null,
        icpFit: score?.icpFit ?? null,
        signalStrength: score?.signalStrength ?? null,
        icpReasoning: score?.reasoning ?? null,
      };
    });

    /* Build initial scoring summary */
    const scoringInitial = initialScores.length > 0
      ? {
          scored: initialScores.length,
          passed: runLeads.filter((rl) => !rl.excluded).length,
          rejected: runLeads.filter((rl) => rl.excluded).length,
          averageScore: Math.round(
            initialScores.reduce((sum, s) => sum + s.score, 0) / initialScores.length,
          ),
          details: initialScores.map((s) => {
            const rl = runLeadMap.get(s.leadId);
            return {
              leadId: s.leadId,
              fullName: rl?.lead.fullName ?? null,
              company: rl?.lead.company ?? null,
              score: s.score,
              passed: !(rl?.excluded && rl.excludedByStepId === "scoring-initial"),
              reasoning: s.reasoning ?? "",
            };
          }),
        }
      : null;

    /* Build final scoring summary */
    const scoringFinal = scores.length > 0
      ? {
          scored: scores.length,
          averageFinalScore: Math.round(
            scores.reduce((sum, s) => sum + (s.finalScore ?? 0), 0) / scores.length,
          ),
          details: scores.map((s) => {
            const rl = runLeadMap.get(s.leadId);
            return {
              leadId: s.leadId,
              fullName: rl?.lead.fullName ?? null,
              company: rl?.lead.company ?? null,
              icpFit: s.icpFit ?? 0,
              finalScore: s.finalScore ?? 0,
              icpReasoning: s.reasoning ?? "",
              signalStrength: s.signalStrength ?? 0,
            };
          }),
        }
      : null;

    const enrichment = {
      totalLeads: leadIds.length,
    };

    /* Fetch hiring signal results for this run (with normalised job listings) */
    const hiringSignalRows = leadIds.length > 0
      ? await this.prisma.hiringSignal.findMany({
          where: { pipelineRunId, leadId: { in: leadIds } },
          include: { jobs: { include: { locations: true } } },
          orderBy: { createdAt: "asc" },
        })
      : [];

    // Group by leadId — one row per (lead, provider); since the first provider
    // covers most cases, merge all providers into a single per-lead record.
    const signalsByLead = new Map<string, typeof hiringSignalRows>();
    for (const row of hiringSignalRows) {
      const existing = signalsByLead.get(row.leadId);
      if (existing) {
        existing.push(row);
      } else {
        signalsByLead.set(row.leadId, [row]);
      }
    }

    const signalDetails = Array.from(signalsByLead.entries()).map(
      ([leadId, rows]) => {
        const rl = runLeadMap.get(leadId);
        // Sum job counts across providers (normally just one provider)
        const totalJobs = rows.reduce(
          (sum: number, r) => sum + r.openJobCount,
          0,
        );
        const departments = Array.from(
          new Set(rows.flatMap((r) => r.departments)),
        );
        const topJobTitles = Array.from(
          new Set(rows.flatMap((r) => r.topJobTitles)),
        ).slice(0, 10);

        // Flatten job listings from all providers for this lead
        const jobs = rows.flatMap((r) =>
          r.jobs.map((j) => ({
            id: j.id,
            externalId: j.externalId,
            jobTitle: j.jobTitle,
            team: j.team,
            jobType: j.jobType,
            locationType: j.locationType,
            datePosted: j.datePosted,
            companyName: j.companyName,
            companySlug: j.companySlug,
            requirementsSummary: j.requirementsSummary,
            skills: j.skills,
            technologies: j.technologies,
            jobCategories: j.jobCategories,
            locations: j.locations.map((l) => ({
              city: l.city,
              region: l.region,
              country: l.country,
            })),
          })),
        );

        return {
          leadId,
          fullName: rl?.lead.fullName ?? null,
          company: rows[0]?.companyName ?? rl?.lead.company ?? null,
          openJobCount: totalJobs,
          departments,
          topJobTitles,
          jobs,
        };
      },
    );

    // Sort: leads with signals (openJobCount > 0) first, then by count desc
    signalDetails.sort((a, b) => b.openJobCount - a.openJobCount);

    const signals = {
      leadsWithSignals: signalsByLead.size,
      totalOpenRoles: signalDetails.reduce((sum, s) => sum + s.openJobCount, 0),
      details: signalDetails,
    };

    /* ── Reddit signals ─────────────────────────────────────────────── */
    const redditSignalRows = leadIds.length > 0
      ? await this.prisma.redditSignal.findMany({
          where: { pipelineRunId, leadId: { in: leadIds } },
          include: { posts: true },
          orderBy: { createdAt: "asc" },
        })
      : [];

    const redditByLead = new Map<string, typeof redditSignalRows>();
    for (const row of redditSignalRows) {
      const existing = redditByLead.get(row.leadId);
      if (existing) {
        existing.push(row);
      } else {
        redditByLead.set(row.leadId, [row]);
      }
    }

    const redditDetails = Array.from(redditByLead.entries()).map(
      ([leadId, rows]) => {
        const rl = runLeadMap.get(leadId);
        const totalMentions = rows.reduce(
          (sum: number, r) => sum + r.totalMentions,
          0,
        );
        const subredditsFound = Array.from(
          new Set(rows.flatMap((r) => r.subredditsFound)),
        );
        const posts = rows.flatMap((r) =>
          r.posts.map((p) => ({
            subreddit: p.subreddit,
            postType: p.postType,
            signalType: p.signalType,
            title: p.title,
            content: p.content,
            author: p.author,
            url: p.url,
            score: p.score,
            numComments: p.numComments,
            createdUtc: p.createdUtc,
          })),
        );
        return {
          leadId,
          fullName: rl?.lead.fullName ?? null,
          company: rows[0]?.companyName ?? rl?.lead.company ?? null,
          totalMentions,
          subredditsFound,
          posts,
        };
      },
    );

    redditDetails.sort((a, b) => b.totalMentions - a.totalMentions);

    const redditSignals = {
      leadsWithSignals: redditByLead.size,
      totalMentions: redditDetails.reduce((sum, s) => sum + s.totalMentions, 0),
      details: redditDetails,
    };

    /* ── Crunchbase signals ──────────────────────────────────────────── */
    const crunchbaseRows = leadIds.length > 0
      ? await this.prisma.crunchbaseSignal.findMany({
          where: { pipelineRunId, leadId: { in: leadIds } },
          orderBy: { createdAt: "asc" },
        })
      : [];

    const crunchbaseByLead = new Map<string, (typeof crunchbaseRows)[number]>();
    for (const row of crunchbaseRows) {
      // One row per lead (first wins if somehow duplicated)
      if (!crunchbaseByLead.has(row.leadId)) {
        crunchbaseByLead.set(row.leadId, row);
      }
    }

    const crunchbaseDetails = Array.from(crunchbaseByLead.entries()).map(
      ([leadId, row]) => {
        const rl = runLeadMap.get(leadId);
        return {
          leadId,
          fullName: rl?.lead.fullName ?? null,
          company: rl?.lead.company ?? null,
          crunchbaseFound: row.crunchbaseFound,
          crunchbasePermalink: row.crunchbasePermalink,
          fundingTotalUsd: row.fundingTotalUsd,
          lastFundingAt: row.lastFundingAt,
          lastFundingType: row.lastFundingType,
          numFundingRounds: row.numFundingRounds,
          growthScore: row.growthScore,
          heatScore: row.heatScore,
          fundingPrediction: row.fundingPrediction,
          fundingPrediction0to5: row.fundingPrediction0to5,
          fundingPrediction6to11: row.fundingPrediction6to11,
          fundingPrediction12to24: row.fundingPrediction12to24,
          fundingPrediction24plus: row.fundingPrediction24plus,
          employeeCountEnum: row.employeeCountEnum,
          semrushVisits: row.semrushVisits,
          shortDescription: row.shortDescription,
          foundedOn: row.foundedOn,
          operatingStatus: row.operatingStatus,
          categories: row.categories,
          numInvestors: row.numInvestors,
          topCompetitors: row.topCompetitors,
          hadLayoffs: row.hadLayoffs,
          techStack: row.techStack,
          ipoPrediction: row.ipoPrediction,
          acquisitionPrediction: row.acquisitionPrediction,
        };
      },
    );

    // Sort: found companies first, then by funding desc
    crunchbaseDetails.sort((a, b) => {
      if (a.crunchbaseFound !== b.crunchbaseFound) return a.crunchbaseFound ? -1 : 1;
      return (b.fundingTotalUsd ?? 0) - (a.fundingTotalUsd ?? 0);
    });

    const foundCount = crunchbaseDetails.filter((d) => d.crunchbaseFound).length;

    const crunchbaseSignals = {
      leadsWithData: foundCount,
      companiesFound: foundCount,
      companiesNotFound: crunchbaseDetails.length - foundCount,
      details: crunchbaseDetails,
    };

    /* ── Company research (Perplexity + LinkedIn posts) ─────────────── */
    const companyResearches = leadIds.length > 0
      ? await this.prisma.companyResearch.findMany({
          where: { leadId: { in: leadIds } },
          include: { items: true },
          orderBy: { createdAt: "desc" },
        })
      : [];

    // Group by lead — take the most recent completed research per lead
    const researchByLead = new Map<string, (typeof companyResearches)[number]>();
    for (const cr of companyResearches) {
      if (!researchByLead.has(cr.leadId)) {
        researchByLead.set(cr.leadId, cr);
      }
    }

    const companyResearchDetails = Array.from(researchByLead.entries())
      .map(([leadId, cr]) => {
        const rl = runLeadMap.get(leadId);
        const perplexityItems = cr.items
          .filter((i) => i.source === "perplexity")
          .map((i) => ({
            date: i.date,
            summary: i.summary,
            sourceUrl: i.sourceUrl,
            category: i.category,
          }));
        const linkedinPosts = cr.items
          .filter((i) => i.source === "linkedin")
          .map((i) => ({
            date: i.date,
            summary: i.summary,
            sourceUrl: i.sourceUrl,
          }));
        return {
          leadId,
          fullName: rl?.lead.fullName ?? null,
          company: cr.company,
          companyDomain: cr.companyDomain,
          status: cr.status,
          perplexityItems,
          linkedinPosts,
        };
      })
      .sort(
        (a, b) =>
          b.perplexityItems.length +
          b.linkedinPosts.length -
          (a.perplexityItems.length + a.linkedinPosts.length),
      );

    const totalLinkedinPosts = companyResearchDetails.reduce(
      (sum, d) => sum + d.linkedinPosts.length,
      0,
    );

    const companyResearch = {
      leadsWithResearch: researchByLead.size,
      companiesResearched: researchByLead.size,
      companiesWithLinkedinPosts: companyResearchDetails.filter((d) => d.linkedinPosts.length > 0).length,
      totalLinkedinPosts,
      details: companyResearchDetails,
    };

    /* Fetch live outreach state from junction table */
    const links = await this.repo.findOutreachDrafts(pipelineRunId);

    const byLead = new Map<
      string,
      Array<typeof links[number]["message"]>
    >();
    for (const link of links) {
      const { leadId } = link.message;
      if (!byLead.has(leadId)) byLead.set(leadId, []);
      byLead.get(leadId)!.push(link.message);
    }

    const outreach = Array.from(byLead.entries())
      .map(([leadId, messages]) => {
        const rl = runLeadMap.get(leadId);
        const score = scoreMap.get(leadId);
        return {
          leadId,
          linkedinUrl: rl?.lead.linkedinUrl ?? null,
          icpFit: score?.icpFit ?? null,
          finalScore: score?.finalScore ?? null,
          signalStrength: score?.signalStrength ?? null,
          messages: messages.map((m) => ({
            id: m.id,
            body: m.body,
            subject: m.subject,
            channel: m.channel,
            stage: m.stage,
            tacticUsed: m.tacticUsed,
            characterCount: m.characterCount,
            wordCount: m.wordCount,
            usageNote: m.usageNote,
            sentAt: m.sentAt,
            createdAt: m.createdAt,
          })),
        };
      })
      .sort((a, b) => (b.finalScore ?? -1) - (a.finalScore ?? -1));

    return {
      id: run.id,
      status: run.status,
      pipelineKey: run.pipelineKey,
      pipelineVersion: run.pipelineVersion,
      pipelineDisplayName: run.pipelineDisplayName,
      definition,
      leads,
      scoringInitial,
      scoringFinal,
      enrichment,
      signals,
      redditSignals,
      crunchbaseSignals,
      companyResearch,
      outreach,
      stepRuns: run.stepRuns,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      errorMessage: run.errorMessage,
      errorStepId: run.errorStepId,
      createdAt: run.createdAt,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  List runs for current user                                      */
  /* ---------------------------------------------------------------- */

  async listRuns(
    userId: string,
    opts?: { limit?: number; offset?: number; status?: string },
  ) {
    const result = await this.repo.listRunsForUser(userId, {
      limit: opts?.limit,
      offset: opts?.offset,
      status: opts?.status as
        | "PENDING"
        | "RUNNING"
        | "SUCCEEDED"
        | "FAILED"
        | "CANCELLED"
        | undefined,
    });

    return result;
  }

  /* ---------------------------------------------------------------- */
  /*  List available pipeline definitions                             */
  /* ---------------------------------------------------------------- */

  listDefinitions(): PipelineDefinition[] {
    return listPipelineDefinitions();
  }
}
