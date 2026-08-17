#!/usr/bin/env python3
"""Build the Duskrunner Radiant Manticore exact-pose class-rig art package."""

from __future__ import annotations

import package_duskrunner_sworn_manticore_rig as builder


builder.SOURCE = builder.ROOT / "assets/gear-portraits/duskrunner/radiant/manticore.png"
builder.SOURCE_MATTE = builder.ROOT / "art/source/mattes/duskrunner_radiant_manticore.png"
builder.BASE = builder.ROOT / "assets/characters/manticore/radiant"
builder.OUT = builder.ROOT / "assets/character-rigs/duskrunner/radiant/manticore"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / "art/review/duskrunner_radiant_manticore_rig_split.png"
builder.REVIEW_TITLE = "Duskrunner Radiant Manticore - rig split"
builder.REVIEW_NOTE = (
    "Approved exact pose   -   hood and cowl follow the head and chest   -   "
    "scorpion tail remains clear"
)
builder.GEAR_ENVELOPE = (80, 70, 890, 815)
builder.SUBJECT_CLIP_ENVELOPE = (0, 0, 1024, 1024)
builder.CLIP_LOWER_BODY_TO_BASE = False


if __name__ == "__main__":
    builder.main()
