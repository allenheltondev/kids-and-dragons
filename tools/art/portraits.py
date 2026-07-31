#!/usr/bin/env python3
"""
Kids & Dragons - portrait derivation.

The commissioned figures are 1024x1024 PNGs with a registered origin
(assets/manifest.json), and that is the right shape for the *stage*: the Pixi
renderer needs the alpha, the resolution, and the feet at (512, 900). It is the
wrong shape for a *card*. Character creation shows all six species at once on a
phone; at ~700KB each that is 4MB of PNG to answer "who do you want to be?".

So this derives one small WebP beside every delivered image, always named
`portrait.webp` so a consumer needs one rule rather than three:

    assets/characters/<species>/<tier>/portrait.webp   from assembled.png
    assets/entities/<entity>/portrait.webp             from assembled.png
    assets/biomes/<biome>/portrait.webp                from bg.webp

**Figures** are trimmed to their own alpha bounding box, padded back to a
square, and resized to PORTRAIT_PX. The registration origin is deliberately
*dropped* — a portrait is never composited against anything, it is an <img> in
a card, and keeping the canvas padding would waste half the pixels on
transparency.

**Backdrops** get none of that. A biome's `bg.webp` is an opaque 1920x1080
landscape: there is no alpha to trim, and squaring it would crop away the sides
of the only image that page has. It is simply scaled to BACKDROP_PX wide.

Everything except the character tiers is here for the wiki rather than the game.
Its infobox, thumbnails and gallery were serving the full-size sources —
because `hugo.yaml` mounts `assets/` wholesale and the generator asked for
`assembled.png` and `bg.webp` by name. The worst of it was a related-entity
card: a 56x56 thumbnail loading a 754KB backdrop, on nearly every page in the
site. The full image is still one click away wherever a page offers one; what
changed is that reading a page no longer downloads it.

These are derived files, committed like any other asset so a checkout can render
the app and build the wiki without a Python toolchain. Re-run after new art
lands:

    npm run art:portraits              # everything delivered
    npm run art:portraits unicorn      # one species, every tier
    npm run art:portraits unicorn/sworn
    npm run art:portraits will_o_wisp  # one entity

Nothing *requires* them. The wiki falls back to `assembled.png` per path
(tools/wiki/page-generator.ts), so a missing or stale portrait is a heavier page,
never a broken image. verify.py does not read them — they are derived from art
that already passed the gate.

Requires: Pillow
"""

from __future__ import annotations

import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("error: needs Pillow  ->  pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "assets", "manifest.json")

FIGURE_FILE = "assembled.png"
BACKDROP_FILE = "bg.webp"

# 512px covers the largest place a portrait renders without ever being the
# reason a phone waits. That is now the wiki's tier viewer, whose stage is
# `max-width: 400px` (custom.css) and which — unlike the infobox and the gallery
# — offers no click-through to the full image, so it has to be sharp on its own.
# One size on purpose: two would be two things to keep in sync, and the step
# from 384 costs 14KB against a 800KB source.
PORTRAIT_PX = 512
# Backdrops keep their 16:9 shape, so this is a width. 640 covers the biome
# infobox (sidebar-width, ~280px) at 2x and is ten times lighter than the
# source. The 56px related-entity thumbnail is `object-fit: cover` and would be
# happy with far less; the infobox is what sets the floor.
BACKDROP_PX = 640
# A hair of breathing room so a horn or a wingtip never touches the frame.
MARGIN = 0.04
# Lossy WebP: these are decoration over a dark surface, and the alpha channel
# survives lossy encoding fine at this quality.
QUALITY = 82
# Encoder effort. `method=6` is the exhaustive search and was the obvious choice
# until it was measured against 68 images: 4.9s per file versus 0.11s, to save
# 3% of the bytes. The whole run is ten seconds at 4 and four minutes at 6, and
# the wiki deploy runs it on every art change.
METHOD = 4


def trim_to_content(img: Image.Image) -> Image.Image:
    """Crop to the opaque bounding box, then pad back to a square.

    Square on purpose: the six species have wildly different aspect ratios (a
    reared manticore against a squat bigfoot), and a card grid of mixed ratios
    reads as a layout bug. Squaring here means every consumer can use one box.
    """
    box = img.getchannel("A").getbbox()
    if box is None:
        return img
    cropped = img.crop(box)
    side = int(max(cropped.width, cropped.height) * (1 + MARGIN * 2))
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    return square


def derive(parts: tuple[str, ...], filename: str) -> str | None:
    """Writes `portrait.webp` beside `filename` in `assets/<parts>/`.

    The two derivations differ in kind, not degree, which is why this branches
    rather than parameterising: a figure is trimmed and squared, a backdrop is
    scaled. See the module docstring.
    """
    base = os.path.join(ROOT, "assets", *parts)
    source = os.path.join(base, filename)
    if not os.path.exists(source):
        return None

    with Image.open(source) as raw:
        if filename == BACKDROP_FILE:
            img = raw.convert("RGB")
            height = round(BACKDROP_PX * img.height / img.width)
            portrait = img.resize((BACKDROP_PX, height), Image.LANCZOS)
        else:
            img = raw.convert("RGBA")
            portrait = trim_to_content(img).resize((PORTRAIT_PX, PORTRAIT_PX), Image.LANCZOS)

    out = os.path.join(base, "portrait.webp")
    portrait.save(out, "WEBP", quality=QUALITY, method=METHOD)
    return out


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]

    if not os.path.exists(MANIFEST):
        sys.exit(f"error: no manifest at {MANIFEST}")
    with open(MANIFEST, encoding="utf-8") as f:
        mf = json.load(f)

    # (selectors, path parts, source filename). A species set is per tier; an
    # entity is one figure; a biome is one backdrop.
    targets: list[tuple[tuple[str, ...], tuple[str, ...], str]] = []
    for species in mf["species"]:
        sid = species["id"]
        for tier in mf["tiers"]:
            targets.append(((sid, f"{sid}/{tier}"), ("characters", sid, tier), FIGURE_FILE))
    for entity in mf["entities"]:
        eid = entity["id"]
        targets.append(((eid,), ("entities", eid), FIGURE_FILE))
    for biome in mf["biomes"]:
        bid = biome if isinstance(biome, str) else biome["id"]
        targets.append(((bid,), ("biomes", bid), BACKDROP_FILE))

    written = 0
    skipped = 0
    saved = 0
    for selectors, parts, filename in targets:
        if args and not any(a in selectors for a in args):
            continue
        out = derive(parts, filename)
        if out is None:
            skipped += 1
            continue
        written += 1
        size = os.path.getsize(out)
        saved += os.path.getsize(os.path.join(os.path.dirname(out), filename)) - size
        print(f"  {os.path.relpath(out, ROOT)}  ({size / 1024:.0f} KB)")

    print(f"\n{written} portrait(s) written"
          f"{f', {skipped} set(s) not yet delivered' if skipped else ''}")
    if written:
        print(f"{saved / 1024 / 1024:.1f} MB smaller than the sources they stand in for")
    return 0


if __name__ == "__main__":
    sys.exit(main())
