#!/usr/bin/env python3
"""Build the Thornguard Sworn Dragonling class-rig art package."""

from __future__ import annotations

from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
SOURCE = ROOT / "art/source/thornguard_dragonling_sworn_armor.png"
BASE = ROOT / "assets/characters/dragonling/sworn"
OUT = ROOT / "assets/character-rigs/thornguard/sworn/dragonling"
PARTS = OUT / "parts"
REVIEW = ROOT / "art/review/thornguard_sworn_dragonling_rig_split.png"
BASE_PARTS = ("wings", "tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane")

# Measured from RANSAC-confirmed feature correspondences between the approved
# portrait, the registered base pose, and the extracted armor matte. Values map
# the 1254px matte directly onto the 1024px rig canvas.
ARMOR_TO_RIG = (0.764222108, 0.006472050, -7.654428, -0.006472050, 0.764222108, 26.785053)

def registered_armor() -> Image.Image:
    """Register the extracted armor to the base pose by matched landmarks.

    Cropping and fitting the armor would destroy its U-shaped neck opening, so
    the measured full-canvas affine transform preserves that occlusion geometry
    while correcting ImageGen's scale and vertical registration drift.
    """
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
    """Separate the rear and foreground pauldrons from the body harness."""
    alpha = armor.getchannel("A")
    mask_r = Image.new("L", CANVAS, 0)  # creature right / image left / rear cap
    ImageDraw.Draw(mask_r).polygon(
        [(145, 465), (210, 465), (215, 540), (199, 625), (145, 625)],
        fill=255,
    )
    mask_l = Image.new("L", CANVAS, 0)  # creature left / image right / foreground cap
    ImageDraw.Draw(mask_l).polygon(
        [(340, 445), (490, 445), (490, 650), (367, 650), (338, 585)],
        fill=255,
    )

    def masked(mask: Image.Image) -> Image.Image:
        result = armor.copy()
        result.putalpha(
            Image.fromarray(
                np.minimum(np.asarray(alpha), np.asarray(mask)).astype(np.uint8),
                "L",
            )
        )
        return result

    # Partition the source exactly. Leaving an eroded rim as underlap would
    # leave a visible ghost of the pauldron on the body when a foreleg moves.
    removal = np.maximum(np.asarray(mask_r), np.asarray(mask_l))
    torso_alpha = np.minimum(np.asarray(alpha), 255 - removal).astype(np.uint8)
    torso = armor.copy()
    torso.putalpha(Image.fromarray(torso_alpha, "L"))
    return {
        "armor_torso": torso,
        "armor_arm_l": masked(mask_l),
        "armor_arm_r": masked(mask_r),
    }


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
    "armor_arm_l",
    "armor_arm_r",
)


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

    draw.text((50, 34), "Thornguard Sworn Dragonling — rig split", font=title, fill="white")
    draw.text(
        (52, 88),
        "Wings stay behind   •   harness → body bone   •   each pauldron → matching foreleg",
        font=note,
        fill="#b9c7d8",
    )
    panels = [
        ("BASE REST POSE", Image.open(BASE / "assembled.png").convert("RGBA")),
        ("REGISTERED COMPOSITE", assembled),
        ("ARMOR — BODY HARNESS", parts["armor_torso"]),
        ("PAULDRON — LEFT FORELEG", parts["armor_arm_l"]),
        ("PAULDRON — RIGHT FORELEG", parts["armor_arm_r"]),
    ]
    positions = [(50, 150), (600, 150), (1150, 150), (1700, 150), (1700, 580)]
    sizes = [(500, 850), (500, 850), (500, 850), (500, 420), (500, 420)]
    for (heading, image), (x, y), (pw, ph) in zip(panels, positions, sizes, strict=True):
        draw.rounded_rectangle((x, y, x + pw, y + ph), 16, fill="#253241", outline="#53677d", width=2)
        draw.text((x + 20, y + 16), heading, font=label, fill="#f7d77d")
        frame_h = ph - 72
        scale = min((pw - 30) / image.width, frame_h / image.height)
        shown = image.resize(
            (round(image.width * scale), round(image.height * scale)),
            Image.Resampling.LANCZOS,
        )
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
