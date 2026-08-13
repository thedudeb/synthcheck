# Model provenance

## Shipping detector

| Field | Value |
| --- | --- |
| Model | `SynthCheck/community-forensics-modern-rehead-v2@20260813` |
| Architecture | Frozen Community Forensics ViT-Small/16 backbone, SynthCheck linear head, 224×224 input, one synthetic-image logit |
| Upstream model | `OwensLab/commfor-model-224` |
| Upstream revision | `26afc31e6b40c312c3fd42c05a758be62446215b` |
| Upstream license | MIT |
| Original upstream artifact | `model.safetensors`, 21,666,049 FP32 parameters |
| Original upstream SHA-256 | `a6cc439d5a6d2dfadd60c77d27a2838ad55b34e601ecd30f46ad97266d6ac4e0` |
| Shipping artifact | `weights/community-forensics-int8.onnx` |
| Shipping size | 23,433,075 bytes |
| Shipping SHA-256 | `d0712f939ef34ab9470eac357e483e188672f472798d4093ddb5d7e5030cd9f4` |
| Input/output | `pixel_values` → `logits` |
| Preprocessing | Resize short edge to 256, center-crop 224×224, ImageNet RGB mean/std |
| Calibration | Log-odds slope 1, intercept `0.65819564532639`; raw probability `0.49021214132173707` maps to displayed 65% |

Upstream model: <https://huggingface.co/OwensLab/commfor-model-224>

Upstream training/evaluation code: <https://github.com/JeongsooP/Community-Forensics>

The upstream weights are pinned by revision and digest. SynthCheck reconstructs the upstream timm architecture, freezes its feature extractor, trains a replacement linear head, exports FP32 ONNX, verifies PyTorch/ONNX parity, and applies deterministic per-channel dynamic INT8 quantization to MatMul/Gemm weights.

The final ONNX artifact is checked into the repository and bundled into the extension build. Setup recomputes its SHA-256 before IndexedDB storage, so no remote weight or inference-asset request occurs at runtime.

## Re-head training data

Training uses deterministic subsets of permissively licensed sources. Images remain local and Git-ignored.

| Source | Role | Count | Revision/license |
| --- | --- | ---: | --- |
| Qwen Image Bench | Synthetic training | 1,200 across 12 generator families | `d2493deb153b020cf169c7e3f57d15e4dd697038`, Apache-2.0 |
| Open Images V7 validation mirror | Real training | 1,200 | Per-image CC BY 2.0 metadata retained |
| DOCCI official train split | Real training | 1,200 | `a0a43eaf34676ffd008fb6565dd8c2ba00d09100`, CC BY 4.0 |

The six Qwen Image Bench validation/test generator families are absent from training. Each training image receives deterministic original, social-frame screenshot, JPEG-75-style, and heavy double-JPEG views. Sampling is class balanced while the ViT backbone remains frozen.

`benchmark/modern/prepare.ts` records Qwen/Open Images selection and attribution. `prepare_docci.py` verifies the official 7,592,938,768-byte DOCCI archive (MD5 `57493de5075fe508d51e77500748f4da`) and extracts only the lowest-priority official train examples. `train_rehead.py` records manifest hashes, seed, parity, and quantized artifact details.

## Calibration and selection discipline

The displayed boundary is fixed at the bounty's required 65%. Calibration was fitted from raw predictions produced by the exact quantized model under ONNX Runtime Web/WASM on a balanced 600-image validation set and its three deterministic degradation variants.

The calibration gate required, on every validation variant:

- at least 75% balanced accuracy;
- at least 85% real recall;
- at least 70% synthetic recall; and
- at least 60% recall for every held-out generator.

The frozen calibration then ran once on a separate, sample-disjoint 600-image test. Balanced accuracy was 92.33% on originals, 94.0% on screenshots, 90.0% on JPEG-75, and 87.33% after heavy recompression. See [modern model evaluation](modern-model-evaluation.md). These are project results, not the maintainers' private benchmark.

## Licenses and attribution

- Community Forensics code and published model weights identify MIT licensing.
- SynthCheck's training/export code and replacement head are released under the project MIT license.
- Qwen Image Bench identifies Apache-2.0; DOCCI identifies CC BY 4.0; sampled Open Images metadata identifies CC BY 2.0 per image.
- ONNX Runtime Web is distributed by Microsoft under the MIT License.
- Training and benchmark images are not redistributed or committed; source licenses and attribution remain with their publishers.

The project root [MIT License](../LICENSE) covers SynthCheck's original source and shipping head. Third-party copyright notices and source terms remain with their respective projects.
