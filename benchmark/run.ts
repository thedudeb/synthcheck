import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as ort from "onnxruntime-web";
import sharp from "sharp";
import { AI_THRESHOLD } from "../src/shared/contracts";
import { MODEL_SPEC } from "../src/shared/model-spec";
import { calibrateAiLikelihood, type PlattCalibration } from "../src/inference/calibration";
import { rgbBytesToNormalizedChw, softmaxSynthetic } from "../src/inference/preprocess";
import { calculateMetrics } from "./metrics";
import type { BenchmarkItem, Prediction } from "./types";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const split = argument("split", "validation");
const candidate = argument("candidate", "baseline");
const datasetDirectory = path.resolve(`benchmark/data/defactify-${split}`);
const manifestPath = path.join(datasetDirectory, "manifest.jsonl");
const candidateSpec = candidate === "ferretnet"
  ? {
      id: "xigua7105/FerretNet@official:ferretnet-b-median-3-fp32",
      defaultPath: "benchmark/candidates/ferretnet/model.onnx",
      expectedHash: "bd4b65b5cedfb20418ccd546999bd5cd4cc3e48e6dda46a847eb0508a34d3bfa",
      inputSize: 256,
      resizeShortEdge: undefined,
      centerCropOnly: true,
      mean: [0.48145466, 0.4578275, 0.40821073] as const,
      std: [0.26862954, 0.26130258, 0.27577711] as const,
      syntheticLabelIndex: 0,
      singleLogit: true,
    }
  : candidate === "xrayon" || candidate === "xrayon-int8"
  ? {
      id: candidate === "xrayon-int8"
        ? "xRayon/convnext-ai-images-detector@1b4d270:phase2-int8-qdq"
        : "xRayon/convnext-ai-images-detector@1b4d270:phase2-fp32",
      defaultPath: candidate === "xrayon-int8"
        ? "benchmark/candidates/xrayon/model-int8-qdq.onnx"
        : "benchmark/candidates/xrayon/model.onnx",
      expectedHash: candidate === "xrayon-int8"
        ? "905511ee9a4fe3db0cc36d943e0fe21ece4323a8f8f5c7bbfcf3e9d45cbdfbbd"
        : "3f949491774eb97cd8d705e73e0bf371d90608a0c8e60f823ebf591ced6b2107",
      inputSize: 256,
      resizeShortEdge: 288,
      centerCropOnly: false,
      mean: [0.485, 0.456, 0.406] as const,
      std: [0.229, 0.224, 0.225] as const,
      syntheticLabelIndex: 1,
      singleLogit: false,
    }
  : {
      id: MODEL_SPEC.id,
      defaultPath: "benchmark/models/detector.onnx",
      expectedHash: MODEL_SPEC.weightsSha256,
      inputSize: MODEL_SPEC.inputSize,
      resizeShortEdge: undefined,
      centerCropOnly: false,
      mean: MODEL_SPEC.imageMean,
      std: MODEL_SPEC.imageStd,
      syntheticLabelIndex: MODEL_SPEC.syntheticLabelIndex,
      singleLogit: false,
    };
if (!["baseline", "xrayon", "xrayon-int8", "ferretnet"].includes(candidate)) throw new Error(`Unknown candidate: ${candidate}`);
const modelPath = path.resolve(argument("model", candidateSpec.defaultPath));
const calibrationArgument = argument("calibration", "none");
const calibrationPath = calibrationArgument === "none" ? undefined : path.resolve(calibrationArgument);
const calibrationText = calibrationPath ? await readFile(calibrationPath, "utf8") : undefined;
const calibration = calibrationText ? JSON.parse(calibrationText) as PlattCalibration & { modelSha256?: string } : undefined;
const resultDirectory = path.resolve("benchmark/results");
const manifestText = await readFile(manifestPath, "utf8");
let items = manifestText
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as BenchmarkItem);
const realLimit = Number(argument("real-limit", "0"));
const perGeneratorLimit = Number(argument("per-generator-limit", "0"));
if (realLimit > 0 || perGeneratorLimit > 0) {
  if (!Number.isInteger(realLimit) || !Number.isInteger(perGeneratorLimit) || realLimit <= 0 || perGeneratorLimit <= 0) {
    throw new Error("Diagnostic subset limits must both be positive integers");
  }
  const counts = new Map<string, number>();
  items = items.filter((item) => {
    const limit = item.source === "real" ? realLimit : perGeneratorLimit;
    const count = counts.get(item.source) ?? 0;
    if (count >= limit) return false;
    counts.set(item.source, count + 1);
    return true;
  });
}
const modelBytes = await readFile(modelPath);
const modelHash = sha256(modelBytes);
if (modelHash !== candidateSpec.expectedHash) throw new Error(`Unexpected model SHA-256 ${modelHash}`);
if (calibration?.modelSha256 && calibration.modelSha256 !== modelHash) {
  throw new Error(`Calibration targets model ${calibration.modelSha256}, not ${modelHash}`);
}

ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(modelBytes, {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "all",
  logSeverityLevel: 3,
});
if (!session.inputNames.includes(MODEL_SPEC.inputName) || !session.outputNames.includes(MODEL_SPEC.outputName)) {
  throw new Error(`Unexpected graph interface: ${session.inputNames.join(",")} -> ${session.outputNames.join(",")}`);
}

await mkdir(resultDirectory, { recursive: true });
const predictionPath = path.join(resultDirectory, `${candidate}-${split}-predictions.jsonl`);
const predictionStream = createWriteStream(predictionPath, { flags: "w" });
const predictions: Prediction[] = [];

for (const [index, item] of items.entries()) {
  const absoluteImagePath = path.join(datasetDirectory, item.path);
  const originalBytes = await readFile(absoluteImagePath);
  if (sha256(originalBytes) !== item.imageSha256) throw new Error(`Image integrity mismatch: ${item.id}`);
  const startedAt = performance.now();
  const source = sharp(originalBytes).toColourspace("srgb").removeAlpha();
  const { data, info } = candidateSpec.centerCropOnly
    ? await (async () => {
        const metadata = await source.metadata();
        if (!metadata.width || !metadata.height) throw new Error(`Missing dimensions for ${item.id}`);
        const padWidth = Math.max(0, candidateSpec.inputSize - metadata.width);
        const padHeight = Math.max(0, candidateSpec.inputSize - metadata.height);
        const leftPad = Math.floor(padWidth / 2);
        const topPad = Math.floor(padHeight / 2);
        const paddedWidth = metadata.width + padWidth;
        const paddedHeight = metadata.height + padHeight;
        return source
          .extend({
            left: leftPad,
            right: padWidth - leftPad,
            top: topPad,
            bottom: padHeight - topPad,
            background: { r: 0, g: 0, b: 0 },
          })
          .extract({
            left: Math.floor((paddedWidth - candidateSpec.inputSize) / 2),
            top: Math.floor((paddedHeight - candidateSpec.inputSize) / 2),
            width: candidateSpec.inputSize,
            height: candidateSpec.inputSize,
          })
          .raw()
          .toBuffer({ resolveWithObject: true });
      })()
    : candidateSpec.resizeShortEdge
    ? await (async () => {
        // Match torchvision Resize(short_edge) followed by CenterCrop without
        // accidentally scaling the image a second time during the crop.
        const resized = await source
          .resize(candidateSpec.resizeShortEdge, candidateSpec.resizeShortEdge, {
            fit: "outside",
            kernel: "linear",
          })
          .raw()
          .toBuffer({ resolveWithObject: true });
        return sharp(resized.data, { raw: resized.info })
          .extract({
            left: Math.floor((resized.info.width - candidateSpec.inputSize) / 2),
            top: Math.floor((resized.info.height - candidateSpec.inputSize) / 2),
            width: candidateSpec.inputSize,
            height: candidateSpec.inputSize,
          })
          .raw()
          .toBuffer({ resolveWithObject: true });
      })()
    : await source
        .resize(candidateSpec.inputSize, candidateSpec.inputSize, { fit: "fill", kernel: "linear" })
        .raw()
        .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`Expected RGB image for ${item.id}, received ${info.channels} channels`);
  const input = rgbBytesToNormalizedChw(
    data,
    info.width,
    info.height,
    3,
    candidateSpec.mean,
    candidateSpec.std,
  );
  const outputs = await session.run({
    [MODEL_SPEC.inputName]: new ort.Tensor("float32", input, [1, 3, candidateSpec.inputSize, candidateSpec.inputSize]),
  });
  const output = outputs[MODEL_SPEC.outputName];
  if (!output) throw new Error(`Missing model output for ${item.id}`);
  const logits = Array.from(output.data as Float32Array);
  const rawAiLikelihood = candidateSpec.singleLogit
    ? 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, logits[0]!))))
    : softmaxSynthetic(logits, candidateSpec.syntheticLabelIndex);
  const aiLikelihood = calibration ? calibrateAiLikelihood(rawAiLikelihood, calibration) : rawAiLikelihood;
  const prediction: Prediction = {
    ...item,
    rawAiLikelihood,
    aiLikelihood,
    predictedLabel: aiLikelihood >= AI_THRESHOLD ? 1 : 0,
    durationMs: Math.round(performance.now() - startedAt),
  };
  predictions.push(prediction);
  predictionStream.write(`${JSON.stringify(prediction)}\n`);
  if ((index + 1) % 10 === 0 || index + 1 === items.length) {
    console.log(`Evaluated ${index + 1}/${items.length}`);
  }
}

await new Promise<void>((resolve, reject) => {
  predictionStream.end(resolve);
  predictionStream.on("error", reject);
});
await session.release();

const metrics = calculateMetrics(predictions, AI_THRESHOLD);
const summary = {
  schemaVersion: 1,
  executedAt: new Date().toISOString(),
  runtime: { node: process.version, onnxruntimeWeb: ort.env.versions.web, threads: 1 },
  model: { id: candidateSpec.id, sha256: modelHash, bytes: modelBytes.byteLength },
  calibration: calibrationText
    ? {
        method: "Platt scaling over raw probability logits",
        path: path.relative(process.cwd(), calibrationPath!),
        sha256: sha256(calibrationText),
        slope: calibration!.slope,
        intercept: calibration!.intercept,
      }
    : null,
  dataset: {
    manifest: path.relative(process.cwd(), manifestPath),
    manifestSha256: sha256(manifestText),
    split,
    sampleMethod: "lowest SHA-256 priorities over immutable dataset row identities, stratified by source",
    diagnosticSubset: realLimit > 0 ? { realLimit, perGeneratorLimit } : null,
  },
  metrics,
};
const summaryPath = path.join(resultDirectory, `${candidate}-${split}.json`);
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
