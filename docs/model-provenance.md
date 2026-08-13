# Model provenance

## Current baseline

| Field | Value |
| --- | --- |
| Model | `onnx-community/ai-image-detection-ONNX`, Q4 artifact |
| Immutable revision | `e3cfe99f2841930a040a6281682c10c989965603` |
| Upstream model | `capcheck/ai-image-detection` |
| Architecture | ViT-Base, 224×224 input |
| Training dataset reported upstream | CIFAKE |
| License reported upstream | Apache-2.0 |
| Weight file | `onnx/model_q4.onnx` |
| File size | 56,757,898 bytes |
| SHA-256 | `28c7f06d5aa87bc7e023c023eab1fbf473deef54e9c62f9838a99e50422810ec` |
| Input/output | `pixel_values` → `logits` |
| Label mapping | `0 = REAL`, `1 = FAKE` |
| Normalization | RGB resized to 224×224, mean `[0.5, 0.5, 0.5]`, standard deviation `[0.5, 0.5, 0.5]` |

Source repository: <https://huggingface.co/onnx-community/ai-image-detection-ONNX>

The extension downloads weights only from a URL containing the immutable revision and verifies the digest before storing them. ONNX Runtime Web is installed from the pinned npm lockfile and bundled into the extension; it is not fetched at runtime.

## Known limitations

- The upstream model card identifies older training data and warns that performance on newer generators, compression, and small images may vary.
- Upstream classification metrics are not sufficient evidence for SynthCheck's web-realistic bounty target.
- Quantization can change calibration. The fixed 65% threshold must be measured directly against the exact Q4 browser artifact.
- This is a provisional baseline until a leak-resistant held-out benchmark proves or disproves it.

## Candidate-selection rule

A replacement model must have redistributable weights, traceable provenance, a browser-compatible ONNX graph, acceptable browser resource use, and better source-separated held-out balanced accuracy at the required threshold. Model selection must not use the final held-out partition.
