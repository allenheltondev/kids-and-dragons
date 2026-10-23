#!/usr/bin/env python3
"""
Kids & Dragons - story plate preview.

verify.py checks a plate's size and opacity; this is what a reviewer needs to judge the
composition, which no script can. A plate is one 16:9 painting shown two ways
(packages/client/src/screens/StoryPlates.tsx, docs/story-plates.md "Safe area"):

  TV     the whole painting, with the narration printed over its lower band
  phone  a 3:4 pane (Travel Mode's top pane) covering the painting, centred, so
         only the middle ~42% of the width survives

Each preview puts both side by side, the caption band shaded and the surviving
middle outlined. The subject must live where both views agree.

Usage:
    python tools/art/plate-preview.py                  # every delivered plate
    python tools/art/plate-preview.py riftlight        # one campaign
    python tools/art/plate-preview.py riftlight/finale # one plate

Writes to art/review/plates/. Plates that have not been delivered are skipped.

Requires: Pillow
"""

from __future__ import annotations

import json
import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("error: needs Pillow  ->  pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "assets", "manifest.json")
OUT = os.path.join(ROOT, "art", "review", "plates")

CAPTION_BAND = 0.28  # the lower share of the height the narration is printed over
PANE_ASPECT = 390 / 520  # a phone's world pane, width over height
FOCUS_Y = 0.45  # StoryPlates.css object-position
SCALE = 0.5


def preview(path: str, label: str) -> Image.Image:
    with Image.open(path) as source:
        im = source.convert("RGB")
    w, h = im.size

    tv = im.resize((round(w * SCALE), round(h * SCALE)), Image.LANCZOS)
    band = Image.new("RGB", (tv.width, round(tv.height * CAPTION_BAND)), (8, 6, 20))
    tv.paste(Image.blend(tv.crop((0, tv.height - band.height, tv.width, tv.height)), band, 0.8), (0, tv.height - band.height))

    pane_w = round(h * PANE_ASPECT)
    x0 = (w - pane_w) // 2
    phone = im.crop((x0, 0, x0 + pane_w, h)).resize((round(pane_w * SCALE), round(h * SCALE)), Image.LANCZOS)

    # The surviving middle, outlined on the TV view.
    draw = ImageDraw.Draw(tv)
    draw.rectangle((round(x0 * SCALE), 0, round((x0 + pane_w) * SCALE) - 1, tv.height - 1), outline=(255, 201, 92), width=2)

    gap, head = 24, 28
    sheet = Image.new("RGB", (tv.width + gap + phone.width, tv.height + head), (20, 18, 36))
    draw = ImageDraw.Draw(sheet)
    draw.text((6, 8), f"{label}   TV (caption band shaded, phone crop outlined)", fill=(244, 240, 255))
    draw.text((tv.width + gap + 6, 8), "phone pane", fill=(244, 240, 255))
    sheet.paste(tv, (0, head))
    sheet.paste(phone, (tv.width + gap, head))
    return sheet


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    with open(MANIFEST, encoding="utf-8") as f:
        ids = json.load(f).get("storyPlates", {}).get("ids", [])
    made = 0
    for plate in ids:
        name = plate.removeprefix("plates/")
        if args and not any(name == a or name.startswith(a.rstrip("/") + "/") for a in args):
            continue
        path = os.path.join(ROOT, "assets", f"{plate}.webp")
        if not os.path.isfile(path):
            continue
        os.makedirs(OUT, exist_ok=True)
        target = os.path.join(OUT, name.replace("/", "-") + ".png")
        preview(path, name).save(target)
        print(f"  wrote {os.path.relpath(target, ROOT)}")
        made += 1
    if made == 0:
        print("no delivered plates to preview")
    return 0


if __name__ == "__main__":
    sys.exit(main())
