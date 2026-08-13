# Reproducible benchmark protocol

## Purpose

SynthCheck accepts a detector only after the exact browser-compatible ONNX artifact reaches at least 75.0% balanced accuracy at a fixed 65% AI-likelihood threshold on a held-out, web-realistic set. Upstream metrics, training accuracy, and a different precision artifact are not substitutes.

## Dataset

The current protocol uses `Rajarshi-Roy-research/Defactify_Image_Dataset` at immutable revision `787334f7857fa54f29027a7f09c30e895ad486ef`. It pairs real MS COCO images with Stable Diffusion 2.1, SDXL, Stable Diffusion 3, DALL-E 3, and Midjourney 6 images.

The upstream dataset card does not declare a license. SynthCheck therefore downloads samples only for local evaluation, excludes all images from Git, and commits only row identities, hashes, scores, aggregate results, and reproduction code. Anyone running the benchmark is responsible for reviewing the upstream dataset terms.

## Sampling and leakage controls

- Validation and test remain distinct upstream splits. The Defactify test split was first evaluated once with the frozen xRayon INT8 artifact and calibration, then exposed for post-failure diagnosis; it must not be reused as final held-out success evidence for later candidates.
- Sampling is stratified by real/synthetic source across the entire split.
- Rows are ranked by SHA-256 of the immutable dataset revision, split, and row index; the lowest ranks are selected. Dataset content and detector output do not influence selection.
- Validation may be used for candidate selection and calibration. Test is reserved for a single final readiness evaluation.
- Every downloaded image and generated manifest is hashed. Benchmark execution verifies both image and model bytes before inference.
- The default validation sample contains 250 real images and 50 from each of five generators, producing balanced real/synthetic class counts.

## Commands

```sh
npm ci
npm run benchmark:model
npm run benchmark:prepare -- --split validation --real 250 --per-generator 50
npm run benchmark:run -- --split validation
```

For the final held-out run, use a larger untouched test sample:

```sh
npm run benchmark:prepare -- --split test --real 500 --per-generator 100
npm run benchmark:run -- --split test
```

The harness uses ONNX Runtime Web's WASM backend with one thread, matching the extension's execution provider and thread count. Candidate-specific preprocessing, output semantics, immutable artifact hashes, and optional calibration are recorded in source and result summaries.

## Recorded candidate decisions

- Baseline Q4: 65.6% balanced accuracy on validation; rejected.
- xRayon ConvNeXtV2 FP32: 94.8% on validation, but a frozen 89.9 MB INT8 QDQ artifact plus validation-fitted Platt calibration reached only 61.6% on the one-shot 1,000-image test run. A clearly labeled post-test FP32 diagnostic reached 67.0%; rejected for generalization.
- FerretNet-B FP32: exact 5.82 MB browser graph, with official PyTorch/ONNX parity verified, but 50.4% on validation and 0.545 ROC-AUC; rejected.

These results are candidate-selection evidence only and do not imply performance on the private bounty benchmark.

## Reported metrics

- True-real rate (specificity)
- True-synthetic rate (sensitivity)
- Balanced accuracy: mean of true-real and true-synthetic rates
- Ordinary accuracy
- Count, accuracy, and mean AI likelihood for every real or generator source

The required pass condition is `balancedAccuracy >= 0.75` at `threshold = 0.65`. No alternate threshold may be substituted in the bounty-readiness claim.
