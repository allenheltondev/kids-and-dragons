#!/usr/bin/env python3
"""Build the Duskrunner Sworn Manticore exact-pose class-rig art package."""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from rig_residuals import keep_body_residual


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
SOURCE = Path(
    os.environ.get(
        "KAD_MANTICORE_GEAR_SOURCE",
        ROOT / "assets/gear-portraits/duskrunner/sworn/manticore.png",
    )
)
SOURCE_MATTE: Path | None = None
BASE = ROOT / "assets/characters/manticore/sworn"
OUT = Path(
    os.environ.get(
        "KAD_MANTICORE_RIG_OUT",
        ROOT / "assets/character-rigs/duskrunner/sworn/manticore",
    )
)
PARTS = OUT / "parts"
REVIEW = Path(
    os.environ.get(
        "KAD_MANTICORE_RIG_REVIEW",
        ROOT / "art/review/duskrunner_sworn_manticore_rig_split.png",
    )
)
REVIEW_TITLE = "Duskrunner Sworn Manticore - rig split"
REVIEW_NOTE = (
    "Approved exact pose   -   hood and scarf follow the head and chest   -   "
    "scorpion tail remains clear"
)
BASE_PARTS = ("tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane")

# Registered against unchanged tail, flank, leg, and foot landmarks.
REGISTERED_SIZE = (951, 938)
REGISTERED_OFFSET = (16, 35)
GEAR_ENVELOPE = (90, 70, 720, 770)
SUBJECT_CLIP_ENVELOPE: tuple[int, int, int, int] | None = None
CLIP_LOWER_BODY_TO_BASE = True
Z_ORDER = (
    "tail",
    "leg_l",
    "leg_r",
    "body",
    "arm_l",
    "arm_r",
    "head",
    "gear_visible",
    "mane",
)


def approved_portrait() -> Image.Image:
    return Image.open(SOURCE).convert("RGB").resize(CANVAS, Image.Resampling.LANCZOS)


def subject_alpha(portrait: Image.Image) -> Image.Image:
    """Remove the smooth purple portrait backdrop and keep the connected figure."""
    rgb = np.asarray(portrait).astype(np.float64)
    yy, xx = np.indices((CANVAS[1], CANVAS[0]))
    x = (xx - CANVAS[0] / 2) / (CANVAS[0] / 2)
    y = (yy - CANVAS[1] / 2) / (CANVAS[1] / 2)
    features = np.stack(
        (np.ones_like(x), x, y, x * x, x * y, y * y, x**3, x * x * y, x * y * y, y**3),
        axis=-1,
    )
    border = (xx < 90) | (xx > 933) | (yy < 90) | (yy > 933)
    samples = border & (xx % 4 == 0) & (yy % 4 == 0)
    predicted = np.empty_like(rgb)
    for channel in range(3):
        coefficients = np.linalg.lstsq(features[samples], rgb[..., channel][samples], rcond=None)[0]
        predicted[..., channel] = features @ coefficients
    residual = np.sqrt(np.mean((rgb - predicted) ** 2, axis=2))
    connected = Image.fromarray(np.where(residual > 7, 255, 0).astype(np.uint8), "L")
    connected = connected.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.MinFilter(15))
    ImageDraw.floodfill(connected, (500, 500), 128, thresh=0)
    return Image.fromarray(
        np.where(np.asarray(connected) == 128, 255, 0).astype(np.uint8), "L"
    )


def register_subject(portrait: Image.Image, alpha: Image.Image) -> tuple[Image.Image, Image.Image]:
    resized_rgb = portrait.resize(REGISTERED_SIZE, Image.Resampling.LANCZOS)
    registered_rgb = Image.new("RGB", CANVAS)
    registered_rgb.paste(resized_rgb, REGISTERED_OFFSET)
    resized_alpha = alpha.resize(REGISTERED_SIZE, Image.Resampling.LANCZOS)
    registered_alpha = Image.new("L", CANVAS)
    registered_alpha.paste(resized_alpha, REGISTERED_OFFSET)
    return registered_rgb, registered_alpha


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
    draw.text((50, 34), REVIEW_TITLE, font=title, fill="white")
    draw.text(
        (52, 88),
        REVIEW_NOTE,
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
    if SOURCE_MATTE is not None:
        source_alpha = Image.open(SOURCE_MATTE).convert("RGBA").getchannel("A")
        source_alpha = source_alpha.resize(CANVAS, Image.Resampling.LANCZOS)
    else:
        source_alpha = subject_alpha(portrait)
    portrait, subject = register_subject(portrait, source_alpha)
    base_assembled = Image.open(BASE / "assembled.png").convert("RGBA")
    base_parts = {
        name: Image.open(BASE / "parts" / f"{name}.png").convert("RGBA")
        for name in BASE_PARTS
    }
    base_union = np.zeros((CANVAS[1], CANVAS[0]), dtype=np.uint8)
    for base_part in base_parts.values():
        base_union = np.maximum(base_union, np.asarray(base_part.getchannel("A")))

    subject_array = np.asarray(subject).copy()
    if CLIP_LOWER_BODY_TO_BASE:
        yy = np.indices((CANVAS[1], CANVAS[0]))[0]
        lower_body = yy > 800
        subject_array[lower_body] = np.minimum(subject_array[lower_body], base_union[lower_body])
    subject = Image.fromarray(subject_array.astype(np.uint8), "L")

    portrait_array = np.asarray(portrait).copy()
    base_array = np.asarray(base_assembled)[..., :3]
    clipped_anatomy = (subject_array == 0) & (base_union > 0)
    portrait_array[clipped_anatomy] = base_array[clipped_anatomy]
    portrait = Image.fromarray(portrait_array.astype(np.uint8), "RGB")

    anatomy_alpha = Image.new("L", CANVAS, 0)
    parts: dict[str, Image.Image] = {}
    for name in BASE_PARTS:
        base_alpha_array = np.asarray(base_parts[name].getchannel("A")).copy()
        if SUBJECT_CLIP_ENVELOPE is not None:
            left, top, right, bottom = SUBJECT_CLIP_ENVELOPE
            base_alpha_array[top:bottom, left:right] = np.minimum(
                base_alpha_array[top:bottom, left:right],
                subject_array[top:bottom, left:right],
            )
        base_alpha = Image.fromarray(base_alpha_array.astype(np.uint8), "L")
        anatomy_alpha = Image.fromarray(
            np.maximum(np.asarray(anatomy_alpha), np.asarray(base_alpha)).astype(np.uint8), "L"
        )
        parts[name] = masked_portrait(portrait, base_alpha)
        parts[name].save(PARTS / f"{name}.png", optimize=True)
    visible = np.minimum(np.asarray(subject), 255 - np.asarray(anatomy_alpha)).astype(np.uint8)
    visible_alpha = keep_body_residual(parts, visible, GEAR_ENVELOPE)
    for name in BASE_PARTS:
        parts[name].save(PARTS / f"{name}.png", optimize=True)
    parts["gear_visible"] = masked_portrait(portrait, visible_alpha)
    parts["gear_visible"].save(PARTS / "gear_visible.png", optimize=True)
    assembled = compose(parts)
    assembled.save(OUT / "assembled.png", optimize=True)
    review_board(assembled)
    print(f"packaged {len(parts)} registered parts in {PARTS.relative_to(ROOT)}")
    print(f"wrote {OUT.joinpath('assembled.png').relative_to(ROOT)}")
    print(f"wrote {REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
