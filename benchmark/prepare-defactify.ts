import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFACTIFY, DEFAULT_SAMPLE } from "./config";
import type { BenchmarkItem } from "./types";

interface DatasetRow {
  row_idx: number;
  row: {
    Image: { src: string; height: number; width: number };
    Label_A: number;
    Label_B: number;
  };
}

interface RowsResponse {
  rows: DatasetRow[];
  num_rows_total: number;
}

interface Candidate extends DatasetRow {
  priority: string;
}

function argument(name: string, fallback: number | string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : String(fallback);
}

const split = argument("split", DEFAULT_SAMPLE.split);
const realTarget = Number(argument("real", DEFAULT_SAMPLE.real));
const syntheticTarget = Number(argument("per-generator", DEFAULT_SAMPLE.perSyntheticSource));
const scanLimit = Number(argument("scan-limit", Number.MAX_SAFE_INTEGER));
if (!Number.isInteger(realTarget) || !Number.isInteger(syntheticTarget) || realTarget <= 0 || syntheticTarget <= 0) {
  throw new Error("Sample counts must be positive integers");
}
if (!Number.isInteger(scanLimit) || scanLimit <= 0) throw new Error("Scan limit must be a positive integer");

const targets = new Map<number, number>([[0, realTarget], ...[1, 2, 3, 4, 5].map((source) => [source, syntheticTarget] as const)]);
const selected = new Map<number, Candidate[]>([...targets.keys()].map((source) => [source, []]));
const rowsEndpoint = "https://datasets-server.huggingface.co/rows";

async function fetchWithRetry(url: string | URL, attempts = 8): Promise<Response> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) return response;
    lastStatus = response.status;
    if (response.status !== 429 && response.status < 500) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 30_000)
      : Math.min(1000 * 2 ** attempt, 30_000);
    console.log(`HTTP ${response.status}; retrying in ${delayMs}ms (${attempt + 1}/${attempts})`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Request failed after ${attempts} attempts (last HTTP ${lastStatus})`);
}

function consider(candidate: DatasetRow): void {
  const target = targets.get(candidate.row.Label_B);
  const group = selected.get(candidate.row.Label_B);
  if (!target || !group) return;
  const priority = createHash("sha256")
    .update(`${DEFACTIFY.revision}:${split}:${candidate.row_idx}`)
    .digest("hex");
  group.push({ ...candidate, priority });
  group.sort((left, right) => left.priority.localeCompare(right.priority));
  if (group.length > target) group.pop();
}

let offset = 0;
let total = Number.POSITIVE_INFINITY;
while (offset < total && offset < scanLimit) {
  const url = new URL(rowsEndpoint);
  url.searchParams.set("dataset", DEFACTIFY.dataset);
  url.searchParams.set("config", DEFACTIFY.config);
  url.searchParams.set("split", split);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", String(Math.min(100, scanLimit - offset)));
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`Dataset rows request failed with HTTP ${response.status}`);
  const page = (await response.json()) as RowsResponse;
  total = page.num_rows_total;
  page.rows.forEach(consider);
  offset += page.rows.length;
  if (page.rows.length === 0) break;
  if (offset % 1000 === 0 || offset >= total) console.log(`Scanned ${Math.min(offset, total)}/${total} ${split} rows`);
}

for (const [source, target] of targets) {
  const actual = selected.get(source)?.length ?? 0;
  if (actual !== target) throw new Error(`Source ${source} has ${actual} selected rows; expected ${target}`);
}

const outputDirectory = path.resolve(`benchmark/data/defactify-${split}`);
await mkdir(outputDirectory, { recursive: true });
const candidates = [...selected.values()].flat().sort((left, right) => left.row_idx - right.row_idx);
const manifest: BenchmarkItem[] = [];

async function download(candidate: Candidate): Promise<BenchmarkItem> {
  const source = DEFACTIFY.sourceNames[candidate.row.Label_B as keyof typeof DEFACTIFY.sourceNames];
  if (!source) throw new Error(`Unknown source label ${candidate.row.Label_B}`);
  if (!candidate.row.Image.src.includes(DEFACTIFY.revision)) {
    throw new Error(`Dataset server returned an unexpected revision for row ${candidate.row_idx}`);
  }
  const response = await fetchWithRetry(candidate.row.Image.src);
  if (!response.ok) throw new Error(`Image ${candidate.row_idx} failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const imageSha256 = createHash("sha256").update(bytes).digest("hex");
  const relativePath = `${source}/${candidate.row_idx}.image`;
  const absolutePath = path.join(outputDirectory, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return {
    id: `defactify:${DEFACTIFY.revision}:${split}:${candidate.row_idx}`,
    dataset: DEFACTIFY.dataset,
    datasetRevision: DEFACTIFY.revision,
    split,
    rowIndex: candidate.row_idx,
    path: relativePath,
    imageSha256,
    label: candidate.row.Label_A === 1 ? 1 : 0,
    source,
  };
}

const concurrency = 8;
for (let index = 0; index < candidates.length; index += concurrency) {
  const batch = candidates.slice(index, index + concurrency);
  manifest.push(...(await Promise.all(batch.map(download))));
  console.log(`Downloaded ${Math.min(index + batch.length, candidates.length)}/${candidates.length} images`);
}

manifest.sort((left, right) => left.rowIndex - right.rowIndex);
await writeFile(
  path.join(outputDirectory, "manifest.jsonl"),
  `${manifest.map((item) => JSON.stringify(item)).join("\n")}\n`,
);
console.log(`Wrote ${manifest.length} verified records to ${path.join(outputDirectory, "manifest.jsonl")}`);
