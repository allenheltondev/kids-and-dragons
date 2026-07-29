from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / "assets/manifest.json").read_text(encoding="utf-8"))
MIN_OVERLAP = MANIFEST["tolerance"]["minSeamOverlapPx"]
TIERS = ("fledgling", "sworn", "radiant", "mythic")

TIER_TRANSFORMS = {
    "dragonling": {
        "sworn": (1.0, 1.0, 45, 0),
        "radiant": (1.0, 1.0, 35, 0),
        "mythic": (0.82, 0.82, 180, 115),
    },
    "griffin": {
        "sworn": (1.0, 1.0, 10, 0),
        "radiant": (1.0, 1.0, -15, 0),
        "mythic": (0.90, 1.0, 70, 0),
    },
    "bigfoot": {
        "sworn": (0.96, 0.98, 20, 14),
        "radiant": (0.98, 0.98, 12, 14),
        "mythic": (0.98, 0.98, 12, 14),
    },
    "kitsune": {
        "sworn": (1.0, 1.0, 18, 0),
        "radiant": (1.0, 1.0, 5, 0),
        "mythic": (0.98, 1.0, 24, 0),
    },
    "manticore": {
        "sworn": (1.0, 1.0, 0, 0),
        "radiant": (1.0, 1.0, 0, 0),
        "mythic": (1.0, 1.0, 0, 0),
    },
}

EXPANDED_BOXES = {
    "dragonling": {"mane": (0, 0, 1024, 850), "signature": (0, 0, 1024, 820)},
    "griffin": {"mane": (80, 0, 680, 780), "signature": (20, 0, 1024, 820)},
    "bigfoot": {"mane": (180, 0, 900, 760)},
    "kitsune": {"mane": (40, 0, 700, 850), "signature": (390, 0, 1024, 900)},
    "manticore": {"mane": (40, 20, 760, 900), "signature": (500, 0, 1024, 760)},
}


CONFIG = {
    "dragonling": {
        "parts": ("body", "head", "mane", "wings", "arm_l", "arm_r", "leg_l", "leg_r", "tail"),
        "polygons": {
            "head": [(40, 100), (410, 80), (455, 250), (425, 485), (145, 500), (35, 390)],
            "body": [(190, 380), (650, 335), (760, 520), (700, 710), (250, 710), (185, 560)],
            "arm_r": [(100, 455), (255, 455), (285, 830), (80, 855)],
            "arm_l": [(220, 445), (405, 465), (415, 880), (205, 890)],
            "leg_r": [(405, 500), (575, 490), (610, 820), (405, 835)],
            "leg_l": [(535, 470), (720, 485), (735, 875), (535, 885)],
            "tail": [(600, 500), (970, 590), (970, 800), (570, 805)],
        },
        "mane_box": (55, 55, 805, 690),
        "mane_exclude": [(35, 185), (345, 165), (410, 330), (350, 475), (55, 465)],
        "signature_box": (420, 300, 825, 590),
        "mane_hue": (90, 175),
        "mane_sat": 75,
        "mane_val": 185,
        "signature_hue": (5, 40),
        "body_anchor": [(335, 420), (690, 390), (730, 610), (660, 700), (340, 700)],
        "roots": {
            "head/mane": (270, 170), "body/mane": (600, 515),
            "head/body": (300, 440), "body/arm_l": (320, 520),
            "body/arm_r": (220, 520), "body/leg_l": (620, 550),
            "body/leg_r": (510, 560), "body/tail": (680, 610),
            "body/wings": (545, 440),
        },
    },
    "griffin": {
        "parts": ("body", "head", "mane", "wings", "arm_l", "arm_r", "leg_l", "leg_r", "tail"),
        "polygons": {
            "head": [(145, 55), (510, 55), (535, 325), (455, 520), (190, 510), (140, 300)],
            "body": [(255, 400), (690, 360), (790, 520), (735, 700), (300, 700), (245, 555)],
            "arm_r": [(175, 455), (325, 455), (330, 845), (155, 855)],
            "arm_l": [(285, 445), (445, 460), (450, 850), (270, 860)],
            "leg_r": [(425, 510), (600, 500), (615, 840), (420, 850)],
            "leg_l": [(585, 485), (755, 500), (765, 870), (575, 875)],
            "tail": [(690, 470), (870, 470), (910, 815), (720, 815)],
        },
        "mane_box": (135, 25, 475, 620),
        "mane_exclude": [(140, 145), (410, 125), (455, 335), (390, 430), (155, 415)],
        "signature_box": (440, 270, 850, 585),
        "mane_hue": (185, 230),
        "mane_sat": 65,
        "mane_val": 205,
        "signature_hue": (32, 62),
        "body_anchor": [(345, 420), (710, 390), (755, 610), (690, 690), (345, 690)],
        "roots": {
            "head/mane": (315, 210), "body/mane": (355, 490),
            "head/body": (335, 450), "body/arm_l": (365, 525),
            "body/arm_r": (245, 525), "body/leg_l": (665, 550),
            "body/leg_r": (515, 555), "body/tail": (735, 560),
            "body/wings": (555, 405),
        },
    },
    "bigfoot": {
        "parts": ("body", "head", "mane", "arm_l", "arm_r", "leg_l", "leg_r"),
        "polygons": {
            "head": [(340, 85), (690, 85), (710, 405), (610, 500), (375, 475), (320, 260)],
            "body": [(345, 330), (680, 330), (690, 670), (350, 680)],
            "arm_r": [(250, 330), (440, 350), (445, 760), (245, 765)],
            "arm_l": [(570, 325), (800, 335), (785, 765), (570, 770)],
            "leg_r": [(345, 555), (550, 550), (560, 920), (325, 920)],
            "leg_l": [(495, 545), (720, 545), (750, 920), (490, 920)],
        },
        "mane_box": (275, 40, 780, 560),
        "mane_exclude": [(355, 135), (650, 130), (670, 355), (585, 420), (365, 390)],
        "mane_hue": (10, 55),
        "mane_sat": 60,
        "mane_val": 180,
        "body_anchor": [(360, 390), (675, 380), (675, 650), (355, 650)],
        "roots": {
            "head/mane": (500, 230), "body/mane": (515, 420),
            "head/body": (510, 435), "body/arm_l": (625, 475),
            "body/arm_r": (380, 475), "body/leg_l": (590, 620),
            "body/leg_r": (430, 620),
        },
    },
    "kitsune": {
        "parts": ("body", "head", "mane", "arm_l", "arm_r", "leg_l", "leg_r", "tail"),
        "polygons": {
            "head": [(85, 65), (410, 55), (445, 360), (385, 490), (120, 485), (75, 300)],
            "body": [(250, 420), (650, 420), (705, 590), (650, 725), (275, 720), (235, 560)],
            "arm_r": [(150, 480), (285, 480), (300, 865), (135, 875)],
            "arm_l": [(245, 470), (390, 480), (410, 890), (235, 895)],
            "leg_r": [(380, 520), (545, 510), (560, 840), (375, 850)],
            "leg_l": [(520, 500), (690, 505), (710, 875), (520, 880)],
        },
        "mane_box": (70, 55, 520, 680),
        "mane_exclude": [(90, 245), (355, 225), (405, 390), (330, 470), (95, 445)],
        "signature_box": (470, 80, 955, 820),
        "mane_hue": (3, 35),
        "mane_sat": 75,
        "mane_val": 238,
        "signature_hue": (170, 210),
        "body_anchor": [(350, 440), (665, 430), (680, 650), (350, 685)],
        "roots": {
            "head/mane": (285, 270), "body/mane": (330, 500),
            "head/body": (335, 455), "body/arm_l": (320, 545),
            "body/arm_r": (220, 545), "body/leg_l": (620, 570),
            "body/leg_r": (470, 580), "body/tail": (655, 500),
        },
    },
    "manticore": {
        "parts": ("body", "head", "mane", "arm_l", "arm_r", "leg_l", "leg_r", "tail"),
        "polygons": {
            "head": [(100, 120), (520, 105), (555, 390), (455, 520), (155, 505), (90, 310)],
            "body": [(285, 390), (720, 370), (805, 540), (750, 715), (300, 715), (260, 555)],
            "arm_r": [(150, 470), (300, 470), (315, 875), (130, 885)],
            "arm_l": [(260, 465), (430, 475), (445, 900), (245, 905)],
            "leg_r": [(480, 510), (650, 500), (660, 850), (470, 860)],
            "leg_l": [(620, 485), (790, 495), (810, 880), (610, 885)],
        },
        "mane_box": (85, 95, 610, 680),
        "mane_exclude": [(120, 225), (450, 200), (505, 400), (420, 500), (120, 465)],
        "signature_box": (580, 30, 950, 590),
        "mane_hue": (335, 20),
        "mane_sat": 70,
        "mane_val": 215,
        "signature_hue": (55, 105),
        "body_anchor": [(370, 410), (735, 385), (770, 620), (700, 690), (370, 685)],
        "roots": {
            "head/mane": (320, 235), "body/mane": (385, 485),
            "head/body": (370, 450), "body/arm_l": (345, 545),
            "body/arm_r": (230, 545), "body/leg_l": (700, 555),
            "body/leg_r": (555, 565), "body/tail": (705, 420),
        },
    },
}


def polygon_mask(size: tuple[int, int], points: list[tuple[int, int]]) -> np.ndarray:
    image = Image.new("1", size, 0)
    ImageDraw.Draw(image).polygon(points, fill=1)
    return np.asarray(image, dtype=bool)


def box_mask(size: tuple[int, int], box: tuple[int, int, int, int]) -> np.ndarray:
    result = np.zeros((size[1], size[0]), dtype=bool)
    result[box[1]:box[3], box[0]:box[2]] = True
    return result


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    # Fast square binary dilation via an integral image. Pillow's large MaxFilter
    # becomes prohibitively slow for the 48-56px fallback seam search.
    padded = np.pad(mask.astype(np.uint8), radius)
    integral = np.pad(padded, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    width = radius * 2 + 1
    counts = (
        integral[width:, width:]
        - integral[:-width, width:]
        - integral[width:, :-width]
        + integral[:-width, :-width]
    )
    return counts > 0


def nearest_pixels(mask: np.ndarray, point: tuple[int, int], count: int) -> np.ndarray:
    coordinates = np.argwhere(mask)
    if len(coordinates) < count:
        raise RuntimeError(f"only {len(coordinates)} pixels available near {point}, need {count}")
    distances = (coordinates[:, 1] - point[0]) ** 2 + (coordinates[:, 0] - point[1]) ** 2
    selected = coordinates[np.argpartition(distances, count - 1)[:count]]
    result = np.zeros_like(mask)
    result[selected[:, 0], selected[:, 1]] = True
    return result


def reference_joint_targets(
    species: str,
    target_assembled: np.ndarray,
) -> dict[str, tuple[int, int]]:
    reference_dir = ROOT / f"assets/characters/{species}/fledgling"
    reference_assembled = np.asarray(
        Image.open(reference_dir / "assembled.png").convert("RGBA")
    )
    reference_parts = {
        path.stem: np.asarray(Image.open(path).convert("RGBA"))
        for path in (reference_dir / "parts").glob("*.png")
    }
    ry, rx = np.where(reference_assembled[:, :, 3] > 8)
    ty, tx = np.where(target_assembled[:, :, 3] > 8)
    rleft, rtop = float(rx.min()), float(ry.min())
    rwidth, rheight = float(rx.max() - rx.min()), float(ry.max() - ry.min())
    tleft, ttop = float(tx.min()), float(ty.min())
    twidth, theight = float(tx.max() - tx.min()), float(ty.max() - ty.min())

    targets: dict[str, tuple[int, int]] = {}
    for a, b in MANIFEST["structuralAdjacency"]:
        if a not in reference_parts or b not in reference_parts:
            continue
        band = (
            (reference_parts[a][:, :, 3] > 8)
            & (reference_parts[b][:, :, 3] > 8)
        )
        by, bx = np.where(band)
        if not len(bx):
            continue
        nx = (float(bx.mean()) - rleft) / rwidth
        ny = (float(by.mean()) - rtop) / rheight
        targets[f"{a}/{b}"] = (
            round(tleft + nx * twidth),
            round(ttop + ny * theight),
        )
    return targets


def hue_range(hue: np.ndarray, bounds: tuple[int, int]) -> np.ndarray:
    low, high = bounds
    if low <= high:
        return (hue >= low) & (hue <= high)
    return (hue >= low) | (hue <= high)


def checkerboard(size: tuple[int, int], cell: int = 16) -> Image.Image:
    board = Image.new("RGBA", size, (238, 232, 222, 255))
    draw = ImageDraw.Draw(board)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(218, 210, 198, 255))
    return board


def write_review(
    species: str,
    tier: str,
    assembled: Image.Image,
    layers: dict[str, Image.Image],
) -> None:
    names = ["assembled", *layers]
    panel = 360
    preview_size = 320
    columns = 5
    rows = (len(names) + columns - 1) // columns
    sheet = Image.new("RGB", (panel * columns, panel * rows), (43, 33, 24))
    for index, name in enumerate(names):
        entry = assembled if name == "assembled" else layers[name]
        tile = Image.new("RGBA", (panel, panel), (255, 246, 232, 255))
        preview = checkerboard((preview_size, preview_size))
        preview.alpha_composite(entry.resize((preview_size, preview_size), Image.Resampling.LANCZOS))
        tile.alpha_composite(preview, ((panel - preview_size) // 2, 30))
        ImageDraw.Draw(tile).text((14, 9), name, fill=(43, 33, 24, 255))
        sheet.paste(tile.convert("RGB"), ((index % columns) * panel, (index // columns) * panel))
    output = ROOT / f"art/review/{species}_{tier}_contact_sheet.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, compress_level=9)


def transform_points(
    points: list[tuple[int, int]],
    transform: tuple[float, float, int, int],
) -> list[tuple[int, int]]:
    sx, sy, dx, dy = transform
    return [(round(x * sx + dx), round(y * sy + dy)) for x, y in points]


def transform_box(
    box: tuple[int, int, int, int],
    transform: tuple[float, float, int, int],
) -> tuple[int, int, int, int]:
    sx, sy, dx, dy = transform
    return (
        max(0, round(box[0] * sx + dx)),
        max(0, round(box[1] * sy + dy)),
        min(1024, round(box[2] * sx + dx)),
        min(1024, round(box[3] * sy + dy)),
    )


def split(species: str, tier: str = "fledgling") -> None:
    config = CONFIG[species]
    transform = TIER_TRANSFORMS.get(species, {}).get(tier, (1.0, 1.0, 0, 0))
    assembled_path = ROOT / f"assets/characters/{species}/{tier}/assembled.png"
    parts_dir = assembled_path.parent / "parts"
    image = Image.open(assembled_path).convert("RGBA")
    pixels = np.asarray(image)
    alpha = pixels[:, :, 3]
    content = alpha > 0
    solid = alpha >= 250
    hsv = np.asarray(image.convert("HSV"))
    hue = hsv[:, :, 0].astype(float) * (360.0 / 255.0)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]

    regions = {
        name: polygon_mask(image.size, transform_points(points, transform)) & content
        for name, points in config["polygons"].items()
    }
    mane_box = (
        config["mane_box"]
        if tier == "fledgling"
        else EXPANDED_BOXES[species]["mane"]
    )
    mane_seed = (
        box_mask(image.size, mane_box)
        & hue_range(hue, config["mane_hue"])
        & (saturation > config["mane_sat"])
        & (value < config["mane_val"])
        & content
    )
    regions["mane"] = dilate(mane_seed, 6) & box_mask(image.size, mane_box) & content
    regions["mane"] &= ~polygon_mask(
        image.size,
        transform_points(config["mane_exclude"], transform),
    )

    signature = next(
        item["signature"] for item in MANIFEST["species"] if item["id"] == species
    )
    if signature != "mane":
        signature_box = (
            config["signature_box"]
            if tier == "fledgling"
            else EXPANDED_BOXES[species]["signature"]
        )
        signature_seed = (
            box_mask(image.size, signature_box)
            & hue_range(hue, config["signature_hue"])
            & (saturation > (65 if tier == "fledgling" else 85))
            & content
        )
        if species == "dragonling" and tier == "sworn":
            signature_seed &= box_mask(image.size, (400, 220, 880, 610))
        elif species == "dragonling" and tier == "radiant":
            signature_seed &= box_mask(image.size, (400, 55, 1024, 690))
        elif species == "dragonling" and tier == "mythic":
            yy, xx = np.indices(signature_seed.shape)
            signature_seed &= (yy < 780) & ((xx < 365) | (xx > 445))
        signature_radius = 12 if tier == "fledgling" else 20
        if species == "dragonling" and tier in ("sworn", "radiant"):
            signature_radius = 8
        regions[signature] = (
            dilate(signature_seed, signature_radius)
            & box_mask(image.size, signature_box)
            & content
        )

    labels = np.full((image.height, image.width), config["parts"].index("body"), dtype=np.uint8)
    # Back-to-front assignment mirrors the manifest and lets identity regions win.
    assignment = [name for name in ("tail", "body", "leg_l", "leg_r", "arm_l", "arm_r", "head", "mane", "wings")
                  if name in regions]
    for name in assignment:
        labels[regions[name]] = config["parts"].index(name)
    labels[
        polygon_mask(
            image.size,
            transform_points(config["body_anchor"], transform),
        )
        & content
    ] = config["parts"].index("body")
    # Identity regions sit on top of the torso anchor.
    labels[regions["mane"]] = config["parts"].index("mane")
    if signature != "mane":
        labels[regions[signature]] = config["parts"].index(signature)

    owner = {
        name: content & (labels == index)
        for index, name in enumerate(config["parts"])
    }
    masks = {name: mask.copy() for name, mask in owner.items()}
    structural = {f"{a}/{b}" for a, b in MANIFEST["structuralAdjacency"]}
    joint_targets = (
        reference_joint_targets(species, pixels)
        if tier != "fledgling"
        else {}
    )
    adjacency = [
        (a, b) for a, b in MANIFEST["adjacency"]
        if a in masks and b in masks
    ]
    seam_info = []
    moving = {"mane", "wings", "tail"}
    for a, b in adjacency:
        key = f"{a}/{b}"
        if key not in config["roots"]:
            continue
        root = transform_points([config["roots"][key]], transform)[0]
        moving_name = b if b in moving else (a if a in moving else None)
        if key in structural:
            structural_point = joint_targets.get(key, root)
            common = nearest_pixels(
                solid,
                structural_point,
                MIN_OVERLAP + 100,
            )
            radius_used = 0
        elif moving_name:
            common = nearest_pixels(
                (owner[moving_name] | owner[a] | owner[b]) & solid,
                root,
                MIN_OVERLAP + 100,
            )
            radius_used = 0
        else:
            common = np.zeros_like(content)
            radius_used = 0
            for radius in (16, 20, 24, 28, 32, 36, 40, 44, 48, 56):
                common = dilate(owner[a], radius) & dilate(owner[b], radius) & solid
                radius_used = radius
                if int(common.sum()) >= MIN_OVERLAP:
                    break
            if int(common.sum()) < MIN_OVERLAP:
                # A narrow juvenile joint can have too little symmetric dilation;
                # use assembled pixels nearest the specified attachment point.
                donor = (owner[a] | owner[b]) & solid
                common = nearest_pixels(donor, root, MIN_OVERLAP + 100)
        masks[a] |= common
        masks[b] |= common
        seam_info.append((a, b, int((masks[a] & masks[b]).sum()), radius_used))

    parts_dir.mkdir(parents=True, exist_ok=True)
    layers: dict[str, Image.Image] = {}
    for name in config["parts"]:
        layer_pixels = np.zeros_like(pixels)
        layer_pixels[masks[name]] = pixels[masks[name]]
        layer = Image.fromarray(layer_pixels, "RGBA")
        layer.save(parts_dir / f"{name}.png", compress_level=9)
        layers[name] = layer
    write_review(species, tier, image, layers)

    print(f"{species}/{tier}: wrote {len(layers)} parts")
    for a, b, overlap, radius in seam_info:
        print(f"  {a}/{b}: {overlap:,}px radius={radius}")


def main() -> None:
    selected = sys.argv[1:]
    for species in CONFIG:
        for tier in TIERS:
            if selected and not any(
                item == species or item == f"{species}/{tier}"
                for item in selected
            ):
                continue
            split(species, tier)


if __name__ == "__main__":
    main()
