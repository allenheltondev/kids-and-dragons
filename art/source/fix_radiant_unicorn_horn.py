from pathlib import Path

import numpy as np
from PIL import Image

from normalize_species_fledglings import refresh_unicorn_tiers
from normalize_unicorn_tiers import SCALES, normalize
from split_songkeeper_gear import main as rebuild_songkeeper
from split_unicorn_tiers import split_tier


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source"
REVIEW_DIR = ROOT / "art" / "review"


def recolor_green_to_blue(
    path: Path,
    region: tuple[int, int, int, int] | None = None,
) -> None:
    image = Image.open(path).convert("RGBA")
    pixels = np.array(image, dtype=np.uint8)
    hsv = np.array(image.convert("RGB").convert("HSV"), dtype=np.uint8)

    hue_degrees = hsv[:, :, 0].astype(np.float32) * (360.0 / 255.0)
    saturation = hsv[:, :, 1]
    visible = pixels[:, :, 3] > 8
    selected = (
        visible
        & (hue_degrees >= 75)
        & (hue_degrees <= 205)
        & (saturation > 35)
    )

    if region is not None:
        left, top, right, bottom = region
        region_mask = np.zeros(selected.shape, dtype=bool)
        region_mask[top:bottom, left:right] = True
        selected &= region_mask

    # Preserve the original lightness and saturation while mapping the green
    # range into a compact 208-224 degree sky/cerulean range.
    mapped_hue = 208.0 + np.clip(
        (hue_degrees - 75.0) * (16.0 / 130.0),
        0.0,
        16.0,
    )
    hsv[:, :, 0][selected] = np.round(mapped_hue[selected] * (255.0 / 360.0)).astype(
        np.uint8
    )
    recolored = np.array(
        Image.fromarray(hsv, "HSV").convert("RGB"),
        dtype=np.uint8,
    )
    pixels[:, :, :3][selected] = recolored[selected]
    Image.fromarray(pixels, "RGBA").save(path, compress_level=9)
    print(f"{path.relative_to(ROOT)}: recolored {int(selected.sum()):,} pixels")


def radiant_panel_region(path: Path) -> tuple[int, int, int, int]:
    with Image.open(path) as image:
        width, height = image.size
    return (
        round(width * 0.52),
        0,
        round(width * 0.61),
        round(height * 0.36),
    )


def fix_review_sources() -> None:
    names = (
        "songkeeper_unicorn_tiers_v4.png",
        "thornguard_unicorn_tiers_v4.png",
        "duskrunner_unicorn_tiers_v2.png",
        "starweaver_unicorn_tiers_v3.png",
    )
    for name in names:
        path = REVIEW_DIR / name
        if path.exists():
            recolor_green_to_blue(path, radiant_panel_region(path))

    raw_names = (
        "songkeeper_unicorn_tiers_v4_raw.png",
        "thornguard_unicorn_tiers_v4_raw.png",
        "duskrunner_unicorn_tiers_v2_raw.png",
        "starweaver_unicorn_tiers_v3_raw.png",
    )
    for name in raw_names:
        path = SOURCE_DIR / name
        if path.exists():
            recolor_green_to_blue(path, radiant_panel_region(path))

    combined = REVIEW_DIR / "remaining_gear_classes_unicorn_tiers_v4.png"
    if combined.exists():
        with Image.open(combined) as image:
            width, height = image.size
        row_height = height // 3
        for row in range(3):
            recolor_green_to_blue(
                combined,
                (
                    round(width * 0.52),
                    row * row_height,
                    round(width * 0.61),
                    row * row_height + round(row_height * 0.36),
                ),
            )


def main() -> None:
    source = SOURCE_DIR / "unicorn_radiant_alpha_raw.png"
    recolor_green_to_blue(source)

    normalize("radiant", SCALES["radiant"])
    split_tier("radiant")
    refresh_unicorn_tiers()
    rebuild_songkeeper()
    fix_review_sources()


if __name__ == "__main__":
    main()
