#!/usr/bin/env python3
"""Build the registered Glassback Crab approval candidate and low-shell parts."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source" / "glassback_crab_rig"
PARTS_DIR = SOURCE_DIR / "parts"
REVIEW_PATH = ROOT / "art" / "review" / "glassback_crab_rig.png"

CANVAS = 1024
ANCHOR_Y = 900
TARGET_HEIGHT = 704
ALPHA_THRESHOLD = 8
Z_ORDER = ["leg_l", "leg_r", "shell", "body", "claw_l", "claw_r"]


def polygon_mask(points: list[tuple[int, int]]) -> np.ndarray:
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return np.asarray(mask) > 0


def register_source() -> Image.Image:
    source = Image.open(SOURCE_DIR / "source.png").convert("RGBA")
    alpha = np.asarray(source.getchannel("A"))
    ys, xs = np.nonzero(alpha > ALPHA_THRESHOLD)
    bbox = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    crop = source.crop(bbox)
    width = round(crop.width * TARGET_HEIGHT / crop.height)
    scaled = crop.resize((width, TARGET_HEIGHT), Image.Resampling.LANCZOS)

    registered = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    registered.alpha_composite(scaled, ((CANVAS - width) // 2, ANCHOR_Y - TARGET_HEIGHT))
    arr = np.asarray(registered).copy()
    rgb = arr[..., :3]
    magenta_spill = (
        (arr[..., 3] > 0)
        & (rgb[..., 0] > 80)
        & (rgb[..., 2] > 80)
        & (rgb[..., 0] > rgb[..., 1] * 1.5)
        & (rgb[..., 2] > rgb[..., 1] * 1.5)
    )
    arr[magenta_spill, 0] = arr[magenta_spill, 1]
    arr[magenta_spill, 2] = arr[magenta_spill, 1]
    return Image.fromarray(arr, "RGBA")


def make_parts(assembled: Image.Image) -> dict[str, Image.Image]:
    rgba = np.asarray(assembled).copy()
    alpha = rgba[..., 3]
    subject = alpha > ALPHA_THRESHOLD
    yy, xx = np.indices(alpha.shape)

    regions = {
        "claw_l": ((xx < 325) & (yy < 650)) | (
            (xx >= 250) & (xx < 440) & (yy >= 575) & (yy < 675)
        ),
        "claw_r": (xx >= 350) & (xx < 670) & (yy >= 620),
        "leg_l": (xx < 410) & (yy >= 630),
        "leg_r": (xx >= 680) & (yy >= 535),
        "body_face": (xx >= 235) & (xx < 800) & (yy >= 425) & (yy < 710),
        "shell": (xx >= 175) & (xx < 940) & (yy < 625),
    }

    names = ["body", "shell", "claw_l", "claw_r", "leg_l", "leg_r"]
    index = {name: i for i, name in enumerate(names)}
    owner = np.full((CANVAS, CANVAS), -1, dtype=np.int8)

    # Foreground appendages receive their visible pixels before the torso and
    # shell. The broad face band keeps both expressive eyestalks on the body.
    for name in ("claw_l", "claw_r", "leg_l", "leg_r"):
        take = subject & regions[name] & (owner < 0)
        owner[take] = index[name]
    take = subject & regions["body_face"] & (owner < 0)
    owner[take] = index["body"]
    take = subject & regions["shell"] & (owner < 0)
    owner[take] = index["shell"]
    owner[subject & (owner < 0)] = index["body"]

    exclusive = {name: owner == index[name] for name in names}
    fully_opaque = alpha == 255
    body_joint_overdraw = polygon_mask(
        [(90, 490), (925, 465), (985, 680), (850, 760), (150, 770), (65, 650)]
    )

    parts: dict[str, Image.Image] = {}
    for name in names:
        base = Image.fromarray((exclusive[name] * 255).astype(np.uint8), "L")
        expanded = np.asarray(base.filter(ImageFilter.MaxFilter(31))) > 0
        include = subject & (exclusive[name] | (expanded & fully_opaque))
        if name == "body":
            include |= subject & fully_opaque & body_joint_overdraw
        if name == "claw_l":
            include &= ~((xx >= 285) & (yy < 585))
        part = rgba.copy()
        part[..., 3] = np.where(include, alpha, 0)
        part[~include, :3] = 0
        parts[name] = Image.fromarray(part, "RGBA")

    return parts


def composite(parts: dict[str, Image.Image]) -> Image.Image:
    result = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    for name in Z_ORDER:
        result.alpha_composite(parts[name])
    return result


def content_crop(image: Image.Image) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    return image.crop(bbox) if bbox else image


def make_review(assembled: Image.Image, parts: dict[str, Image.Image]) -> Image.Image:
    board = Image.new("RGB", (1800, 1080), (23, 29, 43))
    draw = ImageDraw.Draw(board)
    draw.text(
        (35, 24),
        "glassback_crab v1 - cautious warning idle + low-shell rig",
        fill=(240, 243, 249),
    )
    panels = [(30, 65, 890, 1040), (920, 65, 1770, 750), (920, 780, 1770, 1040)]
    for box in panels:
        draw.rounded_rectangle(box, radius=14, fill=(35, 42, 59), outline=(69, 80, 103), width=2)

    hero = content_crop(assembled)
    hero.thumbnail((820, 900), Image.Resampling.LANCZOS)
    board.paste(hero, (50 + (820 - hero.width) // 2, 105), hero)
    draw.text((50, 82), "Assembled idle - 704px", fill=(226, 232, 242))

    ordered = ["body", "shell", "claw_l", "claw_r", "leg_l", "leg_r"]
    for i, name in enumerate(ordered):
        col, row = i % 3, i // 3
        x, y = 950 + col * 270, 110 + row * 305
        tile = content_crop(parts[name])
        tile.thumbnail((235, 235), Image.Resampling.LANCZOS)
        board.paste(tile, (x + (235 - tile.width) // 2, y + 25), tile)
        draw.text((x, y), name, fill=(215, 222, 235))

    small = content_crop(assembled)
    small.thumbnail((300, 64), Image.Resampling.LANCZOS)
    board.paste(small, (970, 900), small)
    draw.text((970, 825), "64px combat read", fill=(226, 232, 242))
    draw.text(
        (1320, 825),
        "Shell remains the pale signature;\nface reads cautious, not hostile.",
        fill=(205, 214, 229),
        spacing=5,
    )
    return board


def main() -> None:
    PARTS_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    registered = register_source()
    parts = make_parts(registered)
    assembled = composite(parts)

    registered.save(SOURCE_DIR / "registered_reference.png")
    assembled.save(SOURCE_DIR / "assembled.png")
    for name, part in parts.items():
        part.save(PARTS_DIR / f"{name}.png")
    make_review(assembled, parts).save(REVIEW_PATH)


if __name__ == "__main__":
    main()
