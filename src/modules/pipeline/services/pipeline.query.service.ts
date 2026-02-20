import { inject, injectable } from "inversify";

import { PIPELINE_TYPES } from "@/modules/pipeline/pipeline.types";
import type { PipelineRepository } from "@/modules/pipeline/persistence/pipeline.repository";
import { listPipelineDefinitions } from "@/modules/pipeline/engine/pipeline.definitions";
import type { PipelineDefinition } from "@/modules/pipeline/schemas/pipeline.dto";

/* ------------------------------------------------------------------ */
/*  Sanitization helpers                                               */
/* ------------------------------------------------------------------ */

/**
 * Strip internal fields from the stored pipeline definition snapshot
 * so that retry policies, timeouts, and step configs are never leaked
 * to API consumers.
 */
function sanitizeDefinition(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;

  const def = raw as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaults: _defaults, ...rest } = def;

  if (Array.isArray(def.steps)) {
    rest.steps = (def.steps as Record<string, unknown>[]).map((step) => ({
      type: step.type,
      id: step.id,
      displayName: step.displayName,
    }));
  }

  return rest;
}

/** Sanitize a single PipelineRun record in-place and return it. */
function sanitizeRun<T extends { definition: unknown }>(run: T): T {
  return { ...run, definition: sanitizeDefinition(run.definition) };
}

/* ------------------------------------------------------------------ */

@injectable()
export class PipelineQueryService {
  constructor(
    @inject(PIPELINE_TYPES.PipelineRepository)
    private readonly repo: PipelineRepository,
  ) {}

  /* ---------------------------------------------------------------- */
  /*  Get single run (with ownership check)                           */
  /* ---------------------------------------------------------------- */

  async getRun(userId: string, pipelineRunId: string) {
    const run = await this.repo.getRunForUser(userId, pipelineRunId);
    return sanitizeRun(run);
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

    return {
      ...result,
      runs: result.runs.map(sanitizeRun),
    };
  }

  /* ---------------------------------------------------------------- */
  /*  List available pipeline definitions                             */
  /* ---------------------------------------------------------------- */

  listDefinitions(): PipelineDefinition[] {
    return listPipelineDefinitions();
  }
}
