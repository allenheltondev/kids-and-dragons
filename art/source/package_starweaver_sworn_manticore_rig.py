#!/usr/bin/env python3
"""Build the Starweaver Sworn Manticore exact-pose class-rig package."""

from pathlib import Path

import package_duskrunner_sworn_manticore_rig as builder


ROOT = Path(__file__).resolve().parents[2]

builder.SOURCE = ROOT / "assets/gear-portraits/starweaver/sworn/manticore.png"
builder.SOURCE_MATTE = None
builder.BASE = ROOT / "assets/characters/manticore/sworn"
builder.OUT = ROOT / "assets/character-rigs/starweaver/sworn/manticore"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = ROOT / "art/review/starweaver_sworn_manticore_rig_split.png"
builder.REVIEW_TITLE = "Starweaver Sworn Manticore - rig split"
builder.REVIEW_NOTE = (
    "Exact-pose registration   -   astral mantle follows the chest   -   "
    "mane and scorpion tail remain above the mantle"
)
builder.REGISTERED_SIZE = (995, 1015)
builder.REGISTERED_OFFSET = (61, -24)
builder.GEAR_ENVELOPE = (120, 100, 760, 780)
builder.SUBJECT_CLIP_ENVELOPE = (120, 500, 940, 950)
builder.PORTRAIT_GREEN_RESTORE_ENVELOPES = (
    ("mane", (500, 180, 670, 410), 80, 20, -5, -20),
)
builder.PORTRAIT_GREEN_RESTORE_SOLID_ALPHA = True
builder.PORTRAIT_GREEN_RESTORE_REQUIRE_SUBJECT = False


if __name__ == "__main__":
    builder.main()
