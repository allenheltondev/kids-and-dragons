#!/usr/bin/env python3
"""Build the registered River Drake approval candidate and serpentine parts."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source" / "river_drake_rig"
PARTS_DIR = SOURCE_DIR / "parts"
REVIEW_PATH = ROOT / "art" / "review" / "river_drake_rig.png"

CANVAS = 1024
ANCHOR_Y = 900
TARGET_HEIGHT = 860
ALPHA_THRESHOLD = 8
Z_ORDER = ["coil", "body", "neck", "limb_l", "limb_r", "head", "fin"]


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
    rgb = rgba[..., :3]
    subject = alpha > ALPHA_THRESHOLD
    yy, xx = np.indices(alpha.shape)

    head = polygon_mask(
        [(70, 145), (305, 105), (465, 210), (440, 390), (285, 475), (80, 390), (55, 245)]
    )
    neck = polygon_mask(
        [(140, 205), (470, 170), (560, 450), (455, 650), (185, 595), (105, 350)]
    )
    limb_l = (xx < 270) & (yy >= 500)
    limb_r = (xx >= 245) & (xx < 535) & (yy >= 485)
    coil = ((xx >= 540) & (yy >= 285)) | ((xx >= 480) & (yy >= 650))
    body_core = polygon_mask(
        [(285, 245), (655, 210), (735, 430), (650, 635), (360, 680), (245, 455)]
    )

    # The drake's green-blue membranes are its defining signature. Restrict
    # that color cue to the three physical fin zones so the jade belly remains
    # on the torso and the entire fin system can animate as one layer.
    fin_zones = (
        polygon_mask([(120, 35), (470, 35), (535, 330), (445, 385), (245, 265), (105, 225)])
        | polygon_mask([(405, 105), (890, 110), (955, 390), (825, 405), (620, 285), (470, 330)])
        | polygon_mask([(555, 640), (1015, 650), (1015, 900), (675, 900), (540, 805)])
    )
    membrane_seed = (
        subject
        & fin_zones
        & (rgb[..., 1] > rgb[..., 0] * 1.05)
        & (rgb[..., 1] > 62)
        & (rgb[..., 2] > 48)
    )
    fin = np.asarray(
        Image.fromarray((membrane_seed * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(17))
    ) > 0
    fin &= subject & fin_zones

    regions = {
        "head": head,
        "neck": neck,
        "body": body_core,
        "coil": coil,
        "limb_l": limb_l,
        "limb_r": limb_r,
        "fin": fin,
    }
    names = ["head", "neck", "body", "coil", "limb_l", "limb_r", "fin"]
    index = {name: i for i, name in enumerate(names)}
    owner = np.full((CANVAS, CANVAS), -1, dtype=np.int8)

    for name in ("limb_l", "limb_r", "head", "fin", "body", "neck", "coil"):
        take = subject & regions[name] & (owner < 0)
        owner[take] = index[name]
    owner[subject & (owner < 0)] = index["body"]

    exclusive = {name: owner == index[name] for name in names}
    fully_opaque = alpha == 255
    parts: dict[str, Image.Image] = {}
    for name in names:
        base = Image.fromarray((exclusive[name] * 255).astype(np.uint8), "L")
        expanded = np.asarray(base.filter(ImageFilter.MaxFilter(31))) > 0
        include = subject & (exclusive[name] | (expanded & fully_opaque))
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
    board = Image.new("RGB", (1800, 1120), (23, 29, 43))
    draw = ImageDraw.Draw(board)
    draw.text(
        (35, 24),
        "river_drake v1 - watchful crossing keeper + serpentine rig",
        fill=(240, 243, 249),
    )
    panels = [(30, 65, 865, 1080), (895, 65, 1770, 760), (895, 790, 1770, 1080)]
    for box in panels:
        draw.rounded_rectangle(box, radius=14, fill=(35, 42, 59), outline=(69, 80, 103), width=2)

    hero = content_crop(assembled)
    hero.thumbnail((790, 930), Image.Resampling.LANCZOS)
    board.paste(hero, (52 + (790 - hero.width) // 2, 115), hero)
    draw.text((50, 82), "Assembled idle - 860px target height", fill=(226, 232, 242))

    ordered = ["head", "neck", "body", "coil", "limb_l", "limb_r", "fin"]
    for i, name in enumerate(ordered):
        col, row = i % 4, i // 4
        x, y = 925 + col * 205, 105 + row * 305
        tile = content_crop(parts[name])
        tile.thumbnail((175, 230), Image.Resampling.LANCZOS)
        board.paste(tile, (x + (175 - tile.width) // 2, y + 25), tile)
        draw.text((x, y), name, fill=(215, 222, 235))

    small = content_crop(assembled)
    small.thumbnail((260, 64), Image.Resampling.LANCZOS)
    board.paste(small, (965, 905), small)
    draw.text((965, 820), "64px combat read", fill=(226, 232, 242))
    draw.text((965, 845), "Continuous fin + deliberate barrier pose", fill=(190, 201, 220))
    draw.text(
        (1325, 820),
        "Routine-minded crossing keeper, not a predator.\nRiver-stone scales keep it below legend status.",
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
