"""Train and export a modern source-balanced head on the frozen Community Forensics ViT.

The exposed frontier audit is never read here. Model selection and calibration use
only the generator-family-held-out modern validation manifest.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
import json
import math
from pathlib import Path
import random
import time

import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps
from safetensors.torch import load_file
import timm
import torch
from torch import nn
from torchvision.transforms import InterpolationMode
from torchvision.transforms import functional as tvf


SEED = 20260813
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)
INPUT_SIZE = 224
RESIZE_SHORT_EDGE = 256
VARIANTS = ("original", "screenshot", "social-q75", "social-heavy")
FEATURE_PIPELINE_VERSION = 2
WEIGHTS_SHA256 = "a6cc439d5a6d2dfadd60c77d27a2838ad55b34e601ecd30f46ad97266d6ac4e0"


@dataclass(frozen=True)
class Item:
    id: str
    path: Path
    image_sha256: str
    label: int
    source: str


class Detector(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.vit = timm.create_model(
            "vit_small_patch16_224.augreg_in21k_ft_in1k",
            pretrained=False,
            num_classes=1,
        )

    def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
        return self.vit(pixel_values)


def digest(path: Path) -> str:
    hasher = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def load_manifest(path: Path, data_root: Path) -> list[Item]:
    items: list[Item] = []
    for line in path.read_text().splitlines():
        if not line:
            continue
        row = json.loads(line)
        items.append(
            Item(
                id=row["id"],
                path=data_root / row["path"],
                image_sha256=row["imageSha256"],
                label=int(row["label"]),
                source=row["source"],
            )
        )
    if not items:
        raise ValueError(f"Manifest is empty: {path}")
    return items


def seeded_random(item: Item, variant: str) -> random.Random:
    value = int(sha256(f"{SEED}:{item.id}:{variant}".encode()).hexdigest()[:16], 16)
    return random.Random(value)


def resize_long_edge(image: Image.Image, maximum: int) -> Image.Image:
    width, height = image.size
    if max(width, height) <= maximum:
        return image
    scale = maximum / max(width, height)
    return image.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.Resampling.LANCZOS)


def jpeg_roundtrip(image: Image.Image, quality: int) -> Image.Image:
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=quality, subsampling=2, optimize=False)
    buffer.seek(0)
    with Image.open(buffer) as decoded:
        return decoded.convert("RGB")


def degrade(image: Image.Image, item: Item, variant: str, training: bool) -> Image.Image:
    rng = seeded_random(item, variant)
    if variant == "original":
        return image
    if variant == "screenshot":
        # Reproduce a rasterized social post rather than merely rescaling the
        # source. The letterboxing and surrounding UI are the hard part for a
        # detector that will encounter screenshots as ordinary web images.
        frame = Image.new("RGB", (1170, 1400), (238, 241, 244))
        draw = ImageDraw.Draw(frame)
        draw.rounded_rectangle((46, 46, 1124, 1354), radius=24, fill=(255, 255, 255), outline=(217, 222, 229), width=2)
        draw.ellipse((74, 69, 122, 117), fill=(72, 132, 220))
        draw.rounded_rectangle((138, 84, 318, 99), radius=8, fill=(200, 206, 214))
        media_left, media_top, media_width, media_height = 47, 140, 1076, 1110
        draw.rectangle(
            (media_left, media_top, media_left + media_width - 1, media_top + media_height - 1),
            fill=(17, 21, 26),
        )
        scale = min(media_width / image.width, media_height / image.height)
        if training:
            scale *= rng.uniform(0.94, 1.0)
        rendered = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.Resampling.LANCZOS,
        )
        frame.paste(
            rendered,
            (
                media_left + (media_width - rendered.width) // 2,
                media_top + (media_height - rendered.height) // 2,
            ),
        )
        for x in (78, 124, 170):
            draw.ellipse((x, 1291, x + 22, 1313), outline=(136, 145, 155), width=3)
        return frame
    if variant == "social-q75":
        maximum = rng.randint(800, 1280) if training else 1080
        quality = rng.randint(60, 88) if training else 75
        transformed = resize_long_edge(image, maximum)
        if training and rng.random() < 0.5:
            transformed = transformed.filter(ImageFilter.GaussianBlur(rng.uniform(0.1, 0.65)))
        return jpeg_roundtrip(transformed, quality)
    if variant == "social-heavy":
        first_edge = rng.randint(600, 900) if training else 720
        second_edge = rng.randint(480, 720) if training else 640
        first_quality = rng.randint(38, 62) if training else 50
        second_quality = rng.randint(28, 48) if training else 38
        transformed = jpeg_roundtrip(resize_long_edge(image, first_edge), first_quality)
        transformed = jpeg_roundtrip(resize_long_edge(transformed, second_edge), second_quality)
        return transformed
    raise ValueError(f"Unknown degradation variant: {variant}")


def preprocess(item: Item, variant: str, training: bool) -> torch.Tensor:
    with Image.open(item.path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    image = degrade(image, item, variant, training)
    if training:
        rng = seeded_random(item, f"appearance:{variant}")
        image = ImageEnhance.Color(image).enhance(rng.uniform(0.9, 1.1))
        image = ImageEnhance.Contrast(image).enhance(rng.uniform(0.92, 1.08))
    image = tvf.resize(image, RESIZE_SHORT_EDGE, interpolation=InterpolationMode.BILINEAR, antialias=True)
    image = tvf.center_crop(image, [INPUT_SIZE, INPUT_SIZE])
    tensor = tvf.pil_to_tensor(image).float().div_(255.0)
    return tvf.normalize(tensor, MEAN, STD)


def extract_features(
    model: Detector,
    items: list[Item],
    device: torch.device,
    batch_size: int,
    training: bool,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    features: list[np.ndarray] = []
    labels: list[int] = []
    variants: list[int] = []
    sources: list[str] = []
    expanded = [(item, variant_index, variant) for item in items for variant_index, variant in enumerate(VARIANTS)]
    started = time.perf_counter()
    with torch.inference_mode():
        for offset in range(0, len(expanded), batch_size):
            batch = expanded[offset : offset + batch_size]
            tensors = torch.stack([preprocess(item, variant, training) for item, _, variant in batch]).to(device)
            tokens = model.vit.forward_features(tensors)
            embeddings = model.vit.forward_head(tokens, pre_logits=True)
            features.append(embeddings.float().cpu().numpy())
            labels.extend(item.label for item, _, _ in batch)
            variants.extend(variant_index for _, variant_index, _ in batch)
            sources.extend(item.source for item, _, _ in batch)
            completed = min(offset + batch_size, len(expanded))
            if completed % (batch_size * 10) == 0 or completed == len(expanded):
                elapsed = time.perf_counter() - started
                print(f"Extracted {completed}/{len(expanded)} features ({completed / max(elapsed, 1e-6):.1f}/s)", flush=True)
    return (
        np.concatenate(features),
        np.asarray(labels, dtype=np.float32),
        np.asarray(variants, dtype=np.int64),
        np.asarray(sources),
    )


def extract_or_load_features(
    model: Detector,
    items: list[Item],
    manifest_path: Path,
    cache_path: Path,
    device: torch.device,
    batch_size: int,
    training: bool,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    manifest_hash = digest(manifest_path)
    if cache_path.exists():
        cache = np.load(cache_path, allow_pickle=False)
        if (
            str(cache["manifest_hash"].item()) == manifest_hash
            and int(cache["pipeline_version"].item()) == FEATURE_PIPELINE_VERSION
        ):
            print(f"Loaded feature cache {cache_path}", flush=True)
            return cache["features"], cache["labels"], cache["variants"], cache["sources"]
    result = extract_features(model, items, device, batch_size, training)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cache_path,
        features=result[0],
        labels=result[1],
        variants=result[2],
        sources=result[3],
        manifest_hash=np.asarray(manifest_hash),
        pipeline_version=np.asarray(FEATURE_PIPELINE_VERSION),
    )
    return result


def balanced_accuracy(logits: np.ndarray, labels: np.ndarray, threshold: float) -> float:
    predicted = logits >= threshold
    true_positive_rate = float(predicted[labels == 1].mean())
    true_negative_rate = float((~predicted[labels == 0]).mean())
    return (true_positive_rate + true_negative_rate) / 2


def choose_threshold(logits: np.ndarray, labels: np.ndarray, variants: np.ndarray) -> tuple[float, dict[str, float]]:
    candidates = np.unique(np.quantile(logits, np.linspace(0.02, 0.98, 385)))
    candidates = np.concatenate(([float(logits.min()) - 1e-6], candidates, [float(logits.max()) + 1e-6]))
    best_key = (-1.0, -1.0)
    best_threshold = 0.0
    best_scores: dict[str, float] = {}
    for threshold in candidates:
        scores = {
            name: balanced_accuracy(logits[variants == index], labels[variants == index], float(threshold))
            for index, name in enumerate(VARIANTS)
        }
        key = (min(scores.values()), sum(scores.values()) / len(scores))
        if key > best_key:
            best_key = key
            best_threshold = float(threshold)
            best_scores = scores
    return best_threshold, best_scores


def train_head(
    train_features: np.ndarray,
    train_labels: np.ndarray,
    validation_features: np.ndarray,
    validation_labels: np.ndarray,
    validation_variants: np.ndarray,
    upstream_weight: np.ndarray,
    upstream_bias: float,
    device: torch.device,
) -> tuple[np.ndarray, float, float, dict[str, float]]:
    mean = train_features.mean(axis=0).astype(np.float32)
    std = train_features.std(axis=0).clip(min=1e-5).astype(np.float32)
    x_train = torch.from_numpy((train_features - mean) / std).to(device)
    y_train = torch.from_numpy(train_labels).to(device).unsqueeze(1)
    x_validation = torch.from_numpy((validation_features - mean) / std).to(device)
    head = nn.Linear(train_features.shape[1], 1).to(device)
    with torch.no_grad():
        head.weight.copy_(torch.from_numpy(upstream_weight * std).to(device).unsqueeze(0))
        head.bias.copy_(torch.tensor([upstream_bias + float(np.dot(upstream_weight, mean))], device=device))
    optimizer = torch.optim.AdamW(head.parameters(), lr=0.015, weight_decay=0.003)
    generator = torch.Generator(device="cpu").manual_seed(SEED)
    real_indices = torch.from_numpy(np.flatnonzero(train_labels == 0))
    synthetic_indices = torch.from_numpy(np.flatnonzero(train_labels == 1))
    half_batch = min(384, real_indices.numel(), synthetic_indices.numel())
    best_key = (-1.0, -1.0)
    best_state: tuple[np.ndarray, float, float, dict[str, float]] | None = None
    stale = 0
    for step in range(1, 1501):
        indices = torch.cat((
            real_indices[torch.randint(0, real_indices.numel(), (half_batch,), generator=generator)],
            synthetic_indices[torch.randint(0, synthetic_indices.numel(), (half_batch,), generator=generator)],
        )).to(device)
        loss = nn.functional.binary_cross_entropy_with_logits(head(x_train[indices]), y_train[indices])
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
        if step % 25 != 0:
            continue
        with torch.no_grad():
            validation_logits = head(x_validation).squeeze(1).float().cpu().numpy()
        threshold, scores = choose_threshold(validation_logits, validation_labels, validation_variants)
        key = (min(scores.values()), sum(scores.values()) / len(scores))
        print(
            f"step={step} loss={loss.item():.4f} threshold={threshold:.4f} "
            + " ".join(f"{name}={score * 100:.2f}" for name, score in scores.items()),
            flush=True,
        )
        if key > best_key:
            normalized_weight = head.weight.detach().float().cpu().numpy()[0]
            normalized_bias = float(head.bias.detach().float().cpu().item())
            baked_weight = normalized_weight / std
            baked_bias = normalized_bias - float(np.dot(normalized_weight, mean / std))
            best_key = key
            best_state = (baked_weight, baked_bias, threshold, scores)
            stale = 0
        else:
            stale += 25
        if stale >= 250:
            break
    if best_state is None:
        raise RuntimeError("Head training did not produce a checkpoint")
    return best_state


def export_onnx(model: Detector, output: Path) -> float:
    model = model.cpu().eval()
    sample = torch.randn(2, 3, INPUT_SIZE, INPUT_SIZE)
    with torch.inference_mode():
        expected = model(sample).numpy()
    torch.onnx.export(
        model,
        sample,
        output,
        input_names=["pixel_values"],
        output_names=["logits"],
        dynamic_axes={"pixel_values": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=18,
        do_constant_folding=True,
    )
    session = ort.InferenceSession(str(output), providers=["CPUExecutionProvider"])
    actual = session.run(["logits"], {"pixel_values": sample.numpy()})[0]
    return float(np.max(np.abs(expected - actual)))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=Path("benchmark/data/modern-head"))
    parser.add_argument("--weights", type=Path, default=Path("benchmark/candidates/community_forensics/model.safetensors"))
    parser.add_argument("--output-dir", type=Path, default=Path("benchmark/candidates/community_forensics_rehead"))
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--device", choices=("auto", "mps", "cpu"), default="auto")
    args = parser.parse_args()

    torch.manual_seed(SEED)
    np.random.seed(SEED)
    if digest(args.weights) != WEIGHTS_SHA256:
        raise ValueError(f"Unexpected upstream weights SHA-256: {digest(args.weights)}")
    if args.device == "mps" or (args.device == "auto" and torch.backends.mps.is_available()):
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    print(f"Using {device}", flush=True)

    train_manifest = args.data_root / "train-manifest.jsonl"
    validation_manifest = args.data_root / "validation-manifest.jsonl"
    train_items = load_manifest(train_manifest, args.data_root)
    validation_items = load_manifest(validation_manifest, args.data_root)
    model = Detector().eval()
    state = load_file(str(args.weights))
    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing or unexpected:
        raise RuntimeError(f"State mismatch: missing={missing}, unexpected={unexpected}")
    upstream_weight = model.vit.head.weight.detach().float().cpu().numpy()[0].copy()
    upstream_bias = float(model.vit.head.bias.detach().float().cpu().item())
    model.to(device)

    train_features, train_labels, _, _ = extract_or_load_features(
        model,
        train_items,
        train_manifest,
        args.output_dir / "train-features.npz",
        device,
        args.batch_size,
        training=True,
    )
    validation_features, validation_labels, validation_variants, validation_sources = extract_or_load_features(
        model,
        validation_items,
        validation_manifest,
        args.output_dir / "validation-features.npz",
        device,
        args.batch_size,
        training=False,
    )
    weight, bias, threshold, scores = train_head(
        train_features,
        train_labels,
        validation_features,
        validation_labels,
        validation_variants,
        upstream_weight,
        upstream_bias,
        device,
    )
    model.vit.head.weight.data.copy_(torch.from_numpy(weight).to(device).unsqueeze(0))
    model.vit.head.bias.data.copy_(torch.tensor([bias], device=device))
    with torch.inference_mode():
        logits = model.vit.head(torch.from_numpy(validation_features).to(device)).squeeze(1).float().cpu().numpy()
    threshold, scores = choose_threshold(logits, validation_labels, validation_variants)
    per_source = {
        source: balanced_accuracy(logits[validation_sources == source], validation_labels[validation_sources == source], threshold)
        for source in sorted(set(validation_sources.tolist()))
        if np.unique(validation_labels[validation_sources == source]).size == 2
    }
    synthetic_recall = {
        source: float((logits[(validation_sources == source) & (validation_labels == 1)] >= threshold).mean())
        for source in sorted(set(validation_sources[validation_labels == 1].tolist()))
    }
    real_recall = float((logits[validation_labels == 0] < threshold).mean())
    calibration_intercept = math.log(0.65 / 0.35) - threshold

    args.output_dir.mkdir(parents=True, exist_ok=True)
    fp32_path = args.output_dir / "model.onnx"
    int8_path = args.output_dir / "model-int8.onnx"
    parity_error = export_onnx(model, fp32_path)
    if parity_error > 1e-4:
        raise RuntimeError(f"ONNX parity error is too high: {parity_error}")
    quantize_dynamic(
        model_input=str(fp32_path),
        model_output=str(int8_path),
        weight_type=QuantType.QInt8,
        op_types_to_quantize=["MatMul", "Gemm"],
        per_channel=True,
        reduce_range=False,
    )
    model_hash = digest(int8_path)
    calibration = {
        "schemaVersion": 1,
        "method": "Held-out-generator threshold alignment to the fixed 65% display cutoff",
        "slope": 1,
        "intercept": calibration_intercept,
        "modelSha256": model_hash,
        "validationThresholdLogit": threshold,
    }
    summary = {
        "schemaVersion": 1,
        "seed": SEED,
        "upstreamWeightsSha256": WEIGHTS_SHA256,
        "trainManifestSha256": digest(train_manifest),
        "validationManifestSha256": digest(validation_manifest),
        "trainImages": len(train_items),
        "validationImages": len(validation_items),
        "validationViewsPerImage": len(VARIANTS),
        "thresholdLogit": threshold,
        "variantBalancedAccuracy": scores,
        "minimumVariantBalancedAccuracy": min(scores.values()),
        "meanVariantBalancedAccuracy": sum(scores.values()) / len(scores),
        "realRecall": real_recall,
        "syntheticRecallByHeldOutSource": synthetic_recall,
        "balancedAccuracyBySourceWhenBothLabelsExist": per_source,
        "model": {
            "fp32Bytes": fp32_path.stat().st_size,
            "int8Bytes": int8_path.stat().st_size,
            "int8Sha256": model_hash,
            "onnxMaxAbsError": parity_error,
        },
    }
    (args.output_dir / "calibration.json").write_text(json.dumps(calibration, indent=2) + "\n")
    (args.output_dir / "validation-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
