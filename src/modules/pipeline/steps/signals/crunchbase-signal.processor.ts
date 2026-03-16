import { createHash } from "crypto";

import type { PrismaClient } from "@prisma/client";

import type {
  CrunchbaseSignalProvider,
  CrunchbaseSignalResult,
  CrunchbaseSignalCompanyInfo,
} from "@/capabilities/crunchbase-signals/crunchbase-signal-provider.dto";
import type { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { LeadDocumentKind } from "@/generated/aisdr/v1/ai_sdr";
import type { PipelineTools } from "@/modules/pipeline/schemas/pipeline.dto";

import { PIPELINE_CONFIG } from "@/modules/pipeline/pipeline.config";

import type { CompanyGroup, LeadInfo } from "./signals.helpers";
import { crunchbaseSignalToRagText, signalDocId } from "./signal-rag-text";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type CrunchbasePhaseResult = {
  companiesWithData: number;
  companiesWithoutData: number;
  detailsByLead: Map<string, CrunchbaseSignalResult>;
};

/* ------------------------------------------------------------------ */
/*  Processor                                                           */
/* ------------------------------------------------------------------ */

export class CrunchbaseSignalProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providers: CrunchbaseSignalProvider[],
    private readonly aiGrpcClient: AiGrpcClient | null = null,
  ) {}

  async process(
    companyGroups: Map<string, CompanyGroup>,
    pipelineRunId: string,
    tools: PipelineTools,
    userId?: string,
  ): Promise<CrunchbasePhaseResult> {
    let companiesWithData = 0;
    let companiesWithoutData = 0;
    const detailsByLead = new Map<string, CrunchbaseSignalResult>();
    const allCompanies = Array.from(companyGroups.values());
    const uniqueCompanies = allCompanies.length;

    const crunchbaseCompanies: CrunchbaseSignalCompanyInfo[] = allCompanies.map((g) => ({
      companyName: g.companyName,
      companyDomain: g.companyDomain,
      leadIds: g.leadIds,
    }));

    tools.emitProgress("Checking company data...", {
      companies: uniqueCompanies,
    });

    for (const provider of this.providers) {
      try {
        const crunchbaseResults = await provider.detectCrunchbaseSignalsBatch({
          companies: crunchbaseCompanies,
          concurrency: PIPELINE_CONFIG.signals.crunchbaseConcurrency,
          maxCompetitors: PIPELINE_CONFIG.signals.crunchbaseMaxCompetitors,
          maxTechItems: PIPELINE_CONFIG.signals.crunchbaseMaxTechItems,
        });

        if (crunchbaseResults === null) {
          tools.log.info(
            { pipelineRunId },
            "Signals step: Crunchbase provider limit reached, skipping",
          );
          continue;
        }

        // Process and persist results for each company
        for (const group of allCompanies) {
          const key = group.companyName.trim().toLowerCase();
          const result = crunchbaseResults.get(key);

          if (result) {
            if (result.crunchbaseFound) {
              companiesWithData++;
            } else {
              companiesWithoutData++;
            }

            // Store for each lead at this company
            for (const leadId of group.leadIds) {
              if (!detailsByLead.has(leadId)) {
                detailsByLead.set(leadId, result);
              }
            }

            // Persist to DB
            await this.persistSignals(result, group.leadIds, pipelineRunId);

            // RAG indexing — fire-and-forget per lead, non-fatal
            for (const leadId of group.leadIds) {
              const detail = detailsByLead.get(leadId);
              if (!detail) continue;
              try {
                await this.indexInAi(leadId, group.companyName, detail, userId ?? "");
              } catch (err) {
                tools.log.warn(
                  { leadId, company: group.companyName, err: (err as Error).message },
                  "Signals step: Crunchbase RAG indexing failed (non-fatal)",
                );
              }
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        tools.log.warn(
          { err: msg, companyCount: crunchbaseCompanies.length },
          "Signals step: Crunchbase provider error, skipping",
        );
      }
    }

    const crunchbaseTotal = companiesWithData + companiesWithoutData;
    const matchRate = crunchbaseTotal > 0
      ? Math.round((companiesWithData / crunchbaseTotal) * 100)
      : 0;

    tools.log.info(
      {
        pipelineRunId,
        found: companiesWithData,
        notFound: companiesWithoutData,
        matchRate: `${matchRate}%`,
      },
      "Signals step: Crunchbase lookup complete",
    );

    tools.emitProgress(
      `Company data lookup — found ${companiesWithData}/${crunchbaseTotal} companies (${matchRate}% match rate)`,
      { found: companiesWithData, total: crunchbaseTotal, matchRate },
    );

    return { companiesWithData, companiesWithoutData, detailsByLead };
  }

  /* ---------------------------------------------------------------- */
  /*  WS detail builder                                                */
  /* ---------------------------------------------------------------- */

  static buildWsDetails(
    detailsByLead: Map<string, CrunchbaseSignalResult>,
    leadById: Map<string, LeadInfo>,
  ) {
    const details = Array.from(detailsByLead.entries()).map(([leadId, sig]) => {
      const lead = leadById.get(leadId);
      return {
        leadId,
        fullName: lead?.fullName ?? null,
        company: lead?.company ?? null,
        crunchbaseFound: sig.crunchbaseFound,
        crunchbasePermalink: sig.crunchbasePermalink,
        fundingTotalUsd: sig.fundingTotalUsd,
        lastFundingAt: sig.lastFundingAt,
        lastFundingType: sig.lastFundingType,
        numFundingRounds: sig.numFundingRounds,
        growthScore: sig.growthScore,
        heatScore: sig.heatScore,
        fundingPrediction: sig.fundingPrediction,
        employeeCountEnum: sig.employeeCountEnum,
        semrushVisits: sig.semrushVisits,
        shortDescription: sig.shortDescription,
        foundedOn: sig.foundedOn,
        operatingStatus: sig.operatingStatus,
        categories: sig.categories,
        numInvestors: sig.numInvestors,
        topCompetitors: sig.topCompetitors,
        hadLayoffs: sig.hadLayoffs,
        techStack: sig.techStack,
        ipoPrediction: sig.ipoPrediction,
        acquisitionPrediction: sig.acquisitionPrediction,
      };
    });

    // Sort: found companies first, then by funding (most funded first)
    details.sort((a, b) => {
      if (a.crunchbaseFound !== b.crunchbaseFound) return a.crunchbaseFound ? -1 : 1;
      return (b.fundingTotalUsd ?? 0) - (a.fundingTotalUsd ?? 0);
    });

    return details;
  }

  /* ---------------------------------------------------------------- */
  /*  Internal                                                          */
  /* ---------------------------------------------------------------- */

  private async indexInAi(
    leadId: string,
    companyName: string,
    result: CrunchbaseSignalResult,
    workspaceId: string,
  ): Promise<void> {
    if (!this.aiGrpcClient) return;

    const text = crunchbaseSignalToRagText(companyName, result);
    const contentHash = createHash("sha256").update(text).digest("hex");

    await this.aiGrpcClient.upsertLeadDocuments({
      requestId: "",
      workspaceId,
      allowPartial: true,
      documents: [
        {
          documentId: signalDocId("crunchbase", leadId),
          leadId,
          kind: LeadDocumentKind.LEAD_DOCUMENT_KIND_CRUNCHBASE_SIGNAL,
          text,
          metadata: { leadId, signalType: "crunchbase" },
          updatedAtMs: String(Date.now()),
          contentHash,
        },
      ],
    });
  }

  private async persistSignals(
    result: CrunchbaseSignalResult,
    leadIds: string[],
    pipelineRunId: string,
  ): Promise<void> {
    if (leadIds.length === 0) return;

    const existing = await this.prisma.crunchbaseSignal.findMany({
      where: {
        pipelineRunId,
        leadId: { in: leadIds },
        providerKey: result.providerKey,
      },
      select: { leadId: true },
    });

    const existingLeadIds = new Set(existing.map((e: { leadId: string }) => e.leadId));

    const creates = leadIds
      .filter((leadId) => !existingLeadIds.has(leadId))
      .map((leadId) =>
        this.prisma.crunchbaseSignal.create({
          data: {
            lead: { connect: { id: leadId } },
            pipelineRunId,
            providerKey: result.providerKey,
            companyName: result.companyName,
            crunchbaseFound: result.crunchbaseFound,
            crunchbasePermalink: result.crunchbasePermalink,
            fundingTotalUsd: result.fundingTotalUsd,
            lastFundingAt: result.lastFundingAt,
            lastFundingType: result.lastFundingType,
            numFundingRounds: result.numFundingRounds,
            growthScore: result.growthScore,
            heatScore: result.heatScore,
            fundingPrediction: result.fundingPrediction,
            fundingPrediction0to5: result.fundingPrediction0to5,
            fundingPrediction6to11: result.fundingPrediction6to11,
            fundingPrediction12to24: result.fundingPrediction12to24,
            fundingPrediction24plus: result.fundingPrediction24plus,
            employeeCountEnum: result.employeeCountEnum,
            semrushVisits: result.semrushVisits,
            shortDescription: result.shortDescription,
            foundedOn: result.foundedOn,
            operatingStatus: result.operatingStatus,
            categories: result.categories,
            numInvestors: result.numInvestors,
            topCompetitors: result.topCompetitors,
            hadLayoffs: result.hadLayoffs,
            techStack: result.techStack,
            ipoPrediction: result.ipoPrediction,
            acquisitionPrediction: result.acquisitionPrediction,
          },
        }),
      );

    if (creates.length > 0) {
      await this.prisma.$transaction(creates);
    }
  }
}
