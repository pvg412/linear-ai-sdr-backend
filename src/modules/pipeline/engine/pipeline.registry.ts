import { injectable } from "inversify";

import { UserFacingError } from "@/infra/userFacingError";
import type { PipelineStepHandler } from "@/modules/pipeline/steps/step.interface";

/**
 * In-memory registry of pipeline step handlers.
 *
 * Step handlers are registered by their `type` string during module bootstrap.
 * The executor looks up handlers here when running a pipeline.
 */
@injectable()
export class PipelineStepRegistry {
  private readonly handlers = new Map<string, PipelineStepHandler>();

  register(handler: PipelineStepHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(
        `Pipeline step handler "${handler.type}" is already registered`,
      );
    }
    this.handlers.set(handler.type, handler);
  }

  get(type: string): PipelineStepHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: `Unknown pipeline step type: "${type}"`,
        debugMessage: `No handler registered for step type "${type}". Available: [${[...this.handlers.keys()].join(", ")}]`,
      });
    }
    return handler;
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  listTypes(): string[] {
    return [...this.handlers.keys()];
  }
}
