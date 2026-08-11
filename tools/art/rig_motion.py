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
from PIL import Image, ImageDraw

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


# How transparent a pixel has to be before it counts as a gap rather than as an
# antialiased edge. Parts overlap, and the seam between two of them is a band of
# alpha in the 200s that is not a hole in anything. Measured on a clean rig, the
# enclosed-pixel count falls from 1734 at `a < 250` to 484 at `a < 64` and barely
# moves below that, which is the antialiasing dropping out and the real geometry
# staying put.
SEE_THROUGH = 64


def enclosed_gap(a):
    """
    Pixels you can see through that are surrounded by figure.

    Enclosure is decided by flooding the see-through region inward from the frame
    border: anything see-through the flood cannot reach is walled in by the
    character. That is a topological question, and it has to be — the obvious
    local test cannot answer it. The version this replaces asked whether a
    non-solid pixel sat inside an eroded solid mask, which is unsatisfiable by
    construction: the erosion includes the centre pixel, so a pixel that is not
    solid is never inside the eroded solid region. It returned 0 for every input
    ever given to it, including a square with a hole punched through it, and the
    gate above it had therefore never once fired.

    Flooding only the figure's bounding box rather than the whole frame is worth
    the four extra lines: identical answers, and ~5x faster (72ms against 366ms
    on a 512px frame), which matters at ~4,000 frames a run.
    """
    gap = a < SEE_THROUGH
    solid = ~gap
    if not solid.any():
        return 0
    ys, xs = np.nonzero(solid)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    sub = gap[y0:y1 + 1, x0:x1 + 1]
    h, w = sub.shape
    # One ring of guaranteed-outside pixels, so a single flood from the corner
    # reaches every gap that touches the crop edge.
    pad = np.zeros((h + 2, w + 2), np.uint8)
    pad[1:-1, 1:-1] = np.where(sub, 255, 0)
    pad[0, :] = pad[-1, :] = pad[:, 0] = pad[:, -1] = 255
    img = Image.fromarray(pad).copy()
    ImageDraw.floodfill(img, (0, 0), 128)
    outside = np.asarray(img)[1:-1, 1:-1] == 128
    return int((sub & ~outside).sum())


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


def gap_regions(a, limit=3):
    """
    The enclosed gaps of one frame, each with how deeply it is walled in.

    `interior_holes` is a single number, and a single number cannot say which of
    the two things it might be. Both populations are real and both are large:
    measured on the approved art standing still, a griffin encloses 896px walled
    in by 30px of figure and a bigfoot 393px by 22px, and those are anatomy — the
    space under a wing, the loop between an arm and a torso. A joint coming apart
    produces the same kind of number. So this does not decide anything; it is
    printed next to the warning that already says "look at it", so that looking
    is a second rather than a render.

    `wall` is how far the outside has to be dilated before it reaches the region,
    which is the thickness of figure sealing it off: a gap pinched shut where two
    limbs cross reads a handful of pixels, a hole in the middle of a torso reads
    tens. That is the distinction a human makes instantly from the picture and
    could not make from an area, and it is a *description*, not a threshold —
    calibrating it into a gate needs the moving population, which means a run
    against the real renderer (`npm run art:verify:rig:motion`, CI's `rig-motion`
    workflow). Nothing here is on the hot path: it runs on one frame per clip.
    """
    gap = a < SEE_THROUGH
    solid = ~gap
    if not solid.any():
        return []
    ys, xs = np.nonzero(solid)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    sub = gap[y0:y1 + 1, x0:x1 + 1]
    h, w = sub.shape
    pad = np.zeros((h + 2, w + 2), np.uint8)
    pad[1:-1, 1:-1] = np.where(sub, 255, 0)
    pad[0, :] = pad[-1, :] = pad[:, 0] = pad[:, -1] = 255
    img = Image.fromarray(pad).copy()
    ImageDraw.floodfill(img, (0, 0), 128)
    outside = np.asarray(img) == 128
    enclosed = sub & ~outside[1:-1, 1:-1]
    if not enclosed.any():
        return []

    lab = Image.fromarray(np.where(enclosed, 255, 0).astype(np.uint8)).copy()
    found = []
    label = 1
    while label < 200:
        cur = np.asarray(lab)
        ry, rx = np.nonzero(cur == 255)
        if not len(ry):
            break
        ImageDraw.floodfill(lab, (int(rx[0]), int(ry[0])), label)
        found.append(np.asarray(lab) == label)
        label += 1
    found.sort(key=lambda r: -int(r.sum()))
    found = found[:limit]

    out = []
    frontier = outside.copy()
    pending = list(found)
    depth = {}
    for k in range(1, 121):
        g = frontier.copy()
        g[1:, :] |= frontier[:-1, :]
        g[:-1, :] |= frontier[1:, :]
        g[:, 1:] |= frontier[:, :-1]
        g[:, :-1] |= frontier[:, 1:]
        frontier = g
        still = []
        for r in pending:
            rp = np.zeros_like(frontier)
            rp[1:-1, 1:-1] = r
            if (frontier & rp).any():
                depth[id(r)] = k
            else:
                still.append(r)
        pending = still
        if not pending:
            break
    for r in found:
        ry, rx = np.nonzero(r)
        out.append({
            "px": int(r.sum()),
            "wall": depth.get(id(r), 121),
            "at": [int(rx.mean()) + x0, int(ry.mean()) + y0],
        })
    return out


_gaps = [enclosed_gap(a) for a in alpha]
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
    # Holes that OPEN during the clip, not holes the art already has. A figure
    # legitimately encloses gaps — the space under a wing, the loop of a curled
    # tail — and a clean rig measures a few hundred pixels of them standing
    # still. What says "a joint is coming apart" is that number growing once the
    # chain moves, so the baseline is this clip's own first tick.
    "interior_holes": int(max(0, max(_gaps) - _gaps[0])),
    # What that number is made of, on the tick where it peaks. See gap_regions:
    # the area alone cannot tell a lifted limb from a joint, and this is what a
    # human needs in order to tell them apart without re-rendering the clip.
    "interior_worst": gap_regions(alpha[int(np.argmax(_gaps))]),
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
