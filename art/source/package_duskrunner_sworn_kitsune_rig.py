#!/usr/bin/env python3
"""Build the Duskrunner Sworn Kitsune exact-pose class-rig art package."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from rig_residuals import keep_body_residual


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
SOURCE = ROOT / "assets/gear-portraits/duskrunner/sworn/kitsune.png"
SOURCE_MATTE: Path | None = None
BASE = ROOT / "assets/characters/kitsune/sworn"
OUT = ROOT / "assets/character-rigs/duskrunner/sworn/kitsune"
PARTS = OUT / "parts"
REVIEW = ROOT / "art/review/duskrunner_sworn_kitsune_rig_split.png"
REVIEW_TITLE = "Duskrunner Sworn Kitsune - rig split"
REVIEW_NOTE = (
    "Approved exact pose   -   hood and scarf follow the head and chest   -   "
    "three tails remain clear"
)
BASE_PARTS = ("tail", "leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane")

# Registered against unchanged tail, flank, leg, and foot landmarks.
REGISTERED_SIZE = (1039, 1069)
REGISTERED_OFFSET = (35, -57)
GEAR_ENVELOPE = (60, 40, 690, 760)
GEAR_BEHIND_ENVELOPE: tuple[int, int, int, int] | None = None
GEAR_BEHIND_SUBJECT_MAX_GREEN: int | None = None
SUBJECT_RESIDUAL_THRESHOLD = 7
SUBJECT_ALLOWED_DILATION = 0
SUBJECT_OVERHANG_ENVELOPE: tuple[int, int, int, int] | None = None
SUBJECT_OVERHANG_DILATION = 0
SUBJECT_FREE_OVERHANG_ENVELOPE: tuple[int, int, int, int] | None = None
SUBJECT_FREE_OVERHANG_MAX_GREEN: int | None = None
SUBJECT_HOLE_FILL_ENVELOPE: tuple[int, int, int, int] | None = None
SUBJECT_CLIP_ENVELOPE: tuple[int, int, int, int] | None = None
BASE_RESTORE_ENVELOPE: tuple[int, int, int, int] | None = None
BASE_RESTORE_ENVELOPES: tuple[tuple[int, int, int, int], ...] = ()
BASE_RESTORE_KEEP_DARK_ENVELOPE: tuple[int, int, int, int] | None = None
BASE_RESTORE_KEEP_DARK_MAX_GREEN = 120
BASE_LIGHT_RESTORE_ENVELOPE: tuple[int, int, int, int] | None = None
BASE_LIGHT_RESTORE_ENVELOPES: tuple[tuple[int, int, int, int], ...] = ()
BASE_LIGHT_RESTORE_POLYGONS: tuple[tuple[tuple[int, int], ...], ...] = ()
BASE_LIGHT_RESTORE_MIN_VALUE = 120
BASE_LIGHT_RESTORE_DILATION = 0
BASE_LIGHT_RESTORE_FEATHER = 0
BASE_EXACT_RESTORE_POLYGONS: tuple[tuple[tuple[int, int], ...], ...] = ()
BASE_EXACT_RESTORE_FEATHER = 0
HEAD_GEAR_ENVELOPE: tuple[int, int, int, int] | None = None
PART_ALPHA_ERASE_ENVELOPES: tuple[tuple[str, tuple[int, int, int, int]], ...] = ()
Z_ORDER = (
    "tail",
    "gear_behind",
    "leg_l",
    "leg_r",
    "body",
    "arm_l",
    "arm_r",
    "head",
    "gear_visible",
    "mane",
    "gear_head",
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
    connected = Image.fromarray(
        np.where(residual > SUBJECT_RESIDUAL_THRESHOLD, 255, 0).astype(np.uint8), "L"
    )
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
        if name in parts:
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
    registered_portrait_array = np.asarray(portrait).copy()
    base_assembled = Image.open(BASE / "assembled.png").convert("RGBA")
    base_parts = {
        name: Image.open(BASE / "parts" / f"{name}.png").convert("RGBA")
        for name in BASE_PARTS
    }
    base_union = np.zeros((CANVAS[1], CANVAS[0]), dtype=np.uint8)
    for base_part in base_parts.values():
        base_union = np.maximum(base_union, np.asarray(base_part.getchannel("A")))

    raw_registered_subject = np.asarray(subject).copy()
    subject_array = raw_registered_subject.copy()
    subject_hole_fill = np.zeros_like(subject_array, dtype=bool)
    if SUBJECT_HOLE_FILL_ENVELOPE is not None:
        inverse = Image.fromarray(255 - subject_array, "L")
        exterior = inverse.copy()
        ImageDraw.floodfill(exterior, (0, 0), 128, thresh=0)
        enclosed_holes = (np.asarray(exterior) == 255)
        left, top, right, bottom = SUBJECT_HOLE_FILL_ENVELOPE
        hole_envelope = np.zeros_like(enclosed_holes)
        hole_envelope[top:bottom, left:right] = True
        subject_hole_fill = enclosed_holes & hole_envelope
        subject_array[subject_hole_fill] = 255
    filled_subject_array = subject_array.copy()
    if SUBJECT_ALLOWED_DILATION > 0:
        size = SUBJECT_ALLOWED_DILATION * 2 + 1
        allowed = Image.fromarray(base_union, "L").filter(ImageFilter.MaxFilter(size))
        subject_array = np.minimum(subject_array, np.asarray(allowed))
    if SUBJECT_OVERHANG_ENVELOPE is not None:
        left, top, right, bottom = SUBJECT_OVERHANG_ENVELOPE
        yy, xx = np.indices((CANVAS[1], CANVAS[0]))
        envelope = (xx >= left) & (xx < right) & (yy >= top) & (yy < bottom)
        if SUBJECT_OVERHANG_DILATION > 0:
            size = SUBJECT_OVERHANG_DILATION * 2 + 1
            near_base = np.asarray(
                Image.fromarray(base_union, "L").filter(ImageFilter.MaxFilter(size))
            ) > 0
        else:
            near_base = base_union > 0
        keep = (base_union > 0) | (envelope & near_base)
        subject_array = np.where(keep, subject_array, 0).astype(np.uint8)
    if SUBJECT_FREE_OVERHANG_ENVELOPE is not None:
        left, top, right, bottom = SUBJECT_FREE_OVERHANG_ENVELOPE
        free_overhang = np.zeros_like(subject_array, dtype=bool)
        free_overhang[top:bottom, left:right] = True
        free_source = filled_subject_array
        if SUBJECT_FREE_OVERHANG_MAX_GREEN is not None:
            portrait_green = np.asarray(portrait)[..., 1]
            free_source = np.where(
                portrait_green <= SUBJECT_FREE_OVERHANG_MAX_GREEN,
                free_source,
                0,
            ).astype(np.uint8)
        subject_array = np.maximum(
            subject_array,
            np.where(free_overhang, free_source, 0).astype(np.uint8),
        )
    yy = np.indices((CANVAS[1], CANVAS[0]))[0]
    lower_body = yy > 800
    subject_array[lower_body] = np.minimum(subject_array[lower_body], base_union[lower_body])
    subject = Image.fromarray(subject_array.astype(np.uint8), "L")

    portrait_array = np.asarray(portrait).copy()
    base_array = np.asarray(base_assembled)[..., :3]
    restore_envelopes = BASE_RESTORE_ENVELOPES
    if BASE_RESTORE_ENVELOPE is not None:
        restore_envelopes = (BASE_RESTORE_ENVELOPE, *restore_envelopes)
    if restore_envelopes:
        restore = np.zeros_like(base_union, dtype=bool)
        for left, top, right, bottom in restore_envelopes:
            restore[top:bottom, left:right] = True
        restore &= base_union > 0
        if BASE_RESTORE_KEEP_DARK_ENVELOPE is not None:
            keep_left, keep_top, keep_right, keep_bottom = BASE_RESTORE_KEEP_DARK_ENVELOPE
            keep_dark = np.zeros_like(restore)
            keep_dark[keep_top:keep_bottom, keep_left:keep_right] = True
            keep_dark &= portrait_array[..., 1] <= BASE_RESTORE_KEEP_DARK_MAX_GREEN
            keep_dark &= subject_array > 0
            restore &= ~keep_dark
        portrait_array[restore] = base_array[restore]
    light_restore_envelopes = BASE_LIGHT_RESTORE_ENVELOPES
    if BASE_LIGHT_RESTORE_ENVELOPE is not None:
        light_restore_envelopes = (BASE_LIGHT_RESTORE_ENVELOPE, *light_restore_envelopes)
    if light_restore_envelopes or BASE_LIGHT_RESTORE_POLYGONS:
        light_base = base_array.max(axis=2) >= BASE_LIGHT_RESTORE_MIN_VALUE
        if BASE_LIGHT_RESTORE_DILATION > 0:
            size = BASE_LIGHT_RESTORE_DILATION * 2 + 1
            light_base = np.asarray(
                Image.fromarray(np.where(light_base, 255, 0).astype(np.uint8), "L").filter(
                    ImageFilter.MaxFilter(size)
                )
            ) > 0
        light_envelope = np.zeros_like(light_base)
        for left, top, right, bottom in light_restore_envelopes:
            light_envelope[top:bottom, left:right] = True
        if BASE_LIGHT_RESTORE_POLYGONS:
            polygon_mask = Image.new("L", CANVAS, 0)
            polygon_draw = ImageDraw.Draw(polygon_mask)
            for polygon in BASE_LIGHT_RESTORE_POLYGONS:
                polygon_draw.polygon(polygon, fill=255)
            light_envelope |= np.asarray(polygon_mask) > 0
        light_restore = light_base & light_envelope & (base_union > 0)
        if BASE_LIGHT_RESTORE_FEATHER > 0:
            restore_weight = Image.fromarray(
                np.where(light_restore, 255, 0).astype(np.uint8), "L"
            ).filter(ImageFilter.GaussianBlur(BASE_LIGHT_RESTORE_FEATHER))
            weight = np.minimum(np.asarray(restore_weight), base_union).astype(np.float64) / 255.0
            portrait_array = np.rint(
                portrait_array * (1.0 - weight[..., None])
                + base_array * weight[..., None]
            ).astype(np.uint8)
        else:
            portrait_array[light_restore] = base_array[light_restore]
    if BASE_EXACT_RESTORE_POLYGONS:
        exact_mask = Image.new("L", CANVAS, 0)
        exact_draw = ImageDraw.Draw(exact_mask)
        for polygon in BASE_EXACT_RESTORE_POLYGONS:
            exact_draw.polygon(polygon, fill=255)
        if BASE_EXACT_RESTORE_FEATHER > 0:
            exact_mask = exact_mask.filter(ImageFilter.GaussianBlur(BASE_EXACT_RESTORE_FEATHER))
        exact_weight = np.minimum(np.asarray(exact_mask), base_union).astype(np.float64) / 255.0
        portrait_array = np.rint(
            portrait_array * (1.0 - exact_weight[..., None])
            + base_array * exact_weight[..., None]
        ).astype(np.uint8)
    clipped_anatomy = (subject_array == 0) & (base_union > 0)
    portrait_array[clipped_anatomy] = base_array[clipped_anatomy]
    portrait = Image.fromarray(portrait_array.astype(np.uint8), "RGB")

    anatomy_alpha = Image.new("L", CANVAS, 0)
    parts: dict[str, Image.Image] = {}
    for name in BASE_PARTS:
        base_alpha = base_parts[name].getchannel("A")
        part_alpha_array = np.asarray(base_alpha).copy()
        for erase_part, envelope in PART_ALPHA_ERASE_ENVELOPES:
            if erase_part != name:
                continue
            left, top, right, bottom = envelope
            part_alpha_array[top:bottom, left:right] = 0
        if SUBJECT_CLIP_ENVELOPE is not None:
            left, top, right, bottom = SUBJECT_CLIP_ENVELOPE
            part_alpha_array[top:bottom, left:right] = np.minimum(
                part_alpha_array[top:bottom, left:right],
                subject_array[top:bottom, left:right],
            )
        part_alpha = Image.fromarray(part_alpha_array.astype(np.uint8), "L")
        anatomy_alpha = Image.fromarray(
            np.maximum(np.asarray(anatomy_alpha), np.asarray(part_alpha)).astype(np.uint8), "L"
        )
        parts[name] = masked_portrait(portrait, part_alpha)
        parts[name].save(PARTS / f"{name}.png", optimize=True)
    visible = np.minimum(np.asarray(subject), 255 - np.asarray(anatomy_alpha)).astype(np.uint8)
    behind_alpha: Image.Image | None = None
    if GEAR_BEHIND_ENVELOPE is not None:
        left, top, right, bottom = GEAR_BEHIND_ENVELOPE
        behind_mask = np.zeros_like(visible, dtype=bool)
        behind_mask[top:bottom, left:right] = True
        behind_source = visible
        if GEAR_BEHIND_SUBJECT_MAX_GREEN is not None:
            dark_subject = np.where(
                np.asarray(portrait)[..., 1] <= GEAR_BEHIND_SUBJECT_MAX_GREEN,
                subject_array,
                0,
            ).astype(np.uint8)
            behind_source = np.maximum(behind_source, dark_subject)
        behind_array = np.where(behind_mask, behind_source, 0).astype(np.uint8)
        visible = np.where(behind_mask, 0, visible).astype(np.uint8)
        behind_alpha = Image.fromarray(behind_array, "L")
    visible_alpha = keep_body_residual(parts, visible, GEAR_ENVELOPE)
    for name in BASE_PARTS:
        parts[name].save(PARTS / f"{name}.png", optimize=True)
    parts["gear_visible"] = masked_portrait(portrait, visible_alpha)
    parts["gear_visible"].save(PARTS / "gear_visible.png", optimize=True)
    if behind_alpha is not None:
        parts["gear_behind"] = masked_portrait(portrait, behind_alpha)
        parts["gear_behind"].save(PARTS / "gear_behind.png", optimize=True)
    if HEAD_GEAR_ENVELOPE is not None:
        left, top, right, bottom = HEAD_GEAR_ENVELOPE
        head_envelope = np.zeros_like(subject_array, dtype=bool)
        head_envelope[top:bottom, left:right] = True
        gear_alpha = Image.fromarray(
            np.where(head_envelope, raw_registered_subject, 0).astype(np.uint8), "L"
        )
        gear_head = Image.fromarray(registered_portrait_array, "RGB").convert("RGBA")
        gear_head.putalpha(gear_alpha)
        parts["gear_head"] = gear_head
        parts["gear_head"].save(PARTS / "gear_head.png", optimize=True)
    assembled = compose(parts)
    assembled.save(OUT / "assembled.png", optimize=True)
    review_board(assembled)
    print(f"packaged {len(parts)} registered parts in {PARTS.relative_to(ROOT)}")
    print(f"wrote {OUT.joinpath('assembled.png').relative_to(ROOT)}")
    print(f"wrote {REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
