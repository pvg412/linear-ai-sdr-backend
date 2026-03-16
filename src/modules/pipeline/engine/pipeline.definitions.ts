import type { PipelineDefinition } from "@/modules/pipeline/schemas/pipeline.dto";
import { PIPELINE_CONFIG as C } from "@/modules/pipeline/pipeline.config";

/* ------------------------------------------------------------------ */
/*  Built-in pipeline definitions                                     */
/* ------------------------------------------------------------------ */

/**
 * Default full pipeline:
 * lead-generation → scoring (initial) → enrichment (profile) → signals
 *   (hiring + Reddit + Crunchbase + company research) → scoring (final) → outreach
 *
 * All tuneable parameters come from PIPELINE_CONFIG (pipeline.config.ts).
 */
export const DEFAULT_COMPANY_PIPELINE: PipelineDefinition = {
  key: "default-company-pipeline",
  version: 1,
  displayName: "Full Lead Pipeline",
  description:
    "End-to-end pipeline: generate leads, score, enrich, detect signals, " +
    "re-score, and prepare outreach.",
  steps: [
    {
      type: "lead-generation",
      id: "lead-generation",
      displayName: "Lead Generation",
      config: {},
      timeoutMs: C.leadGeneration.timeoutMs,
    },
    {
      type: "scoring",
      id: "scoring-initial",
      displayName: "Initial Scoring",
      config: { _stepId: "scoring-initial" },
    },
    {
      type: "enrichment",
      id: "enrichment",
      displayName: "Profile Enrichment",
      config: {
        includeProfileEnrichment: C.enrichment.includeProfileEnrichment,
      },
      timeoutMs: C.enrichment.timeoutMs,
    },
    {
      type: "signals",
      id: "signals",
      displayName: "Signals Detection",
      config: {
        includeCompanyResearch: C.signals.includeCompanyResearch,
        includeLinkedinPosts: C.signals.includeLinkedinPosts,
        perplexityRecency: C.signals.perplexityRecency,
        perplexityMaxResults: C.signals.perplexityMaxResults,
      },
      timeoutMs: C.signals.timeoutMs,
    },
    {
      type: "final-scoring",
      id: "scoring-final",
      displayName: "Final Scoring",
      config: { _stepId: "scoring-final" },
    },
    {
      type: "outreach",
      id: "outreach",
      displayName: "Outreach",
      config: { channel: C.outreach.channel },
      timeoutMs: C.outreach.timeoutMs,
    },
  ],
  defaults: {
    onError: C.execution.defaultOnError,
    retryPolicy: {
      maxAttempts: C.execution.retryMaxAttempts,
      backoffMs: C.execution.retryBackoffMs,
      backoffType: C.execution.retryBackoffType,
    },
    timeoutMs: C.execution.defaultTimeoutMs,
  },
};

/* ------------------------------------------------------------------ */
/*  Registry of all built-in definitions                              */
/* ------------------------------------------------------------------ */

const PIPELINE_DEFINITIONS: Record<string, PipelineDefinition> = {
  [DEFAULT_COMPANY_PIPELINE.key]: DEFAULT_COMPANY_PIPELINE,
};

export function getPipelineDefinition(
  key: string,
): PipelineDefinition | undefined {
  return PIPELINE_DEFINITIONS[key];
}

export function listPipelineDefinitions(): PipelineDefinition[] {
  return Object.values(PIPELINE_DEFINITIONS);
}
