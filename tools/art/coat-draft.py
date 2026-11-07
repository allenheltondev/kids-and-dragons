#!/usr/bin/env python3
"""
Kids & Dragons - draft coat masks (docs/hero-looks.md section 4.3, step 1).

Writes a draft coat mask for every painting of a species, in all three families:

    base   assets/characters/<species>/<tier>/coat-mask.png
    class  assets/character-rigs/<class>/<tier>/<species>/coat-mask.png
    gear   assets/gear-portraits/<class>/<tier>/<species>.coat-mask.png

The region is the species' own (assets/manifest.json -> coatMasks.regions), picked out by
colour from its palette slot as the proof of concept did. A draft is a starting point, never
shipped as is: it bleeds wherever two parts share a colour. Clean it by hand, look at it on
`npm run art:sheet`, then list its painting in manifest coatMasks.paintings. Until it is listed,
`npm run art:verify` fails on it.

Usage:
    npm run art:coat-draft -- unicorn                  # every unicorn painting
    npm run art:coat-draft -- unicorn --family base    # only base | class | gear
    npm run art:coat-draft -- unicorn --tier fledgling
    npm run art:coat-draft -- unicorn --out DIR        # write under DIR/assets/... instead
    npm run art:coat-draft -- unicorn --force          # replace masks already there

An existing mask is never overwritten without --force: it may be an artist's cleaned one.

Requires: Pillow, numpy
"""

from __future__ import annotations

import argparse
import json
import os
import sys

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit("error: needs Pillow and numpy  ->  pip install pillow numpy")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coat  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="art:coat-draft", description="Draft coat masks for one species.")
    ap.add_argument("species")
    ap.add_argument("--family", choices=coat.FAMILIES)
    ap.add_argument("--tier")
    ap.add_argument("--out", help="write under OUT/assets/... instead of the repository's assets/")
    ap.add_argument("--root", default=coat.ROOT, help=argparse.SUPPRESS)  # where paintings and the manifest are read
    ap.add_argument("--force", action="store_true", help="replace masks that already exist")
    args = ap.parse_args(argv)

    with open(os.path.join(args.root, "assets", "manifest.json"), encoding="utf-8") as f:
        mf = json.load(f)
    regions = mf["coatMasks"]["regions"]
    if args.species not in regions:
        print(f"unknown species {args.species!r}; known: {', '.join(regions)}", file=sys.stderr)
        return 2
    region = regions[args.species]
    seed = coat.palette_of(mf, args.species)[region["draftFrom"]]
    out_root = args.out or args.root

    print(f"{args.species}: drafting the {region['region']} from palette {region['draftFrom']} {seed}"
          + ("" if region.get("confirmed") else "  (region not yet confirmed: hero-looks.md section 4.2)"))

    wrote = skipped = missing = 0
    for p in coat.paintings(mf, args.species):
        if args.family and p.family != args.family:
            continue
        if args.tier and p.tier != args.tier:
            continue
        src = coat.asset(p.painting, args.root)
        dst = coat.asset(p.mask, out_root)
        if not os.path.isfile(src):
            missing += 1
            continue
        if os.path.exists(dst) and not args.force:
            print(f"  keep  {p.mask} (exists; --force to replace)")
            skipped += 1
            continue
        rgba = np.asarray(Image.open(src).convert("RGBA"))
        mask = coat.draft_mask(rgba, seed)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        Image.fromarray(mask, "L").save(dst)
        print(f"  draft {p.mask}  {mask.mean() / 255:.1%} of the canvas")
        wrote += 1

    print(f"\n{wrote} draft(s) written, {skipped} kept, {missing} painting(s) not delivered.")
    if wrote:
        print("Drafts are never shipped as is: clean each by hand, review `npm run art:sheet`, then list its\n"
              "painting in assets/manifest.json -> coatMasks.paintings. art:verify fails on an unlisted mask.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
