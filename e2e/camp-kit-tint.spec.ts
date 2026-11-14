/**
 * The camp's cloth tint (#781): `campKitCanvas` draws a painting's cloth in a hero's color with
 * the canvas's own grayscale and multiply, where it used to read every pixel. Both must give
 * the same cloth, edges included, in a real browser (jsdom has no canvas to compare in).
 */

import { test, expect } from "@playwright/test";

// Each painting with the cloth region it is tinted through in the camp (camp-kit-art.ts).
const PAINTINGS: { path: string; cloth: { style: string } | { tent: string } }[] = [
  { path: "camp/kits/rolled.png", cloth: { style: "rolled" } },
  { path: "camp/kits/quilted.png", cloth: { style: "quilted" } },
  { path: "camp/kits/tents/rolled.png", cloth: { tent: "rolled" } },
  { path: "camp/kits/tents/quilted.png", cloth: { tent: "quilted" } },
  { path: "camp/kits/tents/mythic.png", cloth: { tent: "mythic" } },
];

for (const { path: painting, cloth: which } of PAINTINGS) {
  test(`${painting}: the drawn tint matches the pixel loop it replaced, soft edges and transparency included`, async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(
      async ({ url, which }) => {
        const art = await import(/* @vite-ignore */ "/src/world/camp-kit-canvas.ts");
        const matrix = await import(/* @vite-ignore */ "/src/world/camp-kit-art.ts");
        const cloth = ("style" in which ? matrix.CAMP_KIT_STYLES[which.style as "rolled"].cloth : matrix.campTentCloth(which.tent))!;
        const image = new Image();
        image.src = url;
        await image.decode();
        const accent = "#d9534f";

        // The old way, as it was: every pixel's luminance times the accent, over the untinted painting.
        const old = document.createElement("canvas");
        old.width = old.height = 1024;
        const o = old.getContext("2d", { willReadFrequently: true })!;
        o.drawImage(image, 0, 0, 1024, 1024);
        const tint = document.createElement("canvas");
        tint.width = tint.height = 1024;
        const t = tint.getContext("2d", { willReadFrequently: true })!;
        t.drawImage(image, 0, 0, 1024, 1024);
        const data = t.getImageData(0, 0, 1024, 1024);
        const m = matrix.campClothMatrix(accent).split(" ").map(Number);
        for (let i = 0; i < data.data.length; i += 4) {
          const r = data.data[i]!, g = data.data[i + 1]!, b = data.data[i + 2]!;
          data.data[i] = r * m[0]! + g * m[1]! + b * m[2]!;
          data.data[i + 1] = r * m[5]! + g * m[6]! + b * m[7]!;
          data.data[i + 2] = r * m[10]! + g * m[11]! + b * m[12]!;
        }
        t.putImageData(data, 0, 0);
        o.clip(new Path2D(cloth), "evenodd");
        o.drawImage(tint, 0, 0);

        const fresh = art.campKitCanvas(image, cloth, accent) as HTMLCanvasElement;
        const a = o.getImageData(0, 0, 1024, 1024).data;
        const b = fresh.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, 1024, 1024).data;
        let worst = 0, alphaWorst = 0, transparent = 0, edge = 0;
        for (let i = 0; i < a.length; i += 4) {
          const alpha = a[i + 3]!;
          alphaWorst = Math.max(alphaWorst, Math.abs(alpha - b[i + 3]!));
          if (alpha === 0) {
            transparent++;
            continue;
          }
          if (alpha < 250) edge++;
          // Compare as shown over a mid-grey ground, so an edge pixel counts for what it looks like.
          for (let c = 0; c < 3; c++) {
            const over = (px: Uint8ClampedArray) => (px[i + c]! * alpha) / 255 + 128 * (1 - alpha / 255);
            worst = Math.max(worst, Math.abs(over(a) - over(b)));
          }
        }
        return { worst, alphaWorst, transparent, edge };
      },
      { url: `/assets/${painting}`, which },
    );
    expect(result.transparent).toBeGreaterThan(0);
    expect(result.edge).toBeGreaterThan(0);
    expect(result.alphaWorst).toBeLessThanOrEqual(1);
    expect(result.worst).toBeLessThanOrEqual(6);
  });
}
