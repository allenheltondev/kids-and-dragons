#!/usr/bin/env python3
"""Build the registered Frost Wyrm approval candidate and serpentine parts."""

from __future__ import annotations

from pathlib import Path
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source" / "frost_wyrm_rig"
PARTS_DIR = SOURCE_DIR / "parts"
REVIEW_PATH = ROOT / "art" / "review" / "frost_wyrm_rig.png"

CANVAS = 1024
ANCHOR_Y = 900
TARGET_HEIGHT = 860
ALPHA_THRESHOLD = 8
Z_ORDER = ["coil", "body", "neck", "fin", "limb_l", "limb_r", "head"]


def polygon_mask(points: list[tuple[int, int]]) -> np.ndarray:
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return np.asarray(mask) > 0


def remove_small_components(mask: np.ndarray, min_pixels: int) -> np.ndarray:
    """Drop isolated mask flecks while preserving the connected ridge groups."""
    height, width = mask.shape
    visited = np.zeros(mask.shape, dtype=bool)
    kept = np.zeros(mask.shape, dtype=bool)
    ys, xs = np.nonzero(mask)
    for start_y, start_x in zip(ys, xs, strict=True):
        if visited[start_y, start_x]:
            continue
        queue = deque([(int(start_y), int(start_x))])
        visited[start_y, start_x] = True
        component: list[tuple[int, int]] = []
        while queue:
            y, x = queue.popleft()
            component.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    ny, nx = y + dy, x + dx
                    if (
                        0 <= ny < height
                        and 0 <= nx < width
                        and mask[ny, nx]
                        and not visited[ny, nx]
                    ):
                        visited[ny, nx] = True
                        queue.append((ny, nx))
        if len(component) >= min_pixels:
            cy, cx = zip(*component, strict=True)
            kept[np.asarray(cy), np.asarray(cx)] = True
    return kept


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

    regions = {
        "limb_l": (xx < 390) & (yy >= 560),
        "limb_r": (xx >= 500) & (xx < 720) & (yy >= 535) & (yy < 845),
        "head": polygon_mask(
            [(235, 495), (410, 390), (555, 505), (530, 690), (475, 855), (285, 735), (210, 565)]
        ),
        "neck": polygon_mask(
            [(145, 285), (505, 230), (620, 430), (565, 650), (255, 710), (120, 520)]
        ),
        "coil": ((xx >= 620) & (yy >= 430)) | ((xx >= 475) & (yy >= 690)),
        "body": polygon_mask(
            [(260, 35), (850, 25), (930, 390), (755, 650), (400, 600), (170, 350)]
        ),
    }

    # Isolate the bright, plate-like dorsal and tail ridges as a single fin
    # layer without stealing the wedge-shaped crown from the head signature.
    upper_fin_zone = polygon_mask(
        [(185, 35), (790, 25), (900, 305), (760, 370), (525, 270), (245, 445), (155, 305)]
    )
    tail_fin_zone = polygon_mask(
        [(650, 515), (955, 535), (975, 825), (730, 875), (650, 690)]
    )
    bright_ice = (
        subject
        & (rgb[..., 0] > 132)
        & (rgb[..., 1] > 145)
        & (rgb[..., 2] > 165)
        & (rgb[..., 2] > rgb[..., 0] * 1.02)
    )
    occupancy = np.asarray(
        Image.fromarray((subject * 255).astype(np.uint8), "L").filter(ImageFilter.BoxBlur(12))
    )
    fin_seed = (
        bright_ice
        & (upper_fin_zone | tail_fin_zone)
        & (occupancy < 245)
        & ~regions["head"]
    )
    fin = np.asarray(
        Image.fromarray((fin_seed * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(21))
    ) > 0
    regions["fin"] = remove_small_components(fin & subject, min_pixels=250)

    names = ["head", "neck", "body", "coil", "limb_l", "limb_r", "fin"]
    index = {name: i for i, name in enumerate(names)}
    owner = np.full((CANVAS, CANVAS), -1, dtype=np.int8)

    for name in ("limb_l", "limb_r", "head", "neck", "fin", "coil", "body"):
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
        "frost_wyrm v1 - wary tunnel guardian + compact serpentine rig",
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
    draw.text((965, 845), "Wedge head + braced digging claws", fill=(190, 201, 220))
    draw.text(
        (1325, 820),
        "Protective snow-burrower, not a fire dragon.\nDefensive mist belongs to the action rig.",
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
