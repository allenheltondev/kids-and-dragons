#!/usr/bin/env python3
"""Build the Starweaver Sworn Kitsune exact-pose class-rig package."""

from pathlib import Path

import package_duskrunner_sworn_kitsune_rig as builder


ROOT = Path(__file__).resolve().parents[2]

builder.SOURCE = ROOT / "assets/gear-portraits/starweaver/sworn/kitsune.png"
builder.BASE = ROOT / "assets/characters/kitsune/sworn"
builder.OUT = ROOT / "assets/character-rigs/starweaver/sworn/kitsune"
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = ROOT / "art/review/starweaver_sworn_kitsune_rig_split.png"
builder.REVIEW_TITLE = "Starweaver Sworn Kitsune - rig split"
builder.REVIEW_NOTE = (
    "Exact-pose registration   -   astral mantle follows the torso   -   "
    "tails and hood remain unobstructed"
)
builder.KEEP_BODY_RESIDUAL = False
builder.CANONICAL_PARTS = builder.BASE_PARTS
builder.GEAR_ENVELOPE = (250, 430, 610, 710)
builder.STARWEAVER_MASK_ENVELOPES = ()
builder.GEAR_OVERLAY_SOURCE = (
    ROOT / "art/source/mattes/starweaver_sworn_kitsune_overlay.png"
)
builder.GEAR_OVERLAY_REGISTERED_SIZE = (800, 820)
builder.GEAR_OVERLAY_REGISTERED_OFFSET = (-10, 18)
builder.GEAR_OVERLAY_GEM_OFFSET = (-195, -25)
builder.GEAR_OVERLAY_SPLIT_Y = None
builder.MANE_FOREGROUND_ENVELOPE = (145, 330, 500, 700)
builder.GEAR_FRONT_POLYGONS = (
    ((140, 340), (500, 340), (500, 555), (440, 585), (330, 575), (250, 540), (230, 560), (150, 560), (140, 500)),
    ((180, 480), (245, 480), (270, 505), (270, 555), (245, 580), (180, 580), (155, 555), (155, 505)),
    ((155, 520), (215, 530), (240, 580), (220, 665), (140, 665), (140, 580)),
    ((205, 520), (245, 510), (435, 635), (420, 675), (245, 580)),
)
builder.GEAR_FRONT_FEATHER = 0.8
builder.GEAR_BACK_COLLAR_POLYGON = (
    (395, 365),
    (445, 390),
    (480, 420),
    (480, 465),
    (450, 455),
    (420, 430),
)
builder.GEAR_COLLAR_RIM_ENVELOPE = None
builder.GEAR_COLLAR_OUTER_POLYGON = None
builder.GEAR_COLLAR_INNER_POLYGON = None
builder.GEAR_CLASP_POLYGON = (
    (180, 485),
    (245, 485),
    (270, 510),
    (270, 560),
    (245, 585),
    (180, 585),
    (155, 560),
    (155, 510),
)
builder.MANE_TOP_POLYGON = (
    (285, 340),
    (470, 340),
    (470, 435),
    (425, 450),
    (345, 438),
    (285, 408),
)
builder.Z_ORDER = (
    *(name for name in builder.Z_ORDER if name not in ("gear_visible", "focus_stone")),
    "gear_visible",
    "mane_foreground",
    "gear_front",
    "mane_top_foreground",
    "gear_back_collar",
    "neck_foreground",
    "gear_clasp",
    "focus_stone",
)


if __name__ == "__main__":
    builder.main()
