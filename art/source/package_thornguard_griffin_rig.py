#!/usr/bin/env python3
"""Build the Thornguard Sworn Griffin class-rig art package."""

from __future__ import annotations

from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
SOURCE = ROOT / "art/source/thornguard_griffin_sworn_armor.png"
BASE = ROOT / "assets/characters/griffin/sworn"
OUT = ROOT / "assets/character-rigs/thornguard/sworn/griffin"
PARTS = OUT / "parts"
REVIEW = ROOT / "art/review/thornguard_sworn_griffin_rig_split.png"
BASE_PARTS = ("wings", "tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane")

# Composed from two independently measured transforms: 18 spatially distinct
# correspondences register the approved Griffin portrait to its base pose, and
# 74 inliers register the generated armor matte back to that portrait.
ARMOR_TO_RIG = (0.843746454, 0.001033865, -4.921176, -0.001033865, 0.843746454, -10.373629)

Z_ORDER = (
    "wings",
    "tail",
    "leg_l",
    "leg_r",
    "body",
    "arm_l",
    "arm_r",
    "head",
    "mane",
    "armor_torso",
    "armor_wings",
)


def registered_armor() -> Image.Image:
    """Apply the measured full-canvas transform without fitting the armor bbox."""
    source = Image.open(SOURCE).convert("RGBA")
    if source.getchannel("A").getbbox() is None:
        raise ValueError(f"{SOURCE} has no visible pixels")
    a, b, c, d, e, f = ARMOR_TO_RIG
    forward = np.array(((a, b, c), (d, e, f), (0.0, 0.0, 1.0)))
    inverse = np.linalg.inv(forward)[:2].reshape(-1)
    return source.transform(
        CANVAS,
        Image.Transform.AFFINE,
        tuple(float(value) for value in inverse),
        Image.Resampling.BICUBIC,
    )


def split_armor(armor: Image.Image) -> dict[str, Image.Image]:
    """Separate the wing-root guard so it follows the animated wing bone."""
    alpha = armor.getchannel("A")
    wing_mask = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(wing_mask).polygon(
        [(375, 380), (585, 380), (585, 690), (425, 690), (375, 575)],
        fill=255,
    )
    wing_alpha = np.minimum(np.asarray(alpha), np.asarray(wing_mask)).astype(np.uint8)
    torso_alpha = np.minimum(np.asarray(alpha), 255 - np.asarray(wing_mask)).astype(np.uint8)
    torso = armor.copy()
    torso.putalpha(Image.fromarray(torso_alpha, "L"))
    wings = armor.copy()
    wings.putalpha(Image.fromarray(wing_alpha, "L"))
    return {"armor_torso": torso, "armor_wings": wings}


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

    draw.text((50, 34), "Thornguard Sworn Griffin — rig split", font=title, fill="white")
    draw.text(
        (52, 88),
        "Golden wing + neck plumage stay in front   •   fitted cuirass → body bone",
        font=note,
        fill="#b9c7d8",
    )
    panels = [
        ("BASE REST POSE", Image.open(BASE / "assembled.png").convert("RGBA")),
        ("REGISTERED COMPOSITE", assembled),
        ("ARMOR — BREASTPLATE", parts["armor_torso"]),
        ("ARMOR — WING-ROOT GUARD", parts["armor_wings"]),
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
    for name, image in split_armor(registered_armor()).items():
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
