#!/usr/bin/env python3
"""Build the Duskrunner Radiant Unicorn exact-pose class-rig art package."""

from __future__ import annotations

import package_duskrunner_sworn_unicorn_rig as builder


builder.SOURCE = builder.ROOT / "assets/gear-portraits/duskrunner/radiant/unicorn.png"
builder.BASE = builder.ROOT / "assets/characters/unicorn/radiant"
builder.OUT = builder.ROOT / "assets/character-rigs/duskrunner/radiant/unicorn"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / "art/review/duskrunner_radiant_unicorn_rig_split.png"
builder.REVIEW_TITLE = "Duskrunner Radiant Unicorn - rig split"
builder.REVIEW_NOTE = (
    "Approved exact pose   -   fitted scarf and harness follow the body   -   "
    "mane, braid, and horn remain above gear"
)
builder.GEAR_ENVELOPE = (220, 360, 700, 720)


if __name__ == "__main__":
    builder.main()
