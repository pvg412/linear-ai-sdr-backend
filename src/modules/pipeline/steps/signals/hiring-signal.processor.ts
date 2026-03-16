import { createHash } from "crypto";

import type { PrismaClient } from "@prisma/client";

import type {
  SignalProvider,
  HiringSignalResult,
  SignalJobDto,
} from "@/capabilities/hiring-signals/signal-provider.dto";
import type { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { LeadDocumentKind } from "@/generated/aisdr/v1/ai_sdr";
import type { LeadDocument } from "@/generated/aisdr/v1/ai_sdr";
import { RAG_CONSTANTS } from "@/config/constants";
import type { PipelineTools } from "@/modules/pipeline/schemas/pipeline.dto";
import { PIPELINE_CONFIG } from "@/modules/pipeline/pipeline.config";

import type { CompanyGroup, LeadInfo } from "./signals.helpers";
import { runWithConcurrency } from "./signals.helpers";
import {
  hiringJobToRagText,
  hiringSignalSummaryText,
  signalDocId,
  signalItemKey,
} from "./signal-rag-text";

/* ------------------------------------------------------------------ */
/*  Constants (sourced from PIPELINE_CONFIG)                           */
/* ------------------------------------------------------------------ */

const COMPANY_CONCURRENCY = PIPELINE_CONFIG.signals.hiringConcurrency;

export type HiringLeadDetail = {
  openJobCount: number;
  departments: Set<string>;
  topJobTitles: Set<string>;
  jobs: SignalJobDto[];
};

export type HiringPhaseResult = {
  cancelled: boolean;
  companiesChecked: number;
  companiesWithSignals: number;
  totalOpenRoles: number;
  detailsByLead: Map<string, HiringLeadDetail>;
};

/* ------------------------------------------------------------------ */
/*  Processor                                                           */
/* ------------------------------------------------------------------ */

export class HiringSignalProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providers: SignalProvider[],
    private readonly aiGrpcClient: AiGrpcClient | null = null,
  ) {}

  async process(
    companyGroups: Map<string, CompanyGroup>,
    pipelineRunId: string,
    tools: PipelineTools,
    userId?: string,
  ): Promise<HiringPhaseResult> {
    let companiesChecked = 0;
    let companiesWithSignals = 0;
    let totalOpenRoles = 0;
    let cancelled = false;
    const detailsByLead = new Map<string, HiringLeadDetail>();
    const uniqueCompanies = companyGroups.size;

    const processCompany = async (group: CompanyGroup): Promise<void> => {
      if (cancelled) return;
      if (await tools.checkCancelled()) {
        cancelled = true;
        tools.log.info(
          { pipelineRunId },
          "Signals step: cancelled during hiring",
        );
        return;
      }

      const hiringResults = await this.fetchSignals(group, tools);

      if (hiringResults.length > 0) {
        companiesWithSignals++;
        const companyOpenRoles = hiringResults.reduce((sum, r) => sum + r.openJobCount, 0);
        totalOpenRoles += companyOpenRoles;

        const allDepts = new Set(hiringResults.flatMap((r) => r.departments));
        const allTitles = new Set(hiringResults.flatMap((r) => r.topJobTitles));
        const allJobs = hiringResults.flatMap((r) => r.jobs);

        for (const leadId of group.leadIds) {
          const existing = detailsByLead.get(leadId);
          if (existing) {
            existing.openJobCount += companyOpenRoles;
            allDepts.forEach((d) => existing.departments.add(d));
            allTitles.forEach((t) => existing.topJobTitles.add(t));
            existing.jobs.push(...allJobs);
          } else {
            detailsByLead.set(leadId, {
              openJobCount: companyOpenRoles,
              departments: new Set(allDepts),
              topJobTitles: new Set(allTitles),
              jobs: [...allJobs],
            });
          }
        }

        await this.persistSignals(hiringResults, group.leadIds, pipelineRunId);

        // RAG indexing — fire-and-forget per lead, non-fatal
        for (const [leadId, detail] of detailsByLead) {
          if (!group.leadIds.includes(leadId)) continue;
          try {
            await this.indexInAi(leadId, group.companyName, detail, userId ?? "");
          } catch (err) {
            tools.log.warn(
              { leadId, company: group.companyName, err: (err as Error).message },
              "Signals step: hiring RAG indexing failed (non-fatal)",
            );
          }
        }
      }

      companiesChecked++;
      tools.emitProgress(
        `Checking hiring signals — ${companiesChecked} of ${uniqueCompanies} companies`,
        { checked: companiesChecked, total: uniqueCompanies },
      );
    };

    await runWithConcurrency(
      Array.from(companyGroups.values()),
      COMPANY_CONCURRENCY,
      processCompany,
    );

    return { cancelled, companiesChecked, companiesWithSignals, totalOpenRoles, detailsByLead };
  }

  /* ---------------------------------------------------------------- */
  /*  WS detail builder                                                */
  /* ---------------------------------------------------------------- */

  static buildWsDetails(
    detailsByLead: Map<string, HiringLeadDetail>,
    leadById: Map<string, LeadInfo>,
  ) {
    const details = Array.from(detailsByLead.entries()).map(([leadId, sig]) => {
      const lead = leadById.get(leadId);
      return {
        leadId,
        fullName: lead?.fullName ?? null,
        company: lead?.company ?? null,
        openJobCount: sig.openJobCount,
        departments: Array.from(sig.departments),
        topJobTitles: Array.from(sig.topJobTitles).slice(0, 10),
        jobs: sig.jobs.map((j) => ({
          externalId: j.externalId ?? null,
          jobTitle: j.jobTitle ?? null,
          team: j.team ?? null,
          jobType: j.jobType ?? null,
          locationType: j.locationType ?? null,
          datePosted: j.datePosted ?? null,
          companyName: j.companyName ?? null,
          companySlug: j.companySlug ?? null,
          requirementsSummary: j.requirementsSummary ?? null,
          skills: j.skills,
          technologies: j.technologies,
          jobCategories: j.jobCategories,
          locations: j.locations.map((l) => ({
            city: l.city ?? null,
            region: l.region ?? null,
            country: l.country ?? null,
          })),
        })),
      };
    });

    details.sort((a, b) => b.openJobCount - a.openJobCount);
    return details;
  }

  /* ---------------------------------------------------------------- */
  /*  Internal                                                          */
  /* ---------------------------------------------------------------- */

  private async indexInAi(
    leadId: string,
    companyName: string,
    detail: HiringLeadDetail,
    workspaceId: string,
  ): Promise<void> {
    if (!this.aiGrpcClient) return;

    const nowMs = String(Date.now());

    const makeDoc = (documentId: string, text: string): LeadDocument => ({
      documentId,
      leadId,
      kind: LeadDocumentKind.LEAD_DOCUMENT_KIND_HIRING_SIGNAL,
      text,
      metadata: { leadId, signalType: "hiring", companyName },
      updatedAtMs: nowMs,
      contentHash: createHash("sha256").update(text).digest("hex"),
    });

    // 1. Summary document (aggregate stats, no individual job listings)
    const documents: LeadDocument[] = [
      makeDoc(
        signalDocId("hiring", leadId),
        hiringSignalSummaryText(companyName, detail),
      ),
    ];

    // 2. One document per job listing
    for (const job of detail.jobs) {
      const key = signalItemKey([
        job.externalId,
        // fallback: derive key from content when externalId is absent
        job.externalId == null
          ? `${job.jobTitle ?? ""}|${job.datePosted ?? ""}|${job.companyName ?? ""}`
          : null,
      ]);
      documents.push(makeDoc(signalDocId("hiring", leadId, key), hiringJobToRagText(companyName, job)));
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

  private async fetchSignals(
    group: CompanyGroup,
    tools: PipelineTools,
  ): Promise<HiringSignalResult[]> {
    if (!group.companyName) return [];

    const results: HiringSignalResult[] = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.detectHiringSignals({
          companyName: group.companyName,
          companyDomain: group.companyDomain,
          leadId: group.leadIds[0] ?? "",
        });

        if (result === null) {
          tools.log.info(
            { company: group.companyName },
            "Signals step: hiring provider limit reached, skipping",
          );
          continue;
        }

        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        tools.log.warn(
          { company: group.companyName, err: msg },
          "Signals step: hiring provider error, skipping",
        );
      }
    }

    return results;
  }

  private async persistSignals(
    results: HiringSignalResult[],
    leadIds: string[],
    pipelineRunId: string,
  ): Promise<void> {
    if (results.length === 0 || leadIds.length === 0) return;

    const existing = await this.prisma.hiringSignal.findMany({
      where: {
        pipelineRunId,
        leadId: { in: leadIds },
        providerKey: { in: results.map((r) => r.providerKey) },
      },
      select: { leadId: true, providerKey: true },
    });

    const existingKeys = new Set(
      existing.map((e) => `${e.leadId}:${e.providerKey}`),
    );

    const creates = results.flatMap((result) =>
      leadIds
        .filter(
          (leadId) => !existingKeys.has(`${leadId}:${result.providerKey}`),
        )
        .map((leadId) =>
          this.prisma.hiringSignal.create({
            data: {
              lead: { connect: { id: leadId } },
              pipelineRunId,
              providerKey: result.providerKey,
              companyName: result.companyName,
              openJobCount: result.openJobCount,
              departments: result.departments,
              topJobTitles: result.topJobTitles,
              jobs: {
                create: result.jobs.map((job) => ({
                  externalId: job.externalId,
                  jobTitle: job.jobTitle,
                  team: job.team,
                  jobType: job.jobType,
                  locationType: job.locationType,
                  datePosted: job.datePosted,
                  companyName: job.companyName,
                  companySlug: job.companySlug,
                  requirementsSummary: job.requirementsSummary,
                  skills: job.skills,
                  technologies: job.technologies,
                  jobCategories: job.jobCategories,
                  locations: {
                    create: job.locations.map((loc) => ({
                      city: loc.city,
                      region: loc.region,
                      country: loc.country,
                    })),
                  },
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
