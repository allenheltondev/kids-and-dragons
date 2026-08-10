#!/usr/bin/env python3
"""Build the softer-bodied Echo Hunter v3 approval candidate."""

from __future__ import annotations

import build_echo_hunter_candidate as base


base.SOURCE_DIR = base.ROOT / "art" / "source" / "echo_hunter_rig_candidate_v3"
base.PARTS_DIR = base.SOURCE_DIR / "parts"
base.REVIEW_PATH = base.ROOT / "art" / "review" / "echo_hunter_rig_candidate_v3.png"
base.VERSION_LABEL = "v3"


if __name__ == "__main__":
    base.main()
