export function centerCropGeometry(
  width: number,
  height: number,
  resizeShortEdge = 256,
  cropSize = 224,
): { sourceX: number; sourceY: number; sourceSize: number; targetSize: number } {
  const shortEdge = Math.min(width, height);
  const cropInSourcePixels = (cropSize / resizeShortEdge) * shortEdge;
  return {
    sourceX: (width - cropInSourcePixels) / 2,
    sourceY: (height - cropInSourcePixels) / 2,
    sourceSize: cropInSourcePixels,
    targetSize: cropSize,
  };
}

export function imageDataToNormalizedChw(
  imageData: ImageData,
  mean: readonly [number, number, number],
  std: readonly [number, number, number],
): Float32Array {
  const { data, width, height } = imageData;
  const pixels = width * height;
  const output = new Float32Array(3 * pixels);

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = data[pixel * 4 + channel];
      if (value === undefined) throw new Error("Malformed RGBA image data");
      output[channel * pixels + pixel] = (value / 255 - mean[channel]!) / std[channel]!;
    }
  }

  return output;
}

export function softmaxSynthetic(logits: readonly number[], syntheticIndex: number): number {
  if (logits.length < 2 || syntheticIndex < 0 || syntheticIndex >= logits.length) {
    throw new Error("Detector returned invalid logits");
  }
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  const synthetic = exponentials[syntheticIndex];
  if (synthetic === undefined || total === 0) throw new Error("Detector returned invalid probabilities");
  return synthetic / total;
}
