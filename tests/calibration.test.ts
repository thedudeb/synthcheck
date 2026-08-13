import { describe, expect, it } from "vitest";
import { calibrateAiLikelihood } from "../src/inference/calibration";

describe("calibrateAiLikelihood", () => {
  const calibration = { slope: 1.255764663883145, intercept: 2.578414751108438 };

  it("is monotonic and maps the frozen raw boundary above the product threshold", () => {
    const low = calibrateAiLikelihood(0.05, calibration);
    const boundary = calibrateAiLikelihood(0.2, calibration);
    const high = calibrateAiLikelihood(0.9, calibration);
    expect(low).toBeLessThan(boundary);
    expect(boundary).toBeGreaterThan(0.65);
    expect(boundary).toBeLessThan(high);
  });

  it("returns finite probabilities for saturated model output", () => {
    expect(calibrateAiLikelihood(0, calibration)).toBeGreaterThan(0);
    expect(calibrateAiLikelihood(1, calibration)).toBeLessThanOrEqual(1);
  });
});
