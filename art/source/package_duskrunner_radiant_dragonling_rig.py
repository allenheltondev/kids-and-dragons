#!/usr/bin/env python3
"""Build the Duskrunner Radiant Dragonling exact-pose class-rig art package."""

from __future__ import annotations

import package_duskrunner_sworn_dragonling_rig as builder


builder.SOURCE = builder.ROOT / "assets/gear-portraits/duskrunner/radiant/dragonling.png"
builder.BASE = builder.ROOT / "assets/characters/dragonling/radiant"
builder.OUT = builder.ROOT / "assets/character-rigs/duskrunner/radiant/dragonling"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / "art/review/duskrunner_radiant_dragonling_rig_split.png"
builder.REVIEW_TITLE = "Duskrunner Radiant Dragonling - rig split"
builder.REVIEW_NOTE = (
    "Approved exact pose   -   fitted scarf and harness follow the body   -   "
    "wings and mane remain unobstructed"
)
builder.EDGE_ALPHA_CLIP_TOP = 8
builder.EDGE_ALPHA_CLIP_PARTS = ("mane",)


if __name__ == "__main__":
    builder.main()
