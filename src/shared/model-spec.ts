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
  id: "OwensLab/commfor-model-224@26afc31:int8-dynamic",
  displayName: "Community Forensics ViT-S/16 (INT8)",
  sourceRepository: "https://github.com/thedudeb/ai-poidhbot",
  sourceRevision: "e1bee3967163cf1791af145d68778d008e95c5f7",
  upstreamRepository: "https://huggingface.co/OwensLab/commfor-model-224",
  upstreamRevision: "26afc31e6b40c312c3fd42c05a758be62446215b",
  weightsUrl:
    "https://raw.githubusercontent.com/thedudeb/ai-poidhbot/e1bee3967163cf1791af145d68778d008e95c5f7/weights/community-forensics-int8.onnx",
  bundledWeightsPath: "weights/community-forensics-int8.onnx",
  weightsSha256: "9c7a92aafb3a5c14b1626a4cb10a241205254620c6d4a6cc60ca91c15533fc20",
  weightsBytes: 23_433_075,
  license: "MIT",
  inputSize: 224,
  resizeShortEdge: 256,
  inputName: "pixel_values",
  outputName: "logits",
  syntheticLabelIndex: 0,
  singleLogit: true,
  calibration: { slope: 1, intercept: 3.563478187572664 },
  imageMean: [0.485, 0.456, 0.406],
  imageStd: [0.229, 0.224, 0.225],
};
