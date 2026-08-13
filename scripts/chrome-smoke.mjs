import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const extensionPath = path.resolve("dist");
const profilePath = await mkdtemp(path.join(os.tmpdir(), "synthcheck-chrome-"));
const svg = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="384"><defs><linearGradient id="g"><stop stop-color="#174c3c"/><stop offset="1" stop-color="#92d5bd"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="180" cy="160" r="90" fill="#f5d97b"/><path d="M0 340L130 230l100 90 90-70 192 90" fill="#263552"/></svg>',
);
const html = `<!doctype html><html><body><h1>SynthCheck smoke page</h1><img id="fixture" width="512" height="384" alt="test fixture" src="data:image/svg+xml,${svg}"></body></html>`;

const server = createServer((request, response) => {
  if (request.url === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(html);
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Smoke server did not start");
const pageUrl = `http://127.0.0.1:${address.port}/`;
const pageOrigin = new URL(pageUrl).origin;

async function launch() {
  return chromium.launchPersistentContext(profilePath, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
}

async function extensionWorker(context) {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker", { timeout: 20_000 });
}

let context;
const diagnostics = [];
try {
  context = await launch();
  context.on("serviceworker", (serviceWorker) => {
    serviceWorker.on("console", (message) => diagnostics.push(`worker console: ${message.text()}`));
  });
  let worker = await extensionWorker(context);
  const extensionId = new URL(worker.url()).host;
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/setup.html`);
  await setup.getByRole("button", { name: /prepare verified model/i }).click();
  await setup.getByRole("heading", { name: "Offline ready" }).waitFor({ timeout: 180_000 });
  await context.close();

  context = await launch();
  context.on("serviceworker", (serviceWorker) => {
    serviceWorker.on("console", (message) => diagnostics.push(`worker console: ${message.text()}`));
  });
  worker = await extensionWorker(context);
  await worker.evaluate((origin) => chrome.storage.local.set({ disabledOrigins: [origin] }), pageOrigin);
  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.locator("#fixture").waitFor();
  await context.setOffline(true);
  const tabId = await worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url });
    return tabs[0]?.id;
  }, pageUrl);
  if (typeof tabId !== "number") throw new Error("Could not identify smoke-test tab");
  await worker.evaluate(
    async (id) => {
      await chrome.storage.local.set({ disabledOrigins: [] });
      await chrome.tabs.sendMessage(id, { type: "SC_SITE_STATE_CHANGED", enabled: true });
    },
    tabId,
  );
  await page.locator(".synthcheck-badge").first().waitFor({ timeout: 20_000 });
  const badge = page.locator(".synthcheck-badge--complete");
  try {
    await badge.waitFor({ timeout: 120_000 });
  } catch (error) {
    diagnostics.push(
      `badges: ${JSON.stringify(
        await page.locator(".synthcheck-badge").evaluateAll((elements) =>
          elements.map((element) => ({
            className: element.className,
            text: element.textContent,
            title: element.getAttribute("title"),
          })),
        ),
      )}`,
    );
    diagnostics.push(`model status: ${JSON.stringify(await worker.evaluate(() => chrome.storage.local.get()))}`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics.join("\n")}`);
  }
  const label = await badge.textContent();
  if (!label || !/^AI likelihood · \d+%$/.test(label)) {
    throw new Error(`Unexpected result label: ${label ?? "missing"}`);
  }
  console.log(JSON.stringify({ extensionId, offlineRestart: true, resultLabel: label }, null, 2));
} finally {
  await context?.close().catch(() => undefined);
  await new Promise((resolve) => server.close(resolve));
  await rm(profilePath, { recursive: true, force: true });
}
