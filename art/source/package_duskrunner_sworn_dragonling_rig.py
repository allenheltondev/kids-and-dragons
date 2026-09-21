#!/usr/bin/env python3
"""Build the Duskrunner Sworn Dragonling exact-pose class-rig art package."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from rig_residuals import keep_body_residual


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
SOURCE = ROOT / "assets/gear-portraits/duskrunner/sworn/dragonling.png"
GEAR_OVERLAY_SOURCE: Path | None = None
GEAR_BEHIND_BODY_REGIONS: tuple[tuple[int, int, int, int], ...] = ()
BASE = ROOT / "assets/characters/dragonling/sworn"
OUT = ROOT / "assets/character-rigs/duskrunner/sworn/dragonling"
PARTS = OUT / "parts"
REVIEW = ROOT / "art/review/duskrunner_sworn_dragonling_rig_split.png"
REVIEW_TITLE = "Duskrunner Sworn Dragonling - rig split"
REVIEW_NOTE = (
    "Approved exact pose   -   scarf and harness follow the body   -   "
    "wings and mane remain unobstructed"
)
BASE_PARTS = ("wings", "tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane")
EDGE_ALPHA_CLIP_TOP = 0
EDGE_ALPHA_CLIP_PARTS: tuple[str, ...] = ()
DETACHED_PART_ENVELOPES: tuple[tuple[str, tuple[int, int, int, int]], ...] = ()
COLOR_TRIM_DETACHED_PARTS: tuple[str, ...] = ()
KEEP_BODY_RESIDUAL = True
SOURCE_ALPHA_EXTEND_ENVELOPES: tuple[tuple[str, tuple[int, int, int, int]], ...] = ()
RESTORE_NAVY_ANATOMY = False
SUBJECT_CLIP_ENVELOPES: tuple[tuple[int, int, int, int], ...] = ()
CANONICAL_COLOR_RESTORE_ENVELOPES: tuple[tuple[int, int, int, int], ...] = ()
CANONICAL_PARTS: tuple[str, ...] = ()
EXTRACT_TEAL_GEAR = False
GEAR_OVERLAY_POLYGON: tuple[tuple[int, int], ...] = ()
GEAR_OVERLAY_ERASE_ENVELOPES: tuple[tuple[int, int, int, int], ...] = ()

# Registered against the canonical Sworn rest pose using unchanged landmarks
# on the face, wings, feet, and tail. The approved portrait needs only a small
# non-uniform scale correction and translation; no rotation or pose warp.
REGISTERED_SIZE = (1042, 1037)
REGISTERED_OFFSET = (-32, -21)
GEAR_ENVELOPE = (130, 330, 700, 810)
Z_ORDER = (
    "wings",
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


def foreground_candidates(portrait: Image.Image) -> Image.Image:
    """Remove the smooth navy backdrop, retaining detached props."""
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
    # The Dragonling portrait's navy backdrop has more painted texture than
    # the Unicorn's. A slightly firmer cutoff keeps that texture from joining
    # the mane and floor shadow while preserving the soft creature outline.
    connected = Image.fromarray(np.where(residual > 11, 255, 0).astype(np.uint8), "L")
    connected = connected.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    return connected


def subject_alpha(portrait: Image.Image) -> Image.Image:
    """Keep the connected creature, excluding detached props."""
    connected = foreground_candidates(portrait)
    ImageDraw.floodfill(connected, (500, 500), 128, thresh=0)
    return Image.fromarray(np.where(np.asarray(connected) == 128, 255, 0).astype(np.uint8), "L")


def register_subject(portrait: Image.Image, alpha: Image.Image) -> tuple[Image.Image, Image.Image]:
    subject = portrait.convert("RGBA")
    subject.putalpha(alpha)
    subject = subject.resize(REGISTERED_SIZE, Image.Resampling.LANCZOS)
    registered = Image.new("RGBA", CANVAS)
    registered.alpha_composite(subject, dest=REGISTERED_OFFSET)
    return registered.convert("RGB"), registered.getchannel("A")


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
    source_portrait = approved_portrait()
    detached_candidates = foreground_candidates(source_portrait)
    portrait = source_portrait
    registered_gear = None
    registered_gear_alpha = None
    if GEAR_OVERLAY_SOURCE is not None:
        gear = Image.open(GEAR_OVERLAY_SOURCE).convert("RGBA").resize(
            CANVAS,
            Image.Resampling.LANCZOS,
        )
        registered_gear, registered_gear_alpha = register_subject(
            gear.convert("RGB"),
            gear.getchannel("A"),
        )
    portrait, subject = register_subject(portrait, subject_alpha(portrait))
    registered_source, _ = register_subject(
        source_portrait, Image.new("L", CANVAS, 255)
    )
    _, registered_detached = register_subject(source_portrait, detached_candidates)
    base_assembled = Image.open(BASE / "assembled.png").convert("RGBA")
    base_parts = {
        name: Image.open(BASE / "parts" / f"{name}.png").convert("RGBA")
        for name in BASE_PARTS
    }
    base_union = np.zeros((CANVAS[1], CANVAS[0]), dtype=np.uint8)
    for base_part in base_parts.values():
        base_union = np.maximum(base_union, np.asarray(base_part.getchannel("A")))

    if registered_gear_alpha is not None and GEAR_BEHIND_BODY_REGIONS:
        gear_alpha = np.asarray(registered_gear_alpha).copy()
        for x0, y0, x1, y1 in GEAR_BEHIND_BODY_REGIONS:
            gear_alpha[y0:y1, x0:x1] = np.minimum(
                gear_alpha[y0:y1, x0:x1],
                255 - base_union[y0:y1, x0:x1],
            )
        registered_gear_alpha = Image.fromarray(gear_alpha.astype(np.uint8), "L")

    # Remove the portrait's painted floor shadow and retain the canonical feet.
    subject_array = np.asarray(subject).copy()
    yy = np.indices((CANVAS[1], CANVAS[0]))[0]
    lower_body = yy > 800
    subject_array[lower_body] = np.minimum(subject_array[lower_body], base_union[lower_body])
    subject = Image.fromarray(subject_array.astype(np.uint8), "L")

    # Background removal is only authoritative outside the canonical anatomy.
    # Inside it, restore any pixels the navy cutoff clipped and use the base
    # portrait as the color fallback. This keeps every horn, scale, mane edge,
    # wing edge, toe, and tail pixel intact without bringing the backdrop back.
    portrait_array = np.asarray(portrait).copy()
    base_array = np.asarray(base_assembled)[..., :3]
    clipped_anatomy = (subject_array == 0) & (base_union > 0)
    portrait_array[clipped_anatomy] = base_array[clipped_anatomy]
    if RESTORE_NAVY_ANATOMY:
        red = portrait_array[..., 0].astype(np.int16)
        green = portrait_array[..., 1].astype(np.int16)
        blue = portrait_array[..., 2].astype(np.int16)
        navy = (blue > red + 8) & (blue > green + 4)
        portrait_array[navy & (base_union > 0)] = base_array[navy & (base_union > 0)]
    for left, top, right, bottom in CANONICAL_COLOR_RESTORE_ENVELOPES:
        region = base_union[top:bottom, left:right] > 0
        target = portrait_array[top:bottom, left:right]
        fallback = base_array[top:bottom, left:right]
        target[region] = fallback[region]
    portrait = Image.fromarray(portrait_array.astype(np.uint8), "RGB")

    anatomy_alpha = Image.new("L", CANVAS, 0)
    parts: dict[str, Image.Image] = {}
    for name in BASE_PARTS:
        base_alpha = base_parts[name].getchannel("A")
        # Keep the canonical part alpha whole. The subject matte is deliberately
        # not allowed to erase anatomy pixels after chroma extraction.
        part_alpha_array = np.asarray(base_alpha).copy()
        for left, top, right, bottom in SUBJECT_CLIP_ENVELOPES:
            part_alpha_array[top:bottom, left:right] = np.minimum(
                part_alpha_array[top:bottom, left:right],
                subject_array[top:bottom, left:right],
            )
        for extend_name, (left, top, right, bottom) in SOURCE_ALPHA_EXTEND_ENVELOPES:
            if name == extend_name:
                part_alpha_array[top:bottom, left:right] = np.maximum(
                    part_alpha_array[top:bottom, left:right],
                    subject_array[top:bottom, left:right],
                )
        part_alpha = Image.fromarray(part_alpha_array.astype(np.uint8), "L")
        anatomy_alpha = Image.fromarray(
            np.maximum(np.asarray(anatomy_alpha), np.asarray(part_alpha)).astype(np.uint8), "L"
        )
        if GEAR_OVERLAY_SOURCE is not None:
            parts[name] = base_parts[name].copy()
        elif name in CANONICAL_PARTS:
            parts[name] = base_parts[name].copy()
        else:
            parts[name] = masked_portrait(portrait, part_alpha)
        parts[name].save(PARTS / f"{name}.png", optimize=True)
    if GEAR_OVERLAY_SOURCE is not None:
        visible_alpha = registered_gear_alpha
        gear_portrait = registered_gear
    else:
        visible = np.minimum(np.asarray(subject), 255 - np.asarray(anatomy_alpha)).astype(np.uint8)
        if EXTRACT_TEAL_GEAR:
            # A pose-painted mantle cannot be safely pushed through the broad,
            # overlapping anatomy mattes.  Select its teal and brass pigment
            # directly, leaving the creature on its canonical rig layers.
            if GEAR_OVERLAY_POLYGON:
                overlay_mask = Image.new("L", CANVAS, 0)
                ImageDraw.Draw(overlay_mask).polygon(GEAR_OVERLAY_POLYGON, fill=255)
                rgb = np.asarray(portrait).astype(np.int16)
                difference = np.max(np.abs(rgb - base_array.astype(np.int16)), axis=2)
                selected = Image.fromarray(
                    ((difference > 32).astype(np.uint8) * 255), "L"
                ).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(3))
                visible_alpha = Image.fromarray(
                    np.minimum(np.asarray(selected), np.asarray(overlay_mask)).astype(np.uint8),
                    "L",
                )
            else:
                rgb = np.asarray(portrait).astype(np.int16)
                difference = np.max(np.abs(rgb - base_array.astype(np.int16)), axis=2)
                selected = (difference > 35).astype(np.uint8) * 255
                selected = np.minimum(selected, np.asarray(subject))
                left, top, right, bottom = GEAR_ENVELOPE
                kept = np.zeros_like(selected)
                kept[top:bottom, left:right] = selected[top:bottom, left:right]
                visible_alpha = Image.fromarray(kept, "L").filter(
                    ImageFilter.MaxFilter(11)
                ).filter(ImageFilter.MinFilter(11))
            if GEAR_OVERLAY_ERASE_ENVELOPES:
                alpha = np.asarray(visible_alpha).copy()
                for left, top, right, bottom in GEAR_OVERLAY_ERASE_ENVELOPES:
                    alpha[top:bottom, left:right] = 0
                visible_alpha = Image.fromarray(alpha.astype(np.uint8), "L")
        elif KEEP_BODY_RESIDUAL:
            visible_alpha = keep_body_residual(parts, visible, GEAR_ENVELOPE)
        else:
            left, top, right, bottom = GEAR_ENVELOPE
            kept = np.zeros_like(visible)
            kept[top:bottom, left:right] = visible[top:bottom, left:right]
            visible_alpha = Image.fromarray(kept.astype(np.uint8), "L")
        gear_portrait = portrait
    if EDGE_ALPHA_CLIP_TOP > 0:
        for name in EDGE_ALPHA_CLIP_PARTS:
            clipped_alpha = np.asarray(parts[name].getchannel("A")).copy()
            clipped_alpha[:EDGE_ALPHA_CLIP_TOP, :] = 0
            parts[name].putalpha(Image.fromarray(clipped_alpha.astype(np.uint8), "L"))
    for name in BASE_PARTS:
        parts[name].save(PARTS / f"{name}.png", optimize=True)
    parts["gear_visible"] = masked_portrait(gear_portrait, visible_alpha)
    parts["gear_visible"].save(PARTS / "gear_visible.png", optimize=True)
    for name, envelope in DETACHED_PART_ENVELOPES:
        left, top, right, bottom = envelope
        detached = np.zeros_like(np.asarray(registered_detached))
        detached[top:bottom, left:right] = np.asarray(registered_detached)[top:bottom, left:right]
        if name in COLOR_TRIM_DETACHED_PARTS:
            rgb = np.asarray(registered_source).astype(np.int16)
            red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
            crystal = (green > 60) & (blue > 90) & (blue > red + 25) & (green > red + 10)
            brass = (red > 65) & (green > 25) & (red > green + 12) & (red > blue + 15)
            pigment = Image.fromarray(((crystal | brass).astype(np.uint8) * 255), "L")
            pigment = pigment.filter(ImageFilter.MaxFilter(5))
            detached = np.minimum(detached, np.asarray(pigment))
        parts[name] = masked_portrait(
            registered_source, Image.fromarray(detached.astype(np.uint8), "L")
        )
        parts[name].save(PARTS / f"{name}.png", optimize=True)
    assembled = compose(parts)
    assembled.save(OUT / "assembled.png", optimize=True)
    review_board(assembled)
    print(f"packaged {len(parts)} registered parts in {PARTS.relative_to(ROOT)}")
    print(f"wrote {OUT.joinpath('assembled.png').relative_to(ROOT)}")
    print(f"wrote {REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
