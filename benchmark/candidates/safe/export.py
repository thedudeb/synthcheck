#!/usr/bin/env python3
"""Export the pinned official SAFE checkpoint to ONNX and verify parity."""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnx import helper
from torch import nn
from torch.nn import functional as F

CHECKPOINT_SHA256 = "b3f5ecfb46a154ed553aaaf4bf3ba59182310726ddb0cbb1fe42bd0e22d2f20e"


class FixedSafeWavelet(nn.Module):
    """Exact 256px bior1.3 diagonal detail preprocessing in traceable ops."""

    def __init__(self, antialias: bool = True) -> None:
        super().__init__()
        self.antialias = antialias
        low = [-0.0883883461356163, 0.0883883461356163, 0.7071067690849304,
               0.7071067690849304, 0.0883883461356163, -0.0883883461356163]
        high = [0.0, -0.0, 0.7071067690849304, -0.7071067690849304, 0.0, -0.0]
        row_filters = torch.tensor([low, high] * 3, dtype=torch.float32).reshape(6, 1, 1, 6)
        column_filters = torch.tensor([low, high] * 6, dtype=torch.float32).reshape(12, 1, 6, 1)
        # pytorch_wavelets symmetric padding for N=256, L=6 is four samples
        # on each side, reflected around half-sample boundaries.
        symmetric_indices = torch.tensor([3, 2, 1, 0, *range(256), 255, 254, 253, 252], dtype=torch.int64)
        self.register_buffer("row_filters", row_filters)
        self.register_buffer("column_filters", column_filters)
        self.register_buffer("symmetric_indices", symmetric_indices)

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        padded_width = torch.index_select(tensor, 3, self.symmetric_indices)
        row_bands = F.conv2d(padded_width, self.row_filters, stride=(1, 2), groups=3)
        padded_height = torch.index_select(row_bands, 2, self.symmetric_indices)
        all_bands = F.conv2d(padded_height, self.column_filters, stride=(2, 1), groups=6)
        diagonal = all_bands.reshape(tensor.shape[0], 3, 4, 130, 130)[:, :, 3]
        return F.interpolate(
            diagonal,
            size=(256, 256),
            mode="bilinear",
            align_corners=False,
            antialias=self.antialias,
        )


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
        raise ValueError("official SAFE checkpoint SHA-256 mismatch")

    sys.path.insert(0, str(args.source_root.resolve()))
    from models.resnet import resnet50  # pylint: disable=import-outside-toplevel

    model = resnet50(num_classes=2)
    model.load_state_dict(torch.load(args.checkpoint, map_location="cpu", weights_only=True)["model"], strict=True)
    model.eval()
    example = torch.linspace(0, 1, 3 * 256 * 256, dtype=torch.float32).reshape(1, 3, 256, 256)
    with torch.no_grad():
        official_wavelet = model._preprocess_dwt(example)
        fixed_wavelet_module = FixedSafeWavelet()
        fixed_wavelet = fixed_wavelet_module(example)
        wavelet_difference = float(torch.max(torch.abs(official_wavelet - fixed_wavelet)).item())
        if wavelet_difference > 1e-6:
            raise ValueError(f"fixed wavelet mismatch: max abs error {wavelet_difference}")
        expected = model(example).numpy()
        model._preprocess_dwt = fixed_wavelet_module.forward
        replaced = model(example).numpy()
        replacement_difference = float(np.max(np.abs(expected - replaced)))
        if replacement_difference > 1e-5:
            raise ValueError(f"fixed preprocessing model mismatch: max abs error {replacement_difference}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    # The legacy exporter cannot translate PyTorch's private antialiased resize
    # operator. Export the identical standard Resize node first, then enable
    # ONNX opset-18's antialias attribute and verify final-output parity.
    model._preprocess_dwt = FixedSafeWavelet(antialias=False).forward
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
    resize_nodes = [node for node in graph.graph.node if node.op_type == "Resize"]
    if len(resize_nodes) != 1:
        raise ValueError(f"expected one Resize node, found {len(resize_nodes)}")
    resize_nodes[0].attribute.append(helper.make_attribute("antialias", 1))
    onnx.save(graph, args.output)
    graph = onnx.load(args.output)
    onnx.checker.check_model(graph)
    session = ort.InferenceSession(args.output.read_bytes(), providers=["CPUExecutionProvider"])
    actual = session.run(["logits"], {"pixel_values": example.numpy()})[0]
    difference = float(np.max(np.abs(expected - actual)))
    if difference > 1e-4:
        raise ValueError(f"ONNX parity mismatch: max abs error {difference}")
    print(
        f"exported {args.output} ({args.output.stat().st_size} bytes, sha256={digest(args.output)}, "
        f"wavelet_error={wavelet_difference}, model_replacement_error={replacement_difference}, "
        f"onnx_error={difference})"
    )


if __name__ == "__main__":
    main()
