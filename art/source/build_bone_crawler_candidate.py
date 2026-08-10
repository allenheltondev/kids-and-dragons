#!/usr/bin/env python3
"""Build the registered Bone Crawler approval candidate and low-shell parts."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source" / "bone_crawler_rig_candidate"
PARTS_DIR = SOURCE_DIR / "parts"
REVIEW_PATH = ROOT / "art" / "review" / "bone_crawler_rig_candidate.png"

CANVAS = 1024
ANCHOR_Y = 900
TARGET_HEIGHT = 450
ALPHA_THRESHOLD = 8
Z_ORDER = ["leg_l", "leg_r", "body", "shell", "claw_l", "claw_r"]


def polygon_mask(points: list[tuple[int, int]]) -> np.ndarray:
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return np.asarray(mask) > 0


def ellipse_mask(box: tuple[int, int, int, int]) -> np.ndarray:
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).ellipse(box, fill=255)
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


def make_shell_alt(shell: Image.Image) -> Image.Image:
    """Create an alternate collected-fossil pattern without changing registration."""
    arr = np.asarray(shell).copy()
    alpha = arr[..., 3]
    rgb = arr[..., :3].astype(np.int16)
    pale = (
        (alpha > ALPHA_THRESHOLD)
        & (rgb[..., 0] > 105)
        & (rgb[..., 1] > 88)
        & (rgb[..., 2] > 62)
        & (rgb[..., 0] < rgb[..., 1] * 1.55)
    )

    cool = pale & (
        polygon_mask([(280, 540), (470, 465), (540, 570), (470, 680), (300, 690)])
        | ellipse_mask((535, 520, 675, 670))
    )
    ochre = pale & (
        polygon_mask([(455, 650), (645, 610), (740, 690), (690, 805), (490, 790)])
    )
    ash = pale & (
        polygon_mask([(625, 510), (770, 540), (790, 720), (700, 750), (610, 650)])
    )

    rgb[cool, 0] -= 18
    rgb[cool, 1] -= 7
    rgb[cool, 2] += 10
    rgb[ochre, 0] += 4
    rgb[ochre, 1] -= 11
    rgb[ochre, 2] -= 24
    rgb[ash, 0] -= 27
    rgb[ash, 1] -= 24
    rgb[ash, 2] -= 16
    arr[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def make_parts(assembled: Image.Image) -> dict[str, Image.Image]:
    rgba = np.asarray(assembled).copy()
    alpha = rgba[..., 3]
    subject = alpha > ALPHA_THRESHOLD
    yy, xx = np.indices(alpha.shape)

    regions = {
        "claw_l": (xx >= 270) & (xx < 405) & (yy >= 750),
        "claw_r": (xx >= 380) & (xx < 550) & (yy >= 775),
        "leg_l": (xx < 300) & (yy >= 710),
        "leg_r": (xx >= 515) & (yy >= 720),
        "body_face": (xx >= 280) & (xx < 575) & (yy >= 685) & (yy < 875),
        "shell": yy < 805,
    }

    names = ["body", "shell", "claw_l", "claw_r", "leg_l", "leg_r"]
    index = {name: i for i, name in enumerate(names)}
    owner = np.full((CANVAS, CANVAS), -1, dtype=np.int8)

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
        [(245, 690), (785, 675), (810, 825), (700, 895), (275, 900), (220, 805)]
    )

    parts: dict[str, Image.Image] = {}
    for name in names:
        base = Image.fromarray((exclusive[name] * 255).astype(np.uint8), "L")
        expanded = np.asarray(base.filter(ImageFilter.MaxFilter(21))) > 0
        include = subject & (exclusive[name] | (expanded & fully_opaque))
        if name == "body":
            include |= subject & fully_opaque & body_joint_overdraw
        part = rgba.copy()
        part[..., 3] = np.where(include, alpha, 0)
        part[~include, :3] = 0
        parts[name] = Image.fromarray(part, "RGBA")

    parts["shell_alt"] = make_shell_alt(parts["shell"])
    return parts


def composite(parts: dict[str, Image.Image], alternate: bool = False) -> Image.Image:
    result = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    for name in Z_ORDER:
        layer = "shell_alt" if alternate and name == "shell" else name
        result.alpha_composite(parts[layer])
    return result


def content_crop(image: Image.Image) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    return image.crop(bbox) if bbox else image


def make_review(
    assembled: Image.Image,
    assembled_alt: Image.Image,
    parts: dict[str, Image.Image],
) -> Image.Image:
    board = Image.new("RGB", (1800, 1080), (23, 29, 43))
    draw = ImageDraw.Draw(board)
    draw.text(
        (35, 24),
        "bone_crawler v1 - wary fossil collector + rolling low-shell rig",
        fill=(240, 243, 249),
    )
    panels = [(30, 65, 860, 1040), (890, 65, 1770, 725), (890, 755, 1770, 1040)]
    for box in panels:
        draw.rounded_rectangle(box, radius=14, fill=(35, 42, 59), outline=(69, 80, 103), width=2)

    hero = content_crop(assembled)
    hero.thumbnail((780, 840), Image.Resampling.LANCZOS)
    board.paste(hero, (55 + (780 - hero.width) // 2, 145), hero)
    draw.text((50, 82), "Assembled idle - 450px target height", fill=(226, 232, 242))
    draw.text(
        (50, 104),
        "Cautious scavenger; shell is collected armor, never an animated skeleton.",
        fill=(190, 201, 220),
    )

    ordered = ["body", "shell", "shell_alt", "claw_l", "claw_r", "leg_l", "leg_r"]
    for i, name in enumerate(ordered):
        col, row = i % 4, i // 4
        x, y = 920 + col * 205, 105 + row * 285
        tile = content_crop(parts[name])
        tile.thumbnail((175, 210), Image.Resampling.LANCZOS)
        board.paste(tile, (x + (175 - tile.width) // 2, y + 25), tile)
        draw.text((x, y), name, fill=(215, 222, 235))

    alt = content_crop(assembled_alt)
    alt.thumbnail((360, 230), Image.Resampling.LANCZOS)
    board.paste(alt, (925, 790), alt)
    draw.text((925, 770), "Alternate collected-shell palette", fill=(226, 232, 242))

    small = content_crop(assembled)
    small.thumbnail((260, 64), Image.Resampling.LANCZOS)
    board.paste(small, (1420, 890), small)
    draw.text((1420, 800), "64px combat read", fill=(226, 232, 242))
    draw.text((1420, 825), "Dome + wary teal eyes", fill=(190, 201, 220))
    return board


def main() -> None:
    PARTS_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    registered = register_source()
    parts = make_parts(registered)
    assembled = composite(parts)
    assembled_alt = composite(parts, alternate=True)

    registered.save(SOURCE_DIR / "registered_reference.png")
    assembled.save(SOURCE_DIR / "assembled.png")
    assembled_alt.save(SOURCE_DIR / "assembled_alt.png")
    for name, part in parts.items():
        part.save(PARTS_DIR / f"{name}.png")
    make_review(assembled, assembled_alt, parts).save(REVIEW_PATH)


if __name__ == "__main__":
    main()
