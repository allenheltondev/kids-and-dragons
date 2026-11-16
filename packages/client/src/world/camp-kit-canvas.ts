import { isTvBrowser } from "../display/tv";
import { campClothMatrix } from "./camp-kit-art";

/** The SVG cloth tint, rasterized once for the WebGL camp's texture. */
const cache = new WeakMap<object, Map<string, HTMLCanvasElement>>();
/** One hidden SVG holding a color-matrix filter per accent, which the canvas draws through (`tinted`). */
let filters: SVGSVGElement | null = null;
const filterIds = new Map<string, string>();
function clothFilter(accent: string): string {
  const known = filterIds.get(accent);
  if (known) return known;
  const ns = "http://www.w3.org/2000/svg";
  if (!filters || !filters.isConnected) {
    filters = document.createElementNS(ns, "svg");
    filters.setAttribute("width", "0");
    filters.setAttribute("height", "0");
    filters.setAttribute("aria-hidden", "true");
    filters.style.position = "absolute";
    document.body.appendChild(filters);
    filterIds.clear();
  }
  const id = `kad-cloth-${String(filterIds.size)}`;
  const filter = document.createElementNS(ns, "filter");
  filter.setAttribute("id", id);
  filter.setAttribute("color-interpolation-filters", "sRGB");
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", "100%");
  filter.setAttribute("height", "100%");
  const matrix = document.createElementNS(ns, "feColorMatrix");
  matrix.setAttribute("type", "matrix");
  matrix.setAttribute("values", campClothMatrix(accent));
  filter.appendChild(matrix);
  filters.appendChild(filter);
  filterIds.set(accent, id);
  return id;
}

/**
 * The whole painting in her color: its luminance times the accent (the same
 * `campClothMatrix` the book's tiles tint with, as an SVG filter). Where the
 * canvas takes a filter the browser draws it, soft edges and all, instead of
 * reading back a pixel at a time: a TV's slow processor spent seconds on that
 * pixel loop for every tent, flap and bedroll a color change touched.
 */
function tinted(source: CanvasImageSource, accent: string, side: number): HTMLCanvasElement | null {
  const tint = document.createElement("canvas");
  tint.width = tint.height = side;
  const fast = tint.getContext("2d");
  if (fast && "filter" in fast && typeof document.body !== "undefined") {
    fast.filter = `url(#${clothFilter(accent)})`;
    fast.drawImage(source, 0, 0, side, side);
    return tint;
  }
  // No canvas filters (an older browser): the pixel loop.
  const slow = document.createElement("canvas");
  slow.width = slow.height = side;
  const colored = slow.getContext("2d", { willReadFrequently: true });
  if (!colored) return null;
  colored.drawImage(source, 0, 0, side, side);
  const image = colored.getImageData(0, 0, side, side);
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
  // Camp pieces occupy a small part of the TV picture. Half-size rasters avoid
  // processing and uploading four times as many pixels on its slower CPU/GPU.
  const side = isTvBrowser() ? 512 : 1024;
  const key = `${side}:${cloth}:${accent}`;
  const known = cache.get(source)?.get(key);
  if (known) return known;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, side, side);
    const tint = tinted(source, accent, side);
    if (!tint) return null;
    if (side !== 1024) ctx.scale(side / 1024, side / 1024);
    ctx.clip(new Path2D(cloth), "evenodd");
    if (side === 1024) ctx.drawImage(tint, 0, 0);
    else ctx.drawImage(tint, 0, 0, 1024, 1024);
    const variants = cache.get(source) ?? new Map<string, HTMLCanvasElement>();
    if (variants.size >= 16) variants.delete(variants.keys().next().value!);
    variants.set(key, canvas);
    cache.set(source, variants);
    return canvas;
  } catch {
    return null;
  }
}
