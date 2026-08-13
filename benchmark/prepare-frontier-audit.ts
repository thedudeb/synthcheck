import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FRONTIER_AUDIT } from "./frontier-config";
import type { BenchmarkItem } from "./types";

interface OpenFakeRow {
  row_idx: number;
  row: {
    image: { src: string; height: number; width: number };
    label: "real" | "fake";
    model: string;
    type: string;
  };
}

interface RowsResponse {
  rows: OpenFakeRow[];
  num_rows_total: number;
}

interface FilterResponse extends RowsResponse {
  partial: boolean;
}

interface OpenFakeCandidate extends OpenFakeRow {
  priority: string;
  datasetSplit: string;
}

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  priority: string;
  rowIndex: number;
}

interface HuggingFaceTree {
  siblings: Array<{ rfilename: string }>;
}

const outputDirectory = path.resolve("benchmark/data/frontier-original");
const filterEndpoint = "https://datasets-server.huggingface.co/filter";
const targets: Record<string, number> = { ...FRONTIER_AUDIT.openFake.targets };
const sourceUniverseCounts: Record<string, number> = {};

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string | URL, init?: RequestInit, attempts = 10): Promise<Response> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(45_000) });
    } catch (error) {
      const delayMs = Math.min(750 * 2 ** attempt, 30_000);
      console.log(`Request timed out or failed (${error instanceof Error ? error.name : "network error"}); retrying in ${delayMs}ms (${attempt + 1}/${attempts})`);
      await delay(delayMs);
      continue;
    }
    if (response.ok) return response;
    lastStatus = response.status;
    if (response.status !== 429 && response.status < 500) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 30_000)
      : Math.min(750 * 2 ** attempt, 30_000);
    console.log(`HTTP ${response.status}; retrying in ${delayMs}ms (${attempt + 1}/${attempts})`);
    await delay(delayMs);
  }
  throw new Error(`Request failed after ${attempts} attempts (last HTTP ${lastStatus})`);
}

async function fetchOpenFakeSource(source: string, target: number, datasetSplit: string): Promise<OpenFakeCandidate[]> {
  const url = new URL(filterEndpoint);
  url.searchParams.set("dataset", FRONTIER_AUDIT.openFake.dataset);
  url.searchParams.set("config", FRONTIER_AUDIT.openFake.config);
  url.searchParams.set("split", datasetSplit);
  url.searchParams.set("where", `"model" = '${source}'`);
  url.searchParams.set("offset", "0");
  url.searchParams.set("length", String(target));
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`OpenFake filter for ${source} failed with HTTP ${response.status}`);
  const result = await response.json() as FilterResponse;
  sourceUniverseCounts[`${datasetSplit}:${source}`] = result.num_rows_total;
  if (result.rows.length !== target) {
    throw new Error(`OpenFake source ${source} returned ${result.rows.length} rows; expected ${target} of ${result.num_rows_total}`);
  }
  return result.rows.map((row) => {
    if (row.row.model !== source) throw new Error(`OpenFake filter returned ${row.row.model} while selecting ${source}`);
    return {
      ...row,
      priority: sha256(`${FRONTIER_AUDIT.openFake.revision}:${datasetSplit}:${source}:${row.row_idx}`),
      datasetSplit,
    };
  });
}

async function selectOpenFake(): Promise<OpenFakeCandidate[]> {
  const groups = [
    ...Object.entries(targets).map(([source, target]) => ({ source, target, datasetSplit: FRONTIER_AUDIT.openFake.split })),
  ];
  const candidates: OpenFakeCandidate[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    const batch = groups.slice(index, index + 1);
    const pages = await Promise.all(batch.map(({ source, target, datasetSplit }) => fetchOpenFakeSource(source, target, datasetSplit)));
    candidates.push(...pages.flat());
    console.log(`Selected ${Math.min(index + batch.length, groups.length)}/${groups.length} OpenFake source strata`);
  }
  return candidates.sort((left, right) => left.row_idx - right.row_idx);
}

async function selectQwenImagen(): Promise<Array<{ name: string; priority: string; rowIndex: number }>> {
  const url = `https://huggingface.co/api/datasets/${FRONTIER_AUDIT.qwenImageBench.dataset}/revision/${FRONTIER_AUDIT.qwenImageBench.revision}`;
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`Qwen Image Bench tree failed with HTTP ${response.status}`);
  const tree = await response.json() as HuggingFaceTree;
  const universe = tree.siblings
    .map((entry) => entry.rfilename)
    .filter((name) => name.startsWith(FRONTIER_AUDIT.qwenImageBench.directory) && name.endsWith(".png"))
    .sort();
  if (universe.length < FRONTIER_AUDIT.qwenImageBench.target) {
    throw new Error(`Qwen Image Bench contains only ${universe.length} Imagen 4 images`);
  }
  return universe.map((name, rowIndex) => ({
    name,
    rowIndex,
    priority: sha256(`${FRONTIER_AUDIT.qwenImageBench.revision}:${name}`),
  })).sort((left, right) => left.priority.localeCompare(right.priority))
    .slice(0, FRONTIER_AUDIT.qwenImageBench.target)
    .sort((left, right) => left.rowIndex - right.rowIndex);
}

async function downloadQwenImagen(candidate: { name: string; rowIndex: number }): Promise<BenchmarkItem> {
  const url = `https://huggingface.co/datasets/${FRONTIER_AUDIT.qwenImageBench.dataset}/resolve/${FRONTIER_AUDIT.qwenImageBench.revision}/${candidate.name}?download=true`;
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`Qwen Image Bench image ${candidate.name} failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const basename = path.basename(candidate.name);
  const relativePath = `qwen-image-bench/imagen-4/${basename}`;
  await mkdir(path.join(outputDirectory, path.dirname(relativePath)), { recursive: true });
  await writeFile(path.join(outputDirectory, relativePath), bytes);
  return {
    id: `qwen-image-bench:${FRONTIER_AUDIT.qwenImageBench.revision}:imagen-4:${basename}`,
    dataset: FRONTIER_AUDIT.qwenImageBench.dataset,
    datasetRevision: FRONTIER_AUDIT.qwenImageBench.revision,
    split: "original",
    rowIndex: candidate.rowIndex,
    path: relativePath,
    imageSha256: sha256(bytes),
    label: 1,
    source: FRONTIER_AUDIT.qwenImageBench.source,
  };
}

function safeSourceName(source: string): string {
  return source.replace(/[^a-z0-9._-]/gi, "-");
}

async function downloadOpenFake(candidate: OpenFakeCandidate): Promise<BenchmarkItem> {
  if (!candidate.row.image.src.includes(FRONTIER_AUDIT.openFake.revision)) {
    throw new Error(`OpenFake returned an unpinned asset for row ${candidate.row_idx}`);
  }
  const response = await fetchWithRetry(candidate.row.image.src);
  if (!response.ok) throw new Error(`OpenFake image ${candidate.row_idx} failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const relativePath = `openfake/${safeSourceName(candidate.row.model)}/${candidate.row_idx}.image`;
  await mkdir(path.join(outputDirectory, path.dirname(relativePath)), { recursive: true });
  await writeFile(path.join(outputDirectory, relativePath), bytes);
  return {
    id: `openfake:${FRONTIER_AUDIT.openFake.revision}:${candidate.datasetSplit}:${candidate.row_idx}`,
    dataset: FRONTIER_AUDIT.openFake.dataset,
    datasetRevision: FRONTIER_AUDIT.openFake.revision,
    split: "original",
    rowIndex: candidate.row_idx,
    path: relativePath,
    imageSha256: sha256(bytes),
    label: candidate.row.label === "fake" ? 1 : 0,
    source: candidate.row.model,
  };
}

async function fetchRange(url: string, start: number, end: number): Promise<Buffer> {
  const response = await fetchWithRetry(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (response.status !== 206) throw new Error(`Expected HTTP 206 for byte range ${start}-${end}, received ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength !== end - start + 1) {
    throw new Error(`Range ${start}-${end} returned ${bytes.byteLength} bytes`);
  }
  return bytes;
}

function findSignature(bytes: Buffer, signature: number): number {
  for (let offset = bytes.byteLength - 4; offset >= 0; offset -= 1) {
    if (bytes.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

function safeUint64(bytes: Buffer, offset: number): number {
  const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`ZIP64 value exceeds JavaScript safe integer: ${value}`);
  return Number(value);
}

function zip64Values(
  extra: Buffer,
  needsUncompressed: boolean,
  needsCompressed: boolean,
  needsOffset: boolean,
): { uncompressed?: number; compressed?: number; offset?: number } {
  let cursor = 0;
  while (cursor + 4 <= extra.byteLength) {
    const id = extra.readUInt16LE(cursor);
    const length = extra.readUInt16LE(cursor + 2);
    const valueStart = cursor + 4;
    if (id === 0x0001) {
      let valueCursor = valueStart;
      const result: { uncompressed?: number; compressed?: number; offset?: number } = {};
      if (needsUncompressed) {
        result.uncompressed = safeUint64(extra, valueCursor);
        valueCursor += 8;
      }
      if (needsCompressed) {
        result.compressed = safeUint64(extra, valueCursor);
        valueCursor += 8;
      }
      if (needsOffset) result.offset = safeUint64(extra, valueCursor);
      return result;
    }
    cursor = valueStart + length;
  }
  throw new Error("Missing ZIP64 extended information");
}

async function readSynthbusterDirectory(): Promise<ZipEntry[]> {
  const url = FRONTIER_AUDIT.synthbuster.archiveUrl;
  const tailLength = 131_072;
  const tailStart = FRONTIER_AUDIT.synthbuster.archiveBytes - tailLength;
  const tail = await fetchRange(url, tailStart, FRONTIER_AUDIT.synthbuster.archiveBytes - 1);
  const eocdOffset = findSignature(tail, 0x06054b50);
  if (eocdOffset < 20) throw new Error("Could not locate ZIP end-of-central-directory record");
  const locatorOffset = eocdOffset - 20;
  if (tail.readUInt32LE(locatorOffset) !== 0x07064b50) throw new Error("Could not locate ZIP64 locator");
  const zip64EocdOffset = safeUint64(tail, locatorOffset + 8);
  const zip64Eocd = await fetchRange(url, zip64EocdOffset, zip64EocdOffset + 55);
  if (zip64Eocd.readUInt32LE(0) !== 0x06064b50) throw new Error("Invalid ZIP64 end-of-central-directory record");
  const centralSize = safeUint64(zip64Eocd, 40);
  const centralOffset = safeUint64(zip64Eocd, 48);
  const central = await fetchRange(url, centralOffset, centralOffset + centralSize - 1);
  const entries: ZipEntry[] = [];
  let cursor = 0;
  while (cursor + 46 <= central.byteLength) {
    if (central.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`Invalid central-directory entry at ${cursor}`);
    const compression = central.readUInt16LE(cursor + 10);
    const compressed32 = central.readUInt32LE(cursor + 20);
    const uncompressed32 = central.readUInt32LE(cursor + 24);
    const nameLength = central.readUInt16LE(cursor + 28);
    const extraLength = central.readUInt16LE(cursor + 30);
    const commentLength = central.readUInt16LE(cursor + 32);
    const offset32 = central.readUInt32LE(cursor + 42);
    const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const extra = central.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
    const values = compressed32 === 0xffffffff || uncompressed32 === 0xffffffff || offset32 === 0xffffffff
      ? zip64Values(extra, uncompressed32 === 0xffffffff, compressed32 === 0xffffffff, offset32 === 0xffffffff)
      : {};
    if (/^synthbuster\/firefly\/[^/]+\.png$/i.test(name)) {
      entries.push({
        name,
        compression,
        compressedSize: values.compressed ?? compressed32,
        uncompressedSize: values.uncompressed ?? uncompressed32,
        localHeaderOffset: values.offset ?? offset32,
        priority: sha256(`${FRONTIER_AUDIT.synthbuster.record}:${FRONTIER_AUDIT.synthbuster.revision}:${name}`),
        rowIndex: 0,
      });
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  entries.forEach((entry, index) => { entry.rowIndex = index; });
  return entries;
}

async function downloadSynthbusterEntry(entry: ZipEntry): Promise<BenchmarkItem> {
  const url = FRONTIER_AUDIT.synthbuster.archiveUrl;
  const header = await fetchRange(url, entry.localHeaderOffset, entry.localHeaderOffset + 29);
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`Invalid local ZIP header for ${entry.name}`);
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = await fetchRange(url, dataStart, dataStart + entry.compressedSize - 1);
  const bytes = entry.compression === 0
    ? compressed
    : entry.compression === 8
    ? inflateRawSync(compressed)
    : (() => { throw new Error(`Unsupported ZIP compression method ${entry.compression}`); })();
  if (bytes.byteLength !== entry.uncompressedSize) throw new Error(`Unexpected size for ${entry.name}`);
  const basename = path.basename(entry.name);
  const relativePath = `synthbuster/firefly/${basename}`;
  await mkdir(path.join(outputDirectory, path.dirname(relativePath)), { recursive: true });
  await writeFile(path.join(outputDirectory, relativePath), bytes);
  return {
    id: `synthbuster:${FRONTIER_AUDIT.synthbuster.record}:firefly:${basename}`,
    dataset: FRONTIER_AUDIT.synthbuster.dataset,
    datasetRevision: FRONTIER_AUDIT.synthbuster.revision,
    split: "original",
    rowIndex: entry.rowIndex,
    path: relativePath,
    imageSha256: sha256(bytes),
    label: 1,
    source: FRONTIER_AUDIT.synthbuster.source,
  };
}

async function batched<T, U>(items: readonly T[], concurrency: number, action: (item: T) => Promise<U>, label: string): Promise<U[]> {
  const results: U[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...await Promise.all(batch.map(action)));
    console.log(`${label} ${Math.min(index + batch.length, items.length)}/${items.length}`);
  }
  return results;
}

await mkdir(outputDirectory, { recursive: true });
const openFakeCandidates = await selectOpenFake();
const openFakeItems = await batched(openFakeCandidates, 8, downloadOpenFake, "Downloaded OpenFake");

const qwenImagenCandidates = await selectQwenImagen();
const qwenImagenItems = await batched(qwenImagenCandidates, 4, downloadQwenImagen, "Downloaded Qwen Imagen 4");

const fireflyUniverse = await readSynthbusterDirectory();
if (fireflyUniverse.length < FRONTIER_AUDIT.synthbuster.target) {
  throw new Error(`Synthbuster contains only ${fireflyUniverse.length} Firefly images`);
}
const fireflyCandidates = [...fireflyUniverse]
  .sort((left, right) => left.priority.localeCompare(right.priority))
  .slice(0, FRONTIER_AUDIT.synthbuster.target)
  .sort((left, right) => left.rowIndex - right.rowIndex);
const fireflyItems = await batched(fireflyCandidates, 4, downloadSynthbusterEntry, "Downloaded Firefly");

const manifest = [...openFakeItems, ...qwenImagenItems, ...fireflyItems].sort((left, right) => left.id.localeCompare(right.id));
await writeFile(
  path.join(outputDirectory, "manifest.jsonl"),
  `${manifest.map((item) => JSON.stringify(item)).join("\n")}\n`,
);
await writeFile(
  path.join(outputDirectory, "selection.json"),
  `${JSON.stringify({
    schemaVersion: FRONTIER_AUDIT.schemaVersion,
    frozenAt: FRONTIER_AUDIT.frozenAt,
    scoreBlind: true,
    threshold: FRONTIER_AUDIT.threshold,
    strategy: FRONTIER_AUDIT.sampleStrategy,
    openFake: {
      dataset: FRONTIER_AUDIT.openFake.dataset,
      revision: FRONTIER_AUDIT.openFake.revision,
      split: FRONTIER_AUDIT.openFake.split,
      totalRows: FRONTIER_AUDIT.openFake.totalRows,
      sourceUniverseCounts,
      targets: FRONTIER_AUDIT.openFake.targets,
      license: FRONTIER_AUDIT.openFake.license,
    },
    qwenImageBench: {
      dataset: FRONTIER_AUDIT.qwenImageBench.dataset,
      revision: FRONTIER_AUDIT.qwenImageBench.revision,
      source: FRONTIER_AUDIT.qwenImageBench.source,
      target: FRONTIER_AUDIT.qwenImageBench.target,
      license: FRONTIER_AUDIT.qwenImageBench.license,
    },
    synthbuster: {
      record: FRONTIER_AUDIT.synthbuster.record,
      revision: FRONTIER_AUDIT.synthbuster.revision,
      archiveBytes: FRONTIER_AUDIT.synthbuster.archiveBytes,
      archiveMd5: FRONTIER_AUDIT.synthbuster.archiveMd5,
      fireflyUniverse: fireflyUniverse.length,
      target: FRONTIER_AUDIT.synthbuster.target,
      license: FRONTIER_AUDIT.synthbuster.license,
    },
  }, null, 2)}\n`,
);
console.log(`Wrote ${manifest.length} score-blind audit records to ${outputDirectory}`);
