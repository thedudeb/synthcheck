import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prediction } from "./types";

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clampProbability(value: number): number {
  return Math.min(1 - 1e-7, Math.max(1e-7, value));
}

function logit(value: number): number {
  const probability = clampProbability(value);
  return Math.log(probability / (1 - probability));
}

function sigmoid(value: number): number {
  const bounded = Math.max(-40, Math.min(40, value));
  return 1 / (1 + Math.exp(-bounded));
}

function logLoss(rows: readonly Prediction[], slope: number, intercept: number): number {
  return rows.reduce((sum, row) => {
    const probability = clampProbability(sigmoid(slope * logit(row.aiLikelihood) + intercept));
    return sum - row.label * Math.log(probability) - (1 - row.label) * Math.log(1 - probability);
  }, 0) / rows.length;
}

const predictionsPath = path.resolve(argument("predictions"));
const outputPath = path.resolve(argument("output"));
const modelSha256 = argument("model-sha256");
const predictionText = await readFile(predictionsPath, "utf8");
const rows = predictionText.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Prediction);
if (rows.length === 0) throw new Error("Calibration input is empty");
if (new Set(rows.map((row) => row.split)).size !== 1 || rows[0]!.split !== "validation") {
  throw new Error("Platt calibration must be fitted on the validation split only");
}

let slope = 1;
let intercept = 0;
const regularization = 1e-6;
let iterations = 0;
for (; iterations < 50; iterations += 1) {
  let gradientSlope = regularization * slope;
  let gradientIntercept = 0;
  let hessianSlope = regularization;
  let hessianIntercept = regularization;
  let hessianCross = 0;
  for (const row of rows) {
    const input = logit(row.aiLikelihood);
    const probability = sigmoid(slope * input + intercept);
    const residual = probability - row.label;
    const weight = probability * (1 - probability);
    gradientSlope += residual * input;
    gradientIntercept += residual;
    hessianSlope += weight * input * input;
    hessianIntercept += weight;
    hessianCross += weight * input;
  }
  const determinant = hessianSlope * hessianIntercept - hessianCross * hessianCross;
  if (Math.abs(determinant) < 1e-12) throw new Error("Calibration Hessian is singular");
  const deltaSlope = (hessianIntercept * gradientSlope - hessianCross * gradientIntercept) / determinant;
  const deltaIntercept = (-hessianCross * gradientSlope + hessianSlope * gradientIntercept) / determinant;
  slope -= deltaSlope;
  intercept -= deltaIntercept;
  if (Math.max(Math.abs(deltaSlope), Math.abs(deltaIntercept)) < 1e-8) break;
}
if (!(slope > 0) || !Number.isFinite(intercept)) throw new Error("Calibration fit is not monotonic");

const result = {
  schemaVersion: 1,
  method: "Platt scaling over raw probability logits",
  slope,
  intercept,
  fittedOn: {
    split: "validation",
    count: rows.length,
    predictions: path.relative(process.cwd(), predictionsPath),
    predictionsSha256: sha256(predictionText),
  },
  modelSha256,
  objective: "unweighted binary cross-entropy",
  regularization,
  iterations: iterations + 1,
  logLossBefore: logLoss(rows, 1, 0),
  logLossAfter: logLoss(rows, slope, intercept),
  note: "Freeze these parameters before evaluating any test or external dataset.",
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
