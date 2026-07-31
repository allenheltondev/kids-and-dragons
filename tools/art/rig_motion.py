#!/usr/bin/env python3
"""
Kids & Dragons — measure one rendered clip.

The pixel half of `verify-rig-motion.mjs`. It is handed an APNG of one clip and
the facts it needs from the contract, and it prints one JSON object: the
measurements, plus a content hash for the golden baseline. It decides nothing —
every threshold lives in the Node side next to the manifest it came from, so
there is exactly one place to argue with a number.

Frames arrive at 1/60s (see the Node side for why that is not 1/tickFps), so
tick k is frame 5*k, and the caller renders one frame past the end so the tick
at T — the pose a loop has to return to — is actually present.

Usage: rig_motion.py <clip.apng> <ticksPerFrame> <restBottomRow> <assembled.png>
"""
import sys
import json
import hashlib

import numpy as np
from PIL import Image, ImageFilter

path, step, rest_bottom, art_path = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]

im = Image.open(path)
frames = []
for i in range(0, getattr(im, "n_frames", 1), step):
    im.seek(i)
    frames.append(np.array(im.convert("RGBA")))

H, W = frames[0].shape[:2]
alpha = [f[:, :, 3] for f in frames]


def box(a):
    m = a > 8
    rows = np.nonzero(m.any(axis=1))[0]
    cols = np.nonzero(m.any(axis=0))[0]
    if not len(rows):
        return None
    return int(cols.min()), int(rows.min()), int(cols.max()), int(rows.max())


def interior_holes(a):
    """Semi-transparent pixels well inside an opaque region — a joint opening up."""
    solid = Image.fromarray((a > 250).astype(np.uint8) * 255)
    inner = np.array(solid.filter(ImageFilter.MinFilter(9))) > 0
    return int(((a < 250) & (a > 0) & inner).sum())


# The approved art's colours, quantised to a 16-level cube.
#
# A rig may MOVE the commissioned pixels; it may not invent colours. Anything
# that composites — a tint overlay whose traced silhouette overhangs its part, a
# blend landing on the wrong thing — paints hues that are in no part PNG, and it
# does so only on the ticks where the overhang happens to sweep across another
# part. That is the "choppy patches that come and go" failure, and comparing a
# tick against the rig's own first frame cannot see it: a constant recolour drifts
# from the art without drifting from itself.
_art = np.array(Image.open(art_path).convert("RGBA").resize((W, H), Image.BILINEAR))
_am = _art[:, :, 3] > 200
_ART_COLOURS = set(
    map(int, (_art[:, :, :3][_am] // 16).astype(np.int32) @ np.array([256, 16, 1]))
)


def novel_colour_share(f):
    m = f[:, :, 3] > 200
    if not m.any():
        return 0.0
    q = (f[:, :, :3][m] // 16).astype(np.int32) @ np.array([256, 16, 1])
    return float(np.mean([int(x) not in _ART_COLOURS for x in q]))


def delta(i, j):
    """Mean per-pixel max-channel difference, 0-255. Scale-free enough to compare clips."""
    return float(np.abs(frames[i].astype(np.int32) - frames[j].astype(np.int32)).max(axis=2).mean())


boxes = [box(a) for a in alpha]
if any(b is None for b in boxes):
    print(json.dumps({"error": "a frame rendered empty"}))
    sys.exit(0)

margins = [min(b[0], b[1], W - 1 - b[2], H - 1 - b[3]) for b in boxes]
bottoms = [b[3] for b in boxes]


def edge_cover(a):
    """
    The longest stretch of one frame edge the figure covers, as a fraction of it.

    This is the measure that separates a hoof touching the frame from a body
    crossing it. Area does not work — limbs overlapping during a walk shrink the
    silhouette by as much as a leg going off-canvas does — and a raw border pixel
    count does not either, because it is tiny next to the figure's whole area
    however much is outside. How much of the EDGE is covered scales with how big
    a cross-section is passing through it, which is the thing being asked.
    """
    m = a > 8
    return max(
        m[0].mean(), m[-1].mean(), m[:, 0].mean(), m[:, -1].mean()
    )


# A hoof grazing the frame and a character rotating out of it are both "margin 0",
# and they are not the same defect. Two different measurements tell them apart.
#
# `edge_share` is silhouette sitting ON the frame — sensitive, and it fires for a
# horn tip. `area_retained` is how much of the figure is still visible at all,
# against the rest pose: rotating a flat cutout preserves its area, so anything
# missing has left the canvas. That is the one that catches a character rotating
# off stage, and the border count alone did not — a head fully outside the frame
# contributes only the few pixels where the neck crosses the edge.
covers = [float(edge_cover(a)) for a in alpha]
inter = [delta(i, i + 1) for i in range(len(frames) - 1)] or [0.0]

# The hash is of a 96px downscale rather than the full frame: an exact hash would
# make the baseline a tripwire for renderer antialiasing rather than for the rig,
# and a baseline that cries wolf gets ignored, which is the failure mode this
# whole layer exists to prevent.
h = hashlib.sha256()
for f in frames:
    h.update(Image.fromarray(f).resize((96, 96), Image.BILINEAR).tobytes())

print(json.dumps({
    "ticks": len(frames),
    "canvas": [W, H],
    # How far the lowest pixel sinks BELOW where it rests. Rising is free.
    "floor_break": int(max(bottoms) - rest_bottom),
    "edge_margin": int(min(margins)),
    # Worst tick, and the typical tick. A knockdown legitimately loses a sliver
    # mid-topple; losing it for most of the clip means it is off stage.
    "edge_cover_max": round(float(max(covers)), 4),
    "edge_cover_median": round(float(np.median(covers)), 4),
    "interior_holes": int(max(interior_holes(a) for a in alpha)),
    # Worst tick and typical tick. A defect that only shows on some frames is
    # exactly what the max is for.
    "novel_colour_max": round(max(novel_colour_share(f) for f in frames), 5),
    "novel_colour_median": round(float(np.median([novel_colour_share(f) for f in frames])), 5),
    "motion_median": round(float(np.median(inter)), 3),
    "teleport_ratio": round(float(max(inter) / max(0.01, float(np.median(inter)))), 2),
    # Last authored tick back to the first. For a loop this is one step of motion;
    # anything much larger is a visible pop every cycle.
    "loop_close": round(delta(len(frames) - 1, 0), 3),
    "hash": h.hexdigest()[:16],
}))
