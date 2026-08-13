#!/usr/bin/env python3
"""Create a statically quantized xRayon graph using training-split images only."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from onnxruntime.quantization import (
    CalibrationDataReader,
    CalibrationMethod,
    QuantFormat,
    QuantType,
    quantize_static,
)
from PIL import Image
from torchvision.transforms import v2

FP32_SHA256 = "3f949491774eb97cd8d705e73e0bf371d90608a0c8e60f823ebf591ced6b2107"


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


class TrainingImageReader(CalibrationDataReader):
    def __init__(self, manifest: Path, limit: int) -> None:
        root = manifest.parent
        records = [json.loads(line) for line in manifest.read_text().splitlines() if line]
        if len(records) < limit:
            raise ValueError(f"manifest has {len(records)} records; requested {limit}")
        transform = v2.Compose(
            [
                v2.Resize(288),
                v2.CenterCrop(256),
                v2.ToImage(),
                v2.ToDtype(torch.float32, scale=True),
                v2.Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
            ]
        )
        self.samples: list[dict[str, np.ndarray]] = []
        for record in records[:limit]:
            with Image.open(root / record["path"]) as image:
                rgb = image.convert("RGB")
                tensor = transform(rgb).numpy().astype(np.float32, copy=False)
            self.samples.append({"pixel_values": tensor[np.newaxis, ...]})
        self.rewind()

    def get_next(self) -> dict[str, np.ndarray] | None:
        return next(self.iterator, None)

    def rewind(self) -> None:
        self.iterator = iter(self.samples)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=60)
    args = parser.parse_args()

    actual_hash = digest(args.model)
    if actual_hash != FP32_SHA256:
        raise ValueError(f"FP32 model SHA-256 mismatch: {actual_hash}")
    if "/defactify-train/" not in f"/{args.manifest.resolve().as_posix()}":
        raise ValueError("quantization calibration must use the Defactify training split")

    reader = TrainingImageReader(args.manifest, args.samples)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    quantize_static(
        model_input=args.model,
        model_output=args.output,
        calibration_data_reader=reader,
        quant_format=QuantFormat.QDQ,
        activation_type=QuantType.QUInt8,
        weight_type=QuantType.QInt8,
        per_channel=True,
        calibrate_method=CalibrationMethod.MinMax,
        op_types_to_quantize=["Conv", "Gemm", "MatMul"],
        extra_options={"ActivationSymmetric": False, "WeightSymmetric": True},
    )
    print(f"quantized {args.output} ({args.output.stat().st_size} bytes, sha256={digest(args.output)})")


if __name__ == "__main__":
    main()
