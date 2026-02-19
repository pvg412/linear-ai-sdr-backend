import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineStepRegistry } from "@/modules/pipeline/engine/pipeline.registry";
import type { PipelineStepHandler } from "@/modules/pipeline/steps/step.interface";
import { UserFacingError } from "@/infra/userFacingError";

function makeStubHandler(type: string): PipelineStepHandler {
  return {
    type,
    run: vi.fn().mockResolvedValue({
      contextPatch: {},
      outputSummary: { stub: true },
    }),
  };
}

describe("PipelineStepRegistry", () => {
  let registry: PipelineStepRegistry;

  beforeEach(() => {
    registry = new PipelineStepRegistry();
  });

  it("registers and retrieves a step handler", () => {
    const handler = makeStubHandler("test-step");
    registry.register(handler);

    expect(registry.get("test-step")).toBe(handler);
  });

  it("throws on duplicate registration", () => {
    registry.register(makeStubHandler("dup"));

    expect(() => registry.register(makeStubHandler("dup"))).toThrow(
      'Pipeline step handler "dup" is already registered',
    );
  });

  it("throws UserFacingError for unknown step type", () => {
    expect(() => registry.get("nonexistent")).toThrow(UserFacingError);
  });

  it("reports has() correctly", () => {
    registry.register(makeStubHandler("alpha"));

    expect(registry.has("alpha")).toBe(true);
    expect(registry.has("beta")).toBe(false);
  });

  it("lists all registered types", () => {
    registry.register(makeStubHandler("a"));
    registry.register(makeStubHandler("b"));
    registry.register(makeStubHandler("c"));

    expect(registry.listTypes()).toEqual(["a", "b", "c"]);
  });
});
