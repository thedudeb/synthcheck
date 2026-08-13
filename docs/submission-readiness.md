# Bounty submission readiness

Status: **privacy/offline engineering-ready, accuracy qualification uncertain**. This report does not claim that SynthCheck passes the private benchmark.

## Evidence

| Requirement | Evidence |
| --- | --- |
| Native Chrome MV3 | `src/static/manifest.json`; clean-profile Chrome smoke test passed |
| Browser-local inference | ONNX Runtime Web/WASM in the offscreen extension document; no inference API or localhost dependency |
| Offline after setup | Chrome test prepared the bundled model, restarted the browser, disabled networking, and rendered a numeric score |
| Fixed 65% threshold | Shared `AI_THRESHOLD` contract used by classification, UI wording, and benchmark metrics |
| Accuracy gate | Exact 23,433,075-byte INT8 artifact: 77.6% balanced accuracy on the frozen 1,000-image diagnostic sample at displayed threshold 0.65 |
| Independent robustness audit | 66.25% on 400 frontier-generator/original images; 55.0%–59.5% on screenshot and recompression variants, with model and threshold frozen |
| Model integrity | SHA-256 `9c7a92aafb3a5c14b1626a4cb10a241205254620c6d4a6cc60ca91c15533fc20` in source, build, setup verification, and benchmark report |
| Reproducibility | A clean Git archive completed `npm ci` and `npm run verify`; its bundled model digest matched the repository build |
| Automated verification | 15 unit/manifest tests, lint, type-check, production build, Chrome end-to-end test, and npm production audit passed |
| Open licensing | Project MIT license; Community Forensics model and source report MIT licensing; provenance is documented |
| Public source | `https://github.com/thedudeb/ai-poidhbot`, release tag `synthcheck-bounty-v1` |

Primary aggregate report: [`benchmark/results/community-forensics-int8-test.json`](../benchmark/results/community-forensics-int8-test.json).

Independent stress-test report: [`benchmark/results/frontier-audit.json`](../benchmark/results/frontier-audit.json), with methodology in the [frontier robustness audit](frontier-robustness-audit.md).

## Important limitations

- The 77.6% result is project diagnostic evidence, not the private bounty result.
- The newer score-blind frontier audit does not clear 75%: it reaches 66.25% on originals, 55.0% on screenshots, 59.5% after standard social JPEG, and 56.5% after heavy recompression.
- Flux.2 Klein 9B, GPT Image 2, and Nano Banana Pro are material failure modes. The current artifact should not be described as robust across modern generators.
- The diagnostic test sample was selected deterministically from a bounded 3,000-row prefix of the immutable Defactify test split. Its labels have now been exposed and it must not be used for future tuning.
- Generator performance is uneven: the report records 43% synthetic recall for SD3, 55% for Midjourney 6, and 60% for SDXL in this sample.
- Images whose pixels Chrome cannot access are explicitly marked unavailable. CSS backgrounds, canvas/WebGL output, video, protected/authenticated sources, and unusual SVG cases are not guaranteed coverage.
- A score is an estimate, not forensic proof of authenticity or generation.
- GitHub main contains a 23 MB model file. Evaluators should clone normally rather than downloading an auto-generated source archive if their network tooling rewrites large binaries.

## Manual pre-submission check

From a fresh clone, check out the immutable release tag and record its full commit hash:

```sh
git checkout synthcheck-bounty-v1
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
3. The repository visibility is public.
4. The README renders correctly and the MIT license, model provenance, benchmark report, and this readiness report are accessible.
5. No changes have been made after the verified commit unless the checks are rerun and this report is updated.

## Exact manual claim steps

1. Open the POIDH bounty page while signed into the account that should receive the bounty.
2. Select the action to submit or create a claim.
3. Link the public repository: `https://github.com/thedudeb/ai-poidhbot`.
4. Pin the evaluated revision in the claim: tag `synthcheck-bounty-v1` and the full hash printed by `git rev-parse HEAD`.
5. State that SynthCheck is a Manifest V3 extension with browser-local WASM inference, bundled checksum-verified MIT weights, and no cloud or localhost service.
6. Report both development results precisely: **77.6% on the older frozen diagnostic sample, but 66.25% on the independent frontier-original audit and 55.0%–59.5% after degradation; private benchmark not yet evaluated**.
7. Link the README, model-provenance document, aggregate benchmark report, and this readiness report.
8. Submit the claim, then preserve the referenced commit unchanged while maintainers build and test it.
9. If maintainers request fixes, make them in new commits and clearly identify the replacement revision; do not silently rewrite the submitted commit.

Suggested concise claim text:

> SynthCheck is an MIT-licensed Chrome Manifest V3 extension for local AI-image likelihood scoring. It bundles a checksum-pinned 22 MB Community Forensics INT8 model and performs all preprocessing and ONNX Runtime Web/WASM inference inside Chrome, with no cloud inference, image upload, external API, or localhost backend. Clean-profile setup/restart/offline Chrome tests pass. The exact artifact scored 77.6% balanced accuracy on our original frozen diagnostic sample, but a later score-blind frontier audit reached 66.25% on originals and 55.0%–59.5% after screenshot/recompression. These are development results, not a claim that the private benchmark has passed. Evaluated revision: include the full commit hash from `git rev-parse HEAD`.
