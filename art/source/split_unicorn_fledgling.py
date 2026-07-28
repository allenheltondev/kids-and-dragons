from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
ASSEMBLED = ROOT / "assets/characters/unicorn/fledgling/assembled.png"
PARTS = ASSEMBLED.parent / "parts"
MANIFEST = ROOT / "assets/manifest.json"
CONTACT_SHEET = ROOT / "art/review/unicorn_fledgling_contact_sheet.png"
SMALL_PREVIEW = ROOT / "art/review/unicorn_fledgling_120px.png"

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


def polygon_mask(size: tuple[int, int], points: list[tuple[int, int]]) -> np.ndarray:
    mask = Image.new("1", size, 0)
    ImageDraw.Draw(mask).polygon(points, fill=1)
    return np.asarray(mask, dtype=bool)


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask
    image = Image.fromarray((mask.astype(np.uint8) * 255), "L")
    return np.asarray(image.filter(ImageFilter.MaxFilter(radius * 2 + 1))) > 0


def checkerboard(size: tuple[int, int], cell: int = 16) -> Image.Image:
    board = Image.new("RGBA", size, (238, 232, 222, 255))
    draw = ImageDraw.Draw(board)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle(
                    (x, y, min(x + cell - 1, size[0] - 1), min(y + cell - 1, size[1] - 1)),
                    fill=(218, 210, 198, 255),
                )
    return board


def write_review_images(image: Image.Image, layers: dict[str, Image.Image]) -> None:
    panel_size = 400
    preview_size = 352
    columns = 4
    rows = 3
    sheet = Image.new("RGB", (panel_size * columns, panel_size * rows), (43, 33, 24))
    entries = [("assembled", image), *((name, layers[name]) for name in PART_NAMES)]

    for index, (name, entry) in enumerate(entries):
        panel = Image.new("RGBA", (panel_size, panel_size), (255, 246, 232, 255))
        preview = checkerboard((preview_size, preview_size))
        preview.alpha_composite(entry.resize((preview_size, preview_size), Image.Resampling.LANCZOS))
        panel.alpha_composite(preview, ((panel_size - preview_size) // 2, 36))
        ImageDraw.Draw(panel).text((18, 12), name, fill=(43, 33, 24, 255))
        sheet.paste(
            panel.convert("RGB"),
            ((index % columns) * panel_size, (index // columns) * panel_size),
        )

    CONTACT_SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(CONTACT_SHEET, format="PNG", compress_level=9)

    alpha_bbox = image.getchannel("A").getbbox()
    assert alpha_bbox is not None
    crop = image.crop(alpha_bbox)
    scale = 120 / crop.height
    small = crop.resize((round(crop.width * scale), 120), Image.Resampling.LANCZOS)
    preview = Image.new("RGBA", (180, 180), (255, 246, 232, 255))
    preview.alpha_composite(small, ((180 - small.width) // 2, (180 - small.height) // 2))
    preview.convert("RGB").save(SMALL_PREVIEW, format="PNG", compress_level=9)


def main() -> None:
    image = Image.open(ASSEMBLED).convert("RGBA")
    pixels = np.asarray(image)
    alpha = pixels[:, :, 3]
    content = alpha > 0
    solid = alpha >= 250
    hsv = np.asarray(image.convert("HSV"))
    saturated = hsv[:, :, 1] > 68

    regions = {
        "head": polygon_mask(
            image.size,
            [
                (145, 126), (169, 85), (218, 91), (240, 76),
                (282, 86), (331, 96), (385, 101), (429, 108),
                (451, 148), (477, 190), (490, 232), (507, 270),
                (514, 318), (501, 357), (478, 399), (447, 432),
                (399, 449), (350, 439), (303, 432), (258, 430),
                (214, 424), (178, 406), (158, 374), (162, 330),
                (171, 282), (157, 235),
            ],
        ),
        "mane": (
            polygon_mask(
                image.size,
                [
                    (145, 211), (158, 160), (176, 112), (215, 92),
                    (260, 91), (310, 94), (357, 104), (401, 127),
                    (439, 164), (473, 196), (482, 237), (458, 250),
                    (420, 229), (383, 203), (344, 184), (302, 178),
                    (258, 188), (220, 211), (181, 241), (151, 242),
                ],
            )
            | polygon_mask(
                image.size,
                [
                    (390, 148), (438, 170), (476, 207), (489, 246),
                    (509, 284), (514, 327), (505, 372), (488, 413),
                    (462, 450), (428, 458), (407, 429), (415, 389),
                    (422, 345), (420, 300), (407, 255),
                ],
            )
        ),
        "horn": polygon_mask(
            image.size,
            [
                (221, 77), (235, 78), (250, 97), (263, 119),
                (277, 143), (290, 169), (291, 190), (279, 203),
                (258, 203), (242, 188), (235, 165), (229, 137),
                (222, 108),
            ],
        ),
        "tail": polygon_mask(
            image.size,
            [
                (693, 389), (728, 390), (766, 402), (795, 428),
                (816, 464), (826, 504), (852, 531), (876, 542),
                (879, 579), (867, 615), (873, 651), (867, 692),
                (845, 727), (812, 738), (779, 727), (754, 701),
                (745, 665), (750, 625), (733, 599), (711, 568),
                (702, 526), (702, 479),
            ],
        ),
        # Anatomical left appears on the viewer's right.
        "arm_l": polygon_mask(
            image.size,
            [
                (368, 505), (443, 510), (472, 551), (474, 601),
                (469, 658), (466, 714), (458, 773), (453, 827),
                (466, 873), (457, 897), (416, 905), (365, 893),
                (374, 850), (385, 806), (390, 758), (391, 707),
                (389, 658), (378, 608),
            ],
        ),
        "arm_r": polygon_mask(
            image.size,
            [
                (277, 502), (362, 508), (387, 546), (391, 596),
                (384, 650), (379, 706), (372, 760), (359, 815),
                (351, 860), (333, 883), (286, 883), (256, 873),
                (266, 837), (282, 798), (295, 754), (302, 708),
                (302, 661), (294, 612), (280, 559),
            ],
        ),
        "leg_l": polygon_mask(
            image.size,
            [
                (637, 514), (705, 513), (742, 543), (756, 588),
                (754, 642), (749, 696), (751, 753), (761, 807),
                (772, 854), (758, 883), (718, 890), (665, 884),
                (654, 858), (662, 814), (667, 767), (669, 720),
                (666, 675), (654, 631),
            ],
        ),
        "leg_r": polygon_mask(
            image.size,
            [
                (506, 530), (572, 536), (611, 560), (632, 598),
                (637, 644), (635, 693), (630, 742), (622, 789),
                (611, 833), (598, 859), (554, 865), (509, 852),
                (516, 817), (530, 776), (539, 734), (542, 692),
                (539, 650), (522, 609),
            ],
        ),
        "body": polygon_mask(
            image.size,
            [
                (279, 368), (344, 362), (418, 368), (498, 379),
                (579, 376), (652, 374), (705, 390), (736, 421),
                (748, 468), (742, 518), (724, 557), (687, 584),
                (637, 600), (576, 608), (512, 613), (451, 611),
                (393, 606), (342, 590), (305, 560), (284, 519),
                (276, 469), (282, 418),
            ],
        ),
    }

    # Color-driven regions pick up the complete painted locks and their outlines.
    mane_seed = regions["mane"] & saturated & content
    tail_seed = regions["tail"] & saturated & content
    horn_seed = regions["horn"] & saturated & content
    regions["mane"] = dilate(mane_seed, 5) & regions["mane"] & content
    regions["tail"] = dilate(tail_seed, 5) & regions["tail"] & content
    regions["horn"] = dilate(horn_seed, 5) & regions["horn"] & content

    labels = np.full((image.height, image.width), PART_NAMES.index("body"), dtype=np.uint8)

    # Back-to-front anatomical ownership. The color-driven regions are assigned last.
    for name in ("tail", "body", "leg_l", "leg_r", "arm_l", "arm_r", "head", "mane", "horn"):
        labels[regions[name] & content] = PART_NAMES.index(name)

    # Catch antialiased fringe outside polygon edges while keeping parts anatomical.
    yy, xx = np.indices(labels.shape)
    fallback = content & (labels == PART_NAMES.index("body"))
    cleanup = (
        ("head", yy < 365),
        ("mane", (yy < 450) & saturated & ((xx < 190) | (xx > 400))),
        ("arm_r", (yy >= 500) & (xx < 365)),
        ("arm_l", (yy >= 500) & (xx >= 365) & (xx < 490)),
        ("leg_r", (yy >= 530) & (xx >= 490) & (xx < 640)),
        ("leg_l", (yy >= 500) & (xx >= 640) & (xx < 785)),
        ("tail", (yy >= 380) & (xx >= 700)),
    )
    for name, area in cleanup:
        selected = fallback & area
        labels[selected] = PART_NAMES.index(name)
        fallback[selected] = False

    owner_masks = {
        name: content & (labels == index)
        for index, name in enumerate(PART_NAMES)
    }
    final_masks = {name: mask.copy() for name, mask in owner_masks.items()}

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    needed = manifest["tolerance"]["minSeamOverlapPx"]
    adjacency = [
        (a, b)
        for a, b in manifest["adjacency"]
        if a in final_masks and b in final_masks
    ]

    seam_details: list[tuple[str, str, int, int]] = []
    for a, b in adjacency:
        common = np.zeros_like(content)
        used_radius = 0
        for radius in (16, 20, 24, 28, 32, 36, 40, 44, 48):
            common = dilate(owner_masks[a], radius) & dilate(owner_masks[b], radius) & solid
            used_radius = radius
            if int(common.sum()) >= needed:
                break
        final_masks[a] |= common
        final_masks[b] |= common
        seam_details.append((a, b, int((final_masks[a] & final_masks[b]).sum()), used_radius))

    PARTS.mkdir(parents=True, exist_ok=True)
    layers: dict[str, Image.Image] = {}
    for name in PART_NAMES:
        layer_pixels = np.zeros_like(pixels)
        layer_pixels[final_masks[name]] = pixels[final_masks[name]]
        layer = Image.fromarray(layer_pixels, "RGBA")
        layer.save(PARTS / f"{name}.png", format="PNG", compress_level=9)
        layers[name] = layer

    # Mirror the verifier's z-order compositor.
    comp = np.zeros_like(pixels, dtype=float)
    for name in manifest["zOrder"]:
        if name not in layers:
            continue
        src = np.asarray(layers[name]).astype(float)
        src_alpha = src[:, :, 3:4] / 255.0
        comp[:, :, :3] = src[:, :, :3] * src_alpha + comp[:, :, :3] * (1 - src_alpha)
        comp[:, :, 3:4] = src_alpha * 255.0 + comp[:, :, 3:4] * (1 - src_alpha)

    assembled_mask = alpha > manifest["tolerance"]["alphaThreshold"]
    comp_mask = comp[:, :, 3] > manifest["tolerance"]["alphaThreshold"]
    union = int((assembled_mask | comp_mask).sum())
    intersection = int((assembled_mask & comp_mask).sum())
    iou = intersection / union
    delta = np.abs(pixels[:, :, :3].astype(float) - comp[:, :, :3])[assembled_mask & comp_mask]
    mean_delta = float(delta.mean())

    write_review_images(image, layers)

    print(f"Wrote {len(PART_NAMES)} registered parts")
    print(f"Recomposition: IoU={iou:.5f}, mean RGB delta={mean_delta:.2f}")
    for a, b, overlap, radius in seam_details:
        print(f"Seam {a}/{b}: {overlap:,}px (radius {radius}px)")
    print(f"Contact sheet: {CONTACT_SHEET}")


if __name__ == "__main__":
    main()
