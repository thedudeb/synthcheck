import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AI_THRESHOLD } from "../src/shared/contracts";
import { MODEL_SPEC } from "../src/shared/model-spec";
import type { BenchmarkMetrics } from "./metrics";
import { FRONTIER_AUDIT } from "./frontier-config";

interface RunSummary {
  executedAt: string;
  model: { id: string; sha256: string; bytes: number };
  calibration: { slope: number; intercept: number } | null;
  dataset: { manifest: string; manifestSha256: string; selection: unknown };
  metrics: BenchmarkMetrics;
}

const variants = ["original", "screenshot", "social-q75", "social-heavy"] as const;
const summaries = await Promise.all(variants.map(async (variant) => {
  const file = path.resolve(`benchmark/results/frontier-${variant}.json`);
  const text = await readFile(file, "utf8");
  return { variant, file: path.relative(process.cwd(), file), sha256: createHash("sha256").update(text).digest("hex"), run: JSON.parse(text) as RunSummary };
}));

for (const summary of summaries) {
  if (summary.run.model.sha256 !== MODEL_SPEC.weightsSha256) throw new Error(`${summary.variant} used the wrong model`);
  if (summary.run.metrics.threshold !== AI_THRESHOLD) throw new Error(`${summary.variant} used the wrong threshold`);
  if (!summary.run.calibration || summary.run.calibration.slope !== MODEL_SPEC.calibration.slope || summary.run.calibration.intercept !== MODEL_SPEC.calibration.intercept) {
    throw new Error(`${summary.variant} used the wrong calibration`);
  }
}

const original = summaries[0]!.run.metrics;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  auditFrozenAt: FRONTIER_AUDIT.frozenAt,
  scoreBlindSelection: true,
  model: {
    id: MODEL_SPEC.id,
    sha256: MODEL_SPEC.weightsSha256,
    threshold: AI_THRESHOLD,
    calibration: MODEL_SPEC.calibration,
    frozenBeforeAudit: true,
  },
  sources: {
    openFake: {
      dataset: FRONTIER_AUDIT.openFake.dataset,
      revision: FRONTIER_AUDIT.openFake.revision,
      split: FRONTIER_AUDIT.openFake.split,
      license: FRONTIER_AUDIT.openFake.license,
    },
    qwenImageBench: {
      dataset: FRONTIER_AUDIT.qwenImageBench.dataset,
      revision: FRONTIER_AUDIT.qwenImageBench.revision,
      license: FRONTIER_AUDIT.qwenImageBench.license,
    },
    synthbuster: {
      dataset: FRONTIER_AUDIT.synthbuster.dataset,
      record: FRONTIER_AUDIT.synthbuster.record,
      archiveMd5: FRONTIER_AUDIT.synthbuster.archiveMd5,
      license: FRONTIER_AUDIT.synthbuster.license,
    },
  },
  variants: summaries.map(({ variant, file, sha256, run }) => ({
    variant,
    transform: variant === "original"
      ? FRONTIER_AUDIT.transforms.original
      : variant === "screenshot"
      ? FRONTIER_AUDIT.transforms.screenshot
      : variant === "social-q75"
      ? FRONTIER_AUDIT.transforms.socialQ75
      : FRONTIER_AUDIT.transforms.socialHeavy,
    run: file,
    runSha256: sha256,
    balancedAccuracy: run.metrics.balancedAccuracy,
    deltaFromOriginal: run.metrics.balancedAccuracy - original.balancedAccuracy,
    trueRealRate: run.metrics.trueRealRate,
    trueSyntheticRate: run.metrics.trueSyntheticRate,
    count: run.metrics.count,
    bySource: run.metrics.bySource,
  })),
  limitations: [
    "OpenFake's core test split is an independent OOD benchmark but focuses on politically and socially salient imagery.",
    "The audit was not used to tune SynthCheck, but complete non-overlap with the upstream Community Forensics model's training data cannot be proven for older Firefly or real-image sources.",
    "Google's 50-image family stratum combines all 19 Nano Banana Pro images available in OpenFake test with 31 Imagen 4 images from the independently pinned Qwen Image Bench.",
    "Synthbuster's Adobe Firefly subset is from the 2023 dataset release and does not represent every later Firefly version.",
    "The screenshot transform is a deterministic Chrome-rendered social-post frame, not a sample from every device or platform.",
    "No model, calibration, threshold, or sample membership was changed after observing scores.",
  ],
};
await writeFile("benchmark/results/frontier-audit.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
