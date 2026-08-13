#!/usr/bin/env python3
"""Build the Thornguard Mythic Dragonling exact-pose class-rig art package."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from rig_residuals import keep_body_residual


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
SOURCE = ROOT / "assets/gear-portraits/thornguard/mythic/dragonling.png"
BASE = ROOT / "assets/characters/dragonling/mythic"
OUT = ROOT / "assets/character-rigs/thornguard/mythic/dragonling"
PARTS = OUT / "parts"
REVIEW = ROOT / "art/review/thornguard_mythic_dragonling_rig_split.png"
BASE_PARTS = ("wings", "tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane")
Z_ORDER = (*BASE_PARTS, "armor_visible")
ARMOR_ENVELOPE = (170, 475, 590, 750)


def approved_portrait() -> Image.Image:
    return Image.open(SOURCE).convert("RGB").resize(CANVAS, Image.Resampling.LANCZOS)


def foreground_alpha(portrait: Image.Image) -> Image.Image:
    """Reject the commissioned navy backdrop while retaining dark green outlines."""
    rgb = np.asarray(portrait).astype(np.float64)
    red, green, blue = (rgb[..., channel] for channel in range(3))
    navy = (
        (red <= 38)
        & (green <= 47)
        & (blue <= 65)
        & (blue > red * 1.3)
        & (blue > green * 1.12)
    )
    return Image.fromarray(np.where(navy, 0, 255).astype(np.uint8), "L")


def visible_overhang(portrait: Image.Image, anatomy_alpha: Image.Image) -> Image.Image:
    """Keep armor pixels outside the base rig masks, bounded to the torso."""
    rgb = np.asarray(portrait).astype(np.float64)
    yy, xx = np.indices((CANVAS[1], CANVAS[0]))
    left, top, right, bottom = ARMOR_ENVELOPE
    envelope = (xx >= left) & (xx < right) & (yy >= top) & (yy < bottom)
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
    return masked_portrait(
        portrait, Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), "L")
    )


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
    draw.text((50, 34), "Thornguard Mythic Dragonling - rig split", font=title, fill="white")
    draw.text(
        (52, 88),
        "Approved exact pose   -   armor follows torso contour   -   wings remain on their authored bone",
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
    board.save(REVIEW)


def main() -> None:
    PARTS.mkdir(parents=True, exist_ok=True)
    for stale in PARTS.glob("*.png"):
        stale.unlink()
    portrait = approved_portrait()
    foreground = foreground_alpha(portrait)
    base_parts = {
        name: Image.open(BASE / "parts" / f"{name}.png").convert("RGBA")
        for name in BASE_PARTS
    }
    base_union = Image.new("L", CANVAS, 0)
    for base_part in base_parts.values():
        base_union = Image.fromarray(
            np.maximum(
                np.asarray(base_union), np.asarray(base_part.getchannel("A"))
            ).astype(np.uint8),
            "L",
        )
    nearby = np.asarray(base_union.filter(ImageFilter.MaxFilter(81))) > 0
    yy, xx = np.indices((CANVAS[1], CANVAS[0]))
    left, top, right, bottom = ARMOR_ENVELOPE
    armor_region = (xx >= left) & (xx < right) & (yy >= top) & (yy < bottom)
    subject = Image.fromarray(
        np.where((np.asarray(foreground) > 0) & (nearby | armor_region), 255, 0).astype(np.uint8),
        "L",
    )

    anatomy_alpha = Image.new("L", CANVAS, 0)
    parts: dict[str, Image.Image] = {}
    for name in BASE_PARTS:
        base_alpha = np.asarray(base_parts[name].getchannel("A"))
        part_alpha = Image.fromarray(
            np.minimum(base_alpha, np.asarray(subject)).astype(np.uint8), "L"
        )
        anatomy_alpha = Image.fromarray(
            np.maximum(np.asarray(anatomy_alpha), np.asarray(part_alpha)).astype(np.uint8), "L"
        )
        parts[name] = masked_portrait(portrait, part_alpha)
        parts[name].save(PARTS / f"{name}.png")
    visible = np.minimum(np.asarray(subject), 255 - np.asarray(anatomy_alpha)).astype(np.uint8)
    visible_alpha = keep_body_residual(parts, visible, ARMOR_ENVELOPE)
    for name in BASE_PARTS:
        parts[name].save(PARTS / f"{name}.png")
    parts["armor_visible"] = masked_portrait(portrait, visible_alpha)
    parts["armor_visible"].save(PARTS / "armor_visible.png")
    assembled = compose(parts)
    assembled.save(OUT / "assembled.png")
    review_board(assembled)
    print(f"packaged {len(parts)} registered parts in {PARTS.relative_to(ROOT)}")
    print(f"wrote {OUT.joinpath('assembled.png').relative_to(ROOT)}")
    print(f"wrote {REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
