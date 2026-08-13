import type { ModelStatus } from "./shared/contracts";
import { MODEL_SPEC } from "./shared/model-spec";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Setup element ${selector} is missing`);
  return element;
}

const stateElement = requireElement<HTMLElement>("#setup-state");
const detailElement = requireElement<HTMLElement>("#setup-detail");
const progressElement = requireElement<HTMLProgressElement>("#setup-progress");
const installButton = requireElement<HTMLButtonElement>("#install-model");
const modelElement = requireElement<HTMLElement>("#model-name");
const sizeElement = requireElement<HTMLElement>("#model-size");

modelElement.textContent = MODEL_SPEC.displayName;
sizeElement.textContent = `${(MODEL_SPEC.weightsBytes / 1_000_000).toFixed(1)} MB`;

function render(status: ModelStatus): void {
  progressElement.max = status.totalBytes || MODEL_SPEC.weightsBytes;
  progressElement.value = status.downloadedBytes;
  if (status.state === "ready") {
    stateElement.textContent = "Offline ready";
    detailElement.textContent = "The verified model is stored on this device. SynthCheck can now analyze images without internet access.";
    installButton.textContent = "Model installed";
    installButton.disabled = true;
  } else if (status.state === "downloading") {
    stateElement.textContent = "Downloading and verifying…";
    detailElement.textContent = "Keep this page open while the bundled model is verified and prepared for offline use.";
    installButton.disabled = true;
  } else if (status.state === "error") {
    stateElement.textContent = "Setup failed";
    detailElement.textContent = status.error ?? "The model could not be installed.";
    installButton.textContent = "Retry download";
    installButton.disabled = false;
  } else {
    stateElement.textContent = "Model required";
    detailElement.textContent = "Prepare the bundled model once. Its SHA-256 checksum will be verified before it is stored.";
    installButton.disabled = false;
  }
}

installButton.addEventListener("click", async () => {
  installButton.disabled = true;
  render({
    state: "downloading",
    modelId: MODEL_SPEC.id,
    downloadedBytes: 0,
    totalBytes: MODEL_SPEC.weightsBytes,
  });
  try {
    const status = (await chrome.runtime.sendMessage({ type: "SC_INSTALL_MODEL" })) as ModelStatus;
    render(status);
  } catch (error) {
    render({
      state: "error",
      modelId: MODEL_SPEC.id,
      downloadedBytes: 0,
      totalBytes: MODEL_SPEC.weightsBytes,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

chrome.runtime.onMessage.addListener(
  (message: { type: string; downloadedBytes?: number; totalBytes?: number }) => {
    if (message.type !== "SC_SETUP_PROGRESS") return;
    render({
      state: "downloading",
      modelId: MODEL_SPEC.id,
      downloadedBytes: message.downloadedBytes ?? 0,
      totalBytes: message.totalBytes ?? MODEL_SPEC.weightsBytes,
    });
  },
);

void chrome.runtime.sendMessage({ type: "SC_GET_MODEL_STATUS" }).then((status: ModelStatus) => render(status));
