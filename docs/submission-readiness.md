# Bounty submission readiness

Status: **ready to submit with evidence, private qualification not guaranteed**. SynthCheck satisfies the local/offline engineering requirements and its frozen modern test clears the public 75% target on every tested variant. Only the maintainers can determine the private benchmark result.

## Evidence

| Requirement | Evidence |
| --- | --- |
| Native Chrome MV3 | `src/static/manifest.json`; clean-profile Chrome smoke test |
| Browser-local inference | ONNX Runtime Web/WASM in the offscreen extension document; no inference API or localhost dependency |
| Offline after setup | Browser test prepares the bundled model, restarts Chrome, disables networking, and requires a numeric score |
| Fixed 65% threshold | Shared `AI_THRESHOLD` contract used by classification, UI, calibration, and benchmark metrics |
| Modern accuracy test | Exact 23,433,075-byte INT8 artifact: 92.33% original, 94.0% screenshot, 90.0% JPEG-75, 87.33% heavy-JPEG balanced accuracy on a frozen 600-image test |
| Class-recall gates | Across the modern test: real recall 89.33%–92.67%; synthetic recall 82%–96%; every generator/variant at least 66% |
| Legacy regression | 84.5% original, 74.25% screenshot, 82.5% JPEG-75, 76.75% heavy-JPEG; disclosed as exposed/non-independent evidence |
| Model integrity | SHA-256 `d0712f939ef34ab9470eac357e483e188672f472798d4093ddb5d7e5030cd9f4` in source, build, setup verification, and reports |
| Reproducibility | Pinned datasets, deterministic selection, manifest hashes, training/export code, quantization, calibration gates, and exact WASM reports |
| Automated verification | Lint, strict type-check, unit/manifest tests, production build, and Chrome end-to-end offline test |
| Open licensing | Project/upstream model MIT; Qwen Image Bench Apache-2.0; DOCCI CC BY 4.0; sampled Open Images attribution retained |
| Public source | `https://github.com/thedudeb/synthcheck` |

Primary aggregate report: [`benchmark/results/modern-evaluation.json`](../benchmark/results/modern-evaluation.json).

Methodology and caveats: [modern model evaluation](modern-model-evaluation.md).

## Important limitations

- The modern test result is project evidence, not the private bounty score.
- The test is sample-disjoint. Its six synthetic generator families were absent from training but appeared in validation for calibration, so it is not generator-family-unseen from calibration.
- The older exposed regression reaches 74.25% on one deterministic social-frame screenshot set, missing the stress target by 0.75 points. Older Adobe Firefly screenshots are the clearest remaining weakness.
- Heavy recompression reduces modern-test synthetic recall to 82%; GPT Image 2 is the weakest heavy variant at 66%.
- Images whose pixels Chrome cannot access are marked unavailable. CSS backgrounds, canvas/WebGL, video, protected/authenticated sources, and unusual SVG cases are not guaranteed.
- A score is a screening estimate, not forensic proof of authenticity or generation.
- GitHub contains a 23MB model. Clone normally rather than relying on source-archive tooling that may rewrite large binaries.

## Manual pre-submission check

From a fresh clone, check out the immutable release tag and record its full commit hash:

```sh
git checkout synthcheck-bounty-v2
git rev-parse HEAD
npm ci
npm run verify
npx playwright-core install chromium
npm run test:chrome
shasum -a 256 weights/community-forensics-int8.onnx
```

Confirm:

1. The model digest matches the value above.
2. `npm run verify` and `npm run test:chrome` pass.
3. The repository is public.
4. The README, MIT license, provenance, modern evaluation, aggregate report, and this readiness report render correctly.
5. The submitted tag/commit remains unchanged while maintainers evaluate it.

## Exact manual claim steps

1. Open the POIDH bounty page while signed into the receiving account.
2. Start a submission or claim.
3. Link `https://github.com/thedudeb/synthcheck`.
4. Pin tag `synthcheck-bounty-v2` and the full `git rev-parse HEAD` hash.
5. State that SynthCheck is Manifest V3 with local WASM inference, bundled checksum-verified weights, and no cloud/localhost service.
6. Report the four frozen modern-test scores and clearly label them project results, not the private benchmark.
7. Disclose the exposed legacy screenshot regression at 74.25%.
8. Link the README, model provenance, modern evaluation, aggregate report, and this readiness report.
9. Preserve the referenced commit; identify any later replacement revision explicitly.

Suggested concise claim text:

> SynthCheck is an MIT-licensed Chrome Manifest V3 extension for private, browser-local AI-image likelihood scoring. It bundles a checksum-pinned 23.4MB INT8 Community Forensics ViT-S/16 with a reproducibly trained modern head and performs image preprocessing plus ONNX Runtime Web/WASM inference entirely inside Chrome—no cloud inference, image upload, external API, telemetry, or localhost backend. Clean-profile setup/restart/offline Chrome tests pass. At the fixed displayed 65% threshold, the exact browser artifact scored 92.33% balanced accuracy on 600 frozen sample-disjoint originals, 94.0% on Chrome screenshots, 90.0% after JPEG-75, and 87.33% after heavy double-JPEG recompression. These are project results, not the maintainers' private score. A previously exposed legacy screenshot regression scores 74.25% and is disclosed in the repository. Evaluated revision: tag `synthcheck-bounty-v2`, plus the full commit hash.
