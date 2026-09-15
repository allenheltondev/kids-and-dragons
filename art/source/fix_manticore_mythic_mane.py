#!/usr/bin/env python3
"""Replace the Mythic Manticore's black mane plates with authored red fur tones."""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
CHARACTER = ROOT / "assets/characters/manticore/mythic"
PARTS = CHARACTER / "parts"
Z_ORDER = ("tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane")


def main() -> None:
    mane_path = PARTS / "mane.png"
    mane = Image.open(mane_path).convert("RGBA")
    pixels = np.asarray(mane).copy()
    rgb = pixels[..., :3].astype(np.int16)
    alpha = pixels[..., 3]
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    yy, xx = np.indices(alpha.shape)
    mane_region = (xx >= 120) & (xx <= 590) & (yy >= 70) & (yy <= 745)
    replace = (
        (alpha > 0)
        & mane_region
        & ((red - np.maximum(green, blue)) < 18)
    )
    luminance = (
        red.astype(np.float64) * 0.2126
        + green.astype(np.float64) * 0.7152
        + blue.astype(np.float64) * 0.0722
    )
    replacement = np.stack(
        (
            np.clip(58 + luminance * 1.05, 58, 205),
            np.clip(10 + luminance * 0.22, 10, 62),
            np.clip(20 + luminance * 0.30, 20, 82),
        ),
        axis=2,
    )
    pixels[replace, :3] = np.rint(replacement[replace]).astype(np.uint8)
    Image.fromarray(pixels, "RGBA").save(mane_path, optimize=True)

    assembled = Image.new("RGBA", mane.size)
    for name in Z_ORDER:
        assembled.alpha_composite(Image.open(PARTS / f"{name}.png").convert("RGBA"))
    assembled.save(CHARACTER / "assembled.png", optimize=True)
    print(f"recolored {int(replace.sum())} mane pixels")
    print(f"wrote {mane_path.relative_to(ROOT)}")
    print(f"wrote {CHARACTER.joinpath('assembled.png').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
