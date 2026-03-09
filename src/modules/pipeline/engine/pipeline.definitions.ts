import type { PipelineDefinition } from "@/modules/pipeline/schemas/pipeline.dto";

/* ------------------------------------------------------------------ */
/*  Built-in pipeline definitions                                     */
/* ------------------------------------------------------------------ */

/**
 * Default full pipeline:
 * lead-generation → scoring (initial) → enrichment → signals
 *   → scoring (final) → outreach
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
      timeoutMs: 15 * 60 * 1000, // 15 min (APIFY runs ~2-5 min for 100 leads)
    },
    {
      type: "scoring",
      id: "scoring-initial",
      displayName: "Initial Scoring",
      config: { model: "default", _stepId: "scoring-initial" },
    },
    {
      type: "enrichment",
      id: "enrichment",
      displayName: "Enrichment & Company Research",
      config: {
        includeCompanyResearch: true,
        includeProfileEnrichment: true,
      },
      timeoutMs: 10 * 60 * 1000, // 10 min
    },
    {
      type: "signals",
      id: "signals",
      displayName: "Signals Detection",
      config: {},
      timeoutMs: 20 * 60 * 1000, // 20 min (Reddit batch scraper: up to 5min per batch of 10 companies)
    },
    {
      type: "final-scoring",
      id: "scoring-final",
      displayName: "Final Scoring",
      config: {
        model: "default",
        _stepId: "scoring-final",
      },
    },
    {
      type: "outreach",
      id: "outreach",
      displayName: "Outreach",
      config: { channel: "linkedin" },
      timeoutMs: 15 * 60 * 1000, // 15 min (two sequential gRPC calls per lead: parse + stream)
    },
  ],
  defaults: {
    onError: "stop",
    retryPolicy: { maxAttempts: 2, backoffMs: 3000, backoffType: "exponential" },
    timeoutMs: 5 * 60 * 1000,
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
