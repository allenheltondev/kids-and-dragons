#!/usr/bin/env python3
"""Build the Thornguard Sworn Manticore class-rig art package."""

from __future__ import annotations

from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
SOURCE = ROOT / "art/source/thornguard_manticore_sworn_armor.png"
MANE_SOURCE = ROOT / "art/source/thornguard_manticore_sworn_mane.png"
BASE = ROOT / "assets/characters/manticore/sworn"
OUT = ROOT / "assets/character-rigs/thornguard/sworn/manticore"
PARTS = OUT / "parts"
REVIEW = ROOT / "art/review/thornguard_sworn_manticore_rig_split.png"
BASE_PARTS = ("tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane")

# Composed from 19 portrait/base pose inliers and 86 armor/portrait inliers.
# This registers the full source canvas rather than fitting its visible bbox.
ARMOR_TO_RIG = (0.690869997, 0.015320358, 66.007214, -0.015320358, 0.690869997, 92.497478)
MANE_TO_RIG = (0.82235141, 0.01716793, 7.060666, -0.01716793, 0.82235141, -2.942599)

Z_ORDER = (
    "tail",
    "leg_l",
    "leg_r",
    "body",
    "arm_l",
    "arm_r",
    "head",
    "seam_fill",
    "armor_back",
    "armor_chest",
    "mane_armor",
)


def registered_layer(source_path: Path, transform: tuple[float, ...]) -> Image.Image:
    source = Image.open(source_path).convert("RGBA")
    if source.getchannel("A").getbbox() is None:
        raise ValueError(f"{source_path} has no visible pixels")
    a, b, c, d, e, f = transform
    forward = np.array(((a, b, c), (d, e, f), (0.0, 0.0, 1.0)))
    inverse = np.linalg.inv(forward)[:2].reshape(-1)
    return source.transform(
        CANVAS,
        Image.Transform.AFFINE,
        tuple(float(value) for value in inverse),
        Image.Resampling.BICUBIC,
    )


def split_armor(armor: Image.Image) -> dict[str, Image.Image]:
    """Put the shoulder harness behind the mane and breastplate in front."""
    front_mask = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(front_mask).polygon(
        [(170, 480), (380, 430), (505, 500), (560, 665), (420, 770), (180, 720)],
        fill=255,
    )
    front_alpha = np.minimum(np.asarray(armor.getchannel("A")), np.asarray(front_mask)).astype(np.uint8)
    back_alpha = np.minimum(
        np.asarray(armor.getchannel("A")),
        255 - np.asarray(front_mask),
    ).astype(np.uint8)
    front = armor.copy()
    front.putalpha(Image.fromarray(front_alpha, "L"))
    back = armor.copy()
    back.putalpha(Image.fromarray(back_alpha, "L"))
    return {"armor_back": back, "armor_chest": front}


def seam_fill(mane: Image.Image) -> Image.Image:
    """Keep the base layer behind the class art so every rig seam remains filled."""
    return mane.copy()


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
    draw.text((50, 34), "Thornguard Sworn Manticore — rig split", font=title, fill="white")
    draw.text(
        (52, 88),
        "Shoulder harness behind the mane   •   breastplate in front   •   scorpion tail stays clear",
        font=note,
        fill="#b9c7d8",
    )
    panels = [
        ("BASE REST POSE", Image.open(BASE / "assembled.png").convert("RGBA")),
        ("REGISTERED COMPOSITE", assembled),
        ("FITTED ARMORED MANE", parts["mane_armor"]),
        ("ARMOR — FITTED HARNESS", Image.alpha_composite(parts["armor_back"], parts["armor_chest"])),
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
    # The approved armored portrait intentionally shortens the lower mane so
    # the breastplate can sit against the chest; use that purpose-fitted mane
    # for this class variant instead of forcing armor through the base ruff.
    base_mane = parts.pop("mane")
    (PARTS / "mane.png").unlink()
    parts["seam_fill"] = seam_fill(base_mane)
    parts["seam_fill"].save(PARTS / "seam_fill.png", optimize=True)
    parts["mane_armor"] = registered_layer(MANE_SOURCE, MANE_TO_RIG)
    parts["mane_armor"].save(PARTS / "mane_armor.png", optimize=True)
    for name, image in split_armor(registered_layer(SOURCE, ARMOR_TO_RIG)).items():
        image.save(PARTS / f"{name}.png", optimize=True)
        parts[name] = image
    assembled = compose(parts)
    assembled.save(OUT / "assembled.png", optimize=True)
    review_board(parts, assembled)
    print(f"packaged {len(parts)} registered parts in {PARTS.relative_to(ROOT)}")
    print(f"wrote {OUT.joinpath('assembled.png').relative_to(ROOT)}")
    print(f"wrote {REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
