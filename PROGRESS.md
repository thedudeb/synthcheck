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

## 2026-08-13 — Reproducible benchmark and rejected candidates

- Added deterministic, source-stratified Defactify preparation with immutable revision, row, image, manifest, and model hashes; local images and per-image predictions remain excluded from Git.
- Measured the shipping Q4 baseline at 65.6% balanced accuracy on 500 validation images and rejected it.
- Exported xRayon's Apache-2.0 ConvNeXtV2 candidate to ONNX (351 MB), then generated a browser-compatible INT8 QDQ graph (89.9 MB) using 60 training-split calibration images.
- Measured xRayon FP32 at 94.8% validation balanced accuracy, but rejected the candidate after the frozen INT8 model plus source-controlled Platt calibration scored only 61.6% on a one-shot, untouched 1,000-image test set. A post-test FP32 diagnostic reached only 67.0%, confirming generalization—not compression—was the primary failure.
- Exported Apache-2.0 FerretNet-B to a 5.82 MB ONNX graph. Replaced its unsupported median operator with an exact Min/Max sorting network and proved PyTorch/ONNX parity on all ten author examples.
- Rejected FerretNet after 50.4% balanced accuracy and 0.545 ROC-AUC on the 500-image validation set, despite perfect behavior on the authors' examples.
- Passed lint, type checking, and 13 unit tests after adding RGB preprocessing parity, benchmark metrics, and calibration tests.

### Next checkpoint

Select or combine a detector with independently demonstrated cross-domain ranking, establish a new external held-out protocol because the Defactify test labels have now been exposed, then integrate only an artifact that clears 75.0% at the fixed displayed threshold.
