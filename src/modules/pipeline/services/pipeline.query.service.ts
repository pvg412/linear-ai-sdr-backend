import { inject, injectable } from "inversify";

import { PIPELINE_TYPES } from "@/modules/pipeline/pipeline.types";
import type { PipelineRepository } from "@/modules/pipeline/persistence/pipeline.repository";
import { listPipelineDefinitions } from "@/modules/pipeline/engine/pipeline.definitions";
import type { PipelineDefinition } from "@/modules/pipeline/schemas/pipeline.dto";

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
    return this.repo.getRunForUser(userId, pipelineRunId);
  }

  /* ---------------------------------------------------------------- */
  /*  List runs for current user                                      */
  /* ---------------------------------------------------------------- */

  async listRuns(
    userId: string,
    opts?: { limit?: number; offset?: number; status?: string },
  ) {
    return this.repo.listRunsForUser(userId, {
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
  }

  /* ---------------------------------------------------------------- */
  /*  List available pipeline definitions                             */
  /* ---------------------------------------------------------------- */

  listDefinitions(): PipelineDefinition[] {
    return listPipelineDefinitions();
  }
}
