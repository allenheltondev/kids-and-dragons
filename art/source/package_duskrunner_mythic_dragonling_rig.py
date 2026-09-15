#!/usr/bin/env python3
"""Build the Duskrunner Mythic Dragonling exact-pose class-rig art package."""

from __future__ import annotations

import package_duskrunner_sworn_dragonling_rig as builder


builder.SOURCE = builder.ROOT / "assets/gear-portraits/duskrunner/mythic/dragonling.png"
builder.GEAR_OVERLAY_SOURCE = (
    builder.ROOT / "art/source/mattes/duskrunner_mythic_dragonling_gear.png"
)
builder.GEAR_BEHIND_BODY_REGIONS = ((550, 638, 620, 706),)
builder.BASE = builder.ROOT / "assets/characters/dragonling/mythic"
builder.OUT = builder.ROOT / "assets/character-rigs/duskrunner/mythic/dragonling"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / "art/review/duskrunner_mythic_dragonling_rig_split.png"
builder.REVIEW_TITLE = "Duskrunner Mythic Dragonling - rig split"
builder.REVIEW_NOTE = (
    "Exact-pose registration   -   fitted scarf and harness follow the body   -   "
    "wings and mane remain unobstructed"
)
builder.EDGE_ALPHA_CLIP_TOP = 8
builder.EDGE_ALPHA_CLIP_PARTS = ("mane",)
builder.Z_ORDER = (
    "wings",
    "tail",
    "leg_l",
    "leg_r",
    "body",
    "arm_l",
    "arm_r",
    "head",
    "mane",
    "gear_visible",
)


if __name__ == "__main__":
    builder.main()
