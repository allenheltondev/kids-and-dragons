#!/usr/bin/env python3
"""Build the Duskrunner Mythic Unicorn exact-pose class-rig art package."""

from __future__ import annotations

import package_duskrunner_sworn_unicorn_rig as builder


builder.SOURCE = builder.ROOT / "assets/gear-portraits/duskrunner/mythic/unicorn.png"
builder.BASE = builder.ROOT / "assets/characters/unicorn/mythic"
builder.OUT = builder.ROOT / "assets/character-rigs/duskrunner/mythic/unicorn"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / "art/review/duskrunner_mythic_unicorn_rig_split.png"
builder.REVIEW_TITLE = "Duskrunner Mythic Unicorn - rig split"
builder.REVIEW_NOTE = (
    "Exact-pose registration   -   extended Mythic armor follows the torso   -   "
    "mane, braid, and horn remain above gear"
)
builder.REGISTERED_SIZE = (1024, 1024)
builder.REGISTERED_OFFSET = (0, 0)
builder.GEAR_ENVELOPE = (220, 360, 700, 720)
builder.SUBJECT_THRESHOLD = 12


if __name__ == "__main__":
    builder.main()
