# Reproducible detector benchmark

The benchmark runs the exact ONNX artifact in `onnxruntime-web` WASM, single-threaded, using the same preprocessing and fixed 65% displayed threshold as the extension. Images and per-image predictions are intentionally Git-ignored; aggregate reports, immutable revisions, hashes, and conversion recipes are checked in.

## Environment

```sh
npm ci
python3 -m venv benchmark/.venv
benchmark/.venv/bin/pip install -r benchmark/requirements-conversion.txt
```

## Prepare Defactify samples

Validation selection scans the entire immutable split and retains the lowest SHA-256 row priorities per source:

```sh
npm run benchmark:prepare -- --split validation --real 250 --per-generator 50
```

The historical 1,000-image diagnostic test sample was selected from a fixed 3,000-row prefix, not the entire 45,000-row split:

```sh
npm run benchmark:prepare -- --split test --real 500 --per-generator 100 --scan-limit 3000
```

Preparation verifies that image URLs contain the pinned dataset revision, hashes every downloaded image, and writes `manifest.jsonl` plus `selection.json`. The latter records whether the selection universe was an entire split or a bounded prefix.

## Rebuild the shipping model

Download `model.safetensors` and `config.json` from `OwensLab/commfor-model-224` at revision `26afc31e6b40c312c3fd42c05a758be62446215b`, verify the hashes in [model provenance](../docs/model-provenance.md), then place them in `benchmark/candidates/community_forensics/`.

```sh
benchmark/.venv/bin/python benchmark/candidates/community_forensics/export.py
benchmark/.venv/bin/python benchmark/candidates/community_forensics/quantize.py
shasum -a 256 benchmark/candidates/community_forensics/model-int8.onnx
```

The expected final digest is `9c7a92aafb3a5c14b1626a4cb10a241205254620c6d4a6cc60ca91c15533fc20`.

## Run

```sh
npm run benchmark:run -- \
  --candidate community-forensics-int8 \
  --split validation \
  --calibration benchmark/candidates/community_forensics/calibration-int8.json
```

Use `--split test` only to reproduce the already-exposed diagnostic report. It must not be used to tune future models or calibration.

## Interpretation

- `balancedAccuracy` is the mean of real recall and synthetic recall.
- `threshold` is always the displayed AI-likelihood threshold, 0.65.
- Per-source metrics expose generator-specific failures hidden by aggregate accuracy.
- Success here does not guarantee the private bounty result; only the maintainers can evaluate that held-out set.
