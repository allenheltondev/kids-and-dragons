#!/usr/bin/env python3
"""Build the approved Echo Hunter source and quadruped parts."""

from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source" / "echo_hunter_rig"
PARTS_DIR = SOURCE_DIR / "parts"
REVIEW_PATH = ROOT / "art" / "review" / "echo_hunter_rig.png"

CANVAS = 1024
ANCHOR_Y = 900
TARGET_HEIGHT = 820
TARGET_WIDTH = 1008
ALPHA_THRESHOLD = 8
Z_ORDER = [
    "tail",
    "limb_bl",
    "limb_br",
    "body",
    "ruff",
    "limb_fl",
    "limb_fr",
    "head",
    "frills",
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

    # The generated pose is slightly wider than the production creature box.
    # A mild 6.7% horizontal correction keeps every painted extremity while
    # landing on the canon's allowed 820px minimum height and 8px safe margins.
    scaled = crop.resize((TARGET_WIDTH, TARGET_HEIGHT), Image.Resampling.LANCZOS)
    registered = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    registered.alpha_composite(scaled, ((CANVAS - TARGET_WIDTH) // 2, ANCHOR_Y - TARGET_HEIGHT))

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


def make_parts(assembled: Image.Image) -> dict[str, Image.Image]:
    rgba = np.asarray(assembled).copy()
    alpha = rgba[..., 3]
    # Registration uses a practical threshold for bounds, but layer ownership
    # keeps every nonzero antialiasing pixel so recomposition is byte-exact.
    subject = alpha > 0
    yy, xx = np.indices(alpha.shape)

    # Broad pose regions. Ownership is exclusive; a small opaque expansion is
    # added afterward so neighboring sprites retain useful seam overdraw.
    head = polygon_mask(
        [(145, 270), (265, 270), (335, 350), (315, 500), (245, 600), (125, 575), (115, 410)]
    )
    ruff = polygon_mask(
        [(220, 485), (330, 495), (445, 535), (465, 650), (285, 670), (210, 540)]
    )
    tail = polygon_mask(
        [(660, 75), (1018, 70), (1018, 485), (875, 510), (720, 430), (650, 275)]
    )
    limb_fl = polygon_mask(
        [(255, 535), (405, 555), (410, 650), (315, 705), (255, 815), (175, 875), (65, 865),
         (75, 780), (185, 720), (235, 640)]
    )
    limb_fr = polygon_mask(
        [(490, 425), (650, 435), (690, 560), (660, 670), (600, 840), (525, 910), (400, 900),
         (415, 820), (500, 760), (565, 590)]
    )
    limb_bl = polygon_mask(
        [(615, 445), (755, 450), (770, 580), (735, 680), (760, 790), (645, 800), (615, 690),
         (675, 590)]
    )
    limb_br = polygon_mask(
        [(710, 335), (835, 330), (855, 480), (815, 570), (925, 590), (975, 700), (1018, 810),
         (915, 845), (845, 785), (885, 700), (815, 635), (745, 605), (705, 500)]
    )
    body = polygon_mask(
        [(300, 295), (820, 285), (900, 450), (820, 590), (700, 640), (380, 650), (250, 540)]
    )
    chest_bridge = polygon_mask([(335, 540), (500, 535), (510, 660), (340, 685)])
    body |= chest_bridge
    ruff &= ~chest_bridge

    # Blue-lavender membranes identify the two acoustic fans. Expanding that
    # seed captures their pale organic rims without stealing the eyeless face.
    frill_zones = (
        polygon_mask([(5, 60), (280, 60), (320, 360), (270, 525), (80, 500), (5, 350)])
        | polygon_mask([(255, 55), (610, 55), (625, 400), (550, 570), (330, 530), (250, 300)])
    )
    frills = subject & frill_zones

    regions = {
        "body": body,
        "head": head,
        "ruff": ruff,
        "limb_fl": limb_fl,
        "limb_fr": limb_fr,
        "limb_bl": limb_bl,
        "limb_br": limb_br,
        "tail": tail,
        "frills": frills,
    }
    names = list(regions)
    index = {name: i for i, name in enumerate(names)}
    owner = np.full((CANVAS, CANVAS), -1, dtype=np.int8)

    # Anatomical foreground regions claim first. The acoustic membranes still
    # retain almost all their area, while face/ruff ownership stays useful at
    # their visual overlaps. The torso receives any tiny unclaimed gaps.
    for name in (
        "head",
        "ruff",
        "frills",
        "tail",
        "body",
        "limb_fl",
        "limb_fr",
        "limb_bl",
        "limb_br",
    ):
        take = subject & regions[name] & (owner < 0)
        owner[take] = index[name]

    # Grow the nearest anatomical owner through any narrow unclaimed edge
    # pixels. This prevents pale fan rims and whisker antialiasing from falling
    # through to the torso merely because the whole creature is one component.
    unclaimed = subject & (owner < 0)
    owned = subject & (owner >= 0)
    neighbors_unclaimed = (
        np.roll(unclaimed, 1, axis=0)
        | np.roll(unclaimed, -1, axis=0)
        | np.roll(unclaimed, 1, axis=1)
        | np.roll(unclaimed, -1, axis=1)
    )
    frontier = owned & neighbors_unclaimed
    queue = deque((int(y), int(x)) for y, x in zip(*np.nonzero(frontier)))
    while queue:
        y, x = queue.popleft()
        claim = owner[y, x]
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < CANVAS and 0 <= nx < CANVAS and subject[ny, nx] and owner[ny, nx] < 0:
                owner[ny, nx] = claim
                queue.append((ny, nx))

    # A few antialiased whisker/foot islands sit below the ownership threshold
    # of their connecting stroke. Route those isolated pixels by anatomy so no
    # distant flecks pollute the torso sprite's bounds.
    remaining = subject & (owner < 0)
    owner[remaining & (xx < 190) & (yy >= 450)] = index["head"]
    remaining = subject & (owner < 0)
    owner[remaining & (xx < 410) & (yy >= 600)] = index["limb_fl"]
    remaining = subject & (owner < 0)
    owner[remaining & (xx < 710) & (yy >= 650)] = index["limb_fr"]
    remaining = subject & (owner < 0)
    owner[remaining & (xx >= 850) & (yy >= 550)] = index["limb_br"]
    owner[subject & (owner < 0)] = index["body"]

    exclusive = {name: owner == index[name] for name in names}
    fully_opaque = alpha == 255
    parts: dict[str, Image.Image] = {}
    for name in names:
        base = Image.fromarray((exclusive[name] * 255).astype(np.uint8), "L")
        expanded = np.asarray(base.filter(ImageFilter.MaxFilter(31))) > 0
        include = subject & (exclusive[name] | (expanded & fully_opaque))
        part = rgba.copy()
        part[..., 3] = np.where(include, alpha, 0)
        part[~include, :3] = 0
        parts[name] = Image.fromarray(part, "RGBA")
    return parts


def composite(parts: dict[str, Image.Image]) -> Image.Image:
    result = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    for name in Z_ORDER:
        result.alpha_composite(parts[name])
    return result


def content_crop(image: Image.Image) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"))
    mask_image = Image.fromarray(((alpha > ALPHA_THRESHOLD) * 255).astype(np.uint8), "L")
    core = np.asarray(mask_image.filter(ImageFilter.MinFilter(3))) > 0
    if not core.any():
        return image

    seen = np.zeros(core.shape, dtype=bool)
    components: list[tuple[int, tuple[int, int, int, int]]] = []
    for seed_y, seed_x in zip(*np.nonzero(core)):
        if seen[seed_y, seed_x]:
            continue
        queue = deque([(int(seed_y), int(seed_x))])
        seen[seed_y, seed_x] = True
        size = 0
        min_x = max_x = int(seed_x)
        min_y = max_y = int(seed_y)
        while queue:
            y, x = queue.popleft()
            size += 1
            min_x, max_x = min(min_x, x), max(max_x, x)
            min_y, max_y = min(min_y, y), max(max_y, y)
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < CANVAS and 0 <= nx < CANVAS and core[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        components.append((size, (min_x, min_y, max_x + 1, max_y + 1)))

    largest = max(size for size, _ in components)
    meaningful = [bbox for size, bbox in components if size >= largest * 0.10]
    pad = 12
    left = max(0, min(b[0] for b in meaningful) - pad)
    top = max(0, min(b[1] for b in meaningful) - pad)
    right = min(CANVAS, max(b[2] for b in meaningful) + pad)
    bottom = min(CANVAS, max(b[3] for b in meaningful) + pad)
    return image.crop((left, top, right, bottom))


def make_review(assembled: Image.Image, parts: dict[str, Image.Image]) -> Image.Image:
    board = Image.new("RGB", (1800, 1120), (23, 29, 43))
    draw = ImageDraw.Draw(board)
    draw.text(
        (35, 24),
        "echo_hunter - meticulous listener + quadruped rig",
        fill=(240, 243, 249),
    )
    panels = [(30, 65, 865, 1080), (895, 65, 1770, 820), (895, 850, 1770, 1080)]
    for box in panels:
        draw.rounded_rectangle(box, radius=14, fill=(35, 42, 59), outline=(69, 80, 103), width=2)

    hero = content_crop(assembled)
    hero.thumbnail((800, 900), Image.Resampling.LANCZOS)
    board.paste(hero, (48 + (800 - hero.width) // 2, 125), hero)
    draw.text((50, 82), "Assembled ground-scuttle - 820px target height", fill=(226, 232, 242))

    ordered = [
        "head",
        "frills",
        "ruff",
        "body",
        "tail",
        "limb_fl",
        "limb_fr",
        "limb_bl",
        "limb_br",
    ]
    for i, name in enumerate(ordered):
        col, row = i % 5, i // 5
        x, y = 925 + col * 165, 105 + row * 335
        tile = content_crop(parts[name])
        tile.thumbnail((140, 255), Image.Resampling.LANCZOS)
        board.paste(tile, (x + (140 - tile.width) // 2, y + 30), tile)
        draw.text((x, y), name, fill=(215, 222, 235))

    small = content_crop(assembled)
    small.thumbnail((270, 64), Image.Resampling.LANCZOS)
    board.paste(small, (955, 965), small)
    draw.text((955, 880), "64px combat read", fill=(226, 232, 242))
    draw.text((955, 905), "Frills carry the focused, eyeless personality", fill=(190, 201, 220))
    draw.multiline_text(
        (1320, 880),
        "A patient sound-cartographer:\nhead tilted, one paw feeling vibration,\nacoustic fans triangulating the next click.",
        fill=(205, 214, 229),
        spacing=5,
    )
    return board


def main() -> None:
    PARTS_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    registered = register_source()
    parts = make_parts(registered)
    assembled = composite(parts)

    registered.save(SOURCE_DIR / "registered_reference.png")
    assembled.save(SOURCE_DIR / "assembled.png")
    for name, part in parts.items():
        part.save(PARTS_DIR / f"{name}.png")
    make_review(assembled, parts).save(REVIEW_PATH)


if __name__ == "__main__":
    main()
