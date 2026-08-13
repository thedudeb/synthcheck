"""Create a deterministic weight-only INT8 Community Forensics ONNX model."""

from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "model.onnx"
OUTPUT = ROOT / "model-int8.onnx"


def main() -> None:
    quantize_dynamic(
        model_input=str(SOURCE),
        model_output=str(OUTPUT),
        weight_type=QuantType.QInt8,
        op_types_to_quantize=["MatMul", "Gemm"],
        per_channel=True,
        reduce_range=False,
    )
    print({"output": str(OUTPUT), "bytes": OUTPUT.stat().st_size})


if __name__ == "__main__":
    main()
