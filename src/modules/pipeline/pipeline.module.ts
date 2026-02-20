import type { Container } from "inversify";

import { PIPELINE_TYPES } from "./pipeline.types";
import { PipelineRepository } from "./persistence/pipeline.repository";
import { PipelineCommandService } from "./services/pipeline.command.service";
import { PipelineQueryService } from "./services/pipeline.query.service";
import { PipelineExecutor } from "./engine/pipeline.executor";
import { PipelineStepRegistry } from "./engine/pipeline.registry";
import { PipelineBroadcaster } from "./engine/pipeline.broadcaster";

/* Step handlers */
import { LeadGenerationStep } from "./steps/lead-generation.step";
import { EnrichmentStep } from "./steps/enrichment.step";
import { OutreachStep } from "./steps/outreach.step";
import { ScoringStep } from "./steps/scoring.step";
import { FinalScoringStep } from "./steps/final-scoring.step";
import { SignalsStep } from "./steps/signals.step";
import { DecisionMakerStep } from "./steps/decision-maker.step";

export function registerPipelineModule(container: Container): void {
  /* Core infrastructure */
  container
    .bind<PipelineRepository>(PIPELINE_TYPES.PipelineRepository)
    .to(PipelineRepository)
    .inSingletonScope();

  container
    .bind<PipelineBroadcaster>(PIPELINE_TYPES.PipelineBroadcaster)
    .to(PipelineBroadcaster)
    .inSingletonScope();

  /* Step registry — populated with all handlers */
  container
    .bind<PipelineStepRegistry>(PIPELINE_TYPES.PipelineStepRegistry)
    .toDynamicValue((ctx) => {
      const registry = new PipelineStepRegistry();

      /* Adapters to existing modules */
      registry.register(ctx.get<LeadGenerationStep>(LeadGenerationStep));
      registry.register(ctx.get<EnrichmentStep>(EnrichmentStep));
      registry.register(ctx.get<OutreachStep>(OutreachStep));

      /* AI-powered steps */
      registry.register(ctx.get<ScoringStep>(ScoringStep));
      registry.register(ctx.get<FinalScoringStep>(FinalScoringStep));
      registry.register(ctx.get<SignalsStep>(SignalsStep));
      registry.register(ctx.get<DecisionMakerStep>(DecisionMakerStep));

      return registry;
    })
    .inSingletonScope();

  /* Step handlers as injectable classes */
  container.bind<LeadGenerationStep>(LeadGenerationStep).to(LeadGenerationStep).inSingletonScope();
  container.bind<EnrichmentStep>(EnrichmentStep).to(EnrichmentStep).inSingletonScope();
  container.bind<OutreachStep>(OutreachStep).to(OutreachStep).inSingletonScope();
  container.bind<ScoringStep>(ScoringStep).to(ScoringStep).inSingletonScope();
  container.bind<FinalScoringStep>(FinalScoringStep).to(FinalScoringStep).inSingletonScope();
  container.bind<SignalsStep>(SignalsStep).to(SignalsStep).inSingletonScope();
  container.bind<DecisionMakerStep>(DecisionMakerStep).to(DecisionMakerStep).inSingletonScope();

  /* Executor */
  container
    .bind<PipelineExecutor>(PIPELINE_TYPES.PipelineExecutor)
    .to(PipelineExecutor)
    .inSingletonScope();

  /* Services */
  container
    .bind<PipelineCommandService>(PIPELINE_TYPES.PipelineCommandService)
    .to(PipelineCommandService)
    .inSingletonScope();

  container
    .bind<PipelineQueryService>(PIPELINE_TYPES.PipelineQueryService)
    .to(PipelineQueryService)
    .inSingletonScope();
}
