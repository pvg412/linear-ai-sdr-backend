import type {
  PipelineContext,
  PipelineContextData,
  PipelineInput,
} from "@/modules/pipeline/schemas/pipeline.dto";

/**
 * Build an initial PipelineContext for a new run.
 */
export function buildInitialContext(args: {
  pipelineRunId: string;
  pipelineKey: string;
  createdById: string;
  companyId: string | null;
  input: PipelineInput;
}): PipelineContext {
  return {
    pipelineRunId: args.pipelineRunId,
    pipelineKey: args.pipelineKey,
    createdById: args.createdById,
    companyId: args.companyId,
    input: args.input,
    data: {},
  };
}

/**
 * Merge a step's context patch into the current context data.
 * Creates a shallow copy — does not mutate the original.
 */
export function applyContextPatch(
  current: PipelineContextData,
  patch: Partial<PipelineContextData>,
): PipelineContextData {
  return { ...current, ...patch };
}

/**
 * Reconstruct a PipelineContext from persisted JSON (DB round-trip).
 */
export function hydrateContext(args: {
  pipelineRunId: string;
  pipelineKey: string;
  createdById: string;
  companyId: string | null;
  input: unknown;
  data: unknown;
}): PipelineContext {
  return {
    pipelineRunId: args.pipelineRunId,
    pipelineKey: args.pipelineKey,
    createdById: args.createdById,
    companyId: args.companyId,
    input: (args.input ?? {}) as PipelineInput,
    data: (args.data ?? {}) as PipelineContextData,
  };
}
