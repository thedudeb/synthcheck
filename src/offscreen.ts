import { BrowserDetector } from "./inference/detector";
import type {
  BackgroundToOffscreenMessage,
  InferenceFailure,
  InferenceResponse,
  ModelStatus,
} from "./shared/contracts";

const detector = new BrowserDetector();
const resultCache = new Map<string, InferenceResponse>();
const MAX_CACHE_ENTRIES = 256;

function remember(cacheKey: string, response: InferenceResponse): void {
  resultCache.delete(cacheKey);
  resultCache.set(cacheKey, response);
  if (resultCache.size > MAX_CACHE_ENTRIES) {
    const oldest = resultCache.keys().next().value as string | undefined;
    if (oldest) resultCache.delete(oldest);
  }
}

function failureFor(error: unknown): InferenceFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("not installed")) return { code: "model-not-ready", message };
  if (message.includes("fetch")) return { code: "fetch-failed", message };
  if (message.includes("image") || message.includes("decode")) return { code: "decode-failed", message };
  return { code: "inference-failed", message };
}

async function installModel(): Promise<ModelStatus> {
  return detector.install(({ downloadedBytes, totalBytes }) => {
    void chrome.runtime.sendMessage({
      type: "SC_SETUP_PROGRESS",
      downloadedBytes,
      totalBytes,
    });
  });
}

async function infer(message: Extract<BackgroundToOffscreenMessage, { type: "SC_OFFSCREEN_INFER" }>): Promise<InferenceResponse> {
  const cached = resultCache.get(message.source.cacheKey);
  if (cached) return cached;
  try {
    const response: InferenceResponse = { ok: true, result: await detector.infer(message.source) };
    remember(message.source.cacheKey, response);
    return response;
  } catch (error) {
    return { ok: false, error: failureFor(error) };
  }
}

chrome.runtime.onMessage.addListener((message: BackgroundToOffscreenMessage, _sender, sendResponse) => {
  if (message.type === "SC_OFFSCREEN_STATUS") {
    void detector.getStatus().then(sendResponse).catch((error: unknown) => {
      sendResponse({
        state: "error",
        modelId: "unknown",
        downloadedBytes: 0,
        totalBytes: 0,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ModelStatus);
    });
    return true;
  }
  if (message.type === "SC_OFFSCREEN_INSTALL_MODEL") {
    void installModel().then(sendResponse).catch((error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message.type === "SC_OFFSCREEN_INFER") {
    void infer(message).then(sendResponse);
    return true;
  }
  return false;
});
