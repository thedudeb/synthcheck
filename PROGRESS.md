# SynthCheck progress log

## 2026-08-13 — Functional browser-local baseline

- Read and converted `prds/synthcheck.md` into a greenfield MV3 architecture.
- Added deterministic TypeScript/esbuild build, lint, type checking, unit tests, and zero-vulnerability dependency audit.
- Implemented first-run, checksum-verified model storage in IndexedDB and local ONNX Runtime Web/WASM inference in an offscreen document.
- Implemented eligible-image discovery, viewport prioritization, dynamic-source handling, duplicate caching, image labels, explicit unavailable states, page summary, site pause, visibility, and re-scan controls.
- Rejected an incompatible INT8 model graph after ONNX Runtime Web reported an unsupported `ConvInteger` node; selected the upstream Q4 artifact only after a real WASM session load passed.
- Corrected label mapping and preprocessing against immutable upstream `config.json` and `preprocessor_config.json` metadata.
- Passed `npm run verify`: lint, type checking, 8 unit/manifest tests, and production build.
- Passed `npm run test:chrome`: clean setup, verified model download, browser restart, offline mode, browser-local inference, and numeric score rendering.

### Next checkpoint

Build the reproducible source-separated benchmark, measure the exact Q4 browser artifact at the fixed 65% threshold, and replace or calibrate it based on held-out evidence.
