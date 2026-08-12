#!/usr/bin/env python3
"""Build the Thornguard Sworn Bigfoot class-rig art package.

The approved portrait is a complete illustration, not registered rig art.  The
ImageGen extraction beside this script isolates its purpose-drawn bark armour;
this deterministic step registers that armour to Bigfoot's 1024px rest pose,
separates the two pauldrons from the torso, and packages a complete part set for
the pinned rive-mcp builder.

Run from the repository root:

    python art/source/package_thornguard_bigfoot_rig.py
"""

from __future__ import annotations

from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[2]
CANVAS = (1024, 1024)
SOURCE = ROOT / "art/source/thornguard_bigfoot_sworn_armor.png"
BASE = ROOT / "assets/characters/bigfoot/sworn"
OUT = ROOT / "assets/character-rigs/thornguard/sworn/bigfoot"
PARTS = OUT / "parts"
REVIEW = ROOT / "art/review/thornguard_sworn_bigfoot_rig_split.png"
BASE_PARTS = ("leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "mane")

# Measured by mapping the accepted 1254px portrait's figure bounds back onto
# the registered Bigfoot rest pose.  Keeping this explicit makes regeneration
# stable and reviewable instead of hiding a hand-fit inside an image editor.
ARMOR_BOX = (310, 305, 720, 640)


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError(f"{SOURCE} has no visible pixels")
    return bbox


def registered_armor() -> Image.Image:
    source = Image.open(SOURCE).convert("RGBA")
    crop = source.crop(alpha_bbox(source))
    width = ARMOR_BOX[2] - ARMOR_BOX[0]
    height = ARMOR_BOX[3] - ARMOR_BOX[1]
    crop = crop.resize((width, height), Image.Resampling.LANCZOS)
    registered = Image.new("RGBA", CANVAS)
    registered.alpha_composite(crop, (ARMOR_BOX[0], ARMOR_BOX[1]))
    return registered


def split_armor(armor: Image.Image) -> dict[str, Image.Image]:
    """Split pauldrons along internal, fully painted seams.

    The polygons follow the metal shoulder rims.  A small underlap remains on
    the torso so arm rotation cannot open a transparent crack at the joint.
    At rest the arm layers are painted after the arms and restore the approved
    wooden shoulder caps above the creature's fur.
    """
    arr = np.asarray(armor)
    h, w = arr.shape[:2]

    mask_r = Image.new("L", (w, h), 0)  # creature's right / image left
    draw_r = ImageDraw.Draw(mask_r)
    draw_r.polygon([(292, 292), (467, 292), (442, 393), (399, 430), (309, 418)], fill=255)

    mask_l = Image.new("L", (w, h), 0)  # creature's left / image right
    draw_l = ImageDraw.Draw(mask_l)
    draw_l.polygon([(552, 292), (738, 292), (731, 424), (642, 435), (573, 394)], fill=255)

    alpha = armor.getchannel("A")
    arm_r_alpha = Image.fromarray(
        np.minimum(np.asarray(alpha), np.asarray(mask_r)).astype(np.uint8), "L"
    )
    arm_l_alpha = Image.fromarray(
        np.minimum(np.asarray(alpha), np.asarray(mask_l)).astype(np.uint8), "L"
    )

    arm_r = armor.copy()
    arm_r.putalpha(arm_r_alpha)
    arm_l = armor.copy()
    arm_l.putalpha(arm_l_alpha)

    # Remove the opaque core of each pauldron from the torso, but retain a
    # six-pixel dilated underlap around the seam.  That overlap is hidden at
    # rest and prevents a hairline gap during arm motion.
    core_r = mask_r.filter(ImageFilter.MinFilter(13))
    core_l = mask_l.filter(ImageFilter.MinFilter(13))
    torso_alpha = np.asarray(alpha).astype(np.int16)
    removal = np.maximum(np.asarray(core_r), np.asarray(core_l)).astype(np.int16)
    torso_alpha = np.minimum(torso_alpha, 255 - removal).clip(0, 255).astype(np.uint8)
    torso_alpha_image = Image.fromarray(torso_alpha, "L")
    yy, _ = np.indices(torso_alpha.shape)

    # The chest must draw in front of the pale inner-arm cutout at the
    # shoulders; the lower cuirass must draw behind the hands.  Two layers on
    # the same body bone express that depth without changing the skeleton.
    chest_alpha = np.where(yy < 570, torso_alpha, 0).astype(np.uint8)
    lower_alpha = np.where(yy >= 558, torso_alpha, 0).astype(np.uint8)
    chest = armor.copy()
    chest.putalpha(Image.fromarray(chest_alpha, "L"))
    torso = armor.copy()
    torso.putalpha(Image.fromarray(lower_alpha, "L"))

    return {
        "armor_torso": torso,
        "armor_chest": chest,
        "armor_arm_l": arm_l,
        "armor_arm_r": arm_r,
    }


def front_fur(parts: dict[str, Image.Image]) -> Image.Image:
    """Preserve Bigfoot's face and dark mane as an armor occlusion layer.

    The original cutout predates class gear and its ``head``/``mane`` parts
    contain small pieces of pale shoulder fur.  Drawing either whole part in
    front of a cuirass therefore punches fur-colored holes through the armor.
    This derived layer is the minimal character variation the pilot proves we
    need: face plus brown mane only, attached to the existing head bone.
    """
    source = Image.new("RGBA", CANVAS)
    source.alpha_composite(parts["head"])
    source.alpha_composite(parts["mane"])
    rgba = np.asarray(source)
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    alpha = rgba[..., 3]
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    saturation = np.divide(
        maximum - minimum,
        maximum,
        out=np.zeros_like(maximum),
        where=maximum > 0,
    )
    luminance = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    yy, xx = np.indices(alpha.shape)

    # The face never intersects armor above y=330. Below it, retain the darker
    # brown mane and the green leaf while rejecting the pale shoulder/body fur.
    face = (yy < 330) & (xx > 330) & (xx < 720)
    mane = (yy < 535) & (saturation > 0.18) & (luminance < 0.72)
    # Outside the new armor, keep the old layer byte-for-byte: it contains the
    # seam-fill islands that complete hands, wrists, and legs. Only where armor
    # is actually painted do we trim the old pale shoulder fur and retain the
    # face/brown mane selection above.
    armor_alpha = np.zeros_like(alpha)
    for name in ("armor_torso", "armor_chest", "armor_arm_l", "armor_arm_r"):
        armor_alpha = np.maximum(armor_alpha, np.asarray(parts[name].getchannel("A")))
    keep = ((armor_alpha == 0) | face | mane) & (alpha > 0)
    result = source.copy()
    result.putalpha(Image.fromarray(np.where(keep, alpha, 0).astype(np.uint8), "L"))
    return result


def compose(parts: dict[str, Image.Image]) -> Image.Image:
    image = Image.new("RGBA", CANVAS)
    for name in (
        "leg_l",
        "leg_r",
        "body",
        "armor_torso",
        "arm_l",
        "arm_r",
        "armor_chest",
        "armor_arm_l",
        "armor_arm_r",
        "head",
    ):
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

    draw.text((50, 34), "Thornguard Sworn Bigfoot — rig split pilot", font=title, fill="white")
    draw.text(
        (52, 88),
        "Torso → body bone   •   each pauldron → matching arm bone   •   mane stays in front",
        font=note,
        fill="#b9c7d8",
    )

    panels = [
        ("BASE REST POSE", Image.open(BASE / "assembled.png").convert("RGBA")),
        ("REGISTERED COMPOSITE", assembled),
        (
            "ARMOR — BODY LAYERS",
            Image.alpha_composite(parts["armor_torso"], parts["armor_chest"]),
        ),
        ("PAULDRON — LEFT ARM", parts["armor_arm_l"]),
        ("PAULDRON — RIGHT ARM", parts["armor_arm_r"]),
    ]
    positions = [(50, 150), (600, 150), (1150, 150), (1700, 150), (1700, 580)]
    sizes = [(500, 850), (500, 850), (500, 850), (500, 420), (500, 420)]

    for (heading, image), (x, y), (pw, ph) in zip(panels, positions, sizes, strict=True):
        draw.rounded_rectangle((x, y, x + pw, y + ph), 16, fill="#253241", outline="#53677d", width=2)
        draw.text((x + 20, y + 16), heading, font=label, fill="#f7d77d")
        frame_h = ph - 72
        scale = min((pw - 30) / image.width, frame_h / image.height)
        shown = image.resize(
            (round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS
        )
        bg = checker((pw - 30, frame_h))
        px = (bg.width - shown.width) // 2
        py = (bg.height - shown.height) // 2
        bg.paste(shown, (px, py), shown)
        board.paste(bg, (x + 15, y + 57))

    board.save(REVIEW, optimize=True)


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)

    PARTS.mkdir(parents=True, exist_ok=True)
    for stale in PARTS.glob("*.png"):
        stale.unlink()
    parts: dict[str, Image.Image] = {}
    for name in BASE_PARTS:
        source = BASE / "parts" / f"{name}.png"
        target = PARTS / f"{name}.png"
        shutil.copyfile(source, target)
        parts[name] = Image.open(target).convert("RGBA")

    armor = registered_armor()
    split = split_armor(armor)
    for name, image in split.items():
        image.save(PARTS / f"{name}.png", optimize=True)
        parts[name] = image

    front = front_fur(parts)
    front.save(PARTS / "head.png", optimize=True)
    parts["head"] = front
    parts.pop("mane")
    (PARTS / "mane.png").unlink()

    assembled = compose(parts)
    assembled.save(OUT / "assembled.png", optimize=True)
    review_board(parts, assembled)
    print(f"packaged {len(parts)} registered parts in {PARTS.relative_to(ROOT)}")
    print(f"wrote {OUT.joinpath('assembled.png').relative_to(ROOT)}")
    print(f"wrote {REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
