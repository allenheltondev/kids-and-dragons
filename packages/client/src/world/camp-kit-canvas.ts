import { campClothMatrix } from "./camp-kit-art";

/** The SVG cloth tint, rasterized once for the WebGL camp's texture. */
const cache = new WeakMap<object, Map<string, HTMLCanvasElement>>();
/**
 * The whole painting in her color: its luminance times the accent (the same
 * arithmetic as `campClothMatrix`). Where the canvas takes a filter this is a
 * grayscale, a multiply and the painting's own shape put back, all drawn
 * rather than read back a pixel at a time: a TV's slow processor spent seconds
 * on the pixel loop for every tent, flap and bedroll a color change touched.
 */
function tinted(source: CanvasImageSource, accent: string): HTMLCanvasElement | null {
  const tint = document.createElement("canvas");
  tint.width = tint.height = 1024;
  const hex = /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#7FD4C1";
  const fast = tint.getContext("2d");
  if (fast && "filter" in fast) {
    fast.filter = "grayscale(1)";
    fast.drawImage(source, 0, 0, 1024, 1024);
    fast.filter = "none";
    fast.globalCompositeOperation = "multiply";
    fast.fillStyle = hex;
    fast.fillRect(0, 0, 1024, 1024);
    fast.globalCompositeOperation = "destination-in";
    fast.drawImage(source, 0, 0, 1024, 1024);
    return tint;
  }
  // No canvas filters (an older browser): the pixel loop.
  const slow = document.createElement("canvas");
  slow.width = slow.height = 1024;
  const colored = slow.getContext("2d", { willReadFrequently: true });
  if (!colored) return null;
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
  return slow;
}

export function campKitCanvas(source: CanvasImageSource, cloth: string, accent: string): HTMLCanvasElement | null {
  const key = `${cloth}:${accent}`;
  const known = cache.get(source)?.get(key);
  if (known) return known;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, 1024, 1024);
    const tint = tinted(source, accent);
    if (!tint) return null;
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
