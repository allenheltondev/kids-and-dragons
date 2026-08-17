#!/usr/bin/env python3
"""Build the Duskrunner Radiant Griffin exact-pose class-rig art package."""

from __future__ import annotations

import os

import package_duskrunner_sworn_griffin_rig as builder


builder.SOURCE = builder.ROOT / os.environ.get(
    "KAD_GRIFFIN_GEAR_SOURCE",
    "assets/gear-portraits/duskrunner/radiant/griffin.png",
)
builder.BASE = builder.ROOT / "assets/characters/griffin/radiant"
builder.OUT = builder.ROOT / os.environ.get(
    "KAD_GRIFFIN_RIG_OUT",
    "assets/character-rigs/duskrunner/radiant/griffin",
)
builder.PARTS = builder.OUT / "parts"
builder.REVIEW = builder.ROOT / os.environ.get(
    "KAD_GRIFFIN_RIG_REVIEW",
    "art/review/duskrunner_radiant_griffin_rig_split.png",
)
builder.REVIEW_TITLE = "Duskrunner Radiant Griffin - rig split"
builder.REVIEW_NOTE = (
    "Approved exact pose   -   hood and scarf follow the head and body   -   "
    "wings remain unobstructed"
)
# The Radiant portrait is framed 39px left and 23px lower than its registered
# tier art. Exposed wingtip, front talon, head crest, and tail-tip landmarks
# agree on this transform; using the Sworn registration duplicates anatomy as
# residual gear.
builder.REGISTERED_SIZE = (1024, 1020)
builder.REGISTERED_OFFSET = (39, -23)
# Preserve legitimate enclosed negative spaces such as the opening between the
# front talons. The source's smooth backdrop and 5px matte close are sufficient
# here; filling every enclosed region would paint portrait background into the
# rig split.
builder.FILL_SUBJECT_HOLES = False
builder.SUBJECT_CLOSE_SIZE = 9
# With the landmark registration corrected, the edited portrait silhouette is
# authoritative across the figure. Intersecting every base part with it keeps
# seam overdraw inside the creature while preventing base wing, paw, and tail
# edges from leaking around the approved pose.
builder.SUBJECT_CLIP_ENVELOPE = (0, 0, 1024, 1024)


if __name__ == "__main__":
    builder.main()
