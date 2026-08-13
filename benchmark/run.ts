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
const selectionPath = path.join(datasetDirectory, "selection.json");
const candidateSpec = candidate === "community-forensics" || candidate === "community-forensics-int8"
  ? {
      id: candidate === "community-forensics-int8"
        ? "OwensLab/commfor-model-224@26afc31:int8-dynamic"
        : "OwensLab/commfor-model-224@26afc31:fp32",
      defaultPath: candidate === "community-forensics-int8"
        ? "benchmark/candidates/community_forensics/model-int8.onnx"
        : "benchmark/candidates/community_forensics/model.onnx",
      expectedHash: candidate === "community-forensics-int8"
        ? "9c7a92aafb3a5c14b1626a4cb10a241205254620c6d4a6cc60ca91c15533fc20"
        : "1a9a8ec0503cbae9d6fa0f3c5e96ced57a6d9a2a2ce2e923d8e954b4a11a1226",
      inputSize: 224,
      resizeShortEdge: 256,
      centerCropOnly: false,
      mean: [0.485, 0.456, 0.406] as const,
      std: [0.229, 0.224, 0.225] as const,
      syntheticLabelIndex: 0,
      singleLogit: true,
      outputName: "logits",
      patchGrid: undefined,
    }
  : candidate === "safe"
  ? {
      id: "Ouxiang-Li/SAFE@official:checkpoint-best-fp32",
      defaultPath: "benchmark/candidates/safe/model.onnx",
      expectedHash: "e50e082e4b85217018de9130cee7816edfdf47e442d17aaf610ec8b428cd6e33",
      inputSize: 256,
      resizeShortEdge: undefined,
      centerCropOnly: true,
      mean: [0, 0, 0] as const,
      std: [1, 1, 1] as const,
      syntheticLabelIndex: 1,
      singleLogit: false,
      outputName: "logits",
      patchGrid: undefined,
    }
  : candidate === "polimi"
  ? {
      id: "polimi-ispl/synthetic-image-detection@official:synth-vs-real-fp32",
      defaultPath: "benchmark/candidates/polimi/model.onnx",
      expectedHash: "327da4f966688c82caac774b7afe6e6f2929c820ef79c76fd3818970f7ba9bd8",
      inputSize: 96,
      resizeShortEdge: undefined,
      centerCropOnly: false,
      mean: [0.485, 0.456, 0.406] as const,
      std: [0.229, 0.224, 0.225] as const,
      syntheticLabelIndex: 1,
      singleLogit: false,
      outputName: "patch_logits",
      patchGrid: 5,
    }
  : candidate === "ferretnet"
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
      outputName: "logits",
      patchGrid: undefined,
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
      outputName: "logits",
      patchGrid: undefined,
    }
  : {
      id: MODEL_SPEC.id,
      defaultPath: MODEL_SPEC.bundledWeightsPath,
      expectedHash: MODEL_SPEC.weightsSha256,
      inputSize: MODEL_SPEC.inputSize,
      resizeShortEdge: MODEL_SPEC.resizeShortEdge,
      centerCropOnly: false,
      mean: MODEL_SPEC.imageMean,
      std: MODEL_SPEC.imageStd,
      syntheticLabelIndex: MODEL_SPEC.syntheticLabelIndex,
      singleLogit: MODEL_SPEC.singleLogit,
      outputName: MODEL_SPEC.outputName,
      patchGrid: undefined,
    };
if (!["baseline", "xrayon", "xrayon-int8", "ferretnet", "safe", "polimi", "community-forensics", "community-forensics-int8"].includes(candidate)) {
  throw new Error(`Unknown candidate: ${candidate}`);
}
const modelPath = path.resolve(argument("model", candidateSpec.defaultPath));
const calibrationArgument = argument("calibration", "none");
const calibrationPath = calibrationArgument === "none" ? undefined : path.resolve(calibrationArgument);
const calibrationText = calibrationPath ? await readFile(calibrationPath, "utf8") : undefined;
const calibration = calibrationText
  ? JSON.parse(calibrationText) as PlattCalibration & { modelSha256?: string; method?: string }
  : undefined;
const resultDirectory = path.resolve("benchmark/results");
const manifestText = await readFile(manifestPath, "utf8");
const selection = await readFile(selectionPath, "utf8")
  .then((text) => JSON.parse(text) as Record<string, unknown>)
  .catch(() => null);
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
if (!session.inputNames.includes(MODEL_SPEC.inputName) || !session.outputNames.includes(candidateSpec.outputName)) {
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
  if (candidateSpec.patchGrid) {
    let patchSource = sharp(originalBytes).toColourspace("srgb").removeAlpha();
    const metadata = await patchSource.metadata();
    if (!metadata.width || !metadata.height) throw new Error(`Missing dimensions for ${item.id}`);
    if (Math.min(metadata.width, metadata.height) < 256) {
      patchSource = patchSource.resize(256, 256, { fit: "outside", kernel: "linear" });
    }
    const decoded = await patchSource.raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.channels !== 3) throw new Error(`Expected RGB image for ${item.id}`);
    const gridSize = candidateSpec.patchGrid;
    const patchArea = candidateSpec.inputSize * candidateSpec.inputSize;
    const patchCount = gridSize * gridSize;
    const input = new Float32Array(patchCount * patchArea * 3);
    let patchIndex = 0;
    for (let gridY = 0; gridY < gridSize; gridY += 1) {
      const top = Math.round(gridY * (decoded.info.height - candidateSpec.inputSize) / (gridSize - 1));
      for (let gridX = 0; gridX < gridSize; gridX += 1) {
        const left = Math.round(gridX * (decoded.info.width - candidateSpec.inputSize) / (gridSize - 1));
        for (let y = 0; y < candidateSpec.inputSize; y += 1) {
          for (let x = 0; x < candidateSpec.inputSize; x += 1) {
            const pixel = ((top + y) * decoded.info.width + left + x) * 3;
            const target = y * candidateSpec.inputSize + x;
            for (let channel = 0; channel < 3; channel += 1) {
              input[patchIndex * patchArea * 3 + channel * patchArea + target] =
                (decoded.data[pixel + channel]! / 255 - candidateSpec.mean[channel]!) / candidateSpec.std[channel]!;
            }
          }
        }
        patchIndex += 1;
      }
    }
    const outputs = await session.run({
      [MODEL_SPEC.inputName]: new ort.Tensor("float32", input, [patchCount, 3, candidateSpec.inputSize, candidateSpec.inputSize]),
    });
    const output = outputs[candidateSpec.outputName];
    if (!output) throw new Error(`Missing model output for ${item.id}`);
    const logits = Array.from(output.data as Float32Array);
    const syntheticLogits = Array.from({ length: patchCount }, (_, index) => logits[index * 2 + 1]!);
    const meanLogit = syntheticLogits.reduce((sum, value) => sum + value, 0) / syntheticLogits.length;
    const rawAiLikelihood = 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, meanLogit))));
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
    if ((index + 1) % 10 === 0 || index + 1 === items.length) console.log(`Evaluated ${index + 1}/${items.length}`);
    continue;
  }
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
        const padded = await source
          .extend({
            left: leftPad,
            right: padWidth - leftPad,
            top: topPad,
            bottom: padHeight - topPad,
            background: { r: 0, g: 0, b: 0 },
          })
          .raw()
          .toBuffer({ resolveWithObject: true });
        return sharp(padded.data, { raw: padded.info })
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
  const output = outputs[candidateSpec.outputName];
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
        method: calibration!.method ?? "Platt scaling over raw probability logits",
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
    sampleMethod: "lowest SHA-256 priorities within the scanned row universe, stratified by source",
    selection,
    diagnosticSubset: realLimit > 0 ? { realLimit, perGeneratorLimit } : null,
  },
  metrics,
};
const summaryPath = path.join(resultDirectory, `${candidate}-${split}.json`);
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
