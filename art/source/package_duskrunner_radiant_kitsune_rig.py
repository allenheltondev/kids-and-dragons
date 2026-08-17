#!/usr/bin/env python3
"""Build the Duskrunner Radiant Kitsune exact-pose class-rig art package."""

from __future__ import annotations

import package_duskrunner_sworn_kitsune_rig as builder


builder.SOURCE = builder.ROOT / "assets/gear-portraits/duskrunner/radiant/kitsune.png"
builder.SOURCE_MATTE = builder.ROOT / "art/source/mattes/duskrunner_radiant_kitsune.png"
builder.BASE = builder.ROOT / "assets/characters/kitsune/radiant"
builder.OUT = builder.ROOT / "assets/character-rigs/duskrunner/radiant/kitsune"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / "art/review/duskrunner_radiant_kitsune_rig_split.png"
builder.REVIEW_TITLE = "Duskrunner Radiant Kitsune - rig split"
builder.REVIEW_NOTE = (
    "Approved exact pose   -   hood and cowl follow the head and chest   -   "
    "three tails remain clear"
)
builder.REGISTERED_SIZE = (1039, 1069)
builder.REGISTERED_OFFSET = (51, -57)
builder.GEAR_ENVELOPE = (60, 40, 690, 650)
builder.GEAR_BEHIND_ENVELOPE = (60, 650, 690, 800)
builder.GEAR_BEHIND_SUBJECT_MAX_GREEN = 120
builder.SUBJECT_RESIDUAL_THRESHOLD = 15
builder.SUBJECT_ALLOWED_DILATION = 0
builder.SUBJECT_OVERHANG_ENVELOPE = (120, 430, 680, 700)
builder.SUBJECT_OVERHANG_DILATION = 12
builder.SUBJECT_FREE_OVERHANG_ENVELOPE = (120, 430, 700, 700)
builder.SUBJECT_FREE_OVERHANG_MAX_GREEN = 120
builder.SUBJECT_HOLE_FILL_ENVELOPE = (120, 360, 700, 780)
builder.SUBJECT_CLIP_ENVELOPE = (60, 40, 500, 600)
builder.BASE_RESTORE_ENVELOPES = (
    (470, 0, 1024, 1024),
)
builder.BASE_RESTORE_KEEP_DARK_ENVELOPE = (100, 350, 720, 760)
builder.BASE_EXACT_RESTORE_POLYGONS = (
    ((150, 680), (300, 650), (310, 930), (145, 930)),
    ((260, 680), (420, 650), (430, 940), (250, 940)),
    ((385, 660), (550, 630), (565, 900), (375, 900)),
    ((520, 650), (700, 610), (715, 920), (510, 920)),
    ((690, 625), (730, 625), (730, 770), (688, 770)),
)
builder.BASE_EXACT_RESTORE_FEATHER = 4
builder.HEAD_GEAR_ENVELOPE = (60, 40, 500, 600)
builder.PART_ALPHA_ERASE_ENVELOPES = (
    ("tail", (60, 40, 470, 580)),
)


if __name__ == "__main__":
    builder.main()
