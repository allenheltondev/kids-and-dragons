#!/usr/bin/env python3
"""Build the Duskrunner Mythic Kitsune exact-pose class-rig art package."""

from __future__ import annotations

import package_duskrunner_sworn_kitsune_rig as builder


builder.SOURCE = builder.ROOT / "art/source/mattes/duskrunner_mythic_kitsune_gear.png"
builder.SOURCE_MATTE = builder.SOURCE
builder.BASE = builder.ROOT / "assets/characters/kitsune/mythic"
builder.OUT = builder.ROOT / "assets/character-rigs/duskrunner/mythic/kitsune"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / "art/review/duskrunner_mythic_kitsune_rig_split.png"
builder.REVIEW_TITLE = "Duskrunner Mythic Kitsune - rig split"
builder.REVIEW_NOTE = (
    "Approved exact pose   -   hood and upper cowl follow the head   -   "
    "long cloak follows the body while all three tails remain clear"
)
builder.REGISTERED_SIZE = (1039, 1069)
builder.REGISTERED_OFFSET = (51, -57)
builder.GEAR_ENVELOPE = (60, 40, 900, 870)
builder.GEAR_BEHIND_ENVELOPE = (60, 650, 900, 870)
builder.GEAR_BEHIND_SUBJECT_MAX_GREEN = 120
builder.GEAR_BEHIND_ONLY_DARK = False
builder.GEAR_BEHIND_EXCLUDE_CYAN = False
builder.SUBJECT_RESIDUAL_THRESHOLD = 15
builder.BACKGROUND_KEY_COLOR = (45, 40, 55)
builder.BACKGROUND_KEY_INNER_DISTANCE = 4
builder.BACKGROUND_KEY_OUTER_DISTANCE = 10
builder.BACKGROUND_KEY_SOLID_SUBJECT = False
builder.BACKGROUND_KEY_CLOSE_SIZE = 3
builder.BACKGROUND_KEY_BLUR_RADIUS = 0.65
builder.SUBJECT_ALLOWED_DILATION = 0
builder.SUBJECT_OVERHANG_ENVELOPE = (120, 430, 900, 850)
builder.SUBJECT_OVERHANG_DILATION = 12
builder.SUBJECT_FREE_OVERHANG_ENVELOPE = (120, 430, 930, 850)
builder.SUBJECT_FREE_OVERHANG_MAX_GREEN = 120
builder.SUBJECT_HOLE_FILL_ENVELOPE = (120, 360, 930, 850)
builder.SUBJECT_CLIP_ENVELOPE = (60, 40, 500, 600)
builder.BASE_RESTORE_ENVELOPES = (
    (470, 0, 1024, 1024),
)
builder.BASE_RESTORE_KEEP_DARK_ENVELOPE = (100, 350, 900, 850)
builder.BASE_EXACT_RESTORE_POLYGONS = (
    ((150, 680), (300, 650), (310, 930), (145, 930)),
    ((260, 680), (420, 650), (430, 940), (250, 940)),
    ((385, 660), (550, 630), (565, 900), (375, 900)),
    ((520, 650), (700, 610), (715, 920), (510, 920)),
    ((690, 625), (730, 625), (730, 770), (688, 770)),
)
builder.BASE_EXACT_RESTORE_FEATHER = 4
builder.HEAD_GEAR_ENVELOPE = (60, 40, 500, 600)
builder.GEAR_VISIBLE_BODY_OVERLAP_ENVELOPE = (498, 498, 510, 510)
builder.GEAR_BEHIND_BODY_OVERLAP_ENVELOPE = (594, 544, 606, 556)
builder.PART_ALPHA_ERASE_ENVELOPES = (
    ("tail", (60, 40, 470, 580)),
)
builder.PART_ALPHA_ERASE_NON_CYAN_POLYGONS = (
    (
        "tail",
        (
            (430, 365),
            (615, 390),
            (775, 485),
            (930, 620),
            (985, 820),
            (710, 860),
            (560, 730),
            (485, 610),
        ),
    ),
)


if __name__ == "__main__":
    builder.main()
