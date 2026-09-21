#!/usr/bin/env python3
"""Build the Starweaver Sworn Bigfoot exact-pose class-rig package."""

from pathlib import Path

import package_duskrunner_sworn_bigfoot_rig as builder


ROOT = Path(__file__).resolve().parents[2]

builder.SOURCE = ROOT / "assets/gear-portraits/starweaver/sworn/bigfoot.png"
builder.BASE = ROOT / "assets/characters/bigfoot/sworn"
builder.OUT = ROOT / "assets/character-rigs/starweaver/sworn/bigfoot"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = ROOT / "art/review/starweaver_sworn_bigfoot_rig_split.png"
builder.REVIEW_TITLE = "Starweaver Sworn Bigfoot - rig split"
builder.REVIEW_NOTE = (
    "Exact-pose registration   -   astral mantle follows the torso   -   "
    "mane remains above the garment"
)
builder.GEAR_ENVELOPE = (270, 260, 770, 760)
builder.REGISTERED_SIZE = (1022, 1010)
builder.REGISTERED_OFFSET = (13, 21)
builder.KEEP_BODY_RESIDUAL = True
builder.DETACHED_PART_ENVELOPES = (
    ("focus_stone", (670, 120, 790, 290)),
)
builder.DETACHED_PART_OFFSETS = {"focus_stone": (0, -55)}
builder.Z_ORDER = (*builder.Z_ORDER, "focus_stone")


if __name__ == "__main__":
    builder.main()
