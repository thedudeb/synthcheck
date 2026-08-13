import { describe, expect, it } from "vitest";
import { centerCropGeometry, imageDataToNormalizedChw, softmaxSynthetic } from "../src/inference/preprocess";

describe("image preprocessing", () => {
  it("normalizes RGB pixels into planar CHW order", () => {
    const imageData = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([0, 127, 255, 255, 255, 127, 0, 255]),
    } as ImageData;
    const result = imageDataToNormalizedChw(imageData, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);

    const expected = [
      -1,
      1,
      127 / 255 / 0.5 - 1,
      127 / 255 / 0.5 - 1,
      1,
      -1,
    ];
    Array.from(result).forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 7));
  });

  it("computes a centered square crop without stretching", () => {
    expect(centerCropGeometry(400, 200)).toEqual({
      sourceX: 112.5,
      sourceY: 12.5,
      sourceSize: 175,
      targetSize: 224,
    });
  });
});

describe("output calibration primitives", () => {
  it("maps the configured synthetic logit through softmax", () => {
    expect(softmaxSynthetic([0, Math.log(3)], 1)).toBeCloseTo(0.75, 8);
  });

  it("rejects malformed model output", () => {
    expect(() => softmaxSynthetic([1], 0)).toThrow("invalid logits");
  });
});
