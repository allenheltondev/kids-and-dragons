#!/usr/bin/env python3
"""Build the Duskrunner Mythic Bigfoot exact-pose class-rig art package."""

from __future__ import annotations

import package_duskrunner_sworn_bigfoot_rig as builder


builder.SOURCE = builder.ROOT / "assets/gear-portraits/duskrunner/mythic/bigfoot.png"
builder.GEAR_OVERLAY_SOURCE = (
    builder.ROOT / "art/source/mattes/duskrunner_mythic_bigfoot_gear.png"
)
builder.BASE = builder.ROOT / "assets/characters/bigfoot/mythic"
builder.OUT = builder.ROOT / "assets/character-rigs/duskrunner/mythic/bigfoot"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / "art/review/duskrunner_mythic_bigfoot_rig_split.png"
builder.REVIEW_TITLE = "Duskrunner Mythic Bigfoot - rig split"
builder.REVIEW_NOTE = (
    "Exact-pose registration   -   final-form harness follows the torso   -   "
    "mane remains above the garment"
)
builder.REGISTERED_SIZE = (964, 918)
builder.REGISTERED_OFFSET = (10, 59)
builder.SUBJECT_CLOSE_SIZE = 9
builder.SUBJECT_CLIP_ENVELOPE = None
builder.MANE_GEAR_REVEAL_REGIONS = ((370, 470, 640, 670),)
builder.GEAR_VISIBLE_POLYGON = (
    (345, 535),
    (390, 500),
    (430, 505),
    (465, 525),
    (505, 495),
    (545, 475),
    (590, 490),
    (640, 520),
    (650, 680),
    (340, 680),
)
builder.Z_ORDER = (
    "leg_l",
    "leg_r",
    "body",
    "gear_visible",
    "arm_l",
    "arm_r",
    "head",
    "mane",
)


if __name__ == "__main__":
    builder.main()
