# SynthCheck

SynthCheck is a privacy-preserving Chrome extension that estimates whether images on ordinary webpages are AI-generated. Image decoding, preprocessing, and ONNX inference run inside the browser; pixels and image-derived features are never uploaded to an inference service.

> **Development status:** the extension shell and offline inference path are functional. The current model is a reproducible baseline and has **not yet passed** SynthCheck's held-out 75.0% balanced-accuracy gate or the bounty's private benchmark.

## Current capabilities

- Native Chrome Manifest V3 extension with an ephemeral service worker and durable offscreen inference document.
- One-time, checksum-verified model download into browser IndexedDB.
- Automatic viewport-prioritized analysis of eligible `<img>` elements, including lazy and dynamically added images.
- A score on every successful analysis, with scores at or above 65% flagged as likely AI-generated.
- Explicit unavailable states, duplicate-result caching, per-site pause, label visibility, and page re-scan controls.
- Automated unit, manifest, build, and disposable-Chromium offline/restart smoke tests.

## Requirements

- Node.js 20.9 or newer for development, benchmarking, and building only.
- Google Chrome 121 or newer for the unpacked production extension.
- Internet access during initial model setup. Detection works offline afterward for images whose pixels are available to the browser.

Node.js is not used by the installed extension at runtime.

## Reproducible build

```sh
npm ci
npm run verify
```

The unpacked extension is created in `dist/`. `npm ci` uses the committed lockfile, and the build copies all executable runtime code—including ONNX Runtime Web and its WASM files—into the extension. No remotely hosted JavaScript is permitted by the extension content security policy.

## Install in Chrome

1. Run the reproducible build above.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the generated `dist/` directory.
5. On the SynthCheck setup page, select **Download verified model** and wait for **Offline ready**.
6. Visit an ordinary webpage. Eligible images at least 64×64 pixels receive a SynthCheck label as they approach the viewport.

The model download is pinned to an immutable upstream revision and accepted only when its SHA-256 digest matches [the checked-in model specification](src/shared/model-spec.ts).

## Verification

Run fast checks:

```sh
npm run verify
```

Run the real-browser setup/restart/offline smoke test:

```sh
npx playwright-core install chromium
npm run test:chrome
```

The Chrome smoke test uses a disposable browser profile. It installs the extension, downloads and verifies the model, restarts Chromium, disables networking, analyzes an embedded test image, and asserts that a numeric result label appears.

## Privacy and network behavior

- Model inference never calls a cloud API or localhost service.
- Accessible rendered images are converted to a lossless 224×224 local snapshot before inference, avoiding a second network request.
- If page security taints the image canvas, the extension may retrieve the original image URL using its declared host permission. This downloads from the image's existing source; it does not upload the image elsewhere.
- After model setup, no model, code, weight, telemetry, or other inference-asset request is made.
- SynthCheck has no analytics, account, or browsing-history synchronization.

## Model status

The current browser-compatible baseline is the Apache-2.0 `onnx-community/ai-image-detection-ONNX` ViT Q4 artifact. It is useful for plumbing and performance validation, but its training data is CIFAKE and its upstream card warns that performance may degrade on newer generators and compressed images. See [model provenance](docs/model-provenance.md).

The baseline must not be described as bounty-ready until the repository contains a source-separated, web-realistic held-out report showing at least 75.0% balanced accuracy at the fixed 65% threshold.

## License

SynthCheck source code is available under the [MIT License](LICENSE). Third-party model and runtime licenses remain with their respective authors and are documented separately.
