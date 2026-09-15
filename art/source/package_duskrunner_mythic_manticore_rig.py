#!/usr/bin/env python3
"""Build the Duskrunner Mythic Manticore exact-pose class-rig art package."""

from __future__ import annotations

import package_duskrunner_sworn_manticore_rig as builder


builder.SOURCE = builder.ROOT / "assets/gear-portraits/duskrunner/mythic/manticore.png"
builder.BASE = builder.ROOT / "assets/characters/manticore/mythic"
builder.OUT = builder.ROOT / "assets/character-rigs/duskrunner/mythic/manticore"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / "art/review/duskrunner_mythic_manticore_rig_split.png"
builder.REVIEW_TITLE = "Duskrunner Mythic Manticore - rig split"
builder.REVIEW_NOTE = (
    "Approved exact pose   -   hood and cowl follow the head and chest   -   "
    "long cloak stays clear of the scorpion tail"
)
builder.GEAR_ENVELOPE = (80, 70, 930, 875)
builder.SUBJECT_CLIP_ENVELOPE = (0, 0, 1024, 1024)
builder.SUBJECT_HOLE_FILL_ENVELOPE = (300, 350, 930, 800)
builder.GEAR_VISIBLE_ERASE_ENVELOPES = (
    (600, 40, 1024, 455),
)
builder.PORTRAIT_GREEN_RESTORE_ENVELOPES = (
    ("tail", (560, 20, 1024, 455), 60, 8),
)
builder.CLIP_LOWER_BODY_TO_BASE = False


if __name__ == "__main__":
    builder.main()
