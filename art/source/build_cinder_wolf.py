#!/usr/bin/env python3
"""Build the registered Cinder Wolf approval candidate and quadruped parts."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source" / "cinder_wolf_rig"
PARTS_DIR = SOURCE_DIR / "parts"
REVIEW_PATH = ROOT / "art" / "review" / "cinder_wolf_rig.png"

CANVAS = 1024
ANCHOR_Y = 900
TARGET_HEIGHT = 615
ALPHA_THRESHOLD = 8

Z_ORDER = [
    "tail",
    "limb_bl",
    "limb_fl",
    "body",
    "limb_br",
    "limb_fr",
    "ruff",
    "head",
]


def polygon_mask(points: list[tuple[int, int]]) -> np.ndarray:
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return np.asarray(mask) > 0


def register_source() -> Image.Image:
    source = Image.open(SOURCE_DIR / "source.png").convert("RGBA")
    alpha = np.asarray(source.getchannel("A"))
    ys, xs = np.nonzero(alpha > ALPHA_THRESHOLD)
    bbox = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    cropped = source.crop(bbox)
    width = round(cropped.width * TARGET_HEIGHT / cropped.height)
    scaled = cropped.resize((width, TARGET_HEIGHT), Image.Resampling.LANCZOS)

    registered = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    registered.alpha_composite(scaled, ((CANVAS - width) // 2, ANCHOR_Y - TARGET_HEIGHT))
    arr = np.asarray(registered).copy()
    rgb = arr[..., :3]
    green_spill = (
        (arr[..., 3] > 0)
        & (rgb[..., 1] > 80)
        & (rgb[..., 1] > rgb[..., 0] * 1.5)
        & (rgb[..., 1] > rgb[..., 2] * 1.5)
    )
    arr[green_spill, 1] = np.maximum(arr[green_spill, 0], arr[green_spill, 2])
    return Image.fromarray(arr, "RGBA")


def make_parts(assembled: Image.Image) -> dict[str, Image.Image]:
    rgba = np.asarray(assembled).copy()
    alpha = rgba[..., 3]
    subject = alpha > ALPHA_THRESHOLD

    yy, xx = np.indices(alpha.shape)
    tail_boundary = 710 + np.clip((yy - 500) * 0.16, 0, 55)

    # Give every subject pixel one semantic owner. These boundaries follow the
    # visible valleys between the face, neck ruff, four legs and tail. Seam
    # overlap is added below; this map is the clean core of each moving part.
    regions = {
        "head": ((xx < 420) & (yy < 465)) | ((xx < 385) & (yy < 525)),
        "tail": (xx > tail_boundary) & (yy > 475),
        "limb_fl": (xx < 355) & (yy >= 610),
        "limb_fr": (xx >= 355) & (xx < 490) & (yy >= 600),
        "limb_bl": (xx >= 490) & (xx < 640) & (yy >= 590),
        "limb_br": (xx >= 640) & (xx <= tail_boundary) & (yy >= 575),
        "ruff": (xx < 450) & (yy >= 410) & (yy < 660),
    }

    owner = np.full((CANVAS, CANVAS), -1, dtype=np.int8)
    names = ["head", "tail", "limb_fl", "limb_fr", "limb_bl", "limb_br", "ruff"]
    for index, name in enumerate(names):
        take = subject & regions[name] & (owner < 0)
        owner[take] = index
    owner[subject & (owner < 0)] = len(names)
    names.append("body")

    exclusive = {name: owner == index for index, name in enumerate(names)}
    parts: dict[str, Image.Image] = {}
    fully_opaque = alpha == 255
    body_joint_overdraw = polygon_mask(
        [(270, 500), (735, 455), (795, 610), (725, 665), (520, 650), (270, 685)]
    )

    # Dilated owner masks create real seam overdraw. Duplicate pixels are only
    # permitted where the source is fully opaque, so repeated compositing stays
    # byte-exact while antialiased outer edges keep a single owner.
    for name in names:
        base = Image.fromarray((exclusive[name] * 255).astype(np.uint8), "L")
        expanded = np.asarray(base.filter(ImageFilter.MaxFilter(31))) > 0
        include = subject & (exclusive[name] | (expanded & fully_opaque))
        if name == "body":
            include |= subject & fully_opaque & body_joint_overdraw
        part = rgba.copy()
        part[..., 3] = np.where(include, alpha, 0)
        part[~include, :3] = 0
        parts[name] = Image.fromarray(part, "RGBA")

    # The default assembly shows the fissure once, on the topmost ruff. Remove
    # its duplicated seam-underlay colour from lower parts so rotating the ruff
    # cannot leave a second ember mark behind on the torso or foreleg.
    ruff_alpha = np.asarray(parts["ruff"].getchannel("A"))
    for name in ("body", "limb_fr"):
        part = np.asarray(parts[name]).copy()
        rgb = part[..., :3]
        ember = (
            (part[..., 3] > 0)
            & (ruff_alpha == 255)
            & (rgb[..., 0] > 105)
            & (rgb[..., 0] > rgb[..., 1] * 1.45)
            & (rgb[..., 1] > 25)
            & (rgb[..., 2] < 85)
        )
        neutral = np.clip(
            rgb[..., 0].astype(np.int16) * 0.22
            + rgb[..., 1].astype(np.int16) * 0.28
            + rgb[..., 2].astype(np.int16) * 0.12,
            0,
            74,
        ).astype(np.uint8)
        part[ember, 0] = neutral[ember]
        part[ember, 1] = neutral[ember]
        part[ember, 2] = neutral[ember]
        parts[name] = Image.fromarray(part, "RGBA")

    return parts


def make_ruff_alt(ruff: Image.Image) -> Image.Image:
    """Move the dormant fissure slightly for a quiet pack-readable variant."""
    arr = np.asarray(ruff).copy()
    rgb = arr[..., :3]
    alpha = arr[..., 3]
    ember = (
        (alpha > 0)
        & (rgb[..., 0] > 105)
        & (rgb[..., 0] > rgb[..., 1] * 1.45)
        & (rgb[..., 1] > 25)
        & (rgb[..., 2] < 85)
        & (np.indices(alpha.shape)[1] > 300)
        & (np.indices(alpha.shape)[1] < 470)
        & (np.indices(alpha.shape)[0] > 455)
        & (np.indices(alpha.shape)[0] < 650)
    )

    neutral = np.minimum(
        rgb[..., 0].astype(np.int16) * 0.18
        + rgb[..., 1].astype(np.int16) * 0.22
        + rgb[..., 2].astype(np.int16) * 0.10,
        58,
    ).astype(np.uint8)
    arr[ember, 0] = neutral[ember]
    arr[ember, 1] = neutral[ember]
    arr[ember, 2] = neutral[ember]

    ys, xs = np.nonzero(ember)
    for y, x in zip(ys, xs):
        nx, ny = x + 28, y + 5
        if 0 <= nx < CANVAS and 0 <= ny < CANVAS and alpha[ny, nx] == 255:
            arr[ny, nx, :3] = rgb[y, x]
            arr[ny, nx, 3] = 255

    # A broad ash-gray shoulder marking survives the 64px combat view and
    # distinguishes pack members without changing species palette or silhouette.
    yy, xx = np.indices(alpha.shape)
    ash_patch = (
        (alpha > 0)
        & ((((xx - 390) / 62) ** 2 + ((yy - 535) / 82) ** 2) < 1.0)
        & ~ember
    )
    gray = (
        arr[..., 0].astype(np.int16) * 0.30
        + arr[..., 1].astype(np.int16) * 0.45
        + arr[..., 2].astype(np.int16) * 0.25
    )
    ash = np.clip(gray + 18, 0, 178).astype(np.uint8)
    arr[ash_patch, 0] = ((arr[ash_patch, 0].astype(np.uint16) + ash[ash_patch]) // 2).astype(np.uint8)
    arr[ash_patch, 1] = ((arr[ash_patch, 1].astype(np.uint16) + ash[ash_patch]) // 2).astype(np.uint8)
    arr[ash_patch, 2] = ((arr[ash_patch, 2].astype(np.uint16) + ash[ash_patch]) // 2).astype(np.uint8)

    return Image.fromarray(arr, "RGBA")


def composite(parts: dict[str, Image.Image], ruff_name: str = "ruff") -> Image.Image:
    result = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    for name in Z_ORDER:
        layer = parts[ruff_name] if name == "ruff" else parts[name]
        result.alpha_composite(layer)
    return result


def content_crop(image: Image.Image) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    return image.crop(bbox) if bbox else image


def make_review(
    assembled: Image.Image,
    assembled_alt: Image.Image,
    parts: dict[str, Image.Image],
) -> Image.Image:
    board = Image.new("RGB", (1800, 1120), (23, 29, 43))
    draw = ImageDraw.Draw(board)
    draw.text((35, 24), "cinder_wolf v1 - wary storybook idle + quadruped rig", fill=(240, 243, 249))

    panels = [(30, 65, 720, 1080), (750, 65, 1770, 715), (750, 745, 1770, 1080)]
    for box in panels:
        draw.rounded_rectangle(box, radius=14, fill=(35, 42, 59), outline=(69, 80, 103), width=2)

    hero = content_crop(assembled)
    hero.thumbnail((650, 930), Image.Resampling.LANCZOS)
    board.paste(hero, (50 + (650 - hero.width) // 2, 105), hero)
    draw.text((50, 82), "Assembled idle - 615px", fill=(226, 232, 242))

    ordered = ["body", "head", "ruff", "limb_fl", "limb_fr", "limb_bl", "limb_br", "tail"]
    for index, name in enumerate(ordered):
        col, row = index % 4, index // 4
        x, y = 775 + col * 245, 115 + row * 290
        tile = content_crop(parts[name])
        tile.thumbnail((210, 220), Image.Resampling.LANCZOS)
        board.paste(tile, (x + (210 - tile.width) // 2, y + 20), tile)
        draw.text((x, y), name, fill=(215, 222, 235))

    default_small = content_crop(assembled)
    default_small.thumbnail((250, 64), Image.Resampling.LANCZOS)
    board.paste(default_small, (790, 880), default_small)
    draw.text((790, 820), "64px combat read", fill=(226, 232, 242))

    alt = content_crop(assembled_alt)
    alt.thumbnail((270, 260), Image.Resampling.LANCZOS)
    board.paste(alt, (1290, 795), alt)
    draw.text((1285, 765), "ruff_alt pack variant", fill=(226, 232, 242))
    return board


def main() -> None:
    PARTS_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)

    registered = register_source()
    parts = make_parts(registered)
    parts["ruff_alt"] = make_ruff_alt(parts["ruff"])

    assembled = composite(parts)
    assembled_alt = composite(parts, "ruff_alt")
    registered.save(SOURCE_DIR / "registered_reference.png")
    assembled.save(SOURCE_DIR / "assembled.png")
    assembled_alt.save(SOURCE_DIR / "assembled_alt.png")
    for name, part in parts.items():
        part.save(PARTS_DIR / f"{name}.png")
    make_review(assembled, assembled_alt, parts).save(REVIEW_PATH)


if __name__ == "__main__":
    main()
