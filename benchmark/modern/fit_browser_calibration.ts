import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prediction } from "../types";

const variants = ["original", "screenshot", "social-q75", "social-heavy"] as const;

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function logit(probability: number): number {
  return Math.log(probability / (1 - probability));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface RunSummary {
  model: { sha256: string; bytes: number; id: string };
  dataset: { manifest: string; manifestSha256: string };
}

interface VariantMetrics {
  balancedAccuracy: number;
  realRecall: number;
  syntheticRecall: number;
  syntheticRecallBySource: Record<string, number>;
}

function metrics(predictions: readonly Prediction[], threshold: number): VariantMetrics {
  const real = predictions.filter((prediction) => prediction.label === 0);
  const synthetic = predictions.filter((prediction) => prediction.label === 1);
  const realRecall = real.filter((prediction) => (prediction.rawAiLikelihood ?? prediction.aiLikelihood) < threshold).length / real.length;
  const syntheticRecall = synthetic.filter((prediction) => (prediction.rawAiLikelihood ?? prediction.aiLikelihood) >= threshold).length / synthetic.length;
  const sources = [...new Set(synthetic.map((prediction) => prediction.source))].sort();
  return {
    balancedAccuracy: (realRecall + syntheticRecall) / 2,
    realRecall,
    syntheticRecall,
    syntheticRecallBySource: Object.fromEntries(sources.map((source) => {
      const group = synthetic.filter((prediction) => prediction.source === source);
      return [source, group.filter((prediction) => (prediction.rawAiLikelihood ?? prediction.aiLikelihood) >= threshold).length / group.length];
    })),
  };
}

const prefix = argument("result-prefix", "community-forensics-rehead-v2-modern-validation");
const outputPath = path.resolve(argument("output", "benchmark/candidates/community_forensics_rehead_v2/calibration.json"));
const resultDirectory = path.resolve("benchmark/results");
const runs = await Promise.all(variants.map(async (variant) => {
  const resultName = `${prefix}-${variant}`;
  const [summaryText, predictionsText] = await Promise.all([
    readFile(path.join(resultDirectory, `${resultName}.json`), "utf8"),
    readFile(path.join(resultDirectory, `${resultName}-predictions.jsonl`), "utf8"),
  ]);
  const summary = JSON.parse(summaryText) as RunSummary;
  if (!summary.dataset.manifest.includes("modern-validation") && !summary.dataset.manifest.includes("validation-manifest")) {
    throw new Error(`${variant} is not a modern validation run: ${summary.dataset.manifest}`);
  }
  return {
    variant,
    summary,
    summarySha256: sha256(summaryText),
    predictions: predictionsText.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Prediction),
  };
}));

const modelHashes = new Set(runs.map((run) => run.summary.model.sha256));
if (modelHashes.size !== 1) throw new Error("Validation runs do not use the same model");
const values = runs.flatMap((run) => run.predictions.map((prediction) => prediction.rawAiLikelihood ?? prediction.aiLikelihood));
const thresholds = [...new Set(values)].sort((left, right) => left - right);
let best: {
  threshold: number;
  key: readonly number[];
  byVariant: Record<string, VariantMetrics>;
} | undefined;
for (const threshold of thresholds) {
  const byVariant = Object.fromEntries(runs.map((run) => [run.variant, metrics(run.predictions, threshold)]));
  const variantMetrics = Object.values(byVariant);
  const sourceRecalls = variantMetrics.flatMap((variant) => Object.values(variant.syntheticRecallBySource));
  const passes = variantMetrics.every((variant) => (
    variant.balancedAccuracy >= 0.75
    && variant.realRecall >= 0.85
    && variant.syntheticRecall >= 0.70
  )) && sourceRecalls.every((recall) => recall >= 0.60);
  if (!passes) continue;
  const balancedAccuracies = variantMetrics.map((variant) => variant.balancedAccuracy);
  const key = [
    Math.min(...balancedAccuracies),
    balancedAccuracies.reduce((sum, value) => sum + value, 0) / balancedAccuracies.length,
    Math.min(...variantMetrics.map((variant) => variant.realRecall)),
    Math.min(...sourceRecalls),
  ] as const;
  if (!best || key.some((value, index) => value !== best!.key[index] && value > best!.key[index]! && key.slice(0, index).every((prior, priorIndex) => prior === best!.key[priorIndex]))) {
    best = { threshold, key, byVariant };
  }
}
if (!best) {
  throw new Error("No browser threshold satisfies the frozen accuracy and recall gates");
}

const displayThreshold = 0.65;
const calibration = {
  schemaVersion: 1,
  method: "Exact ONNX Runtime Web validation with frozen accuracy, class-recall, and per-generator gates",
  slope: 1,
  intercept: logit(displayThreshold) - logit(best.threshold),
  modelSha256: [...modelHashes][0],
  rawProbabilityThreshold: best.threshold,
  displayThreshold,
  gates: {
    minimumBalancedAccuracy: 0.75,
    minimumRealRecall: 0.85,
    minimumSyntheticRecall: 0.70,
    minimumPerGeneratorRecall: 0.60,
  },
  validation: {
    resultPrefix: prefix,
    summaries: Object.fromEntries(runs.map((run) => [run.variant, {
      sha256: run.summarySha256,
      manifest: run.summary.dataset.manifest,
      manifestSha256: run.summary.dataset.manifestSha256,
    }])),
    metrics: best.byVariant,
  },
};
await writeFile(outputPath, `${JSON.stringify(calibration, null, 2)}\n`);
console.log(JSON.stringify(calibration, null, 2));
