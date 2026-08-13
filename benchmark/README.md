# Reproducible detector benchmark

The benchmark runs the exact ONNX artifact in `onnxruntime-web` WASM, single-threaded, with the extension's preprocessing and fixed 65% display threshold. Images and per-image predictions are Git-ignored; aggregate reports, immutable revisions, hashes, selection code, and conversion recipes are checked in.

## Environment

```sh
npm ci
python3 -m venv benchmark/.venv
benchmark/.venv/bin/pip install -r benchmark/requirements-conversion.txt
```

## Rebuild the shipping detector

Download `model.safetensors` from `OwensLab/commfor-model-224` at revision `26afc31e6b40c312c3fd42c05a758be62446215b`, verify SHA-256 `a6cc439d5a6d2dfadd60c77d27a2838ad55b34e601ecd30f46ad97266d6ac4e0`, and place it in `benchmark/candidates/community_forensics/`.

Prepare deterministic Qwen Image Bench and Open Images train/validation/test samples, then add the official DOCCI-train stratum:

```sh
npm run benchmark:modern:prepare
npm run benchmark:modern:prepare:docci
```

The first command selects 1,200 synthetic training images across 12 generators, 1,200 Open Images training photographs, and two disjoint balanced 600-image validation/test sets. The second command verifies the official DOCCI archive and adds 1,200 CC BY 4.0 train images. All exposed frontier-audit names and hashes are excluded.

Train the source-balanced replacement head, export FP32 ONNX, verify parity, and quantize:

```sh
benchmark/.venv/bin/python benchmark/modern/train_rehead.py \
  --output-dir benchmark/candidates/community_forensics_rehead_v2
```

The expected INT8 artifact is 23,433,075 bytes with SHA-256 `d0712f939ef34ab9470eac357e483e188672f472798d4093ddb5d7e5030cd9f4`.

Generate the exact validation transformations:

```sh
node --import tsx benchmark/transform-frontier-audit.ts \
  --source-dir benchmark/data/modern-head \
  --source-manifest validation-manifest.jsonl \
  --output-prefix benchmark/data/modern-validation \
  --variant all
```

Run the quantized model without calibration on the original, screenshot, JPEG-75, and heavy validation sets. Use result names with prefix `community-forensics-rehead-v2-modern-validation-`, then fit the single constrained display calibration:

```sh
npm run benchmark:modern:calibrate
```

Calibration refuses non-validation reports and refuses to emit unless one threshold clears every accuracy, class-recall, and per-generator gate on all four exact WASM variants.

After the model and calibration are frozen, generate the test transforms and run the same four commands with `test-manifest.jsonl`, `benchmark/data/modern-test-*`, and the frozen calibration. Generate the checked-in aggregate report:

```sh
npm run benchmark:modern:summarize
```

See [modern model evaluation](../docs/modern-model-evaluation.md) and [`modern-evaluation.json`](results/modern-evaluation.json) for the frozen results and limitations.

## Historical Defactify evaluation

The original model-selection work used deterministic Defactify samples. Validation scans the immutable split and retains the lowest SHA-256 priorities per source:

```sh
npm run benchmark:prepare -- --split validation --real 250 --per-generator 50
```

The historical 1,000-image diagnostic test sample came from a fixed 3,000-row prefix:

```sh
npm run benchmark:prepare -- --split test --real 500 --per-generator 100 --scan-limit 3000
```

Its labels are exposed. Retain it only as historical evidence; never use it for future training, calibration, or model selection.

## Frontier regression audit

The original score-blind audit froze 400 balanced images from OpenFake, Qwen Image Bench, and Synthbuster, then created Chrome screenshot and social recompression variants:

```sh
npm run benchmark:frontier:prepare
npm run benchmark:frontier:transform
```

That audit exposed the former shipping model's modern-generator weaknesses and is no longer an independent set. V2 re-runs are retained only as transparent regression evidence. See [frontier robustness audit](../docs/frontier-robustness-audit.md).

## Interpretation

- `balancedAccuracy` is the mean of real and synthetic recall.
- `threshold` is always the displayed AI-likelihood threshold, 0.65.
- Per-source metrics expose generator-specific failures hidden by aggregates.
- The sample-disjoint modern test holds its six synthetic families out of training, but the same families occur in calibration validation.
- Project evaluation cannot guarantee the maintainers' private bounty result.
