#!/usr/bin/env python3
"""Build the Thornguard Radiant Dragonling exact-pose class-rig art package."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
SOURCE = ROOT / "assets/gear-portraits/thornguard/radiant/dragonling.png"
BASE = ROOT / "assets/characters/dragonling/radiant"
OUT = ROOT / "assets/character-rigs/thornguard/radiant/dragonling"
PARTS = OUT / "parts"
REVIEW = ROOT / "art/review/thornguard_radiant_dragonling_rig_split.png"
BASE_PARTS = ("wings", "tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane")
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
    "armor_visible",
)


def approved_portrait() -> Image.Image:
    return Image.open(SOURCE).convert("RGB").resize(CANVAS, Image.Resampling.LANCZOS)


def geared_part(portrait: Image.Image, base_part: Image.Image) -> Image.Image:
    result = portrait.convert("RGBA")
    result.putalpha(base_part.getchannel("A"))
    return result


def visible_overhang(portrait: Image.Image, anatomy_alpha: Image.Image) -> Image.Image:
    """Keep approved portrait pixels that extend beyond the base rig masks."""
    rgb = np.asarray(portrait).astype(np.float64)
    yy, xx = np.indices((CANVAS[1], CANVAS[0]))
    envelope = (xx >= 100) & (xx < 700) & (yy >= 360) & (yy < 760)
    outside_anatomy = np.asarray(anatomy_alpha) < 16

    x = (xx - CANVAS[0] / 2) / (CANVAS[0] / 2)
    y = (yy - CANVAS[1] / 2) / (CANVAS[1] / 2)
    features = np.stack(
        (np.ones_like(x), x, y, x * x, x * y, y * y, x**3, x * x * y, x * y * y, y**3),
        axis=-1,
    )
    red, green, blue = (rgb[..., channel] for channel in range(3))
    background_samples = (
        envelope
        & outside_anatomy
        & (blue > red * 1.12)
        & (blue > green * 1.05)
        & (blue < 90)
    )
    predicted = np.empty_like(rgb)
    for channel in range(3):
        coefficients = np.linalg.lstsq(
            features[background_samples], rgb[..., channel][background_samples], rcond=None
        )[0]
        predicted[..., channel] = features @ coefficients
    residual = np.sqrt(np.mean((rgb - predicted) ** 2, axis=2))
    mask = envelope & outside_anatomy & (residual > 6)
    result = portrait.convert("RGBA")
    result.putalpha(Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), "L"))
    return result


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


def review_board(assembled: Image.Image) -> None:
    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    board = Image.new("RGB", (2250, 1120), "#17202a")
    draw = ImageDraw.Draw(board)
    try:
        title = ImageFont.truetype("arialbd.ttf", 42)
        label = ImageFont.truetype("arialbd.ttf", 25)
        note = ImageFont.truetype("arial.ttf", 20)
    except OSError:
        title = label = note = ImageFont.load_default()
    draw.text((50, 34), "Thornguard Radiant Dragonling — rig split", font=title, fill="white")
    draw.text(
        (52, 88),
        "Approved pixels painted into exact rig masks   •   armor follows body contour   •   wings remain behind",
        font=note,
        fill="#b9c7d8",
    )
    panels = [
        ("BASE REST POSE", Image.open(BASE / "assembled.png").convert("RGBA")),
        ("REGISTERED COMPOSITE", assembled),
        ("APPROVED FIT REFERENCE", Image.open(SOURCE).convert("RGBA")),
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
    portrait = approved_portrait()
    anatomy_alpha = Image.new("L", CANVAS, 0)
    parts: dict[str, Image.Image] = {}
    for name in BASE_PARTS:
        base_part = Image.open(BASE / "parts" / f"{name}.png").convert("RGBA")
        anatomy_alpha = Image.fromarray(
            np.maximum(np.asarray(anatomy_alpha), np.asarray(base_part.getchannel("A"))).astype(np.uint8),
            "L",
        )
        parts[name] = geared_part(portrait, base_part)
        parts[name].save(PARTS / f"{name}.png", optimize=True)
    parts["armor_visible"] = visible_overhang(portrait, anatomy_alpha)
    parts["armor_visible"].save(PARTS / "armor_visible.png", optimize=True)
    assembled = compose(parts)
    assembled.save(OUT / "assembled.png", optimize=True)
    review_board(assembled)
    print(f"packaged {len(parts)} registered parts in {PARTS.relative_to(ROOT)}")
    print(f"wrote {OUT.joinpath('assembled.png').relative_to(ROOT)}")
    print(f"wrote {REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
