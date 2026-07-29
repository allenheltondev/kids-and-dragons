from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source"
REVIEW_DIR = ROOT / "art" / "review"
ASSET_DIR = ROOT / "assets" / "gear" / "songkeeper"
TIERS = ("sworn", "radiant", "mythic")
CANVAS = (1024, 1024)
REVIEW_BG = (47, 42, 56, 255)


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("image has no opaque pixels")
    return bbox


def remove_small_components(mask: np.ndarray, min_size: int = 18) -> np.ndarray:
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    output = np.zeros_like(mask, dtype=bool)

    for start_y, start_x in zip(*np.where(mask & ~seen)):
        if seen[start_y, start_x]:
            continue
        stack = [(int(start_y), int(start_x))]
        seen[start_y, start_x] = True
        component: list[tuple[int, int]] = []

        while stack:
            y, x = stack.pop()
            component.append((y, x))
            for next_y in range(max(0, y - 1), min(height, y + 2)):
                for next_x in range(max(0, x - 1), min(width, x + 2)):
                    if mask[next_y, next_x] and not seen[next_y, next_x]:
                        seen[next_y, next_x] = True
                        stack.append((next_y, next_x))

        if len(component) >= min_size:
            ys, xs = zip(*component)
            output[np.array(ys), np.array(xs)] = True

    return output


def registered_layer(
    source_rgba: Image.Image,
    source_mask: np.ndarray,
    source_bbox: tuple[int, int, int, int],
    target_bbox: tuple[int, int, int, int],
) -> Image.Image:
    rgba = np.array(source_rgba, dtype=np.uint8)
    rgba[:, :, 3] = np.where(source_mask, rgba[:, :, 3], 0)
    layer = Image.fromarray(rgba, "RGBA")

    src_left, src_top, src_right, src_bottom = source_bbox
    dst_left, dst_top, dst_right, dst_bottom = target_bbox
    cropped = layer.crop(source_bbox)
    resized = cropped.resize(
        (dst_right - dst_left, dst_bottom - dst_top),
        Image.Resampling.LANCZOS,
    )

    output = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    output.alpha_composite(resized, (dst_left, dst_top))
    return output


def extract_tier(tier: str) -> tuple[Image.Image, Image.Image, Image.Image]:
    source = Image.open(
        SOURCE_DIR / f"songkeeper_{tier}_alpha_raw.png"
    ).convert("RGBA")
    canonical = Image.open(
        ROOT / "assets" / "characters" / "unicorn" / tier / "assembled.png"
    ).convert("RGBA")

    rgba = np.array(source, dtype=np.uint8)
    rgb = rgba[:, :, :3]
    hsv = np.array(source.convert("RGB").convert("HSV"), dtype=np.uint8)
    red = rgb[:, :, 0].astype(np.int16)
    blue = rgb[:, :, 2].astype(np.int16)
    hue = hsv[:, :, 0]
    alpha = rgba[:, :, 3]

    # Amber, cream-gold, brass, and their warm brown outlines all sit in this
    # range. The canonical unicorn is violet/blue or near-white, so the mask
    # cleanly excludes the character while retaining the full woven garment.
    warm = (
        (alpha > 8)
        & ((hue < 49) | (hue > 249))
        & ((red - blue) > 6)
        & (red > 24)
    )

    src_left, src_top, src_right, src_bottom = alpha_bbox(source)
    src_width = src_right - src_left
    src_height = src_bottom - src_top
    y_grid, x_grid = np.indices(warm.shape)

    split_y = round(src_top + src_height * 0.40)
    earring_left = round(src_left + src_width * 0.31)
    earring_right = round(src_left + src_width * 0.62)
    torso_bottom = round(src_top + src_height * 0.90)

    earring_mask = (
        warm
        & (y_grid < split_y)
        & (x_grid >= earring_left)
        & (x_grid <= earring_right)
    )
    torso_mask = warm & (y_grid >= split_y) & (y_grid <= torso_bottom)

    earring_mask = remove_small_components(earring_mask)
    torso_mask = remove_small_components(torso_mask)

    target_bbox = alpha_bbox(canonical)
    torso = registered_layer(source, torso_mask, alpha_bbox(source), target_bbox)
    earring = registered_layer(source, earring_mask, alpha_bbox(source), target_bbox)

    tier_dir = ASSET_DIR / tier
    tier_dir.mkdir(parents=True, exist_ok=True)
    torso.save(tier_dir / "overlay_torso.png")
    # The manifest keeps the generic prop_held slot. Songkeeper intentionally
    # positions this detachable class ornament at the ear.
    earring.save(tier_dir / "prop_held.png")

    composite = canonical.copy()
    composite.alpha_composite(torso)
    composite.alpha_composite(earring)
    composite.save(REVIEW_DIR / f"songkeeper_{tier}_unicorn_composite.png")
    return torso, earring, composite


def make_contact_sheet(composites: list[tuple[str, Image.Image]]) -> None:
    panel_width = 512
    panel_height = 556
    sheet = Image.new(
        "RGBA",
        (panel_width * len(composites), panel_height),
        REVIEW_BG,
    )
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for index, (tier, composite) in enumerate(composites):
        preview = composite.resize((512, 512), Image.Resampling.LANCZOS)
        sheet.alpha_composite(preview, (index * panel_width, 0))
        draw.text(
            (index * panel_width + 16, 524),
            tier,
            fill=(255, 246, 232, 255),
            font=font,
        )

    sheet.save(REVIEW_DIR / "songkeeper_registered_unicorn_tiers.png")


def make_small_contact_sheet(composites: list[tuple[str, Image.Image]]) -> None:
    panel_width = 220
    panel_height = 156
    character_height = 120
    sheet = Image.new(
        "RGBA",
        (panel_width * len(composites), panel_height),
        REVIEW_BG,
    )
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for index, (tier, composite) in enumerate(composites):
        cropped = composite.crop(alpha_bbox(composite))
        width = round(cropped.width * character_height / cropped.height)
        preview = cropped.resize(
            (width, character_height),
            Image.Resampling.LANCZOS,
        )
        x = index * panel_width + (panel_width - width) // 2
        sheet.alpha_composite(preview, (x, 4))
        draw.text(
            (index * panel_width + 12, 136),
            tier,
            fill=(255, 246, 232, 255),
            font=font,
        )

    sheet.save(REVIEW_DIR / "songkeeper_registered_unicorn_tiers_120px.png")


def main() -> None:
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    composites: list[tuple[str, Image.Image]] = []
    for tier in TIERS:
        _, _, composite = extract_tier(tier)
        composites.append((tier, composite))
    make_contact_sheet(composites)
    make_small_contact_sheet(composites)


if __name__ == "__main__":
    main()
