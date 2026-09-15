#!/usr/bin/env python3
"""Build the Duskrunner Mythic Griffin exact-pose class-rig art package."""

from __future__ import annotations

import package_duskrunner_sworn_griffin_rig as builder


builder.SOURCE = builder.ROOT / "assets/gear-portraits/duskrunner/mythic/griffin.png"
builder.GEAR_OVERLAY_SOURCE = (
    builder.ROOT / "art/source/mattes/duskrunner_mythic_griffin_gear.png"
)
builder.GEAR_OVERLAY_ERASE_SOURCE = (
    builder.ROOT / "art/source/mattes/duskrunner_mythic_griffin_hood_crown_cutout.png"
)
builder.GEAR_BEHIND_HEAD_SOURCE = (
    builder.ROOT / "art/source/mattes/duskrunner_mythic_griffin_hood_lining.png"
)
# The hood lining belongs behind the complete head silhouette.  The visible
# hood rim already masks the crest where it crosses the opening, so clipping
# the mane against the lining creates holes through the face/crest layers.
builder.GEAR_BEHIND_HEAD_CLIP_PARTS = ()
builder.GEAR_BEHIND_HEAD_ERASES_OVERLAY = False
builder.BASE = builder.ROOT / "assets/characters/griffin/mythic"
builder.OUT = builder.ROOT / "assets/character-rigs/duskrunner/mythic/griffin"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / "art/review/duskrunner_mythic_griffin_rig_split.png"
builder.REVIEW_TITLE = "Duskrunner Mythic Griffin - rig split"
builder.REVIEW_NOTE = (
    "Exact-pose registration   -   final-form hood and cloak follow the body   -   "
    "wings remain unobstructed"
)
builder.REGISTERED_SIZE = (970, 970)
builder.REGISTERED_OFFSET = (50, 20)
builder.FILL_SUBJECT_HOLES = False
builder.SUBJECT_CLOSE_SIZE = 9
builder.SUBJECT_CLIP_ENVELOPE = None
builder.HEAD_FOREGROUND_POLYGON = (
    (235, 185),
    (415, 195),
    (455, 300),
    (430, 425),
    (350, 480),
    (215, 465),
    (175, 410),
    (185, 330),
)
builder.HEAD_FOREGROUND_GOLD_KEEP_ENVELOPE = (190, 350, 330, 440)
builder.Z_ORDER = (
    "wings",
    "gear_behind_head",
    "tail",
    "leg_l",
    "leg_r",
    "body",
    "arm_l",
    "arm_r",
    "head",
    "mane",
    "head_foreground",
    "gear_visible",
)


if __name__ == "__main__":
    builder.main()
