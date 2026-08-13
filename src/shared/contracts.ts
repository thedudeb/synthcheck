export const AI_THRESHOLD = 0.65;

export type AnalysisState = "queued" | "analyzing" | "complete" | "unavailable";

export interface InferenceSource {
  url: string;
  cacheKey: string;
}

export interface InferenceResult {
  aiLikelihood: number;
  classification: "likely-ai" | "not-flagged";
  modelId: string;
  durationMs: number;
}

export interface InferenceFailure {
  code: "model-not-ready" | "fetch-failed" | "decode-failed" | "inference-failed";
  message: string;
}

export interface ModelStatus {
  state: "not-installed" | "downloading" | "ready" | "error";
  modelId: string;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
}

export interface PageStats {
  total: number;
  queued: number;
  analyzing: number;
  complete: number;
  flagged: number;
  unavailable: number;
}

export type ContentToBackgroundMessage =
  | { type: "SC_INFER"; requestId: string; source: InferenceSource }
  | { type: "SC_PAGE_STATS"; stats: PageStats }
  | { type: "SC_GET_SITE_STATE"; origin: string };

export type UiToBackgroundMessage =
  | { type: "SC_GET_MODEL_STATUS" }
  | { type: "SC_INSTALL_MODEL" }
  | { type: "SC_GET_TAB_SUMMARY"; tabId: number }
  | { type: "SC_SET_SITE_STATE"; origin: string; enabled: boolean };

export type BackgroundToOffscreenMessage =
  | { type: "SC_OFFSCREEN_STATUS" }
  | { type: "SC_OFFSCREEN_INSTALL_MODEL" }
  | { type: "SC_OFFSCREEN_INFER"; requestId: string; source: InferenceSource };

export type RuntimeMessage = ContentToBackgroundMessage | UiToBackgroundMessage | BackgroundToOffscreenMessage;

export interface InferenceResponse {
  ok: boolean;
  result?: InferenceResult;
  error?: InferenceFailure;
}

export interface SiteStateResponse {
  enabled: boolean;
}

export interface TabSummaryResponse {
  stats: PageStats;
}

export const EMPTY_PAGE_STATS: PageStats = {
  total: 0,
  queued: 0,
  analyzing: 0,
  complete: 0,
  flagged: 0,
  unavailable: 0,
};
