import * as ort from "onnxruntime-web";
import { AI_THRESHOLD, type InferenceResult, type InferenceSource, type ModelStatus } from "../shared/contracts";
import { sha256Hex } from "../shared/hash";
import { MODEL_SPEC } from "../shared/model-spec";
import { readStoredModel, storeModel } from "../shared/storage";
import { imageDataToNormalizedChw, softmaxSynthetic } from "./preprocess";

interface SetupProgress {
  downloadedBytes: number;
  totalBytes: number;
}

type ProgressCallback = (progress: SetupProgress) => void;

export class BrowserDetector {
  private session: ort.InferenceSession | undefined;
  private loading: Promise<ort.InferenceSession> | undefined;
  private status: ModelStatus = {
    state: "not-installed",
    modelId: MODEL_SPEC.id,
    downloadedBytes: 0,
    totalBytes: MODEL_SPEC.weightsBytes,
  };

  constructor() {
    ort.env.wasm.wasmPaths = chrome.runtime.getURL("ort/");
    ort.env.wasm.numThreads = 1;
  }

  async getStatus(): Promise<ModelStatus> {
    const record = await readStoredModel();
    if (record?.modelId === MODEL_SPEC.id && record.sha256 === MODEL_SPEC.weightsSha256) {
      this.status = {
        state: "ready",
        modelId: MODEL_SPEC.id,
        downloadedBytes: record.bytes.byteLength,
        totalBytes: MODEL_SPEC.weightsBytes,
      };
    }
    return this.status;
  }

  async install(onProgress: ProgressCallback): Promise<ModelStatus> {
    const existing = await readStoredModel();
    if (existing?.modelId === MODEL_SPEC.id && existing.sha256 === MODEL_SPEC.weightsSha256) {
      this.status = {
        state: "ready",
        modelId: MODEL_SPEC.id,
        downloadedBytes: existing.bytes.byteLength,
        totalBytes: MODEL_SPEC.weightsBytes,
      };
      return this.status;
    }

    this.status = {
      state: "downloading",
      modelId: MODEL_SPEC.id,
      downloadedBytes: 0,
      totalBytes: MODEL_SPEC.weightsBytes,
    };

    try {
      const response = await fetch(MODEL_SPEC.weightsUrl, { cache: "no-store", credentials: "omit" });
      if (!response.ok || !response.body) throw new Error(`Model download failed with HTTP ${response.status}`);
      const advertisedLength = Number(response.headers.get("content-length")) || MODEL_SPEC.weightsBytes;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let downloadedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        downloadedBytes += value.byteLength;
        onProgress({ downloadedBytes, totalBytes: advertisedLength });
      }

      const modelBytes = new Uint8Array(downloadedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        modelBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }

      const actualHash = await sha256Hex(modelBytes.buffer);
      if (actualHash !== MODEL_SPEC.weightsSha256) {
        throw new Error(`Model integrity check failed (received ${actualHash})`);
      }

      await storeModel({
        modelId: MODEL_SPEC.id,
        sha256: actualHash,
        bytes: modelBytes.buffer,
        installedAt: new Date().toISOString(),
      });
      this.session = undefined;
      this.loading = undefined;
      this.status = {
        state: "ready",
        modelId: MODEL_SPEC.id,
        downloadedBytes,
        totalBytes: MODEL_SPEC.weightsBytes,
      };
      return this.status;
    } catch (error) {
      this.status = {
        state: "error",
        modelId: MODEL_SPEC.id,
        downloadedBytes: 0,
        totalBytes: MODEL_SPEC.weightsBytes,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  async infer(source: InferenceSource): Promise<InferenceResult> {
    const startedAt = performance.now();
    const session = await this.getSession();
    const image = await this.loadImage(source.url);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = MODEL_SPEC.inputSize;
      canvas.height = MODEL_SPEC.inputSize;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas image processing is unavailable");
      context.drawImage(
        image,
        0,
        0,
        MODEL_SPEC.inputSize,
        MODEL_SPEC.inputSize,
      );
      const input = imageDataToNormalizedChw(
        context.getImageData(0, 0, MODEL_SPEC.inputSize, MODEL_SPEC.inputSize),
        MODEL_SPEC.imageMean,
        MODEL_SPEC.imageStd,
      );
      const tensor = new ort.Tensor("float32", input, [1, 3, MODEL_SPEC.inputSize, MODEL_SPEC.inputSize]);
      const outputs = await session.run({ [MODEL_SPEC.inputName]: tensor });
      const output = outputs[MODEL_SPEC.outputName];
      if (!output) throw new Error(`Model output ${MODEL_SPEC.outputName} is missing`);
      const logits = Array.from(output.data as Float32Array);
      const aiLikelihood = softmaxSynthetic(logits, MODEL_SPEC.syntheticLabelIndex);
      return {
        aiLikelihood,
        classification: aiLikelihood >= AI_THRESHOLD ? "likely-ai" : "not-flagged",
        modelId: MODEL_SPEC.id,
        durationMs: Math.round(performance.now() - startedAt),
      };
    } finally {
      image.close();
    }
  }

  private async getSession(): Promise<ort.InferenceSession> {
    if (this.session) return this.session;
    if (this.loading) return this.loading;
    this.loading = this.createSession();
    try {
      this.session = await this.loading;
      return this.session;
    } finally {
      this.loading = undefined;
    }
  }

  private async createSession(): Promise<ort.InferenceSession> {
    const stored = await readStoredModel();
    if (!stored || stored.modelId !== MODEL_SPEC.id || stored.sha256 !== MODEL_SPEC.weightsSha256) {
      throw new Error("Model is not installed");
    }
    return ort.InferenceSession.create(stored.bytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      logSeverityLevel: 3,
    });
  }

  private async loadImage(url: string): Promise<ImageBitmap> {
    const response = await fetch(url, { credentials: "include", cache: "force-cache" });
    if (!response.ok) throw new Error(`Image fetch failed with HTTP ${response.status}`);
    const blob = await response.blob();
    return createImageBitmap(blob, { imageOrientation: "from-image" });
  }
}
