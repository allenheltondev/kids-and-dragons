#!/usr/bin/env python3
"""
Kids & Dragons - contact sheet generator.

The other half of the art gate. verify.py prevents *broken*; the contact sheet is
what prevents *wrong* - whether the four tiers read as the same individual, whether
it is this art and not merely pretty art. No script decides that, so this tool's
only job is to put everything a reviewer needs on one image.
See docs/art-pipeline.md section 3.2 and docs/asset-brief.md section 6.2.

Each sheet carries four things, in the order a reviewer wants them:

    1. every part alone, in its registered canvas position  - construction
    2. the assembled figure                                 - the character
    3. the figure at 120px tall, on light and on dark       - the phone check
    4. all delivered tiers side by side                     - same individual?

Part thumbnails deliberately show the *whole canvas* rather than a trimmed crop:
registration is the load-bearing constraint (asset-brief.md section 3.1), and a part
drifting out of position is obvious the moment you see it floating in the frame.

Usage:
    python tools/art/sheet.py                 # every delivered set
    python tools/art/sheet.py unicorn         # one species
    python tools/art/sheet.py unicorn/sworn   # one species/tier

Writes to art/review/<species>/. Sets that have not been delivered yet are skipped,
not failed - only unicorn exists today.

Requires: Pillow, numpy
"""

from __future__ import annotations

import json
import os
import sys

try:
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("error: needs Pillow and numpy  ->  pip install pillow numpy")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "assets", "manifest.json")
REVIEW = os.path.join(ROOT, "art", "review")

RED, GREEN, YELLOW, DIM, BOLD, RESET = (
    ("\033[31m", "\033[32m", "\033[33m", "\033[2m", "\033[1m", "\033[0m")
    if sys.stdout.isatty() and os.name != "nt"
    else ("", "", "", "", "", "")
)

# Sheet furniture, in sheet pixels.
PAD = 28
GAP = 16
PART_CELL = 190
ASSEMBLED_H = 460
TIER_CELL = 300
LABEL_H = 26

# Paper and ink come from the manifest's global palette so the sheet never fights
# the art it is showing. Never pure white, never pure black - asset-brief.md 2.3.
PAPER = (255, 246, 232)
INK = (43, 33, 24)
FAINT = (176, 164, 150)


# ----------------------------------------------------------------------------- drawing helpers


def load_font(size: int):
    """Pillow's bitmap default is unreadable above ~12px; prefer a real face if the
    box has one, and fall back so the tool still runs on a bare container."""
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


FONT_H1 = load_font(30)
FONT_H2 = load_font(19)
FONT_LABEL = load_font(15)
FONT_SMALL = load_font(13)


def text_width(draw: ImageDraw.ImageDraw, s: str, font) -> int:
    return int(draw.textlength(s, font=font))


def checker(size: tuple[int, int], step: int = 14) -> Image.Image:
    """Alpha has to be visible on a review sheet - a part with a baked white
    background is one of the failure modes the eye is here to catch."""
    w, h = size
    im = Image.new("RGB", size, (236, 228, 216))
    d = ImageDraw.Draw(im)
    for y in range(0, h, step):
        for x in range(0, w, step):
            if (x // step + y // step) % 2:
                d.rectangle([x, y, x + step - 1, y + step - 1], fill=(220, 210, 196))
    return im


def content_box(im: Image.Image, threshold: int) -> tuple[int, int, int, int] | None:
    a = np.array(im.getchannel("A"))
    ys, xs = np.where(a > threshold)
    if not len(ys):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def fit(im: Image.Image, size: int) -> Image.Image:
    """Scale a full square canvas down to `size`, keeping every part in position."""
    return im.resize((size, size), Image.LANCZOS)


def at_height(im: Image.Image, height: int, threshold: int) -> Image.Image:
    """Crop to the character and scale it so the character itself is `height` px -
    the same measurement verify.py's signature legibility check uses."""
    box = content_box(im, threshold)
    if box is None:
        return Image.new("RGBA", (height, height), (0, 0, 0, 0))
    crop = im.crop(box)
    scale = height / crop.height
    return crop.resize((max(1, round(crop.width * scale)), height), Image.LANCZOS)


def card(inner: Image.Image, label: str, bg, sub: str = "") -> Image.Image:
    """One labelled tile: image on a background, caption underneath."""
    w = max(inner.width, 120)
    h = inner.height + LABEL_H + (18 if sub else 0)
    tile = Image.new("RGB", (w, h), PAPER)
    plate = Image.new("RGB", (w, inner.height), bg)
    plate.paste(inner, ((w - inner.width) // 2, 0), inner if inner.mode == "RGBA" else None)
    tile.paste(plate, (0, 0))

    d = ImageDraw.Draw(tile)
    d.rectangle([0, 0, w - 1, inner.height - 1], outline=FAINT)
    d.text(((w - text_width(d, label, FONT_LABEL)) // 2, inner.height + 5), label, font=FONT_LABEL, fill=INK)
    if sub:
        d.text(((w - text_width(d, sub, FONT_SMALL)) // 2, inner.height + LABEL_H + 1), sub, font=FONT_SMALL, fill=FAINT)
    return tile


def row(tiles: list[Image.Image], gap: int = GAP) -> Image.Image:
    if not tiles:
        return Image.new("RGB", (1, 1), PAPER)
    w = sum(t.width for t in tiles) + gap * (len(tiles) - 1)
    h = max(t.height for t in tiles)
    im = Image.new("RGB", (w, h), PAPER)
    x = 0
    for t in tiles:
        im.paste(t, (x, 0))
        x += t.width + gap
    return im


def grid(tiles: list[Image.Image], cols: int, gap: int = GAP) -> Image.Image:
    rows = [row(tiles[i:i + cols], gap) for i in range(0, len(tiles), cols)]
    return stack(rows, gap)


def stack(parts: list[Image.Image], gap: int = GAP) -> Image.Image:
    parts = [p for p in parts if p.width > 1]
    if not parts:
        return Image.new("RGB", (1, 1), PAPER)
    w = max(p.width for p in parts)
    h = sum(p.height for p in parts) + gap * (len(parts) - 1)
    im = Image.new("RGB", (w, h), PAPER)
    y = 0
    for p in parts:
        im.paste(p, (0, y))
        y += p.height + gap
    return im


def heading(text: str, sub: str, width: int) -> Image.Image:
    im = Image.new("RGB", (width, 74), PAPER)
    d = ImageDraw.Draw(im)
    d.text((0, 0), text, font=FONT_H1, fill=INK)
    d.text((0, 40), sub, font=FONT_SMALL, fill=FAINT)
    d.line([0, 68, width, 68], fill=FAINT)
    return im


def band(text: str, width: int) -> Image.Image:
    im = Image.new("RGB", (width, 30), PAPER)
    ImageDraw.Draw(im).text((0, 6), text, font=FONT_H2, fill=INK)
    return im


def page(blocks: list[Image.Image]) -> Image.Image:
    body = stack(blocks, GAP)
    im = Image.new("RGB", (body.width + PAD * 2, body.height + PAD * 2), PAPER)
    im.paste(body, (PAD, PAD))
    return im


def save(im: Image.Image, path: str) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    return os.path.relpath(path, ROOT)


# ----------------------------------------------------------------------------- sheets


def load_set(species: dict, tier: str, thr: int):
    """Returns (assembled, {part: image}) for a delivered set, or None."""
    base = os.path.join(ROOT, "assets", "characters", species["id"], tier)
    asm_path = os.path.join(base, "assembled.png")
    if not os.path.exists(asm_path):
        return None

    assembled = Image.open(asm_path).convert("RGBA")
    parts: dict[str, Image.Image] = {}
    for name in species["parts"]:
        p = os.path.join(base, "parts", f"{name}.png")
        if os.path.exists(p):
            parts[name] = Image.open(p).convert("RGBA")
    return assembled, parts


def tier_sheet(species: dict, tier: str, assembled, parts, canvas: dict, tol: dict) -> Image.Image:
    thr = tol["alphaThreshold"]
    sig = species["signature"]
    sig_h = tol["silhouetteHeightPx"]

    # 1. parts, each in its registered canvas position
    tiles = []
    for name in species["parts"]:
        im = parts.get(name)
        cell = checker((PART_CELL, PART_CELL))
        if im is not None:
            cell.paste(fit(im, PART_CELL), (0, 0), fit(im, PART_CELL))
            note = "signature" if name == sig else ""
        else:
            ImageDraw.Draw(cell).text((10, PART_CELL // 2), "missing", font=FONT_LABEL, fill=(180, 60, 60))
            note = "MISSING"
        tiles.append(card(cell, f"{name}.png", (236, 228, 216), note))
    parts_block = grid(tiles, cols=5)
    width = max(parts_block.width, 4 * TIER_CELL)

    # 2. the assembled figure, plus the same figure on dark - the grid is not white
    asm_light = Image.new("RGB", (ASSEMBLED_H, ASSEMBLED_H), PAPER)
    small = fit(assembled, ASSEMBLED_H)
    asm_light.paste(small, (0, 0), small)
    asm_dark = Image.new("RGB", (ASSEMBLED_H, ASSEMBLED_H), (48, 42, 38))
    asm_dark.paste(small, (0, 0), small)

    # 3. the legibility check: the character exactly 120px tall, which is how big
    #    she is in a phone's 60%-height pane (asset-brief.md section 1)
    tiny = at_height(assembled, sig_h, thr)
    legibility = []
    for bg, label in ((PAPER, "light"), ((48, 42, 38), "dark"), ((0, 0, 0), "silhouette")):
        plate = Image.new("RGB", (max(160, tiny.width + 40), sig_h + 40), bg)
        if label == "silhouette":
            mask = tiny.getchannel("A")
            shape = Image.new("RGB", tiny.size, (255, 255, 255))
            plate.paste(shape, ((plate.width - tiny.width) // 2, 20), mask)
        else:
            plate.paste(tiny, ((plate.width - tiny.width) // 2, 20), tiny)
        legibility.append(card(plate, f"{sig_h}px - {label}", bg))

    box = content_box(assembled, thr)
    char_h = (box[3] - box[1]) if box else 0

    return page([
        heading(
            f"{species['id']} / {tier}",
            f"{len(parts)} of {len(species['parts'])} parts   "
            f"canvas {canvas['width']}x{canvas['height']}   origin y={canvas['originY']}   "
            f"character {char_h}px tall   signature: {sig}",
            width,
        ),
        band("Parts - each in its registered canvas position", width),
        parts_block,
        band("Assembled", width),
        row([card(asm_light, "assembled", PAPER), card(asm_dark, "on a dark grid", (48, 42, 38))]),
        band(f"Legibility - the character at {sig_h}px, the size she is on a phone", width),
        row(legibility),
    ])


def species_sheet(species: dict, sets: dict, canvas: dict, tol: dict) -> Image.Image:
    """All delivered tiers side by side. This is the 'is it the same individual?'
    gate - asset-brief.md section 6.2, and the one no verifier can decide."""
    thr = tol["alphaThreshold"]
    sig_h = tol["silhouetteHeightPx"]
    tiers = list(sets.keys())

    full, tiny_row = [], []
    for tier in tiers:
        assembled, _ = sets[tier]
        plate = Image.new("RGB", (TIER_CELL, TIER_CELL), PAPER)
        scaled = fit(assembled, TIER_CELL)
        plate.paste(scaled, (0, 0), scaled)
        box = content_box(assembled, thr)
        full.append(card(plate, tier, PAPER, f"{(box[3] - box[1]) if box else 0}px tall on canvas"))

        tiny = at_height(assembled, sig_h, thr)
        cell = Image.new("RGB", (max(150, tiny.width + 30), sig_h + 30), PAPER)
        cell.paste(tiny, ((cell.width - tiny.width) // 2, 15), tiny)
        tiny_row.append(card(cell, tier, PAPER))

    width = max(sum(t.width for t in full) + GAP * (len(full) - 1), 640)
    missing = [t for t in ["fledgling", "sworn", "radiant", "mythic"] if t not in tiers]

    return page([
        heading(
            f"{species['id']} - all tiers",
            f"{len(tiers)} of 4 delivered"
            + (f"   not yet delivered: {', '.join(missing)}" if missing else "")
            + "   |   same skeleton, escalating detail - do these read as one individual?",
            width,
        ),
        band("Tiers, at the same canvas scale", width),
        row(full),
        band(f"Tiers at {sig_h}px - three of these share a grid", width),
        row(tiny_row),
    ])


# ----------------------------------------------------------------------------- driver


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]

    if not os.path.exists(MANIFEST):
        sys.exit(f"error: no manifest at {MANIFEST}")
    with open(MANIFEST, encoding="utf-8") as f:
        mf = json.load(f)

    canvas, tol = mf["canvas"], mf["tolerance"]
    thr = tol["alphaThreshold"]

    print(f"{BOLD}Kids & Dragons - contact sheets{RESET}")
    print(f"{DIM}manifest: {os.path.relpath(MANIFEST, ROOT)}   out: {os.path.relpath(REVIEW, ROOT)}{RESET}")

    written: list[str] = []
    skipped: list[str] = []
    matched = 0  # manifest targets the args named, whether delivered or not

    for sp in mf["species"]:
        sets: dict[str, tuple] = {}

        for tier in mf["tiers"]:
            if args and not any(a == sp["id"] or a == f'{sp["id"]}/{tier}' for a in args):
                continue
            matched += 1
            loaded = load_set(sp, tier, thr)
            if loaded is None:
                skipped.append(f'{sp["id"]}/{tier}')
                continue
            assembled, parts = loaded
            sets[tier] = loaded

            out = os.path.join(REVIEW, sp["id"], f"{tier}_sheet.png")
            written.append(save(tier_sheet(sp, tier, assembled, parts, canvas, tol), out))
            print(f"  {GREEN}wrote{RESET} {written[-1]}  ({len(parts)} parts)")

        # The cross-tier sheet only says anything once there are two tiers to compare.
        if len(sets) >= 2:
            out = os.path.join(REVIEW, sp["id"], "tiers.png")
            written.append(save(species_sheet(sp, sets, canvas, tol), out))
            print(f"  {GREEN}wrote{RESET} {written[-1]}  ({len(sets)} tiers side by side)")
        elif len(sets) == 1:
            print(f"  {DIM}skip  {sp['id']}/tiers.png - needs two tiers to compare{RESET}")

    print(f"\n{BOLD}{'-' * 60}{RESET}")
    if skipped:
        print(f"{DIM}not yet delivered: {len(skipped)} set(s) - {', '.join(skipped[:6])}"
              f"{'...' if len(skipped) > 6 else ''}{RESET}")

    if not written:
        # A named set that simply hasn't been commissioned yet is not an error - only
        # 20 of the 24 sets exist and that is the plan (asset-brief.md section 6.3).
        # A name that isn't in the manifest at all is a typo, and typos should hurt.
        if args and matched == 0:
            known = ", ".join(sp["id"] for sp in mf["species"])
            print(f"{RED}{BOLD}unknown target{RESET} - {', '.join(args)} is not in the manifest. Known species: {known}.")
            return 1
        print(f"{YELLOW}nothing to review - none of those sets have been delivered yet.{RESET}")
        return 0

    print(f"{GREEN}{len(written)} sheet(s){RESET} in {os.path.relpath(REVIEW, ROOT)}/")
    print(f"\n{GREEN}{BOLD}DONE{RESET} - now use your eyes. "
          f"The verifier prevents broken; this prevents wrong (art-pipeline.md section 3.2).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
