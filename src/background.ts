import {
  EMPTY_PAGE_STATS,
  type InferenceResponse,
  type ModelStatus,
  type PageStats,
  type RuntimeMessage,
  type SiteStateResponse,
  type TabSummaryResponse,
} from "./shared/contracts";

const OFFSCREEN_PATH = "offscreen.html";
const pageStats = new Map<number, PageStats>();
let creatingOffscreen: Promise<void> | undefined;

async function ensureOffscreen(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl],
  });
  if (contexts.length > 0) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: "Decode webpage images and run the local ONNX detector outside ephemeral service worker lifetime",
      })
      .finally(() => {
        creatingOffscreen = undefined;
      });
  }
  await creatingOffscreen;
}

async function offscreenMessage<T>(message: RuntimeMessage): Promise<T> {
  await ensureOffscreen();
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

async function disabledOrigins(): Promise<string[]> {
  const stored = await chrome.storage.local.get("disabledOrigins");
  return Array.isArray(stored.disabledOrigins) ? (stored.disabledOrigins as string[]) : [];
}

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case "SC_INFER":
      return offscreenMessage<InferenceResponse>({
        type: "SC_OFFSCREEN_INFER",
        requestId: message.requestId,
        source: message.source,
      });
    case "SC_PAGE_STATS":
      if (sender.tab?.id !== undefined) pageStats.set(sender.tab.id, message.stats);
      return { ok: true };
    case "SC_GET_SITE_STATE": {
      const disabled = await disabledOrigins();
      return { enabled: !disabled.includes(message.origin) } satisfies SiteStateResponse;
    }
    case "SC_GET_MODEL_STATUS":
      return offscreenMessage<ModelStatus>({ type: "SC_OFFSCREEN_STATUS" });
    case "SC_INSTALL_MODEL":
      return offscreenMessage<ModelStatus>({ type: "SC_OFFSCREEN_INSTALL_MODEL" });
    case "SC_GET_TAB_SUMMARY":
      return { stats: pageStats.get(message.tabId) ?? EMPTY_PAGE_STATS } satisfies TabSummaryResponse;
    case "SC_SET_SITE_STATE": {
      const disabled = new Set(await disabledOrigins());
      if (message.enabled) disabled.delete(message.origin);
      else disabled.add(message.origin);
      await chrome.storage.local.set({ disabledOrigins: [...disabled] });
      return { enabled: message.enabled } satisfies SiteStateResponse;
    }
    case "SC_OFFSCREEN_STATUS":
    case "SC_OFFSCREEN_INSTALL_MODEL":
    case "SC_OFFSCREEN_INFER":
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type.startsWith("SC_OFFSCREEN_")) return false;
  void handleMessage(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => pageStats.delete(tabId));

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== "install") return;
  void chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
});
