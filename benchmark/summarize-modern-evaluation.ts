import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MODEL_SPEC } from "../src/shared/model-spec";
import type { BenchmarkMetrics } from "./metrics";

const variants = ["original", "screenshot", "social-q75", "social-heavy"] as const;

interface RunSummary {
  executedAt: string;
  runtime: Record<string, unknown>;
  model: { id: string; sha256: string; bytes: number };
  calibration: { slope: number; intercept: number; sha256: string } | null;
  dataset: { manifest: string; manifestSha256: string; split: string };
  metrics: BenchmarkMetrics;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readRun(name: string): Promise<RunSummary & { reportSha256: string }> {
  const text = await readFile(path.resolve(`benchmark/results/${name}.json`), "utf8");
  const run = JSON.parse(text) as RunSummary;
  if (run.model.sha256 !== MODEL_SPEC.weightsSha256 || run.model.bytes !== MODEL_SPEC.weightsBytes) {
    throw new Error(`${name} used the wrong model`);
  }
  if (!run.calibration || run.calibration.slope !== MODEL_SPEC.calibration.slope || run.calibration.intercept !== MODEL_SPEC.calibration.intercept) {
    throw new Error(`${name} used the wrong calibration`);
  }
  return { ...run, reportSha256: sha256(text) };
}

const testRuns = await Promise.all(variants.map((variant) => readRun(`community-forensics-rehead-v2-modern-test-${variant}`)));
const legacyRuns = await Promise.all(variants.map((variant) => readRun(`frontier-rehead-v2-${variant}`)));
const testMetrics = Object.fromEntries(variants.map((variant, index) => [variant, testRuns[index]!.metrics]));
const legacyMetrics = Object.fromEntries(variants.map((variant, index) => [variant, legacyRuns[index]!.metrics]));
const testPassed = testRuns.every((run) => (
  run.metrics.balancedAccuracy >= 0.75
  && run.metrics.trueRealRate >= 0.85
  && run.metrics.trueSyntheticRate >= 0.70
  && run.metrics.bySource.filter((source) => source.source !== "open-images").every((source) => source.accuracy >= 0.60)
));

const calibrationText = await readFile("benchmark/candidates/community_forensics_rehead_v2/calibration.json", "utf8");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  threshold: 0.65,
  model: {
    id: MODEL_SPEC.id,
    sha256: MODEL_SPEC.weightsSha256,
    bytes: MODEL_SPEC.weightsBytes,
    calibration: MODEL_SPEC.calibration,
    calibrationSha256: sha256(calibrationText),
  },
  modernTest: {
    scoreBlind: true,
    description: "Sample-disjoint test frozen after model and calibration; synthetic generator families were held out from training but appeared in calibration validation",
    countPerVariant: testRuns[0]!.metrics.count,
    manifestSha256: testRuns[0]!.dataset.manifestSha256,
    passedFrozenGates: testPassed,
    gates: {
      minimumBalancedAccuracy: 0.75,
      minimumRealRecall: 0.85,
      minimumSyntheticRecall: 0.70,
      minimumPerGeneratorRecall: 0.60,
    },
    metrics: testMetrics,
    reportSha256: Object.fromEntries(variants.map((variant, index) => [variant, testRuns[index]!.reportSha256])),
  },
  exposedLegacyRegression: {
    scoreBlind: false,
    description: "Previously exposed OpenFake/Qwen/Synthbuster audit retained as regression evidence; it was not used for v2 calibration or the modern test claim",
    countPerVariant: legacyRuns[0]!.metrics.count,
    metrics: legacyMetrics,
    reportSha256: Object.fromEntries(variants.map((variant, index) => [variant, legacyRuns[index]!.reportSha256])),
  },
  caveat: "These are project evaluation results, not the bounty maintainers' private benchmark result.",
};
await writeFile("benchmark/results/modern-evaluation.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ testPassed, model: report.model, modernTest: testMetrics }, null, 2));
