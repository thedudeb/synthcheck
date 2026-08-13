import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { MODEL_SPEC } from "../src/shared/model-spec";

const modelDirectory = path.resolve("benchmark/models");
const modelPath = path.join(modelDirectory, "detector.onnx");
const temporaryPath = `${modelPath}.partial`;

async function digest(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

await mkdir(modelDirectory, { recursive: true });
try {
  const existing = await stat(modelPath);
  if (existing.size === MODEL_SPEC.weightsBytes && (await digest(modelPath)) === MODEL_SPEC.weightsSha256) {
    console.log(`Verified existing model: ${modelPath}`);
    process.exit(0);
  }
} catch {
  // Missing or invalid model is replaced below.
}

const response = await fetch(MODEL_SPEC.weightsUrl, { redirect: "follow" });
if (!response.ok || !response.body) throw new Error(`Model download failed with HTTP ${response.status}`);
await writeFile(temporaryPath, Buffer.from(await response.arrayBuffer()));
const downloaded = await stat(temporaryPath);
const hash = await digest(temporaryPath);
if (downloaded.size !== MODEL_SPEC.weightsBytes || hash !== MODEL_SPEC.weightsSha256) {
  await unlink(temporaryPath).catch(() => undefined);
  throw new Error(`Model integrity mismatch: ${downloaded.size} bytes, SHA-256 ${hash}`);
}
await rename(temporaryPath, modelPath);
console.log(`Downloaded and verified ${MODEL_SPEC.id} (${downloaded.size} bytes)`);
