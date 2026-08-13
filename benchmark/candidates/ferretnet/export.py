#!/usr/bin/env python3
"""Export the pinned official FerretNet-B checkpoint to ONNX."""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import onnx
import torch
from torch import nn
from torch.nn import functional as F

CHECKPOINT_SHA256 = "fe755d78370bb6547070329553572405b4ecebd23382c9a6cbb11c4ab85a82c2"


class OnnxMaskMedian3x3(nn.Module):
    """Exact official MaskMedianValues(3) using ONNX Min/Max primitives."""

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        padded = F.pad(tensor, (1, 1, 1, 1), mode="constant", value=0.0)
        height, width = tensor.shape[-2:]
        values = [
            padded[:, :, y : y + height, x : x + width]
            if not (y == 1 and x == 1)
            else torch.zeros_like(tensor)
            for y in range(3)
            for x in range(3)
        ]
        # A fixed bubble sorting network is small for nine values and exports to
        # elementwise Min/Max, both supported by ONNX Runtime Web.
        for upper in range(8, 0, -1):
            for index in range(upper):
                lower = torch.minimum(values[index], values[index + 1])
                higher = torch.maximum(values[index], values[index + 1])
                values[index], values[index + 1] = lower, higher
        return values[4]


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    if digest(args.checkpoint) != CHECKPOINT_SHA256:
        raise ValueError("official checkpoint SHA-256 mismatch")
    sys.path.insert(0, str(args.source_root.resolve()))
    from src.model.ferretnet import Ferret  # pylint: disable=import-outside-toplevel
    from src.model.lpd import get_lpd_dict  # pylint: disable=import-outside-toplevel

    model = Ferret(
        in_channels=3,
        num_classes=1,
        dim=96,
        depths=[2, 2],
        lpd_func="median",
        window_size=3,
        lpd_dict=get_lpd_dict(),
    )
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model.load_state_dict(checkpoint["model"], strict=True)
    model.eval()

    official_lpd = model.lpd
    replacement_lpd = OnnxMaskMedian3x3()
    probe = torch.linspace(-2, 2, 3 * 17 * 19, dtype=torch.float32).reshape(1, 3, 17, 19)
    if not torch.equal(official_lpd(probe), replacement_lpd(probe)):
        difference = torch.max(torch.abs(official_lpd(probe) - replacement_lpd(probe))).item()
        raise ValueError(f"ONNX median replacement mismatch: max abs error {difference}")
    model.lpd = replacement_lpd

    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        (torch.zeros(1, 3, 256, 256, dtype=torch.float32),),
        args.output,
        input_names=["pixel_values"],
        output_names=["logits"],
        opset_version=18,
        dynamo=False,
    )
    graph = onnx.load(args.output)
    onnx.checker.check_model(graph)
    print(f"exported {args.output} ({args.output.stat().st_size} bytes, sha256={digest(args.output)})")


if __name__ == "__main__":
    main()
