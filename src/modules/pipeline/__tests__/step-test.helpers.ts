import { vi } from "vitest";

import type {
  LeadReference,
  PipelineContext,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

export function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    pipelineRunId: "run-1",
    pipelineKey: "test-pipeline",
    createdById: "user-1",
    companyId: "company-1",
    input: {},
    data: {},
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tools                                                              */
/* ------------------------------------------------------------------ */

export function makeTools(opts?: { cancelled?: boolean }): PipelineTools {
  return {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    checkCancelled: vi.fn().mockResolvedValue(opts?.cancelled ?? false),
    emitProgress: vi.fn(),
  };
}

/* ------------------------------------------------------------------ */
/*  Lead references                                                    */
/* ------------------------------------------------------------------ */

export function makeLeadRef(
  i: number,
  extra?: Partial<LeadReference>,
): LeadReference {
  return {
    id: `lead-${i}`,
    fullName: `Lead ${i}`,
    email: `lead${i}@example.com`,
    company: `Company ${i}`,
    linkedinUrl: `https://linkedin.com/in/lead-${i}`,
    title: `Title ${i}`,
    ...extra,
  };
}

/**
 * Generate an array of N lead references with sequential IDs.
 */
export function makeLeadRefs(
  count: number,
  extraFn?: (i: number) => Partial<LeadReference>,
): LeadReference[] {
  return Array.from({ length: count }, (_, i) =>
    makeLeadRef(i, extraFn?.(i)),
  );
}
