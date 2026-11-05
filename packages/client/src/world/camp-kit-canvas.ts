import { campClothMatrix } from "./camp-kit-art";

/** The SVG cloth tint, rasterized once for the WebGL camp's texture. */
const cache = new WeakMap<object, Map<string, HTMLCanvasElement>>();
export function campKitCanvas(source: CanvasImageSource, cloth: string, accent: string): HTMLCanvasElement | null {
  const key = `${cloth}:${accent}`;
  const known = cache.get(source)?.get(key);
  if (known) return known;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    const tint = document.createElement("canvas");
    tint.width = tint.height = 1024;
    const colored = tint.getContext("2d", { willReadFrequently: true });
    if (!ctx || !colored) return null;
    ctx.drawImage(source, 0, 0, 1024, 1024);
    colored.drawImage(source, 0, 0, 1024, 1024);
    const image = colored.getImageData(0, 0, 1024, 1024);
    const matrix = campClothMatrix(accent).split(" ").map(Number);
    for (let i = 0; i < image.data.length; i += 4) {
      const r = image.data[i]!, g = image.data[i + 1]!, b = image.data[i + 2]!;
      image.data[i] = r * matrix[0]! + g * matrix[1]! + b * matrix[2]!;
      image.data[i + 1] = r * matrix[5]! + g * matrix[6]! + b * matrix[7]!;
      image.data[i + 2] = r * matrix[10]! + g * matrix[11]! + b * matrix[12]!;
    }
    colored.putImageData(image, 0, 0);
    ctx.clip(new Path2D(cloth), "evenodd");
    ctx.drawImage(tint, 0, 0);
    const variants = cache.get(source) ?? new Map<string, HTMLCanvasElement>();
    if (variants.size >= 16) variants.delete(variants.keys().next().value!);
    variants.set(key, canvas);
    cache.set(source, variants);
    return canvas;
  } catch {
    return null;
  }
}
