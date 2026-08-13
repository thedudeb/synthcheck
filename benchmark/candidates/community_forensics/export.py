"""Export the pinned Community Forensics ViT-S/16 detector to ONNX.

Upstream model: OwensLab/commfor-model-224 at revision
26afc31e6b40c312c3fd42c05a758be62446215b (MIT).
"""

from pathlib import Path

import numpy as np
import onnxruntime as ort
import timm
import torch
from safetensors.torch import load_file


ROOT = Path(__file__).resolve().parent
WEIGHTS = ROOT / "model.safetensors"
OUTPUT = ROOT / "model.onnx"


class Detector(torch.nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.vit = timm.create_model(
            "vit_small_patch16_224.augreg_in21k_ft_in1k",
            pretrained=False,
            num_classes=1,
        )

    def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
        return self.vit(pixel_values)


def main() -> None:
    torch.manual_seed(20260813)
    model = Detector().eval()
    state = load_file(str(WEIGHTS))
    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing or unexpected:
        raise RuntimeError(f"State mismatch: missing={missing}, unexpected={unexpected}")

    sample = torch.randn(1, 3, 224, 224)
    with torch.no_grad():
        expected = model(sample).numpy()
    torch.onnx.export(
        model,
        sample,
        OUTPUT,
        input_names=["pixel_values"],
        output_names=["logits"],
        dynamic_axes={"pixel_values": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=18,
        do_constant_folding=True,
    )

    session = ort.InferenceSession(str(OUTPUT), providers=["CPUExecutionProvider"])
    actual = session.run(["logits"], {"pixel_values": sample.numpy()})[0]
    max_error = float(np.max(np.abs(expected - actual)))
    if max_error > 1e-4:
        raise RuntimeError(f"ONNX parity error is too high: {max_error}")
    print({"output": str(OUTPUT), "bytes": OUTPUT.stat().st_size, "max_abs_error": max_error})


if __name__ == "__main__":
    main()
