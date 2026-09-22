#!/usr/bin/env python3
"""Build the Starweaver Sworn Dragonling exact-pose class-rig package."""

from pathlib import Path

import package_duskrunner_sworn_dragonling_rig as builder


ROOT = Path(__file__).resolve().parents[2]

builder.SOURCE = ROOT / "assets/gear-portraits/starweaver/sworn/dragonling.png"
builder.BASE = ROOT / "assets/characters/dragonling/sworn"
builder.OUT = ROOT / "assets/character-rigs/starweaver/sworn/dragonling"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = ROOT / "art/review/starweaver_sworn_dragonling_rig_split.png"
builder.REVIEW_TITLE = "Starweaver Sworn Dragonling - rig split"
builder.REVIEW_NOTE = (
    "Exact-pose registration   -   astral mantle follows the torso   -   "
    "wings and mane remain unobstructed"
)
# Only the mantle belongs to the torso overlay.  The surrounding anatomy is
# supplied by canonical rig parts, so a broad portrait residual would carry
# chroma-edge fragments into the wing, mane, and limb layers.
builder.GEAR_ENVELOPE = (180, 430, 520, 710)
builder.REGISTERED_SIZE = (1056, 1038)
builder.REGISTERED_OFFSET = (-69, -41)
builder.KEEP_BODY_RESIDUAL = False
builder.RESTORE_NAVY_ANATOMY = True
builder.CANONICAL_PARTS = builder.BASE_PARTS
builder.EXTRACT_TEAL_GEAR = True
builder.GEAR_OVERLAY_POLYGON = (
    (185, 430), (385, 425), (420, 455), (445, 490), (480, 535),
    (465, 570), (365, 615), (325, 675), (245, 650), (180, 580),
)
builder.GEAR_OVERLAY_ERASE_ENVELOPES = ((185, 425, 390, 458),)
builder.DETACHED_PART_ENVELOPES = (
    ("focus_stone", (430, 50, 600, 250)),
)
builder.COLOR_TRIM_DETACHED_PARTS = ("focus_stone",)
builder.Z_ORDER = (*builder.Z_ORDER, "focus_stone")


if __name__ == "__main__":
    builder.main()
