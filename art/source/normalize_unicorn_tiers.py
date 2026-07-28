from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SCALES = {
    "sworn": 0.768,
    "radiant": 0.748,
    "mythic": 0.748,
}


def normalize(tier: str, scale: float) -> None:
    source_path = ROOT / f"art/source/unicorn_{tier}_alpha_raw.png"
    target_path = ROOT / f"assets/characters/unicorn/{tier}/assembled.png"
    source = Image.open(source_path).convert("RGBA")
    source_bbox = source.getchannel("A").getbbox()
    if source_bbox is None:
        raise RuntimeError(f"{source_path} is empty")

    resized = source.resize(
        (round(source.width * scale), round(source.height * scale)),
        Image.Resampling.LANCZOS,
    )
    center_x = (source_bbox[0] + source_bbox[2] - 1) * 0.5 * scale
    feet_y = (source_bbox[3] - 1) * scale
    offset_x = round(512 - center_x)
    offset_y = round(899 - feet_y)

    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    canvas.alpha_composite(resized, (offset_x, offset_y))

    pixels = np.array(canvas)
    visible = pixels[:, :, 3] > 0
    rgb = pixels[:, :, :3]

    pure_black = visible & np.all(rgb == 0, axis=2)
    pure_white = visible & np.all(rgb == 255, axis=2)
    rgb[pure_black] = (43, 33, 24)
    rgb[pure_white] = (255, 246, 232)

    green_fringe = (
        visible
        & (rgb[:, :, 1] > rgb[:, :, 0] * 1.4)
        & (rgb[:, :, 1] > rgb[:, :, 2] * 1.4)
        & (rgb[:, :, 1] > 100)
    )
    rgb[:, :, 1][green_fringe] = (
        (
            rgb[:, :, 0][green_fringe].astype(np.uint16)
            + rgb[:, :, 2][green_fringe].astype(np.uint16)
        )
        // 2
    ).astype(np.uint8)
    rgb[~visible] = 0
    pixels[:, :, :3] = rgb

    target_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, "RGBA").save(target_path, format="PNG", compress_level=9)

    alpha = pixels[:, :, 3]
    ys, xs = np.where(alpha > 8)
    print(
        f"{tier}: scale={scale:.3f} offset=({offset_x},{offset_y}) "
        f"bbox>8=({xs.min()},{ys.min()},{xs.max()+1},{ys.max()+1}) feet={ys.max()}"
    )


def main() -> None:
    for tier, scale in SCALES.items():
        normalize(tier, scale)


if __name__ == "__main__":
    main()
