#!/usr/bin/env python3
"""
Kids & Dragons - installable app icons (epic #410).

Writes the icons `packages/client/public/manifest.webmanifest` names, from the
approved master `assets/brand/dragon-mark.png` (assets/brand/README.md):

    icons/icon-192.png            purpose "any": the transparent mark, as exported
    icons/icon-512.png            purpose "any"
    icons/icon-maskable-192.png   purpose "maskable": the mark on the brand night,
    icons/icon-maskable-512.png   wholly inside the safe circle

A maskable icon is cropped by the launcher to a circle, a squircle or a
rounded square. Only the circle of 40% of the icon's width around its centre
is promised to survive every mask, so the dragon is scaled until its farthest
painted pixel (a horn tip or the snout, not its bounding box) sits on a circle
of SAFE_RADIUS, a little inside that promise. The background is the page's own
`#0d0b1a` (theme.css --kad-bg), so the splash screen and the icon agree.

The "any" icons stay transparent, like apple-touch-icon.png: a browser paints
them on its own surface.

Usage:
    python3 tools/art/pwa-icons.py            # rewrite the icons from the master

Requires: Pillow, numpy
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MASTER = ROOT / "assets/brand/dragon-mark.png"
OUT = ROOT / "packages/client/public/icons"

BACKGROUND = (0x0D, 0x0B, 0x1A, 255)
# The spec's safe zone is a radius of 0.40; keep a hair inside it.
SAFE_RADIUS = 0.38
SIZES = (192, 512)


def farthest_reach(mark: Image.Image) -> float:
    """The distance from the canvas centre to the farthest painted pixel, in pixels."""
    alpha = np.asarray(mark.getchannel("A"), dtype=np.float32)
    ys, xs = np.nonzero(alpha > 8)
    cx, cy = (mark.width - 1) / 2, (mark.height - 1) / 2
    return float(np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2).max())


def any_icon(mark: Image.Image, size: int) -> Image.Image:
    return mark.resize((size, size), Image.LANCZOS)


def maskable_icon(mark: Image.Image, size: int) -> Image.Image:
    scale = (SAFE_RADIUS * size) / farthest_reach(mark)
    side = round(mark.width * scale)
    dragon = mark.resize((side, side), Image.LANCZOS)
    icon = Image.new("RGBA", (size, size), BACKGROUND)
    offset = (size - side) // 2
    icon.alpha_composite(dragon, (offset, offset))
    return icon.convert("RGB")


def icons() -> dict[str, Image.Image]:
    mark = Image.open(MASTER).convert("RGBA")
    out: dict[str, Image.Image] = {}
    for size in SIZES:
        out[f"icon-{size}.png"] = any_icon(mark, size)
        out[f"icon-maskable-{size}.png"] = maskable_icon(mark, size)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, image in icons().items():
        path = OUT / name
        image.save(path, format="PNG", optimize=True)
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
