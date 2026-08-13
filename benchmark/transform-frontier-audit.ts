import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import sharp from "sharp";
import { FRONTIER_AUDIT } from "./frontier-config";
import type { BenchmarkItem } from "./types";

type Variant = "screenshot" | "social-q75" | "social-heavy";

const sourceDirectory = path.resolve("benchmark/data/frontier-original");
const sourceManifestText = await readFile(path.join(sourceDirectory, "manifest.jsonl"), "utf8");
const sourceManifest = sourceManifestText.trim().split("\n").map((line) => JSON.parse(line) as BenchmarkItem);
const requested = process.argv.includes("--variant")
  ? process.argv[process.argv.indexOf("--variant") + 1]
  : "all";
const variants: Variant[] = requested === "all"
  ? ["screenshot", "social-q75", "social-heavy"]
  : requested === "screenshot" || requested === "social-q75" || requested === "social-heavy"
  ? [requested]
  : (() => { throw new Error(`Unknown transform variant: ${requested ?? "missing"}`); })();

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mimeForFormat(format?: string): string {
  if (format === "jpg" || format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  if (format === "gif") return "image/gif";
  if (format === "avif" || format === "heif") return "image/avif";
  return "image/png";
}

async function createScreenshot(page: Page, bytes: Buffer): Promise<Buffer> {
  const metadata = await sharp(bytes, { animated: false }).metadata();
  const dataUrl = `data:${mimeForFormat(metadata.format)};base64,${bytes.toString("base64")}`;
  await page.setContent(`<!doctype html>
    <html>
      <head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        html, body { margin: 0; width: 1170px; height: 1400px; overflow: hidden; }
        body { background: #eef1f4; color: #16202a; font-family: Arial, Helvetica, sans-serif; padding: 46px; }
        .post { width: 1078px; height: 1308px; background: #fff; border: 1px solid #d9dee5; border-radius: 24px; overflow: hidden; box-shadow: 0 8px 24px rgba(20, 32, 44, .12); }
        .bar { height: 94px; padding: 22px 28px; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #e3e6ea; }
        .avatar { width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #5c6cf2, #31d2ba); }
        .line { width: 180px; height: 15px; border-radius: 8px; background: #c8ced6; }
        .media { width: 100%; height: 1110px; background: #11151a; display: flex; align-items: center; justify-content: center; }
        img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
        .footer { height: 104px; display: flex; align-items: center; gap: 24px; padding: 0 30px; }
        .dot { width: 22px; height: 22px; border: 3px solid #88919b; border-radius: 50%; }
      </style></head>
      <body><main class="post"><div class="bar"><div class="avatar"></div><div class="line"></div></div><div class="media"><img id="source" src="${dataUrl}"></div><div class="footer"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></main></body>
    </html>`);
  await page.locator("#source").evaluate((image: HTMLImageElement) => image.decode());
  return page.screenshot({ type: "png" });
}

async function transform(bytes: Buffer, variant: Variant, page?: Page): Promise<Buffer> {
  if (variant === "screenshot") {
    if (!page) throw new Error("Screenshot transform requires Chrome");
    return createScreenshot(page, bytes);
  }
  if (variant === "social-q75") {
    return sharp(bytes, { animated: false })
      .rotate()
      .toColourspace("srgb")
      .removeAlpha()
      .resize({ width: 1080, height: 1080, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75, chromaSubsampling: "4:2:0", mozjpeg: true })
      .toBuffer();
  }
  const firstPass = await sharp(bytes, { animated: false })
    .rotate()
    .toColourspace("srgb")
    .removeAlpha()
    .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 50, chromaSubsampling: "4:2:0", mozjpeg: true })
    .toBuffer();
  return sharp(firstPass)
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 38, chromaSubsampling: "4:2:0", mozjpeg: true })
    .toBuffer();
}

function description(variant: Variant): string {
  if (variant === "screenshot") return FRONTIER_AUDIT.transforms.screenshot;
  if (variant === "social-q75") return FRONTIER_AUDIT.transforms.socialQ75;
  return FRONTIER_AUDIT.transforms.socialHeavy;
}

let browser: Browser | undefined;
try {
  if (variants.includes("screenshot")) {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.SYNTHCHECK_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
  }
  for (const variant of variants) {
    const outputDirectory = path.resolve(`benchmark/data/frontier-${variant}`);
    const page = variant === "screenshot" ? await browser!.newPage({ viewport: { width: 1170, height: 1400 } }) : undefined;
    const manifest: BenchmarkItem[] = [];
    await mkdir(path.join(outputDirectory, "images"), { recursive: true });
    for (const [index, item] of sourceManifest.entries()) {
      const sourceBytes = await readFile(path.join(sourceDirectory, item.path));
      if (sha256(sourceBytes) !== item.imageSha256) throw new Error(`Source integrity mismatch: ${item.id}`);
      const outputBytes = await transform(sourceBytes, variant, page);
      const extension = variant === "screenshot" ? "png" : "jpg";
      const relativePath = `images/${sha256(item.id).slice(0, 24)}.${extension}`;
      await writeFile(path.join(outputDirectory, relativePath), outputBytes);
      manifest.push({
        ...item,
        id: `${item.id}:${variant}`,
        split: variant,
        path: relativePath,
        imageSha256: sha256(outputBytes),
      });
      if ((index + 1) % 25 === 0 || index + 1 === sourceManifest.length) {
        console.log(`Created ${variant} ${index + 1}/${sourceManifest.length}`);
      }
    }
    await page?.close();
    await writeFile(
      path.join(outputDirectory, "manifest.jsonl"),
      `${manifest.map((item) => JSON.stringify(item)).join("\n")}\n`,
    );
    await writeFile(
      path.join(outputDirectory, "selection.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        frozenAt: FRONTIER_AUDIT.frozenAt,
        strategy: FRONTIER_AUDIT.sampleStrategy,
        sourceManifest: "benchmark/data/frontier-original/manifest.jsonl",
        sourceManifestSha256: sha256(sourceManifestText),
        variant,
        transform: description(variant),
        count: manifest.length,
      }, null, 2)}\n`,
    );
  }
} finally {
  await browser?.close();
}
