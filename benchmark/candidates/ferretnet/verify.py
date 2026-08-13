#!/usr/bin/env python3
"""Verify official PyTorch and exported ONNX FerretNet outputs on author examples."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image
from torchvision.transforms import CenterCrop, Compose, Normalize, ToTensor

from export import OnnxMaskMedian3x3


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.source_root.resolve()))
    from src.model.ferretnet import Ferret  # pylint: disable=import-outside-toplevel
    from src.model.lpd import get_lpd_dict  # pylint: disable=import-outside-toplevel

    model = Ferret(3, 1, 96, [2, 2], "median", 3, get_lpd_dict())
    model.load_state_dict(torch.load(args.checkpoint, map_location="cpu", weights_only=True)["model"])
    model.eval()
    transform = Compose(
        [
            CenterCrop((256, 256)),
            ToTensor(),
            Normalize((0.48145466, 0.4578275, 0.40821073), (0.26862954, 0.26130258, 0.27577711)),
        ]
    )
    session = ort.InferenceSession(args.model.read_bytes(), providers=["CPUExecutionProvider"])
    examples = sorted((args.source_root / "analysis/example/images/cam").glob("*.png"))
    for path in examples:
        tensor = transform(Image.open(path).convert("RGB")).unsqueeze(0)
        with torch.no_grad():
            official = model(tensor).item()
            official_lpd = model.lpd
            model.lpd = OnnxMaskMedian3x3()
            replacement = model(tensor).item()
            model.lpd = official_lpd
        exported = float(session.run(["logits"], {"pixel_values": tensor.numpy()})[0][0, 0])
        print(
            f"{path.name}: official={official:.7f} replacement={replacement:.7f} "
            f"onnx={exported:.7f} probability={torch.sigmoid(torch.tensor(exported)).item():.6f}"
        )


if __name__ == "__main__":
    main()
