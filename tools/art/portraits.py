#!/usr/bin/env python3
"""
Kids & Dragons - portrait derivation.

The commissioned figures are 1024x1024 PNGs with a registered origin
(assets/manifest.json), and that is the right shape for the *stage*: the Pixi
renderer needs the alpha, the resolution, and the feet at (512, 900). It is the
wrong shape for a *card*. Character creation shows all six species at once on a
phone; at ~700KB each that is 4MB of PNG to answer "who do you want to be?".

So this derives one small, trimmed, transparent WebP per delivered set:

    assets/characters/<species>/<tier>/portrait.webp

Trimmed to the figure's own bounding box, padded back to a square, and resized
to PORTRAIT_PX. The registration origin is deliberately *dropped* — a portrait
is never composited against anything, it is an <img> in a card, and keeping the
canvas padding would waste half the pixels on transparency.

These are derived files, committed like any other asset so a checkout can render
the app without a Python toolchain. Re-run after new art lands:

    npm run art:portraits            # every delivered set
    npm run art:portraits unicorn    # one species
    npm run art:portraits unicorn/sworn

Nothing in the app *requires* them: every portrait falls back to the assembled
PNG in the client (screens/CreatureImage.tsx), so a missing or stale portrait is
a slower card, never a broken one. verify.py does not read them — they are
derived from art that already passed the gate.

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

# 384px covers the largest place a portrait renders (the creation preview on a
# TV, at roughly a third of the pane) without ever being the reason a phone
# waits. Above this the file size climbs faster than anybody can see.
PORTRAIT_PX = 384
# A hair of breathing room so a horn or a wingtip never touches the frame.
MARGIN = 0.04
# Lossy WebP: these are decoration over a dark surface, and the alpha channel
# survives lossy encoding fine at this quality.
QUALITY = 82


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


def derive(species: str, tier: str) -> str | None:
    base = os.path.join(ROOT, "assets", "characters", species, tier)
    source = os.path.join(base, "assembled.png")
    if not os.path.exists(source):
        return None

    with Image.open(source) as raw:
        img = raw.convert("RGBA")

    portrait = trim_to_content(img).resize((PORTRAIT_PX, PORTRAIT_PX), Image.LANCZOS)
    out = os.path.join(base, "portrait.webp")
    portrait.save(out, "WEBP", quality=QUALITY, method=6)
    return out


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]

    if not os.path.exists(MANIFEST):
        sys.exit(f"error: no manifest at {MANIFEST}")
    with open(MANIFEST, encoding="utf-8") as f:
        mf = json.load(f)

    written = 0
    skipped = 0
    for species in mf["species"]:
        sid = species["id"]
        for tier in mf["tiers"]:
            if args and not any(a == sid or a == f"{sid}/{tier}" for a in args):
                continue
            out = derive(sid, tier)
            if out is None:
                skipped += 1
                continue
            written += 1
            size_kb = os.path.getsize(out) / 1024
            print(f"  {os.path.relpath(out, ROOT)}  ({size_kb:.0f} KB)")

    print(f"\n{written} portrait(s) written"
          f"{f', {skipped} set(s) not yet delivered' if skipped else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
