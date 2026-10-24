/**
 * The install manifest (`public/manifest.webmanifest`, epic #410) and the
 * icons it names. That a real browser accepts it as installable is
 * e2e/installable.spec.ts, against a production build.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { swStrategyFor } from "./policy";

const client = fileURLToPath(new URL("../../", import.meta.url));
const publicDir = `${client}public`;

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

const manifest = JSON.parse(readFileSync(`${publicDir}/manifest.webmanifest`, "utf8")) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  description: string;
  icons: ManifestIcon[];
  shortcuts: { name: string; url: string; icons: ManifestIcon[] }[];
  launch_handler: { client_mode: string };
  share_target: { action: string; method: string; params: Record<string, string> };
  screenshots: { src: string; sizes: string; type: string; form_factor: string; label: string }[];
};

/** A PNG's width and height, from its header. */
function pngSize(path: string): [number, number] {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("latin1"), path).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("the install manifest", () => {
  it("installs the whole site as one standalone app", () => {
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBe("Kids & Dragons");
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(manifest.description.length).toBeGreaterThan(0);
  });

  it("matches the page's own colors", () => {
    const html = readFileSync(`${client}index.html`, "utf8");
    const theme = /<meta name="theme-color" content="([^"]+)"/.exec(html)?.[1];
    expect(manifest.theme_color).toBe(theme);
    expect(manifest.background_color).toBe(theme);
  });

  it("is linked from the page, beside the Apple touch icon it does not replace", () => {
    const html = readFileSync(`${client}index.html`, "utf8");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />');
    expect(pngSize(`${publicDir}/apple-touch-icon.png`)).toEqual([180, 180]);
  });

  it("names icons that exist at the sizes it claims, for both purposes", () => {
    for (const icon of manifest.icons) {
      const path = `${publicDir}${icon.src}`;
      expect(existsSync(path), icon.src).toBe(true);
      expect(icon.type).toBe("image/png");
      const [width, height] = pngSize(path);
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
    const sizes = (purpose: string) => manifest.icons.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes);
    expect(sizes("any")).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(sizes("maskable")).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("offers the book and the join screen as shortcuts, with 96px icons", () => {
    const byUrl = Object.fromEntries(manifest.shortcuts.map((shortcut) => [shortcut.url, shortcut]));
    expect(byUrl["/journal"]?.name).toBe("Open my book");
    expect(byUrl["/"]?.name).toBe("Join a game");
    for (const shortcut of manifest.shortcuts) {
      expect(shortcut.icons.length, shortcut.name).toBeGreaterThan(0);
      for (const icon of shortcut.icons) {
        expect(icon.sizes).toBe("96x96");
        expect(icon.type).toBe("image/png");
        expect(existsSync(`${publicDir}${icon.src}`), icon.src).toBe(true);
        expect(pngSize(`${publicDir}${icon.src}`), icon.src).toEqual([96, 96]);
      }
    }
  });

  it("focuses the running app on a link, and takes shares by GET at /share", () => {
    expect(manifest.launch_handler).toEqual({ client_mode: "navigate-existing" });
    expect(manifest.share_target.action).toBe("/share");
    expect(manifest.share_target.method).toBe("GET");
    expect(manifest.share_target.params).toEqual({ title: "title", text: "text", url: "url" });
  });

  it("shows a narrow and a wide screenshot at the sizes it claims", () => {
    const factors = manifest.screenshots.map((shot) => shot.form_factor);
    expect(factors).toEqual(expect.arrayContaining(["narrow", "wide"]));
    for (const shot of manifest.screenshots) {
      expect(shot.label.length, shot.src).toBeGreaterThan(0);
      expect(shot.type).toBe("image/png");
      expect(existsSync(`${publicDir}${shot.src}`), shot.src).toBe(true);
      const [width, height] = pngSize(`${publicDir}${shot.src}`);
      expect(`${width}x${height}`, shot.src).toBe(shot.sizes);
    }
    const sizeOf = (factor: string) => manifest.screenshots.find((shot) => shot.form_factor === factor)?.sizes;
    expect(sizeOf("narrow")).toBe("390x844");
    expect(sizeOf("wide")).toBe("1920x1080");
  });

  it("keeps every maskable icon's dragon inside the circle every launcher mask leaves", () => {
    // The spec's safe zone: a circle of 40% of the width around the centre.
    // Outside it, an icon must be plain background, or a mask may crop a horn.
    const paths = manifest.icons.filter((icon) => icon.purpose === "maskable").map((icon) => `${publicDir}${icon.src}`);
    const code = `
import json, sys
import numpy as np
from PIL import Image
out = {}
for path in json.loads(sys.argv[1]):
    im = np.asarray(Image.open(path).convert("RGBA")).astype(int)
    h, w = im.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    outside = np.hypot(xs - (w - 1) / 2, ys - (h - 1) / 2) > 0.40 * w
    background = im[0, 0]
    out[path] = dict(
        opaque=bool((im[..., 3] == 255).all()),
        stray=int((np.abs(im[outside] - background).max(axis=1) > 6).sum()),
    )
print(json.dumps(out))
`;
    const report = JSON.parse(
      execFileSync(process.platform === "win32" ? "python" : "python3", ["-c", code, JSON.stringify(paths)], { encoding: "utf8" }),
    ) as Record<string, { opaque: boolean; stray: number }>;
    for (const path of paths) {
      expect(report[path], path).toEqual({ opaque: true, stray: 0 });
    }
  });

  it("is fetched by the browser itself, never kept by the service worker; its icons are kept like brand art", () => {
    const origin = "https://kad.example";
    const at = (path: string) => swStrategyFor({ method: "GET", mode: "cors", hasRange: false, url: origin + path }, origin);
    expect(at("/manifest.webmanifest")).toBe("passthrough");
    for (const icon of manifest.icons) expect(at(icon.src)).toBe("image");
  });
});
