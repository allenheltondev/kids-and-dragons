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


def enclosed(a):
    """
    Pixels you can see through that are surrounded by figure, the flood that
    decided it, and the crop the two live in.

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
    on a 512px frame), which matters at ~4,000 frames a run. The flood is handed
    back still padded because the wall-depth walk below grows outward from it and
    needs the ring; every caller that wants pixels crops it.
    """
    gap = a < SEE_THROUGH
    solid = ~gap
    if not solid.any():
        return None
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
    outside = np.asarray(img) == 128
    return sub & ~outside[1:-1, 1:-1], outside, (y0, y1, x0, x1)


def enclosed_area(e):
    """Total enclosed gap of one frame — the scalar `interior_holes` is built from."""
    return 0 if e is None else int(e[0].sum())


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


def centroid(a):
    """Centre of mass of the solid figure, or None for an empty frame."""
    m = a >= SEE_THROUGH
    if not m.any():
        return None
    ys, xs = np.nonzero(m)
    return float(ys.mean()), float(xs.mean())


def resampled(mask, dy, dx):
    """
    `mask` read at `p - (dy, dx)` — dragged by (dy, dx) into this frame.

    Pixels whose source falls off the canvas read False. The contract keeps the
    figure inset by an edge margin, so that only happens outside the silhouette.
    """
    out = np.zeros_like(mask)
    h, w = mask.shape
    y0, y1 = max(0, dy), min(h, h + dy)
    x0, x1 = max(0, dx), min(w, w + dx)
    if y0 >= y1 or x0 >= x1:
        return out
    out[y0:y1, x0:x1] = mask[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
    return out


def rest_gaps_seen_from(a, rest_gap, rest_centre):
    """
    The rest pose's gaps, moved into this frame's frame of reference.

    `new` asks whether a region was solid figure at rest, and asking that at a
    fixed CANVAS coordinate makes a gap that merely moved look like one that
    opened: translate a figure whose arm encloses a loop against its torso, and
    the loop lands on pixels that were torso a moment ago. Measured on a
    synthetic figure with no tear anywhere, translated bodily, the old comparison
    reported 80px "opened" at a 4px shift, 240px at 12px, and the whole 500px gap
    at 30px — each walled in by 21px, the moved anatomy's own wall, which put the
    artefact in the same bucket the threshold candidate was being read out of.
    `interior_holes` stayed 0 throughout, correctly, since translation preserves
    enclosed area: the two measures fail in opposite directions, the net
    cancelling an opening against a closing and this one mistaking movement for
    an opening.

    So the comparison happens in the figure's frame rather than the canvas's:
    shift the rest gaps by how far the figure's centre of mass has travelled, and
    a gap that only moved lines back up with itself.

    Two limits worth knowing, because this does not make the number clean. The
    estimate is a single translation, so **rotation and articulation are only
    partly compensated** — a topple still smears, and a limb swinging while the
    body stays put is not corrected at all. And a tear is itself part of the mass
    whose centre is measured, so a large one perturbs its own alignment by about
    `area x distance / total`, a pixel or so at realistic sizes. The 1px of slack
    below absorbs that along with the rounding to whole pixels.
    """
    c = centroid(a)
    if c is None or rest_centre is None:
        return rest_gap
    dy = int(round(c[0] - rest_centre[0]))
    dx = int(round(c[1] - rest_centre[1]))
    if dy == 0 and dx == 0:
        g = rest_gap
    else:
        g = resampled(rest_gap, dy, dx)
    out = g.copy()
    out[1:, :] |= g[:-1, :]
    out[:-1, :] |= g[1:, :]
    out[:, 1:] |= g[:, :-1]
    out[:, :-1] |= g[:, 1:]
    return out


def openings(e, was_gap):
    """
    Every enclosed region of one frame, paired with how much of it was solid
    figure at rest, biggest opening first. Regions that opened nothing at all are
    dropped: they are the art's own anatomy and say nothing about this clip.

    `was_gap` is the rest pose already moved into this frame's reference — see
    `rest_gaps_seen_from` for why it is not simply the rest frame's own gaps.

    Splitting this out from the description below is what lets the peak frame be
    chosen by what opened. Labelling every frame costs one flood and a handful of
    region fills per frame; the wall-depth walk, which is the expensive half,
    still runs once per clip.
    """
    if e is None:
        return []
    encl, _outside, (y0, y1, x0, x1) = e
    if not encl.any():
        return []

    lab = Image.fromarray(np.where(encl, 255, 0).astype(np.uint8)).copy()
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

    wg = was_gap[y0:y1 + 1, x0:x1 + 1]
    scored = [(int((r & ~wg).sum()), r) for r in found]
    return sorted((t for t in scored if t[0] > 0), key=lambda t: -t[0])


def wall_depths(regions, outside):
    """
    How far the outside has to be dilated before it reaches each region — the
    thickness of figure sealing it off.

    Every region of the tick is walked at once: the dilation is the cost and it
    is shared, so measuring all of them costs barely more than measuring three.
    That matters because the tick cannot be chosen until the walls are known.
    """
    depth = {}
    frontier = outside.copy()
    pending = list(regions)
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
    return depth


def gap_regions(opened, walls, e, limit=3):
    """
    The enclosed gaps of one frame, each with how much of it is NEW and how
    deeply it is walled in.

    `interior_holes` is a single number, and a single number cannot say which of
    the two things it might be. Both populations are real and both are large:
    measured on the approved art standing still, a griffin encloses 896px walled
    in by 30px of figure and a bigfoot 393px by 22px, and those are anatomy — the
    space under a wing, the loop between an arm and a torso. A joint coming apart
    produces the same kind of number. So this does not decide anything; it is
    printed next to the warning that already says "look at it", so that looking
    is a second rather than a render.

    `new` is the part of the region that was solid figure at rest, and it is what
    makes this comparable to `interior_holes` — which is rest-subtracted, so a
    description of the peak frame's *absolute* gaps describes something else
    entirely. The first calibration run made exactly that mistake: it reported a
    bigfoot `revive` that opened 3px of gap as a 76px region walled in by 47px,
    at coordinates that barely moved from clip to clip, because it was measuring
    the figure's permanent anatomy rather than anything that opened.

    `wall` is how far the outside has to be dilated before it reaches the region,
    which is the thickness of figure sealing it off: a gap pinched shut where two
    limbs cross reads a handful of pixels, a hole in the middle of a torso reads
    tens. That is the distinction a human makes instantly from the picture and
    could not make from an area, and it is a *description*, not a threshold —
    calibrating it into a gate needs the moving population, which only the real
    renderer can produce — CI's `rig-motion` workflow collects it every run via
    `--gap-report` and summarises it with `tools/art/gap-calibration.mjs`.
    Ranked by `wall`, deepest first, with a bigger opening breaking ties — not by
    area. Area is the thing this whole file argues cannot tell anatomy from
    breakage, so ranking by it would bury a small deep tear under a large shallow
    one, and `gap-calibration.mjs` buckets on the first entry.
    """
    if e is None or not opened:
        return []
    _encl, _outside, (y0, y1, x0, x1) = e
    ranked = sorted(opened, key=lambda t: (-walls.get(id(t[1]), 121), -t[0]))
    out = []
    for n, r in ranked[:limit]:
        ry, rx = np.nonzero(r)
        out.append({
            "px": int(r.sum()),
            "new": n,
            "wall": walls.get(id(r), 121),
            "at": [int(rx.mean()) + x0, int(ry.mean()) + y0],
        })
    return out


_encl = [enclosed(a) for a in alpha]
_gaps = [enclosed_area(e) for e in _encl]

# What each tick OPENED, per region. The peak is picked off this rather than off
# `_gaps`, and the difference is the whole point of the two-pass split above.
#
# `_gaps` is a total, and a total cancels. A tick that tears 141px open at a
# joint while a limb swings shut across 140px of the figure's own negative space
# nets +1px, loses `argmax` to some blander tick, and the regions then get read
# off that blander tick instead — so the gate described the wrong frame exactly
# when there was most to see. Cancel it completely and `_gaps` never moves at
# all: the old selection had no peak to find, `interior_worst` came back empty,
# and the clip was invisible to the description and to the calibration both.
#
# An opening cannot cancel, because closing figure back over anatomy adds nothing
# to it: a region only scores for the pixels that were solid at rest.
#
# Each tick is scored against the rest pose carried into ITS frame of reference,
# not against the rest frame where it sits on the canvas — otherwise a figure
# that simply walks reports its own anatomy as freshly torn. See
# `rest_gaps_seen_from`.
_rest_gap = alpha[0] < SEE_THROUGH
_rest_centre = centroid(alpha[0])
_opens = [
    openings(e, rest_gaps_seen_from(a, _rest_gap, _rest_centre))
    for a, e in zip(alpha, _encl)
]

# And the tick is chosen by the DEEPEST wall, not by the largest opening.
#
# Choosing by area was the same mistake as choosing by the total, one level up:
# area is precisely what this file argues cannot separate anatomy from breakage,
# so a clip that spreads its legs into a broad shallow gap on one tick and tears
# a small deep hole on another picked the legs, and the tear reached neither the
# warning nor the calibration — the wall walk only ever ran on the chosen tick,
# so nothing downstream could recover it. Measured on a fixture with exactly that
# shape: a 1920px opening walled in by 7px was described, while a 288px hole
# walled in by 25px two ticks later went unreported.
#
# Walls are therefore measured on every tick. The dilation is shared across a
# tick's regions, so this costs the walk itself, not the walk times the regions.
_walls = [
    wall_depths([r for _n, r in o], e[1]) if o else {}
    for o, e in zip(_opens, _encl)
]
_peak = int(np.argmax([max(w.values()) if w else 0 for w in _walls]))

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
    # What that number is made of, on the tick that opened the most. See
    # gap_regions: the area alone cannot tell a lifted limb from a joint, and
    # this is what a human needs in order to tell them apart without re-rendering
    # the clip.
    #
    # This tick is chosen by what opened while `interior_holes` is a net over all
    # ticks, so the two can now come from different frames — deliberately. The
    # number answers "how much gap did this clip end up with", the regions answer
    # "where did it tear worst", and on a clip where something opens as something
    # else closes those have different answers. `interior_worst_tick` is which
    # frame to actually look at, since it is no longer implied by the number.
    "interior_worst": gap_regions(_opens[_peak], _walls[_peak], _encl[_peak]),
    "interior_worst_tick": _peak,
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
