#!/usr/bin/env python3
"""Build the Starweaver Sworn Griffin exact-pose class-rig package."""

from pathlib import Path

import package_duskrunner_sworn_griffin_rig as builder


ROOT = Path(__file__).resolve().parents[2]

builder.SOURCE = ROOT / "assets/gear-portraits/starweaver/sworn/griffin.png"
builder.BASE = ROOT / "assets/characters/griffin/sworn"
builder.OUT = ROOT / "assets/character-rigs/starweaver/sworn/griffin"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = ROOT / "art/review/starweaver_sworn_griffin_rig_split.png"
builder.REVIEW_TITLE = "Starweaver Sworn Griffin - rig split"
builder.REVIEW_NOTE = (
    "Exact-pose registration   -   astral mantle follows the torso   -   "
    "wings and head plumage remain unobstructed"
)
builder.REGISTERED_SIZE = (988, 957)
builder.REGISTERED_OFFSET = (2, -6)
builder.DETACHED_GOLD_PARTS = (("focus_stone", (650, 120, 780, 380)),)
builder.Z_ORDER = (*builder.Z_ORDER, "focus_stone")


if __name__ == "__main__":
    builder.main()
