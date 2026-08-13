export interface ModelSpec {
  id: string;
  displayName: string;
  sourceRepository: string;
  sourceRevision: string;
  weightsUrl: string;
  weightsSha256: string;
  weightsBytes: number;
  license: string;
  inputSize: number;
  inputName: string;
  outputName: string;
  syntheticLabelIndex: number;
  imageMean: readonly [number, number, number];
  imageStd: readonly [number, number, number];
}

// Browser-ready baseline. It remains replaceable until held-out validation proves
// the final detector clears the PRD's balanced-accuracy gate.
export const MODEL_SPEC: ModelSpec = {
  id: "onnx-community/ai-image-detection-ONNX@e3cfe99:model-q4",
  displayName: "AI Image Detection ViT (Q4 baseline)",
  sourceRepository: "https://huggingface.co/onnx-community/ai-image-detection-ONNX",
  sourceRevision: "e3cfe99f2841930a040a6281682c10c989965603",
  weightsUrl:
    "https://huggingface.co/onnx-community/ai-image-detection-ONNX/resolve/e3cfe99f2841930a040a6281682c10c989965603/onnx/model_q4.onnx",
  weightsSha256: "28c7f06d5aa87bc7e023c023eab1fbf473deef54e9c62f9838a99e50422810ec",
  weightsBytes: 56_757_898,
  license: "Apache-2.0",
  inputSize: 224,
  inputName: "pixel_values",
  outputName: "logits",
  syntheticLabelIndex: 1,
  imageMean: [0.5, 0.5, 0.5],
  imageStd: [0.5, 0.5, 0.5],
};
