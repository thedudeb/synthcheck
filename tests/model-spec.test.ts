import { describe, expect, it } from "vitest";
import { MODEL_SPEC } from "../src/shared/model-spec";

describe("pinned detector model", () => {
  it("uses an immutable source revision and SHA-256", () => {
    expect(MODEL_SPEC.weightsUrl).toContain(MODEL_SPEC.sourceRevision);
    expect(MODEL_SPEC.sourceRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(MODEL_SPEC.weightsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(MODEL_SPEC.weightsBytes).toBeGreaterThan(1_000_000);
    expect(MODEL_SPEC.upstreamRevision).toMatch(/^[0-9a-f]{40}$/);
  });

  it("matches the upstream single-logit model and preprocessing metadata", () => {
    expect(MODEL_SPEC.singleLogit).toBe(true);
    expect(MODEL_SPEC.imageMean).toEqual([0.485, 0.456, 0.406]);
    expect(MODEL_SPEC.imageStd).toEqual([0.229, 0.224, 0.225]);
    expect(MODEL_SPEC.inputSize).toBe(224);
    expect(MODEL_SPEC.resizeShortEdge).toBe(256);
    expect(MODEL_SPEC.calibration).toEqual({ slope: 1, intercept: 3.563478187572664 });
  });
});
