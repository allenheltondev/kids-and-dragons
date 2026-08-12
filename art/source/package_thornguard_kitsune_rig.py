#!/usr/bin/env python3
"""Build the Thornguard Sworn Kitsune class-rig art package."""

from __future__ import annotations

from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
ARMOR_SOURCE = ROOT / "art/source/thornguard_kitsune_sworn_armor.png"
RUFF_SOURCE = ROOT / "art/source/thornguard_kitsune_sworn_ruff.png"
BASE = ROOT / "assets/characters/kitsune/sworn"
OUT = ROOT / "assets/character-rigs/thornguard/sworn/kitsune"
PARTS = OUT / "parts"
REVIEW = ROOT / "art/review/thornguard_sworn_kitsune_rig_split.png"
BASE_PARTS = ("tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane")

# Full-canvas transform composed from 24 portrait/base pose inliers and 112
# armor/portrait inliers. It registers the generated armor without bbox fitting.
ARMOR_TO_RIG = (0.794152844, 0.010108512, -30.257845, -0.010108512, 0.794152844, 65.087722)
# The fitted ruff was extracted directly on the approved portrait canvas, so it
# uses the measured portrait-to-rest-pose registration without the armor
# extraction's additional vertical correction.
RUFF_TO_RIG = (0.831404574, 0.008935753, -38.513373, -0.008935753, 0.831404574, -28.315592)

Z_ORDER = (
    "tail",
    "leg_l",
    "leg_r",
    "body",
    "arm_l",
    "arm_r",
    "mane_armor",
    "head",
    "mane",
    "armor_torso",
)


def registered_layer(source_path: Path, transform: tuple[float, ...]) -> Image.Image:
    source = Image.open(source_path).convert("RGBA")
    if source.getchannel("A").getbbox() is None:
        raise ValueError(f"{source_path} has no visible pixels")
    a, b, c, d, e, f = transform
    inverse = np.linalg.inv(np.array(((a, b, c), (d, e, f), (0.0, 0.0, 1.0))))[:2].reshape(-1)
    return source.transform(
        CANVAS,
        Image.Transform.AFFINE,
        tuple(float(value) for value in inverse),
        Image.Resampling.BICUBIC,
    )


def head_mane(mane: Image.Image) -> Image.Image:
    """Keep the base mane's rig seam fills but clear its oversized chest ruff."""
    cutout = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(cutout).polygon(
        [
            (145, 490),
            (180, 500),
            (225, 510),
            (275, 505),
            (325, 485),
            (370, 465),
            (420, 450),
            (445, 545),
            (330, 590),
            (165, 575),
        ],
        fill=255,
    )
    cutout = cutout.filter(ImageFilter.GaussianBlur(14.0))
    alpha = np.asarray(mane.getchannel("A"), dtype=np.uint16)
    clipped = (alpha * (255 - np.asarray(cutout, dtype=np.uint16)) // 255).astype(np.uint8)
    result = mane.copy()
    result.putalpha(Image.fromarray(clipped, "L"))
    return result


def fitted_ruff() -> Image.Image:
    """Register and trim the armored portrait's compact ruff to the neck."""
    ruff = registered_layer(RUFF_SOURCE, RUFF_TO_RIG)
    region = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(region).polygon(
        [(145, 405), (225, 375), (350, 380), (425, 440), (410, 615), (300, 680), (150, 555)],
        fill=255,
    )
    region = region.filter(ImageFilter.GaussianBlur(1.25))
    alpha = np.minimum(np.asarray(ruff.getchannel("A")), np.asarray(region)).astype(np.uint8)
    ruff.putalpha(Image.fromarray(alpha, "L"))
    return ruff


def compose(parts: dict[str, Image.Image]) -> Image.Image:
    image = Image.new("RGBA", CANVAS)
    for name in Z_ORDER:
        image.alpha_composite(parts[name])
    return image


def checker(size: tuple[int, int], cell: int = 16) -> Image.Image:
    image = Image.new("RGB", size, "#d7d9dc")
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill="#eef0f2")
    return image


def review_board(parts: dict[str, Image.Image], assembled: Image.Image) -> None:
    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    board = Image.new("RGB", (2250, 1120), "#17202a")
    draw = ImageDraw.Draw(board)
    try:
        title = ImageFont.truetype("arialbd.ttf", 42)
        label = ImageFont.truetype("arialbd.ttf", 25)
        note = ImageFont.truetype("arial.ttf", 20)
    except OSError:
        title = label = note = ImageFont.load_default()
    draw.text((50, 34), "Thornguard Sworn Kitsune — rig split", font=title, fill="white")
    draw.text((52, 88), "Fitted harness → body bone   •   portrait-matched chest ruff → head bone", font=note, fill="#b9c7d8")
    panels = [
        ("BASE REST POSE", Image.open(BASE / "assembled.png").convert("RGBA")),
        ("REGISTERED COMPOSITE", assembled),
        ("ARMOR — FITTED HARNESS", parts["armor_torso"]),
        ("FITTED CHEST RUFF", parts["mane_armor"]),
    ]
    positions = [(50, 150), (600, 150), (1150, 150), (1700, 150)]
    for (heading, image), (x, y) in zip(panels, positions, strict=True):
        pw, ph = 500, 850
        draw.rounded_rectangle((x, y, x + pw, y + ph), 16, fill="#253241", outline="#53677d", width=2)
        draw.text((x + 20, y + 16), heading, font=label, fill="#f7d77d")
        frame_h = ph - 72
        scale = min((pw - 30) / image.width, frame_h / image.height)
        shown = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
        bg = checker((pw - 30, frame_h))
        bg.paste(shown, ((bg.width - shown.width) // 2, (bg.height - shown.height) // 2), shown)
        board.paste(bg, (x + 15, y + 57))
    board.save(REVIEW, optimize=True)


def main() -> None:
    PARTS.mkdir(parents=True, exist_ok=True)
    for stale in PARTS.glob("*.png"):
        stale.unlink()
    parts: dict[str, Image.Image] = {}
    for name in BASE_PARTS:
        source = BASE / "parts" / f"{name}.png"
        target = PARTS / f"{name}.png"
        shutil.copyfile(source, target)
        parts[name] = Image.open(target).convert("RGBA")
    parts["mane"] = head_mane(parts["mane"])
    parts["mane"].save(PARTS / "mane.png", optimize=True)
    parts["mane_armor"] = fitted_ruff()
    parts["mane_armor"].save(PARTS / "mane_armor.png", optimize=True)
    parts["armor_torso"] = registered_layer(ARMOR_SOURCE, ARMOR_TO_RIG)
    parts["armor_torso"].save(PARTS / "armor_torso.png", optimize=True)
    assembled = compose(parts)
    assembled.save(OUT / "assembled.png", optimize=True)
    review_board(parts, assembled)
    print(f"packaged {len(parts)} registered parts in {PARTS.relative_to(ROOT)}")
    print(f"wrote {OUT.joinpath('assembled.png').relative_to(ROOT)}")
    print(f"wrote {REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
