import { describe, expect, it } from "vitest";
import { MODEL_SPEC } from "../src/shared/model-spec";

describe("pinned detector model", () => {
  it("uses an immutable source revision and SHA-256", () => {
    expect(MODEL_SPEC.weightsUrl).toContain(MODEL_SPEC.sourceRevision);
    expect(MODEL_SPEC.sourceRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(MODEL_SPEC.weightsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(MODEL_SPEC.weightsBytes).toBeGreaterThan(1_000_000);
  });

  it("matches the upstream FAKE label and preprocessing metadata", () => {
    expect(MODEL_SPEC.syntheticLabelIndex).toBe(1);
    expect(MODEL_SPEC.imageMean).toEqual([0.5, 0.5, 0.5]);
    expect(MODEL_SPEC.imageStd).toEqual([0.5, 0.5, 0.5]);
    expect(MODEL_SPEC.inputSize).toBe(224);
  });
});
