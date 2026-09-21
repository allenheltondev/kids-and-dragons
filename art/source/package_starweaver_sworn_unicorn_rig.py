#!/usr/bin/env python3
"""Build the Starweaver Sworn Unicorn exact-pose class-rig art package."""

from __future__ import annotations

import package_duskrunner_sworn_unicorn_rig as builder


builder.SOURCE = builder.ROOT / "assets/gear-portraits/starweaver/sworn/unicorn.png"
builder.BASE = builder.ROOT / "assets/characters/unicorn/sworn"
builder.OUT = builder.ROOT / "assets/character-rigs/starweaver/sworn/unicorn"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / "art/review/starweaver_sworn_unicorn_rig_split.png"
builder.REVIEW_TITLE = "Starweaver Sworn Unicorn - rig split"
builder.REVIEW_NOTE = (
    "Exact-pose registration   -   astral mantle follows the torso   -   "
    "mane, braid, and horn remain above gear"
)
builder.REGISTERED_SIZE = (1024, 1024)
builder.REGISTERED_OFFSET = (0, 0)
builder.GEAR_ENVELOPE = (260, 400, 620, 690)
builder.GEAR_VISIBLE_KEEP_ENVELOPE = (250, 390, 650, 720)
builder.DETACHED_PART_ENVELOPES = (
    ("focus_stone", (520, 150, 660, 310)),
)
builder.BASE_PARTS_BELOW_Y = ()
# Permit the fitted hem and hoof fringe without extending below the canonical
# 900px standing line used by every hero rig.
builder.LOWER_BODY_BASE_DILATION = 21
builder.LOWER_BODY_REJECT_NAVY = True
builder.SUBJECT_THRESHOLD = 9
builder.Z_ORDER = (*builder.Z_ORDER, "focus_stone")


if __name__ == "__main__":
    builder.main()
