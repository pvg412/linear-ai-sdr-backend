export const PIPELINE_TYPES = {
  PipelineRepository: Symbol.for("PipelineRepository"),
  PipelineCommandService: Symbol.for("PipelineCommandService"),
  PipelineQueryService: Symbol.for("PipelineQueryService"),
  PipelineExecutor: Symbol.for("PipelineExecutor"),
  PipelineStepRegistry: Symbol.for("PipelineStepRegistry"),
  PipelineBroadcaster: Symbol.for("PipelineBroadcaster"),
} as const;
