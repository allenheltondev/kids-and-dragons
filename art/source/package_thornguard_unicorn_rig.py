#!/usr/bin/env python3
"""Build the Thornguard Sworn Unicorn class-rig art package."""

from __future__ import annotations

from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
SOURCE = ROOT / "art/source/thornguard_unicorn_sworn_fitted_armor.png"
BASE = ROOT / "assets/characters/unicorn/sworn"
OUT = ROOT / "assets/character-rigs/thornguard/sworn/unicorn"
PARTS = OUT / "parts"
REVIEW = ROOT / "art/review/thornguard_sworn_unicorn_rig_split.png"
BASE_PARTS = ("tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane", "horn")

# Composed from 118 fitted-composite/base pose inliers and 45
# armor/fitted-composite inliers. The armor was purpose-drawn for this pose.
ARMOR_TO_RIG = (0.698112069, 0.012686860, 27.833491, -0.012686860, 0.698112069, 119.599075)

Z_ORDER = (
    "tail",
    "leg_l",
    "leg_r",
    "body",
    "arm_l",
    "arm_r",
    "head",
    "armor_torso",
    "mane",
    "horn",
)


def registered_armor() -> Image.Image:
    source = Image.open(SOURCE).convert("RGBA")
    if source.getchannel("A").getbbox() is None:
        raise ValueError(f"{SOURCE} has no visible pixels")
    a, b, c, d, e, f = ARMOR_TO_RIG
    forward = np.array(((a, b, c), (d, e, f), (0.0, 0.0, 1.0)))
    inverse = np.linalg.inv(forward)[:2].reshape(-1)
    registered = source.transform(
        CANVAS,
        Image.Transform.AFFINE,
        tuple(float(value) for value in inverse),
        Image.Resampling.BICUBIC,
    )
    return registered


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
    draw.text((50, 34), "Thornguard Sworn Unicorn — rig split", font=title, fill="white")
    draw.text(
        (52, 88),
        "Purpose-drawn coherent harness   •   chest, shoulder and belly connections all contact anatomy",
        font=note,
        fill="#b9c7d8",
    )
    panels = [
        ("BASE REST POSE", Image.open(BASE / "assembled.png").convert("RGBA")),
        ("REGISTERED COMPOSITE", assembled),
        ("ARMOR — COHERENT FITTED HARNESS", parts["armor_torso"]),
    ]
    positions = [(50, 150), (600, 150), (1150, 150)]
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
    parts["armor_torso"] = registered_armor()
    parts["armor_torso"].save(PARTS / "armor_torso.png", optimize=True)
    assembled = compose(parts)
    assembled.save(OUT / "assembled.png", optimize=True)
    review_board(parts, assembled)
    print(f"packaged {len(parts)} registered parts in {PARTS.relative_to(ROOT)}")
    print(f"wrote {OUT.joinpath('assembled.png').relative_to(ROOT)}")
    print(f"wrote {REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
