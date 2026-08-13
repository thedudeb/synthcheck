# Frontier-generator robustness audit and exposed regression

## Outcome

The former frozen SynthCheck model did **not** clear the bounty's 75.0% target on this independently sourced audit. It reached **66.25%** on originals and **55.0%–59.5%** after screenshot or social-media transformations. Those score-blind results exposed the modern-generator gap that blocked the first submission candidate.

The set is now exposed. Shipping v2 is re-run on it only as transparent regression evidence; the separate [modern model evaluation](modern-model-evaluation.md) provides v2's score-blind test.

## Shipping v2 regression

V2's model and calibration were frozen on the separate modern validation corpus. However, the original audit findings informed subsequent engineering priorities, so the following results are not independent and were not used to recalibrate v2.

| Variant | Balanced accuracy | Real recall | Synthetic recall |
| --- | ---: | ---: | ---: |
| Original | 84.50% | 89.00% | 80.00% |
| Chrome screenshot | 74.25% | 94.00% | 54.50% |
| Social JPEG q75 | 82.50% | 89.50% | 75.50% |
| Heavy double JPEG | 76.75% | 93.50% | 60.00% |

The regression improves originals by 18.25 points and the JPEG variants by 20.25–22.25 points. Its screenshot result remains 0.75 points below the stress target, mostly because the older Adobe Firefly screenshots are frequently missed. This limitation is retained in the submission report.

## Frozen protocol

- The exact former shipping INT8 model, SHA-256 `9c7a92aafb3a5c14b1626a4cb10a241205254620c6d4a6cc60ca91c15533fc20`, was used unchanged for the original score-blind audit.
- Calibration remained slope `1`, intercept `3.563478187572664`; the displayed decision threshold remained `0.65`.
- Source membership and transformations were frozen before the first inference result was inspected.
- No model, calibration, threshold, or sample was changed after scores were visible.
- ONNX Runtime Web 1.22.0 used its single-threaded WASM provider, matching the shipping path.

The 400-image original set is balanced: 200 authentic images and 200 synthetic images.

| Source | Count | Role |
| --- | ---: | --- |
| OpenFake DOCCI | 100 | Real |
| OpenFake ImageNet | 100 | Real |
| OpenFake Flux.2 Klein 9B | 50 | Synthetic |
| OpenFake GPT Image 1.5 | 25 | Synthetic |
| OpenFake GPT Image 2 | 25 | Synthetic |
| OpenFake Nano Banana Pro | 19 | Synthetic |
| Qwen Image Bench Imagen 4 | 31 | Synthetic |
| Synthbuster Adobe Firefly | 50 | Synthetic |

Sources are pinned to immutable releases:

- [OpenFake core test](https://huggingface.co/datasets/ComplexDataLab/OpenFake/tree/3fd1109dc3258874243fa31c5bda9ee24260163b), revision `3fd1109dc3258874243fa31c5bda9ee24260163b`, CC-BY-NC-4.0 metadata.
- [Qwen Image Bench](https://huggingface.co/datasets/Qwen/Qwen-Image-Bench/tree/d2493deb153b020cf169c7e3f57d15e4dd697038), revision `d2493deb153b020cf169c7e3f57d15e4dd697038`, Apache-2.0.
- [Synthbuster](https://zenodo.org/records/10066460), record `10066460`, archive MD5 `0695bd328e16ea21c5c9cc2ae1d994ff`, CC-BY-NC-SA-4.0.

The external images and per-image predictions remain Git-ignored. The repository contains the deterministic preparation code, pinned sources, selection rules, transformation code, aggregate reports, and artifact hashes.

## Aggregate results

| Variant | Balanced accuracy | Real recall | Synthetic recall | Change vs. original |
| --- | ---: | ---: | ---: | ---: |
| Original | 66.25% | 86.0% | 46.5% | — |
| Chrome screenshot | 55.0% | 73.0% | 37.0% | -11.25 pp |
| Social JPEG, 1080 px/q75 | 59.5% | 87.5% | 31.5% | -6.75 pp |
| Heavy two-pass JPEG, 720/q50 then 640/q38 | 56.5% | 92.5% | 20.5% | -9.75 pp |

Recompression makes the detector more conservative: it rejects fewer authentic images, but synthetic recall collapses. The screenshot result includes both image rasterization and a deterministic 1170×1400 social-post frame rendered by Chrome.

## Generator recall

| Generator | Original | Screenshot | Social q75 | Heavy social |
| --- | ---: | ---: | ---: | ---: |
| Adobe Firefly | 76.0% | 48.0% | 48.0% | 34.0% |
| Flux.2 Klein 9B | 8.0% | 16.0% | 10.0% | 4.0% |
| GPT Image 1.5 | 52.0% | 16.0% | 44.0% | 40.0% |
| GPT Image 2 | 16.0% | 8.0% | 16.0% | 4.0% |
| Imagen 4 | 90.3% | 90.3% | 38.7% | 19.4% |
| Nano Banana Pro | 31.6% | 42.1% | 36.8% | 26.3% |

For the former model, the strongest original-source results were Imagen 4 and the older Firefly subset; Flux.2, GPT Image 2, and Nano Banana Pro were the clearest release blockers.

## Reproduce

With Node.js 20.9 or newer and Chrome installed:

```sh
npm ci
npm run benchmark:frontier:prepare
npm run benchmark:frontier:transform
npm run benchmark:run -- --split original --dataset-dir benchmark/data/frontier-original --result-name frontier-original --calibration benchmark/candidates/community_forensics/calibration-int8.json
npm run benchmark:run -- --split screenshot --dataset-dir benchmark/data/frontier-screenshot --result-name frontier-screenshot --calibration benchmark/candidates/community_forensics/calibration-int8.json
npm run benchmark:run -- --split social-q75 --dataset-dir benchmark/data/frontier-social-q75 --result-name frontier-social-q75 --calibration benchmark/candidates/community_forensics/calibration-int8.json
npm run benchmark:run -- --split social-heavy --dataset-dir benchmark/data/frontier-social-heavy --result-name frontier-social-heavy --calibration benchmark/candidates/community_forensics/calibration-int8.json
npm run benchmark:frontier:summarize
```

The primary machine-readable report is [`benchmark/results/frontier-audit.json`](../benchmark/results/frontier-audit.json).

## Limitations

- OpenFake focuses on politically and socially salient images; the result is not an estimate for every browsing domain.
- The original baseline audit was score-blind, but its exposed findings later informed v2 engineering priorities. V2's re-run must therefore be interpreted only as regression evidence. Complete non-overlap with the upstream Community Forensics corpus also cannot be proven for older Firefly or real-image sources.
- Only 19 Nano Banana Pro records existed in the pinned OpenFake test split, so the 50-image Google-family stratum adds 31 Imagen 4 images from Qwen Image Bench.
- Synthbuster's Firefly images are from its 2023 release and do not represent every later Firefly model.
- The screenshot is one deterministic Chrome/social-frame simulation, not every platform, crop, display density, or device.
- The four variants are correlated derivatives of the same 400 sources; they are 1,600 predictions, not 1,600 independent source images.
