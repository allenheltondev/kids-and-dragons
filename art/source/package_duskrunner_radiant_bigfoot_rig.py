#!/usr/bin/env python3
"""Build the Duskrunner Radiant Bigfoot exact-pose class-rig art package."""

from __future__ import annotations

import package_duskrunner_sworn_bigfoot_rig as builder


builder.SOURCE = builder.ROOT / "assets/gear-portraits/duskrunner/radiant/bigfoot.png"
builder.BASE = builder.ROOT / "assets/characters/bigfoot/radiant"
builder.OUT = builder.ROOT / "assets/character-rigs/duskrunner/radiant/bigfoot"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / "art/review/duskrunner_radiant_bigfoot_rig_split.png"
builder.REVIEW_TITLE = "Duskrunner Radiant Bigfoot - rig split"
builder.REVIEW_NOTE = (
    "Approved exact pose   -   fitted harness follows the torso   -   "
    "mane remains above the garment"
)
builder.REGISTERED_SIZE = (964, 918)
builder.REGISTERED_OFFSET = (10, 59)
builder.SUBJECT_CLOSE_SIZE = 9
builder.SUBJECT_CLIP_ENVELOPE = (0, 0, 1024, 1024)


if __name__ == "__main__":
    builder.main()
