import { build, context } from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outdir = path.join(root, "dist");
const watch = process.argv.includes("--watch");

async function copyStatic() {
  await mkdir(outdir, { recursive: true });
  for (const name of ["manifest.json", "content.css", "offscreen.html", "popup.html", "setup.html"]) {
    await cp(path.join(root, "src", "static", name), path.join(outdir, name));
  }

  const ortSource = path.join(root, "node_modules", "onnxruntime-web", "dist");
  const ortTarget = path.join(outdir, "ort");
  await mkdir(ortTarget, { recursive: true });
  const runtimeFiles = (await readdir(ortSource)).filter(
    (name) => name.startsWith("ort-wasm") && (name.endsWith(".wasm") || name.endsWith(".mjs")),
  );
  await Promise.all(runtimeFiles.map((name) => cp(path.join(ortSource, name), path.join(ortTarget, name))));
}

await rm(outdir, { recursive: true, force: true });
await copyStatic();

const options = {
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    offscreen: "src/offscreen.ts",
    popup: "src/popup.ts",
    setup: "src/setup.ts",
  },
  bundle: true,
  entryNames: "[name]",
  format: "iife",
  outdir,
  platform: "browser",
  target: "chrome121",
  sourcemap: true,
  minify: false,
  logLevel: "info",
};

if (watch) {
  const buildContext = await context(options);
  await buildContext.watch();
  console.log("SynthCheck build watcher started");
} else {
  await build(options);
}
