export interface ModelSpec {
  id: string;
  displayName: string;
  sourceRepository: string;
  sourceRevision: string;
  upstreamRepository: string;
  upstreamRevision: string;
  weightsUrl: string;
  bundledWeightsPath: string;
  weightsSha256: string;
  weightsBytes: number;
  license: string;
  inputSize: number;
  resizeShortEdge: number;
  inputName: string;
  outputName: string;
  syntheticLabelIndex: number;
  singleLogit: boolean;
  calibration: { slope: number; intercept: number };
  imageMean: readonly [number, number, number];
  imageStd: readonly [number, number, number];
}

export const MODEL_SPEC: ModelSpec = {
  id: "SynthCheck/community-forensics-modern-rehead-v2@20260813:int8-dynamic",
  displayName: "SynthCheck Modern Forensics ViT-S/16 (INT8)",
  sourceRepository: "https://github.com/thedudeb/synthcheck",
  sourceRevision: "main",
  upstreamRepository: "https://huggingface.co/OwensLab/commfor-model-224",
  upstreamRevision: "26afc31e6b40c312c3fd42c05a758be62446215b",
  weightsUrl:
    "https://raw.githubusercontent.com/thedudeb/synthcheck/main/weights/community-forensics-int8.onnx",
  bundledWeightsPath: "weights/community-forensics-int8.onnx",
  weightsSha256: "d0712f939ef34ab9470eac357e483e188672f472798d4093ddb5d7e5030cd9f4",
  weightsBytes: 23_433_075,
  license: "MIT",
  inputSize: 224,
  resizeShortEdge: 256,
  inputName: "pixel_values",
  outputName: "logits",
  syntheticLabelIndex: 0,
  singleLogit: true,
  calibration: { slope: 1, intercept: 0.65819564532639 },
  imageMean: [0.485, 0.456, 0.406],
  imageStd: [0.229, 0.224, 0.225],
};
