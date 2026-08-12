#!/usr/bin/env python3
"""Build the Mire Mimic alert/disguised candidate and low-shell parts."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source" / "mire_mimic_rig"
PARTS_DIR = SOURCE_DIR / "parts"
REVIEW_PATH = ROOT / "art" / "review" / "mire_mimic_rig.png"

CANVAS = 1024
ANCHOR_Y = 900
TARGET_HEIGHT = 701
ALPHA_THRESHOLD = 8
Z_ORDER = ["leg_l", "leg_r", "shell", "body", "claw_l", "claw_r", "whiskers"]


def polygon_mask(points: list[tuple[int, int]]) -> np.ndarray:
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return np.asarray(mask) > 0


def ellipse_mask(box: tuple[int, int, int, int]) -> np.ndarray:
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).ellipse(box, fill=255)
    return np.asarray(mask) > 0


def register_source() -> Image.Image:
    source = Image.open(SOURCE_DIR / "source.png").convert("RGBA")
    alpha = np.asarray(source.getchannel("A"))
    ys, xs = np.nonzero(alpha > ALPHA_THRESHOLD)
    bbox = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    crop = source.crop(bbox)
    width = round(crop.width * TARGET_HEIGHT / crop.height)
    scaled = crop.resize((width, TARGET_HEIGHT), Image.Resampling.LANCZOS)

    registered = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    registered.alpha_composite(scaled, ((CANVAS - width) // 2, ANCHOR_Y - TARGET_HEIGHT))
    arr = np.asarray(registered).copy()
    rgb = arr[..., :3]
    magenta_spill = (
        (arr[..., 3] > 0)
        & (rgb[..., 0] > 80)
        & (rgb[..., 2] > 80)
        & (rgb[..., 0] > rgb[..., 1] * 1.5)
        & (rgb[..., 2] > rgb[..., 1] * 1.5)
    )
    arr[magenta_spill, 0] = arr[magenta_spill, 1]
    arr[magenta_spill, 2] = arr[magenta_spill, 1]
    return Image.fromarray(arr, "RGBA")


def signature_masks(rgba: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    alpha = rgba[..., 3]
    rgb = rgba[..., :3]
    yy, xx = np.indices(alpha.shape)

    eyes = np.zeros(alpha.shape, dtype=bool)
    for box in [(300, 665, 350, 750), (338, 660, 388, 745), (377, 655, 427, 740), (416, 648, 468, 738)]:
        eyes |= ellipse_mask(box)
    eyes &= alpha > ALPHA_THRESHOLD

    occupancy = np.asarray(
        Image.fromarray(((alpha > ALPHA_THRESHOLD) * 255).astype(np.uint8), "L").filter(
            ImageFilter.BoxBlur(5)
        )
    )
    gold = (
        (alpha > ALPHA_THRESHOLD)
        & (xx < 590)
        & (yy > 650)
        & (rgb[..., 0] > 75)
        & (rgb[..., 1] > 50)
        & (rgb[..., 2] < 125)
        & (rgb[..., 0] > rgb[..., 2] * 1.15)
        & (rgb[..., 1] > rgb[..., 2] * 0.90)
        & (occupancy < 252)
    )
    # Grow the color seeds just enough to include the dark inked edges of each
    # feeler.  Without this, those edges get copied into neighboring limb
    # layers as joint overdraw and remain behind in the disguised state.
    gold = np.asarray(
        Image.fromarray((gold * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(13))
    ) > 0
    gold &= (alpha > ALPHA_THRESHOLD) & (xx < 590) & (yy > 650)
    # Keep the whole small face panel on the removable sensory layer.  The
    # broader patch lets the disguised pose replace the eye sockets as well as
    # the bright irises, instead of leaving four suspicious circular holes.
    eye_patch = polygon_mask(
        [(276, 651), (474, 638), (495, 711), (466, 767), (288, 774), (267, 710)]
    )
    eye_patch &= alpha > ALPHA_THRESHOLD
    whiskers = eye_patch | gold
    camo_underlay = polygon_mask(
        [(135, 625), (545, 610), (625, 735), (540, 800), (165, 800), (95, 715)]
    )
    return whiskers, eye_patch, camo_underlay


def make_parts(assembled: Image.Image) -> dict[str, Image.Image]:
    rgba = np.asarray(assembled).copy()
    alpha = rgba[..., 3]
    subject = alpha > ALPHA_THRESHOLD
    yy, xx = np.indices(alpha.shape)
    whisker_feature, eye_region, camo_underlay = signature_masks(rgba)

    regions = {
        "claw_l": (xx < 285) & (yy >= 690),
        "claw_r": (xx >= 445) & (xx < 735) & (yy >= 635),
        "leg_l": (xx >= 190) & (xx < 450) & (yy >= 690),
        "leg_r": (xx >= 675) & (yy >= 520),
        "body_face": (xx >= 95) & (xx < 780) & (yy >= 585) & (yy < 810),
        "shell": (xx >= 105) & (xx < 930) & (yy < 660),
    }

    names = ["body", "shell", "claw_l", "claw_r", "leg_l", "leg_r", "whiskers"]
    index = {name: i for i, name in enumerate(names)}
    owner = np.full((CANVAS, CANVAS), -1, dtype=np.int8)

    take = subject & whisker_feature
    owner[take] = index["whiskers"]
    for name in ("claw_l", "claw_r", "leg_l", "leg_r"):
        take = subject & regions[name] & (owner < 0)
        owner[take] = index[name]
    take = subject & regions["body_face"] & (owner < 0)
    owner[take] = index["body"]
    take = subject & regions["shell"] & (owner < 0)
    owner[take] = index["shell"]
    owner[subject & (owner < 0)] = index["body"]

    exclusive = {name: owner == index[name] for name in names}
    fully_opaque = alpha == 255
    body_joint_overdraw = polygon_mask(
        [(65, 560), (925, 500), (990, 690), (820, 785), (130, 830), (40, 700)]
    )
    parts: dict[str, Image.Image] = {}
    for name in names:
        base = Image.fromarray((exclusive[name] * 255).astype(np.uint8), "L")
        expanded = np.asarray(base.filter(ImageFilter.MaxFilter(31))) > 0
        include = subject & (exclusive[name] | (expanded & fully_opaque))
        if name == "body":
            include |= subject & fully_opaque & body_joint_overdraw
            include &= ~(whisker_feature & ~camo_underlay)
        elif name != "whiskers":
            # Joint overdraw must not duplicate the retractable feelers onto a
            # limb layer, or they remain visible when the sensory layer hides.
            include &= ~whisker_feature
        part = rgba.copy()
        part[..., 3] = np.where(include, alpha, 0)
        part[~include, :3] = 0
        parts[name] = Image.fromarray(part, "RGBA")

    # The body carries a camouflaged backing under the removable sensory layer.
    # At alert, the topmost whiskers layer restores the exact generated pixels;
    # at disguised idle, hiding it reveals this quiet mud/log patch.
    body = np.asarray(parts["body"]).copy()
    thin_underlay = (whisker_feature & camo_underlay & ~eye_region) & (body[..., 3] > 0)
    neutralize = (eye_region | thin_underlay) & (body[..., 3] > 0)
    blurred = np.asarray(
        Image.fromarray(body, "RGBA").filter(ImageFilter.GaussianBlur(28))
    )
    luma = (
        blurred[..., 0].astype(np.int16) * 0.30
        + blurred[..., 1].astype(np.int16) * 0.45
        + blurred[..., 2].astype(np.int16) * 0.25
    )
    texture = np.clip(luma * 0.62 + 27, 42, 102).astype(np.uint8)
    body[thin_underlay, 0] = np.clip(texture[thin_underlay] + 13, 0, 125)
    body[thin_underlay, 1] = np.clip(texture[thin_underlay] + 4, 0, 115)
    body[thin_underlay, 2] = np.clip(texture[thin_underlay] - 16, 15, 90)

    # Camouflage the face with a mossy log texture sampled from the creature's
    # own shell.  A feathered interior mask keeps the replacement from reading
    # as a pasted-on rectangle in the hidden-sensory pose.
    registered = Image.fromarray(rgba, "RGBA")
    log_texture = registered.crop((475, 500, 704, 637)).resize(
        (229, 137), Image.Resampling.LANCZOS
    )
    texture_canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    texture_canvas.paste(log_texture, (267, 638))
    texture_arr = np.asarray(texture_canvas)
    inner = polygon_mask(
        [(288, 665), (463, 654), (477, 708), (453, 749), (299, 755), (282, 710)]
    )
    feather = np.asarray(
        Image.fromarray((inner * 255).astype(np.uint8), "L").filter(
            ImageFilter.GaussianBlur(12)
        )
    ).astype(np.float32) / 255.0
    feather *= eye_region
    weight = feather[..., None]
    body[..., :3] = np.where(
        weight > 0,
        np.clip(body[..., :3] * (1.0 - weight) + texture_arr[..., :3] * weight, 0, 255),
        body[..., :3],
    ).astype(np.uint8)
    parts["body"] = Image.fromarray(body, "RGBA")
    return parts


def composite(parts: dict[str, Image.Image], alert: bool = True) -> Image.Image:
    result = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    for name in Z_ORDER:
        if name == "whiskers" and not alert:
            continue
        result.alpha_composite(parts[name])
    return result


def content_crop(image: Image.Image) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    return image.crop(bbox) if bbox else image


def make_review(
    assembled: Image.Image,
    disguised: Image.Image,
    parts: dict[str, Image.Image],
) -> Image.Image:
    board = Image.new("RGB", (1800, 1120), (23, 29, 43))
    draw = ImageDraw.Draw(board)
    draw.text((35, 24), "mire_mimic v1 - caught-pretending alert + disguised idle", fill=(240, 243, 249))
    panels = [(30, 65, 850, 1080), (880, 65, 1770, 720), (880, 750, 1770, 1080)]
    for box in panels:
        draw.rounded_rectangle(box, radius=14, fill=(35, 42, 59), outline=(69, 80, 103), width=2)

    hero = content_crop(assembled)
    hero.thumbnail((780, 930), Image.Resampling.LANCZOS)
    board.paste(hero, (50 + (780 - hero.width) // 2, 110), hero)
    draw.text((50, 82), "Alert assembled - 701px", fill=(226, 232, 242))

    ordered = ["body", "shell", "whiskers", "claw_l", "claw_r", "leg_l", "leg_r"]
    for i, name in enumerate(ordered):
        col, row = i % 4, i // 4
        x, y = 910 + col * 210, 105 + row * 290
        tile = content_crop(parts[name])
        tile.thumbnail((180, 215), Image.Resampling.LANCZOS)
        board.paste(tile, (x + (180 - tile.width) // 2, y + 25), tile)
        draw.text((x, y), name, fill=(215, 222, 235))

    quiet = content_crop(disguised)
    quiet.thumbnail((470, 275), Image.Resampling.LANCZOS)
    board.paste(quiet, (915, 790), quiet)
    draw.text((915, 770), "Disguised: sensory layer hidden", fill=(226, 232, 242))

    small = content_crop(assembled)
    small.thumbnail((280, 64), Image.Resampling.LANCZOS)
    board.paste(small, (1440, 900), small)
    draw.text((1440, 820), "64px alert read", fill=(226, 232, 242))
    return board


def main() -> None:
    PARTS_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    registered = register_source()
    parts = make_parts(registered)
    assembled = composite(parts, alert=True)
    disguised = composite(parts, alert=False)

    registered.save(SOURCE_DIR / "registered_reference.png")
    assembled.save(SOURCE_DIR / "assembled.png")
    disguised.save(SOURCE_DIR / "assembled_disguised.png")
    for name, part in parts.items():
        part.save(PARTS_DIR / f"{name}.png")
    make_review(assembled, disguised, parts).save(REVIEW_PATH)


if __name__ == "__main__":
    main()
