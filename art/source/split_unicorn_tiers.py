from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / "assets/manifest.json").read_text(encoding="utf-8"))
TIERS = ("sworn", "radiant", "mythic")
PART_NAMES = (
    "body",
    "head",
    "mane",
    "horn",
    "arm_l",
    "arm_r",
    "leg_l",
    "leg_r",
    "tail",
)


CONFIG = {
    "sworn": {
        "head": [(184, 126), (236, 112), (315, 113), (390, 127), (429, 174), (445, 235),
                 (442, 303), (420, 359), (390, 403), (344, 424), (292, 417), (243, 411),
                 (205, 397), (188, 365), (191, 314), (198, 254), (183, 201)],
        "body": [(279, 371), (345, 363), (423, 373), (502, 385), (582, 377), (654, 378),
                 (707, 396), (732, 430), (738, 478), (729, 526), (708, 566), (671, 593),
                 (620, 608), (559, 614), (499, 617), (438, 612), (382, 604), (335, 587),
                 (302, 558), (283, 518), (276, 468), (282, 418)],
        "arm_r": [(279, 510), (365, 516), (389, 552), (392, 602), (386, 654), (380, 709),
                  (373, 762), (359, 816), (350, 861), (332, 881), (285, 879), (258, 869),
                  (270, 831), (284, 792), (296, 748), (303, 703), (302, 656), (292, 607)],
        "arm_l": [(365, 508), (443, 511), (469, 550), (472, 602), (468, 657), (465, 714),
                  (458, 770), (452, 824), (465, 873), (454, 896), (414, 902), (363, 891),
                  (373, 848), (385, 802), (390, 755), (391, 704), (388, 655), (377, 606)],
        "leg_r": [(505, 526), (574, 533), (613, 558), (632, 598), (638, 645), (636, 693),
                  (631, 742), (622, 791), (610, 833), (598, 858), (552, 864), (510, 850),
                  (517, 815), (530, 775), (539, 733), (542, 691), (539, 650), (521, 608)],
        "leg_l": [(635, 510), (705, 511), (742, 540), (756, 585), (754, 640), (749, 696),
                  (751, 751), (761, 806), (772, 853), (758, 881), (716, 888), (662, 882),
                  (652, 857), (661, 814), (667, 768), (669, 721), (666, 675), (653, 628)],
        "mane_box": (165, 105, 535, 535),
        "horn_box": (188, 25, 345, 235),
        "tail_box": (665, 350, 875, 810),
        "roots": {
            "head/mane": (335, 205),
            "body/mane": (435, 400),
            "head/horn": (278, 196),
            "body/tail": (707, 430),
        },
    },
    "radiant": {
        "head": [(184, 111), (238, 92), (322, 91), (401, 108), (443, 157), (458, 222),
                 (454, 292), (434, 351), (403, 400), (354, 429), (300, 423), (247, 417),
                 (205, 400), (185, 366), (188, 309), (196, 245), (181, 188)],
        "body": [(288, 386), (351, 376), (427, 384), (505, 394), (584, 388), (654, 390),
                 (707, 410), (733, 445), (740, 492), (732, 539), (710, 577), (670, 601),
                 (620, 613), (558, 619), (497, 622), (437, 617), (380, 607), (334, 589),
                 (302, 559), (285, 518), (280, 469), (286, 421)],
        "arm_r": [(283, 520), (365, 521), (390, 556), (393, 605), (389, 657), (383, 711),
                  (376, 765), (362, 817), (353, 861), (335, 884), (287, 882), (263, 872),
                  (274, 835), (287, 796), (299, 751), (305, 706), (304, 659), (294, 609)],
        "arm_l": [(368, 519), (443, 520), (469, 556), (473, 607), (469, 660), (466, 715),
                  (459, 772), (454, 826), (467, 875), (457, 899), (415, 905), (365, 893),
                  (375, 851), (387, 806), (392, 758), (393, 709), (390, 659), (379, 611)],
        "leg_r": [(508, 541), (576, 545), (614, 568), (634, 607), (640, 653), (638, 701),
                  (633, 750), (624, 797), (611, 838), (599, 862), (553, 868), (511, 854),
                  (519, 820), (532, 780), (541, 738), (544, 696), (541, 655), (524, 617)],
        "leg_l": [(638, 525), (706, 526), (742, 554), (756, 598), (754, 650), (750, 703),
                  (752, 757), (762, 810), (773, 857), (758, 886), (716, 893), (663, 886),
                  (653, 861), (662, 820), (668, 774), (670, 728), (667, 684), (654, 639)],
        "mane_box": (160, 65, 610, 690),
        "horn_box": (175, 0, 385, 270),
        "tail_box": (660, 350, 890, 860),
        "roots": {
            "head/mane": (350, 195),
            "body/mane": (455, 420),
            "head/horn": (300, 218),
            "body/tail": (706, 440),
        },
    },
    "mythic": {
        "head": [(217, 138), (267, 118), (345, 121), (420, 145), (459, 193), (469, 254),
                 (463, 318), (446, 372), (416, 416), (371, 441), (320, 435), (273, 430),
                 (237, 414), (219, 383), (224, 330), (231, 270), (216, 209)],
        "body": [(306, 408), (367, 399), (438, 407), (511, 418), (585, 411), (651, 414),
                 (700, 432), (724, 465), (731, 508), (723, 550), (703, 585), (667, 608),
                 (620, 621), (564, 628), (509, 632), (453, 628), (401, 618), (358, 601),
                 (328, 574), (309, 537), (301, 492), (306, 449)],
        "arm_r": [(300, 535), (382, 539), (406, 572), (409, 618), (405, 667), (400, 718),
                  (393, 769), (381, 819), (371, 860), (353, 884), (308, 882), (282, 872),
                  (292, 837), (305, 800), (317, 758), (323, 715), (322, 671), (312, 625)],
        "arm_l": [(384, 534), (456, 537), (480, 571), (484, 619), (480, 668), (477, 721),
                  (470, 774), (465, 825), (477, 871), (467, 895), (428, 901), (380, 890),
                  (390, 850), (401, 808), (406, 763), (407, 716), (404, 670), (394, 625)],
        "leg_r": [(515, 558), (579, 561), (615, 583), (633, 620), (638, 663), (636, 708),
                  (631, 754), (623, 798), (611, 838), (599, 861), (556, 867), (516, 854),
                  (523, 821), (535, 783), (543, 744), (546, 704), (543, 664), (527, 627)],
        "leg_l": [(630, 544), (696, 545), (730, 571), (743, 612), (741, 661), (737, 711),
                  (740, 761), (750, 811), (761, 854), (748, 882), (708, 888), (658, 882),
                  (648, 858), (657, 819), (663, 777), (665, 734), (662, 692), (650, 651)],
        "mane_box": (135, 100, 665, 780),
        "horn_box": (175, 0, 420, 385),
        "tail_box": (610, 340, 910, 900),
        "roots": {
            "head/mane": (380, 230),
            "body/mane": (475, 455),
            "head/horn": (330, 330),
            "body/tail": (665, 445),
        },
    },
}


def polygon_mask(size: tuple[int, int], points: list[tuple[int, int]]) -> np.ndarray:
    mask = Image.new("1", size, 0)
    ImageDraw.Draw(mask).polygon(points, fill=1)
    return np.asarray(mask, dtype=bool)


def box_mask(size: tuple[int, int], box: tuple[int, int, int, int]) -> np.ndarray:
    mask = np.zeros((size[1], size[0]), dtype=bool)
    mask[box[1]:box[3], box[0]:box[2]] = True
    return mask


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    image = Image.fromarray(mask.astype(np.uint8) * 255, "L")
    return np.asarray(image.filter(ImageFilter.MaxFilter(radius * 2 + 1))) > 0


def nearest_pixels(
    mask: np.ndarray,
    point: tuple[int, int],
    count: int,
) -> np.ndarray:
    coordinates = np.argwhere(mask)
    if len(coordinates) < count:
        raise RuntimeError(f"only {len(coordinates)} pixels available near {point}, need {count}")
    distances = (coordinates[:, 1] - point[0]) ** 2 + (coordinates[:, 0] - point[1]) ** 2
    selected = coordinates[np.argpartition(distances, count - 1)[:count]]
    result = np.zeros_like(mask)
    result[selected[:, 0], selected[:, 1]] = True
    return result


def checkerboard(size: tuple[int, int], cell: int = 16) -> Image.Image:
    board = Image.new("RGBA", size, (238, 232, 222, 255))
    draw = ImageDraw.Draw(board)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(218, 210, 198, 255))
    return board


def write_review(tier: str, image: Image.Image, layers: dict[str, Image.Image]) -> None:
    panel = 400
    preview_size = 352
    sheet = Image.new("RGB", (panel * 4, panel * 3), (43, 33, 24))
    entries = [("assembled", image), *((name, layers[name]) for name in PART_NAMES)]
    for index, (name, entry) in enumerate(entries):
        tile = Image.new("RGBA", (panel, panel), (255, 246, 232, 255))
        preview = checkerboard((preview_size, preview_size))
        preview.alpha_composite(entry.resize((preview_size, preview_size), Image.Resampling.LANCZOS))
        tile.alpha_composite(preview, ((panel - preview_size) // 2, 36))
        ImageDraw.Draw(tile).text((18, 12), name, fill=(43, 33, 24, 255))
        sheet.paste(tile.convert("RGB"), ((index % 4) * panel, (index // 4) * panel))
    out = ROOT / f"art/review/unicorn_{tier}_contact_sheet.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, format="PNG", compress_level=9)


def split_tier(tier: str) -> None:
    config = CONFIG[tier]
    assembled_path = ROOT / f"assets/characters/unicorn/{tier}/assembled.png"
    parts_dir = assembled_path.parent / "parts"
    image = Image.open(assembled_path).convert("RGBA")
    pixels = np.asarray(image)
    alpha = pixels[:, :, 3]
    content = alpha > 0
    solid = alpha >= 250
    hsv = np.asarray(image.convert("HSV"))
    saturated = hsv[:, :, 1] > 68
    hue_degrees = hsv[:, :, 0].astype(float) * (360.0 / 255.0)
    value = hsv[:, :, 2]

    regions = {
        name: polygon_mask(image.size, config[name])
        for name in ("head", "body", "arm_l", "arm_r", "leg_l", "leg_r")
    }
    for name in ("mane", "horn", "tail"):
        box = box_mask(image.size, config[f"{name}_box"])
        seed = box & saturated & content
        if name == "horn":
            seed &= (hue_degrees >= 185) & (hue_degrees <= 245)
            regions[name] = dilate(seed, 5) & box & content
        else:
            seed &= (
                (hue_degrees >= 230)
                & (hue_degrees <= 335)
                & (value < 215)
            )
            density = np.asarray(
                Image.fromarray(seed.astype(np.uint8) * 255, "L").filter(
                    ImageFilter.BoxBlur(5)
                )
            )
            regions[name] = (
                dilate(seed, 5)
                & box
                & content
                & ((hsv[:, :, 1] > 50) | (density > 100))
            )

    labels = np.full((image.height, image.width), PART_NAMES.index("body"), dtype=np.uint8)
    for name in ("tail", "body", "leg_l", "leg_r", "arm_l", "arm_r", "head", "mane", "horn"):
        labels[regions[name] & content] = PART_NAMES.index(name)

    yy, xx = np.indices(labels.shape)
    fallback = content & (labels == PART_NAMES.index("body"))
    cleanup = (
        ("head", yy < config["body"][0][1] - 8),
        ("arm_r", (yy >= 500) & (xx < 370)),
        ("arm_l", (yy >= 500) & (xx >= 370) & (xx < 500)),
        ("leg_r", (yy >= 520) & (xx >= 500) & (xx < 640)),
        ("leg_l", (yy >= 500) & (xx >= 640) & (xx < 790)),
        ("tail", box_mask(image.size, config["tail_box"])),
    )
    for name, area in cleanup:
        selected = fallback & area
        labels[selected] = PART_NAMES.index(name)
        fallback[selected] = False

    owner = {name: content & (labels == index) for index, name in enumerate(PART_NAMES)}
    masks = {name: value.copy() for name, value in owner.items()}
    needed = MANIFEST["tolerance"]["minSeamOverlapPx"]
    adjacency = [(a, b) for a, b in MANIFEST["adjacency"] if a in masks and b in masks]
    seam_info = []
    for a, b in adjacency:
        common = np.zeros_like(content)
        radius_used = 0
        seam_key = f"{a}/{b}"
        moving_parts = {
            "head/mane": "mane",
            "body/mane": "mane",
            "head/horn": "horn",
            "body/tail": "tail",
        }
        if seam_key in moving_parts:
            moving = moving_parts[seam_key]
            common = nearest_pixels(
                owner[moving] & solid,
                config["roots"][seam_key],
                needed + 100,
            )
        else:
            for radius in (16, 20, 24, 28, 32, 36, 40, 44, 48):
                common = dilate(owner[a], radius) & dilate(owner[b], radius) & solid
                radius_used = radius
                if int(common.sum()) >= needed:
                    break
        masks[a] |= common
        masks[b] |= common
        seam_info.append((a, b, int((masks[a] & masks[b]).sum()), radius_used))

    if tier == "radiant":
        # The radiant horn grows through the mane and its dilated seam mask
        # intentionally carries a few violet mane pixels. Mark those pixels as
        # shared mane overdraw so palette sampling sees only the blue horn,
        # while recomposition and animation-safe overlap remain unchanged.
        blue_horn = (hue_degrees >= 185) & (hue_degrees <= 245)
        violet_overdraw = masks["horn"] & content & saturated & ~blue_horn
        masks["mane"] |= violet_overdraw

    parts_dir.mkdir(parents=True, exist_ok=True)
    layers = {}
    for name in PART_NAMES:
        layer_pixels = np.zeros_like(pixels)
        layer_pixels[masks[name]] = pixels[masks[name]]
        layer = Image.fromarray(layer_pixels, "RGBA")
        layer.save(parts_dir / f"{name}.png", format="PNG", compress_level=9)
        layers[name] = layer

    write_review(tier, image, layers)
    print(f"{tier}: wrote {len(layers)} parts")
    for a, b, overlap, radius in seam_info:
        print(f"  {a}/{b}: {overlap:,}px radius={radius}")


def main() -> None:
    selected = tuple(sys.argv[1:]) or TIERS
    for tier in selected:
        if tier not in CONFIG:
            raise SystemExit(f"unknown tier: {tier}")
        split_tier(tier)


if __name__ == "__main__":
    main()
