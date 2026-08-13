#!/usr/bin/env python3
"""Export the pinned official Polimi synthetic-vs-real patch detector."""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch

CHECKPOINT_SHA256 = "c39a5af9a4f5afaaad5ae00c1a82ef8941a87fc7bdb9fc2dfa2b78642629f90d"


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
        raise ValueError("official Polimi checkpoint SHA-256 mismatch")
    sys.path.insert(0, str(args.source_root.resolve()))
    from utils.architectures import EfficientNetB4  # pylint: disable=import-outside-toplevel

    model = EfficientNetB4(n_classes=2, pretrained=False)
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model.load_state_dict(checkpoint["net"], strict=True)
    model.eval()
    example = torch.linspace(0, 1, 4 * 3 * 96 * 96, dtype=torch.float32).reshape(4, 3, 96, 96)
    with torch.no_grad():
        expected = model(example).numpy()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        (example,),
        args.output,
        input_names=["pixel_values"],
        output_names=["patch_logits"],
        dynamic_axes={"pixel_values": {0: "patch_count"}, "patch_logits": {0: "patch_count"}},
        opset_version=18,
        dynamo=False,
    )
    graph = onnx.load(args.output)
    onnx.checker.check_model(graph)
    session = ort.InferenceSession(args.output.read_bytes(), providers=["CPUExecutionProvider"])
    actual = session.run(["patch_logits"], {"pixel_values": example.numpy()})[0]
    difference = float(np.max(np.abs(expected - actual)))
    if difference > 1e-4:
        raise ValueError(f"ONNX parity mismatch: max abs error {difference}")
    print(
        f"exported {args.output} ({args.output.stat().st_size} bytes, "
        f"sha256={digest(args.output)}, max_abs_error={difference})"
    )


if __name__ == "__main__":
    main()
