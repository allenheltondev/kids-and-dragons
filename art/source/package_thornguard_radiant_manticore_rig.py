#!/usr/bin/env python3
"""Build the Thornguard Radiant Manticore exact-pose class-rig art package."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from rig_residuals import keep_body_residual


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
SOURCE = ROOT / "assets/gear-portraits/thornguard/radiant/manticore.png"
BASE = ROOT / "assets/characters/manticore/radiant"
OUT = ROOT / "assets/character-rigs/thornguard/radiant/manticore"
PARTS = OUT / "parts"
REVIEW = ROOT / "art/review/thornguard_radiant_manticore_rig_split.png"
BASE_PARTS = ("tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane")
# Armor outside the anatomy masks sits behind the body and legs so the rear
# haunch breaks the shoulder/saddle silhouette. The detached hawk stays above.
Z_ORDER = (
    "tail",
    "armor_underlay",
    "leg_l",
    "leg_r",
    "body",
    "arm_l",
    "arm_r",
    "head",
    "mane",
    "hawk",
)
REGISTER_Y = -15
ARMOR_ENVELOPE = (130, 330, 711, 706)


def approved_portrait() -> Image.Image:
    portrait = Image.open(SOURCE).convert("RGB").resize(CANVAS, Image.Resampling.LANCZOS)
    return portrait.transform(
        CANVAS,
        Image.Transform.AFFINE,
        (1, 0, 0, 0, 1, -REGISTER_Y),
        fillcolor=portrait.getpixel((CANVAS[0] // 2, CANVAS[1] - 1)),
    )


def subject_alpha(portrait: Image.Image) -> Image.Image:
    """Remove the smooth backdrop while retaining Manticore and hawk."""
    rgb = np.asarray(portrait).astype(np.float64)
    red, green, blue = (rgb[..., channel] for channel in range(3))
    value = np.max(rgb, axis=2)
    # The backdrop is consistently blue-purple even where its brush texture is
    # strong. Every approved foreground material is either warmer than blue,
    # greener than blue, or bright enough to be the hawk's neutral wing.
    subject_color = (red > blue + 3) | (green > blue + 3) | (value > 105)
    foreground = Image.fromarray(np.where(subject_color, 255, 0).astype(np.uint8), "L")
    foreground = foreground.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))

    selected = np.zeros((CANVAS[1], CANVAS[0]), dtype=np.uint8)
    # Main geared Manticore and its detached hawk companion.
    for seed in ((480, 560), (620, 250)):
        component = foreground.copy()
        ImageDraw.floodfill(component, seed, 128, thresh=0)
        selected = np.maximum(selected, np.where(np.asarray(component) == 128, 255, 0).astype(np.uint8))
    return Image.fromarray(selected, "L")


def masked_portrait(portrait: Image.Image, alpha: Image.Image) -> Image.Image:
    result = portrait.convert("RGBA")
    result.putalpha(alpha)
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
    draw.text((50, 34), "Thornguard Radiant Manticore - rig split", font=title, fill="white")
    draw.text(
        (52, 88),
        "Approved pixels on exact rig masks   -   segmented tail remains rigged   -   hawk retained with armor assembly",
        font=note,
        fill="#b9c7d8",
    )
    panels = [
        ("BASE REST POSE", Image.open(BASE / "assembled.png").convert("RGBA")),
        ("REGISTERED COMPOSITE", assembled),
        ("APPROVED FIT REFERENCE", Image.open(SOURCE).convert("RGBA")),
    ]
    for (heading, image), (x, y) in zip(panels, ((50, 150), (600, 150), (1150, 150)), strict=True):
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
    subject = subject_alpha(portrait)
    anatomy_alpha = Image.new("L", CANVAS, 0)
    parts: dict[str, Image.Image] = {}
    for name in BASE_PARTS:
        base_alpha = Image.open(BASE / "parts" / f"{name}.png").convert("RGBA").getchannel("A")
        part_alpha = Image.fromarray(
            np.minimum(np.asarray(base_alpha), np.asarray(subject)).astype(np.uint8), "L"
        )
        anatomy_alpha = Image.fromarray(
            np.maximum(np.asarray(anatomy_alpha), np.asarray(part_alpha)).astype(np.uint8), "L"
        )
        parts[name] = masked_portrait(portrait, part_alpha)
        parts[name].save(PARTS / f"{name}.png", optimize=True)
    visible = np.minimum(np.asarray(subject), 255 - np.asarray(anatomy_alpha)).astype(np.uint8)
    yy, xx = np.indices((CANVAS[1], CANVAS[0]))
    hawk_region = (xx >= 500) & (xx < 760) & (yy >= 130) & (yy < 390)
    hawk_alpha = np.where(hawk_region, visible, 0).astype(np.uint8)
    armor_residual = np.where(hawk_region, 0, visible).astype(np.uint8)
    armor_alpha = keep_body_residual(
        parts, armor_residual, ARMOR_ENVELOPE
    )
    for name in BASE_PARTS:
        parts[name].save(PARTS / f"{name}.png", optimize=True)
    parts["armor_underlay"] = masked_portrait(
        portrait, armor_alpha
    )
    parts["armor_underlay"].save(PARTS / "armor_underlay.png", optimize=True)
    parts["hawk"] = masked_portrait(
        portrait, Image.fromarray(hawk_alpha, "L")
    )
    parts["hawk"].save(PARTS / "hawk.png", optimize=True)
    assembled = compose(parts)
    assembled.save(OUT / "assembled.png", optimize=True)
    review_board(assembled)
    print(f"packaged {len(parts)} registered parts in {PARTS.relative_to(ROOT)}")
    print(f"wrote {OUT.joinpath('assembled.png').relative_to(ROOT)}")
    print(f"wrote {REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
