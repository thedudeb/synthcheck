import {
  AI_THRESHOLD,
  type AnalysisState,
  type InferenceResponse,
  type PageStats,
  type SiteStateResponse,
} from "./shared/contracts";

const MIN_DIMENSION = 64;
const POSITION_MARGIN = 6;

interface ImageRecord {
  image: HTMLImageElement;
  badge: HTMLButtonElement;
  source: string;
  state: AnalysisState;
  flagged: boolean;
  unavailable: boolean;
  requestId?: string;
}

const records = new Map<HTMLImageElement, ImageRecord>();
let enabled = true;
let labelsVisible = true;
let positionFrame: number | undefined;

function eligible(image: HTMLImageElement): boolean {
  return (
    image.isConnected &&
    image.complete &&
    image.naturalWidth >= MIN_DIMENSION &&
    image.naturalHeight >= MIN_DIMENSION &&
    image.getClientRects().length > 0 &&
    Boolean(image.currentSrc || image.src)
  );
}

function makeBadge(): HTMLButtonElement {
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "synthcheck-badge synthcheck-badge--queued";
  badge.textContent = "SynthCheck · queued";
  badge.setAttribute("aria-label", "SynthCheck image analysis queued");
  badge.hidden = !labelsVisible;
  document.documentElement.append(badge);
  return badge;
}

function updateBadge(record: ImageRecord, label: string, detail: string): void {
  record.badge.className = `synthcheck-badge synthcheck-badge--${record.state}`;
  record.badge.textContent = label;
  record.badge.title = detail;
  record.badge.setAttribute("aria-label", `${label}. ${detail}`);
  record.badge.hidden = !labelsVisible || !enabled;
  schedulePositions();
  reportStats();
}

function stats(): PageStats {
  const values = [...records.values()];
  return {
    total: values.length,
    queued: values.filter((record) => record.state === "queued").length,
    analyzing: values.filter((record) => record.state === "analyzing").length,
    complete: values.filter((record) => record.state === "complete").length,
    flagged: values.filter((record) => record.flagged).length,
    unavailable: values.filter((record) => record.unavailable).length,
  };
}

let statsTimer: number | undefined;
function reportStats(): void {
  if (statsTimer !== undefined) return;
  statsTimer = window.setTimeout(() => {
    statsTimer = undefined;
    void chrome.runtime.sendMessage({ type: "SC_PAGE_STATS", stats: stats() });
  }, 100);
}

function positionBadges(): void {
  positionFrame = undefined;
  for (const record of records.values()) {
    if (!record.image.isConnected) {
      record.badge.remove();
      records.delete(record.image);
      continue;
    }
    const rect = record.image.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    record.badge.style.display = visible ? "block" : "none";
    if (!visible) continue;
    const left = Math.max(POSITION_MARGIN, Math.min(window.innerWidth - record.badge.offsetWidth - POSITION_MARGIN, rect.right - record.badge.offsetWidth - POSITION_MARGIN));
    const top = Math.max(POSITION_MARGIN, Math.min(window.innerHeight - record.badge.offsetHeight - POSITION_MARGIN, rect.top + POSITION_MARGIN));
    record.badge.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  reportStats();
}

function schedulePositions(): void {
  if (positionFrame !== undefined) return;
  positionFrame = requestAnimationFrame(positionBadges);
}

function sourceFor(image: HTMLImageElement): string {
  return image.currentSrc || image.src;
}

function inferenceUrlFor(image: HTMLImageElement, fallback: string): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 224;
    canvas.height = 224;
    const context = canvas.getContext("2d");
    if (!context) return fallback;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Reading the canvas throws for inaccessible cross-origin images. For
    // accessible images this lossless snapshot prevents a second network fetch.
    return canvas.toDataURL("image/png");
  } catch {
    return fallback;
  }
}

async function analyze(record: ImageRecord): Promise<void> {
  if (!enabled || record.state === "analyzing" || !eligible(record.image)) return;
  const currentSource = sourceFor(record.image);
  if (record.state === "complete" && record.source === currentSource) return;
  record.source = currentSource;
  record.state = "analyzing";
  record.flagged = false;
  record.unavailable = false;
  record.requestId = crypto.randomUUID();
  updateBadge(record, "SynthCheck · analyzing", "Analysis runs privately on this device");

  try {
    const inferenceUrl = inferenceUrlFor(record.image, currentSource);
    const response = (await chrome.runtime.sendMessage({
      type: "SC_INFER",
      requestId: record.requestId,
      source: { url: inferenceUrl, cacheKey: currentSource },
    })) as InferenceResponse;
    if (record.source !== sourceFor(record.image)) {
      resetRecord(record);
      return;
    }
    if (!response.ok || !response.result) {
      record.state = "unavailable";
      record.unavailable = true;
      updateBadge(record, "SynthCheck · unavailable", response.error?.message ?? "This image could not be analyzed");
      return;
    }
    const percentage = Math.round(response.result.aiLikelihood * 100);
    record.state = "complete";
    record.flagged = response.result.aiLikelihood >= AI_THRESHOLD;
    updateBadge(
      record,
      `AI likelihood · ${percentage}%`,
      record.flagged
        ? "Likely AI-generated at the required 65% threshold. This estimate is not proof."
        : "Not flagged at the required 65% threshold. This estimate is not proof of authenticity.",
    );
  } catch (error) {
    record.state = "unavailable";
    record.unavailable = true;
    updateBadge(record, "SynthCheck · unavailable", error instanceof Error ? error.message : String(error));
  }
}

function resetRecord(record: ImageRecord): void {
  record.state = "queued";
  record.source = sourceFor(record.image);
  record.flagged = false;
  record.unavailable = false;
  updateBadge(record, "SynthCheck · queued", "Waiting for this image to enter the viewport");
  intersectionObserver.observe(record.image);
}

function register(image: HTMLImageElement): void {
  const existing = records.get(image);
  if (existing) {
    if (existing.source !== sourceFor(image)) resetRecord(existing);
    return;
  }
  if (!eligible(image)) return;
  const record: ImageRecord = {
    image,
    badge: makeBadge(),
    source: sourceFor(image),
    state: "queued",
    flagged: false,
    unavailable: false,
  };
  records.set(image, record);
  intersectionObserver.observe(image);
  schedulePositions();
  reportStats();
}

function scan(root: ParentNode = document): void {
  if (root instanceof HTMLImageElement) register(root);
  root.querySelectorAll?.("img").forEach((image) => register(image));
}

const intersectionObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const record = records.get(entry.target as HTMLImageElement);
      if (record) void analyze(record);
    }
  },
  { rootMargin: "300px" },
);

const mutationObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === "attributes" && mutation.target instanceof HTMLImageElement) {
      register(mutation.target);
    }
    mutation.addedNodes.forEach((node) => {
      if (node instanceof Element) scan(node);
    });
  }
  schedulePositions();
});

chrome.runtime.onMessage.addListener((message: { type: string; enabled?: boolean; visible?: boolean }) => {
  if (message.type === "SC_SITE_STATE_CHANGED" && typeof message.enabled === "boolean") {
    enabled = message.enabled;
    for (const record of records.values()) record.badge.hidden = !enabled || !labelsVisible;
    if (enabled) scan();
  }
  if (message.type === "SC_LABEL_VISIBILITY" && typeof message.visible === "boolean") {
    labelsVisible = message.visible;
    for (const record of records.values()) record.badge.hidden = !enabled || !labelsVisible;
  }
  if (message.type === "SC_RESCAN") {
    for (const record of records.values()) resetRecord(record);
    scan();
  }
});

async function start(): Promise<void> {
  const state = (await chrome.runtime.sendMessage({
    type: "SC_GET_SITE_STATE",
    origin: location.origin,
  })) as SiteStateResponse;
  enabled = state.enabled;
  if (enabled) scan();
  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset"],
  });
  window.addEventListener("scroll", schedulePositions, { passive: true });
  window.addEventListener("resize", schedulePositions, { passive: true });
}

void start();
