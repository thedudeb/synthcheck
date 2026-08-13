# Modern model evaluation

## Outcome

SynthCheck's exact 23,433,075-byte INT8 browser artifact clears the bounty's 75% balanced-accuracy target on every variant of a frozen, sample-disjoint modern test.

| Test variant | Balanced accuracy | Real recall | Synthetic recall |
| --- | ---: | ---: | ---: |
| Original | 92.33% | 89.33% | 95.33% |
| Chrome screenshot | 94.00% | 92.00% | 96.00% |
| Social JPEG, 1080px/q75 | 90.00% | 91.33% | 88.67% |
| Heavy double JPEG, 720/q50 then 640/q38 | 87.33% | 92.67% | 82.00% |

These are project evaluation results, not the bounty maintainers' private result. They materially improve confidence but cannot guarantee qualification.

## Model and runtime

- Model: `SynthCheck/community-forensics-modern-rehead-v2@20260813:int8-dynamic`
- Artifact SHA-256: `d0712f939ef34ab9470eac357e483e188672f472798d4093ddb5d7e5030cd9f4`
- Artifact size: 23,433,075 bytes
- Runtime: ONNX Runtime Web 1.22.0, single-threaded WASM
- Preprocessing: resize short edge to 256, center-crop 224, ImageNet RGB normalization
- Display threshold: 65%
- Calibration: slope `1`, intercept `0.65819564532639`, fitted only on validation predictions from the exact INT8/WASM artifact

The calibration tool refused to emit a file unless one threshold achieved at least 75% balanced accuracy, 85% real recall, 70% synthetic recall, and 60% recall for every held-out synthetic source on all four validation variants.

## Data discipline

All sample selection used lowest SHA-256 priorities over immutable, pinned source listings. The external images and per-image predictions are Git-ignored; manifests, hashes, source code, aggregate reports, and attribution records are reproducible.

Training used 3,600 source images:

- 1,200 synthetic images, 100 from each of 12 Qwen Image Bench generator families.
- 1,200 Open Images V7 real photographs with per-image CC BY 2.0 attribution retained locally.
- 1,200 DOCCI real photographs from the official train split under CC BY 4.0.

Each training image contributed deterministic original, screenshot-frame, social-JPEG, and heavy-recompression views. The Community Forensics ViT-S/16 backbone remained frozen; only its linear classifier head was trained.

Validation and test each contain 600 balanced source images: 300 Open Images photographs and 50 synthetic images from each of six generator families held out from training—Flux.2 Max, GPT Image 2, Imagen 4 Ultra, Nano Banana 2, Qwen Image 2 Pro, and Seedream 5. Validation and test use disjoint image samples. The families appear in validation for calibration, so the test is sample-disjoint and generator-family-held-out from training, not generator-family-unseen from calibration.

The test membership was frozen after the model and calibration were frozen and was evaluated once. Its four variants are correlated derivatives of the same 600 sources, not 2,400 independent source images.

## Per-generator test recall

| Generator | Original | Screenshot | JPEG-75 | Heavy JPEG |
| --- | ---: | ---: | ---: | ---: |
| Flux.2 Max | 96% | 94% | 88% | 78% |
| GPT Image 2 | 94% | 96% | 84% | 66% |
| Imagen 4 Ultra | 94% | 98% | 94% | 96% |
| Nano Banana 2 | 92% | 92% | 88% | 80% |
| Qwen Image 2 Pro | 100% | 96% | 88% | 86% |
| Seedream 5 | 96% | 100% | 90% | 86% |

## Legacy regression

The earlier 400-image OpenFake/Qwen/Synthbuster audit was exposed before v2, so its re-run is regression evidence rather than an independent test.

| Variant | Balanced accuracy | Real recall | Synthetic recall |
| --- | ---: | ---: | ---: |
| Original | 84.50% | 89.00% | 80.00% |
| Chrome screenshot | 74.25% | 94.00% | 54.50% |
| Social JPEG q75 | 82.50% | 89.50% | 75.50% |
| Heavy double JPEG | 76.75% | 93.50% | 60.00% |

The screenshot regression misses the 75% stress target by 0.75 points, mainly on the older Adobe Firefly subset. This known limitation is preserved rather than folded into calibration.

## Reproduce

See [the benchmark guide](../benchmark/README.md) for environment setup, pinned data preparation, training, export, exact WASM evaluation, calibration, and report generation. The primary machine-readable summary is [modern-evaluation.json](../benchmark/results/modern-evaluation.json).
