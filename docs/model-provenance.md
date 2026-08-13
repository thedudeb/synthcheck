# Model provenance

## Shipping detector

| Field | Value |
| --- | --- |
| Model | `OwensLab/commfor-model-224` |
| Upstream revision | `26afc31e6b40c312c3fd42c05a758be62446215b` |
| Architecture | ViT-Small/16, 224×224 input, single synthetic-image logit |
| Training data reported upstream | Community Forensics / Community Forensics Small, spanning thousands of generators |
| Model license reported upstream | MIT |
| Original artifact | `model.safetensors`, 21,666,049 FP32 parameters |
| Original SHA-256 | `a6cc439d5a6d2dfadd60c77d27a2838ad55b34e601ecd30f46ad97266d6ac4e0` |
| Shipping artifact | `weights/community-forensics-int8.onnx` |
| Shipping size | 23,433,075 bytes |
| Shipping SHA-256 | `9c7a92aafb3a5c14b1626a4cb10a241205254620c6d4a6cc60ca91c15533fc20` |
| Input/output | `pixel_values` → `logits` |
| Preprocessing | Resize short edge to 256, center-crop 224×224, ImageNet RGB mean/std |
| Calibration | Log-odds slope 1, intercept `3.563478187572664`; raw 5% maps to displayed 65% |

Upstream model: <https://huggingface.co/OwensLab/commfor-model-224>

Upstream training/evaluation code: <https://github.com/JeongsooP/Community-Forensics>

The original weights are pinned by revision and digest. `benchmark/candidates/community_forensics/export.py` reconstructs the upstream timm architecture and exports FP32 ONNX; `quantize.py` applies deterministic per-channel dynamic INT8 quantization to MatMul/Gemm weights. Both export parity and browser-runtime loading were verified before selection.

The final ONNX artifact is checked into the repository and bundled into the extension build. Setup recomputes its SHA-256 digest before IndexedDB storage, so no remote weight or inference-asset request occurs at runtime.

## Calibration and selection discipline

The displayed decision boundary is fixed at the bounty's required 65%. A monotonic intercept calibration maps the validation-selected conservative native threshold of 5% to that displayed boundary without changing rank ordering. The calibration was frozen before evaluating the quantized artifact on the diagnostic test sample.

The checked-in quantized report records 77.6% balanced accuracy on 1,000 images: 92.8% real-image recall and 62.4% synthetic-image recall. That split was subsequently exposed and is retained only as transparent diagnostic evidence, not as a future model-selection set.

## Licenses and attribution

- Community Forensics code and published model weights identify MIT licensing.
- ONNX Runtime Web is distributed by Microsoft under the MIT License.
- The local benchmark images are not redistributed or committed; dataset licenses remain with their publishers.

The project root [MIT License](../LICENSE) covers SynthCheck's original source. Third-party copyright notices and license terms remain with their respective projects.
