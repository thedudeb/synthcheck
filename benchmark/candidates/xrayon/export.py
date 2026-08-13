#!/usr/bin/env python3
"""Export the pinned xRayon ConvNeXtV2 candidate checkpoint to ONNX."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

import onnx
import torch
import timm

CHECKPOINT_SHA256 = "37f31776a241b575dc034ddded7afd12014ba453ac07cbe3725f808787717f0e"


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    actual_hash = digest(args.checkpoint)
    if actual_hash != CHECKPOINT_SHA256:
        raise ValueError(f"checkpoint SHA-256 mismatch: {actual_hash}")

    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    print(f"checkpoint keys: {sorted(checkpoint.keys())}")
    state_dict = checkpoint.get("model_state_dict", checkpoint.get("model", checkpoint))
    model = timm.create_model("convnextv2_base.fcmae_ft_in1k", pretrained=False, num_classes=2)
    missing, unexpected = model.load_state_dict(state_dict, strict=False)
    if missing or unexpected:
        raise ValueError(f"state mismatch: missing={missing}, unexpected={unexpected}")
    model.eval()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    example = torch.zeros(1, 3, 256, 256, dtype=torch.float32)
    torch.onnx.export(
        model,
        (example,),
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
