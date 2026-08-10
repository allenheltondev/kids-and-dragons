#!/usr/bin/env python3
"""Build the Gemfall Seal-Keeper's registered 2x2 approval rig."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source" / "legend_dragon_rig_candidate"
PARTS_DIR = SOURCE_DIR / "parts"
REVIEW_PATH = ROOT / "art" / "review" / "legend_dragon_rig_candidate.png"

CANVAS = 2048
EDGE_MARGIN = 24
ALPHA_THRESHOLD = 8
PARTS = [
    "body",
    "head",
    "jaw",
    "crown",
    "mantle",
    "wing_far",
    "wing_near",
    "limb_fl",
    "limb_fr",
    "limb_bl",
    "limb_br",
    "tail",
]
Z_ORDER = [
    "tail",
    "wing_far",
    "limb_bl",
    "body",
    "mantle",
    "limb_fl",
    "limb_fr",
    "limb_br",
    "wing_near",
    "head",
    "jaw",
    "crown",
]


def polygon_mask(points: list[tuple[int, int]]) -> np.ndarray:
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return np.asarray(mask) > 0


def register_source() -> Image.Image:
    source = Image.open(SOURCE_DIR / "source.png").convert("RGBA")
    alpha = np.asarray(source.getchannel("A"))
    ys, xs = np.nonzero(alpha > ALPHA_THRESHOLD)
    bbox = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    crop = source.crop(bbox)

    available = CANVAS - 2 * EDGE_MARGIN
    scale = min(available / crop.width, available / crop.height)
    size = (round(crop.width * scale), round(crop.height * scale))
    scaled = crop.resize(size, Image.Resampling.LANCZOS)
    registered = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - scaled.width) // 2
    y = CANVAS - EDGE_MARGIN - scaled.height
    registered.alpha_composite(scaled, (x, y))

    # Remove any chroma fringe left in translucent edge pixels.
    arr = np.asarray(registered).copy()
    rgb = arr[..., :3]
    spill = (
        (arr[..., 3] > 0)
        & (rgb[..., 0] > 70)
        & (rgb[..., 2] > 70)
        & (rgb[..., 0] > rgb[..., 1] * 1.45)
        & (rgb[..., 2] > rgb[..., 1] * 1.45)
    )
    neutral = ((rgb[..., 0].astype(np.uint16) + rgb[..., 2].astype(np.uint16)) // 2).astype(np.uint8)
    arr[spill, 0] = np.minimum(arr[spill, 0], neutral[spill])
    arr[spill, 2] = np.minimum(arr[spill, 2], neutral[spill])
    return Image.fromarray(arr, "RGBA")


def make_parts(assembled: Image.Image) -> dict[str, Image.Image]:
    rgba = np.asarray(assembled).copy()
    alpha = rgba[..., 3]
    subject = alpha > 0
    yy, xx = np.indices(alpha.shape)

    # Regions follow this individual's painted anatomy. They are deliberately
    # broad; foreground priority below chooses ownership at overlaps, while a
    # later expansion preserves hidden paint for joint rotation.
    regions = {
        "crown": (
            polygon_mask([(285, 0), (760, 0), (720, 285), (545, 345), (300, 270)])
            | polygon_mask([(590, 25), (1080, 25), (1095, 465), (900, 455), (710, 330)])
        ),
        "jaw": polygon_mask(
            [(285, 480), (545, 455), (625, 520), (540, 595), (325, 600), (270, 535)]
        ),
        "head": polygon_mask(
            [(285, 230), (770, 130), (925, 300), (880, 570), (680, 655), (340, 625), (245, 430)]
        ),
        "mantle": polygon_mask(
            [(420, 475), (945, 420), (1050, 810), (990, 1325), (720, 1500), (455, 1260), (350, 690)]
        ),
        "wing_far": polygon_mask(
            [(55, 390), (345, 350), (485, 760), (430, 1375), (330, 1795), (80, 1790), (15, 850)]
        ),
        "wing_near": polygon_mask(
            [(1080, 175), (1690, 210), (2035, 655), (2040, 1510), (1870, 1840), (1600, 1690), (1490, 1100), (1260, 820), (1030, 650)]
        ),
        "limb_fl": polygon_mask(
            [(120, 1030), (500, 1030), (555, 1345), (485, 1585), (235, 1605), (75, 1370)]
        ),
        "limb_fr": polygon_mask(
            [(650, 940), (1050, 955), (1065, 1410), (955, 1840), (550, 1845), (510, 1535)]
        ),
        "limb_bl": polygon_mask(
            [(930, 1210), (1230, 1210), (1290, 1500), (1225, 1825), (960, 1825), (885, 1535)]
        ),
        "limb_br": polygon_mask(
            [(1190, 980), (1575, 980), (1625, 1435), (1555, 1850), (1230, 1850), (1150, 1450)]
        ),
        "tail": (
            polygon_mask(
                [(110, 1505), (520, 1435), (1050, 1500), (1540, 1450), (1920, 1600), (1910, 2035), (150, 2035)]
            )
            | polygon_mask(
                [(1290, 1200), (1780, 1160), (1950, 1510), (1830, 1780), (1540, 1650), (1280, 1450)]
            )
        ),
        "body": polygon_mask(
            [(745, 610), (1510, 565), (1710, 900), (1670, 1500), (1420, 1680), (870, 1560), (620, 1180)]
        ),
    }

    index = {name: i for i, name in enumerate(PARTS)}
    owner = np.full((CANVAS, CANVAS), -1, dtype=np.int8)

    # Small, animatable, and foreground anatomy claims first. The torso is the
    # safe final owner for any paint that lies between the broad regions.
    priority = [
        "jaw",
        "crown",
        "head",
        "limb_fl",
        "limb_fr",
        "limb_bl",
        "limb_br",
        "wing_near",
        "wing_far",
        "mantle",
        "tail",
        "body",
    ]
    # A small region dilation owns antialiased edges without the expensive
    # four-million-pixel Python flood fill used by the first draft.
    ownership_regions = {
        name: np.asarray(
            Image.fromarray((region * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(11))
        )
        > 0
        for name, region in regions.items()
    }
    for name in priority:
        take = subject & ownership_regions[name] & (owner < 0)
        owner[take] = index[name]

    # Any disconnected paint outside those expanded regions routes by visible
    # anatomy so it cannot become a distant speck in the torso component.
    remaining = subject & (owner < 0)
    owner[remaining & (yy < 590)] = index["crown"]
    remaining = subject & (owner < 0)
    owner[remaining & (xx < 455)] = index["wing_far"]
    remaining = subject & (owner < 0)
    owner[remaining & (xx > 1540)] = index["wing_near"]
    remaining = subject & (owner < 0)
    owner[remaining & (yy > 1625)] = index["tail"]
    owner[subject & (owner < 0)] = index["body"]

    exclusive = {name: owner == index[name] for name in PARTS}
    fully_opaque = alpha == 255
    result: dict[str, Image.Image] = {}
    for name in PARTS:
        base = Image.fromarray((exclusive[name] * 255).astype(np.uint8), "L")
        expanded = np.asarray(base.filter(ImageFilter.MaxFilter(31))) > 0
        include = subject & (exclusive[name] | (expanded & fully_opaque))
        part = rgba.copy()
        part[..., 3] = np.where(include, alpha, 0)
        part[~include, :3] = 0
        result[name] = Image.fromarray(part, "RGBA")
    return result


def composite(parts: dict[str, Image.Image]) -> Image.Image:
    result = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    for name in Z_ORDER:
        result.alpha_composite(parts[name])
    return result


def content_crop(image: Image.Image, pad: int = 10) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.nonzero(alpha > ALPHA_THRESHOLD)
    if not len(xs):
        return image
    box = (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(image.width, int(xs.max()) + pad + 1),
        min(image.height, int(ys.max()) + pad + 1),
    )
    return image.crop(box)


def make_review(assembled: Image.Image, parts: dict[str, Image.Image]) -> Image.Image:
    board = Image.new("RGB", (3000, 1900), (23, 29, 43))
    draw = ImageDraw.Draw(board)
    draw.text((45, 28), "legend_dragon v1 - Gemfall Seal-Keeper / custom 2x2 rig", fill=(240, 243, 249))

    draw.rounded_rectangle((35, 75, 1570, 1855), radius=18, fill=(35, 42, 59), outline=(69, 80, 103), width=3)
    draw.rounded_rectangle((1605, 75, 2965, 1515), radius=18, fill=(35, 42, 59), outline=(69, 80, 103), width=3)
    draw.rounded_rectangle((1605, 1550, 2965, 1855), radius=18, fill=(35, 42, 59), outline=(69, 80, 103), width=3)

    hero = content_crop(assembled)
    hero.thumbnail((1460, 1665), Image.Resampling.LANCZOS)
    board.paste(hero, (72 + (1460 - hero.width) // 2, 145 + (1665 - hero.height) // 2), hero)
    draw.text((70, 95), "Assembled - 2048x2048 / 2x2 footprint", fill=(226, 232, 242))

    for i, name in enumerate(PARTS):
        col, row = i % 4, i // 4
        x, y = 1645 + col * 325, 115 + row * 455
        tile = content_crop(parts[name])
        tile.thumbnail((285, 365), Image.Resampling.LANCZOS)
        board.paste(tile, (x + (285 - tile.width) // 2, y + 45), tile)
        draw.text((x, y), name, fill=(215, 222, 235))

    small = content_crop(assembled)
    small.thumbnail((420, 128), Image.Resampling.LANCZOS)
    board.paste(small, (1665, 1665), small)
    draw.text((1665, 1580), "2x2 combat read", fill=(226, 232, 242))
    draw.multiline_text(
        (2190, 1580),
        "Personification: patient curator + examiner\nSignature: broken crown horn, mantle, deliberate tail boundary\nAnimation hooks: speaking jaw, display wings, raised questioning paw",
        fill=(205, 214, 229),
        spacing=8,
    )
    return board


def verify(registered: Image.Image, assembled: Image.Image, parts: dict[str, Image.Image]) -> None:
    expected = np.asarray(registered)
    actual = np.asarray(assembled)
    mask_expected = expected[..., 3] > ALPHA_THRESHOLD
    mask_actual = actual[..., 3] > ALPHA_THRESHOLD
    union = int((mask_expected | mask_actual).sum())
    inter = int((mask_expected & mask_actual).sum())
    iou = inter / union if union else 0.0
    delta = np.abs(expected[..., :3].astype(float) - actual[..., :3].astype(float))[mask_expected & mask_actual]
    mean_delta = float(delta.mean()) if delta.size else 0.0
    print(f"registered recomposite IoU={iou:.6f}, mean RGB delta={mean_delta:.3f}")
    if iou < 0.999 or mean_delta > 1.0:
        raise SystemExit("candidate recomposite failed")
    for name, part in parts.items():
        if not np.any(np.asarray(part)[..., 3] > ALPHA_THRESHOLD):
            raise SystemExit(f"empty rig part: {name}")


def main() -> None:
    PARTS_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    registered = register_source()
    parts = make_parts(registered)
    assembled = composite(parts)
    verify(registered, assembled, parts)

    registered.save(SOURCE_DIR / "registered_reference.png")
    assembled.save(SOURCE_DIR / "assembled.png")
    for name, part in parts.items():
        part.save(PARTS_DIR / f"{name}.png")
    make_review(assembled, parts).save(REVIEW_PATH)


if __name__ == "__main__":
    main()
