#!/usr/bin/env python3
"""Build the Thornguard Radiant Unicorn exact-pose class-rig art package."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
SOURCE = ROOT / "assets/gear-portraits/thornguard/radiant/unicorn.png"
COHERENT_ARMOR = ROOT / "art/source/thornguard_unicorn_radiant_fitted_armor.png"
BASE = ROOT / "assets/characters/unicorn/radiant"
OUT = ROOT / "assets/character-rigs/thornguard/radiant/unicorn"
PARTS = OUT / "parts"
REVIEW = ROOT / "art/review/thornguard_radiant_unicorn_rig_split.png"
BASE_PARTS = ("tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane", "horn")

# Forward transform from the generated 1254px armor cutout to the exact
# 1024px Radiant Unicorn rig pose.
ARMOR_TO_RIG = (0.535, 0.0, 115.0, 0.0, 0.535, 242.0)
ARMOR_ENVELOPE = (
    (210, 400),
    (680, 400),
    (680, 735),
    (210, 735),
)
Z_ORDER = (
    "armor_underlay",
    "tail",
    "leg_l",
    "leg_r",
    "body",
    "arm_l",
    "arm_r",
    "head",
    "armor_visible",
    "mane",
    "horn",
)


def registered_underlay() -> Image.Image:
    """Register the continuous hidden harness beneath the creature anatomy."""
    source = Image.open(COHERENT_ARMOR).convert("RGBA")
    if source.getchannel("A").getbbox() is None:
        raise ValueError(f"{COHERENT_ARMOR} has no visible pixels")
    a, b, c, d, e, f = ARMOR_TO_RIG
    forward = np.array(((a, b, c), (d, e, f), (0.0, 0.0, 1.0)))
    inverse = np.linalg.inv(forward)[:2].reshape(-1)
    return source.transform(
        CANVAS,
        Image.Transform.AFFINE,
        tuple(float(value) for value in inverse),
        Image.Resampling.BICUBIC,
    )


def approved_portrait() -> Image.Image:
    """Register the approved geared portrait to the rig canvas."""
    portrait = Image.open(SOURCE).convert("RGB").resize(CANVAS, Image.Resampling.LANCZOS)
    return portrait.transform(
        CANVAS,
        Image.Transform.AFFINE,
        (1.0, 0.0, 2.0, 0.0, 1.0, 2.0),
        Image.Resampling.BICUBIC,
    )


def geared_part(portrait: Image.Image, base_part: Image.Image) -> Image.Image:
    """Paint one existing rig part with its exact approved geared pixels."""
    result = portrait.convert("RGBA")
    result.putalpha(base_part.getchannel("A"))
    return result


def registered_visible_armor(portrait: Image.Image, anatomy_alpha: Image.Image) -> Image.Image:
    """Recover only armor pixels that protrude beyond the rig anatomy masks."""
    rgb = np.asarray(portrait).astype(np.float64)
    envelope_image = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(envelope_image).polygon(ARMOR_ENVELOPE, fill=255)
    envelope = np.asarray(envelope_image) > 0
    outside_anatomy = np.asarray(anatomy_alpha) < 16

    # The portrait backdrop is a smooth navy polynomial. Fit it from known
    # background pixels around the harness, then retain every pixel whose
    # residual exceeds that model. Unlike hue classification this preserves
    # the nearly-black strap edges and buckle outlines.
    yy, xx = np.indices((CANVAS[1], CANVAS[0]))
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
    mask_image = Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), "L")
    mask_image = mask_image.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    result = portrait.convert("RGBA")
    result.putalpha(mask_image)
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
    draw.text((50, 34), "Thornguard Radiant Unicorn — rig split", font=title, fill="white")
    draw.text(
        (52, 88),
        "Exact approved pose   •   fitted harness → body bone   •   mane and horn stay in front",
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
    parts: dict[str, Image.Image] = {}
    portrait = approved_portrait()
    anatomy_alpha = Image.new("L", CANVAS, 0)
    for name in BASE_PARTS:
        source = BASE / "parts" / f"{name}.png"
        target = PARTS / f"{name}.png"
        base_part = Image.open(source).convert("RGBA")
        anatomy_alpha = Image.fromarray(
            np.maximum(np.asarray(anatomy_alpha), np.asarray(base_part.getchannel("A")))
        )
        parts[name] = geared_part(portrait, base_part)
        parts[name].save(target, optimize=True)
    parts["armor_underlay"] = registered_underlay()
    underlay_alpha = np.minimum(
        np.asarray(parts["armor_underlay"].getchannel("A")),
        np.asarray(anatomy_alpha),
    )
    parts["armor_underlay"].putalpha(Image.fromarray(underlay_alpha.astype(np.uint8), "L"))
    parts["armor_visible"] = registered_visible_armor(portrait, anatomy_alpha)
    parts["armor_underlay"].save(PARTS / "armor_underlay.png", optimize=True)
    parts["armor_visible"].save(PARTS / "armor_visible.png", optimize=True)
    assembled = compose(parts)
    assembled.save(OUT / "assembled.png", optimize=True)
    review_board(parts, assembled)
    print(f"packaged {len(parts)} registered parts in {PARTS.relative_to(ROOT)}")
    print(f"wrote {OUT.joinpath('assembled.png').relative_to(ROOT)}")
    print(f"wrote {REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
