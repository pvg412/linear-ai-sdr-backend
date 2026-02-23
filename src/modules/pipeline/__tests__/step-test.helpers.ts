import { vi } from "vitest";

import type {
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


