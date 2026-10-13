#!/usr/bin/env python3
"""
Kids & Dragons - seam verifier: does a part set hold together when its joints move?

`verify.py`'s seam check asks whether every adjacent pair shares 2,000 opaque
pixels. A 50px disc stamped on each joint answers yes, and that is what every
part set was delivered with: no overlap anywhere along the seams except the
disc, so every rig opened gaps at its joints on the first idle breath
(art-pipeline.md section 6.4). This checks the band itself, along the whole
seam, and the things that made the old cuts fail in motion. The spec it
enforces is docs/briefs/part-recut.md; the numbers below are that brief's.

For every MOVING pair (a part that rotates relative to its neighbour), with B
the part drawn behind and F the part drawn in front:

  band      Within BAND_PX of the visible seam between them, every pixel F
            paints opaquely must also be painted opaquely by B, so a rotation
            of up to that far shows B, never background — except where a part
            riding F (its descendant, drawn over it) covers F at rest, which
            moves with F and so is never uncovered by F turning. >= BAND_MIN
  joint     When B is the parent (body under an arm), every pixel F paints
            opaquely within JOINT_PX of the pinned pivot must be painted by B
            too: the shoulder is where the most is revealed.     >= BAND_MIN
  copy      WARNING ONLY. B's hidden pixels in the band should be B's own
            continuation, not a copy of F's artwork sampled from assembled.png
            (what the old brief asked for; it shows a ghost of F when F moves).
            Pixel equality is not proof of copying — a flat coat painted
            honestly under a flat arm of the same colour is equal too — so it
            is measured only where assembled.png has texture (a neighbour
            differs by more than TEXTURE_DELTA), and reported for a person to
            look at rather than failed. Share of textured band pixels
            identical to assembled.png, warned above:            COPY_MAX

And per part set:

  ground    body, head and mane own no visible pixel within GROUND_PX of the
            standing line: feet and talons belong to the limbs that carry them.
  joints    joints.json is present, names every child in the hierarchy, and
            each acting child's pivot is painted by both it and its parent.

Moving pairs are the hierarchy's parent/child pairs whose child acts (head,
arms, legs, tail, wings), plus body/mane (the mane rides the head, so it moves
against the body). Gear and other riders move with their parent and are not
checked here; the brief covers them in prose.

Usage:
    python3 tools/art/verify_seams.py                       every part set
    python3 tools/art/verify_seams.py bigfoot               one species (and its class variants)
    python3 tools/art/verify_seams.py bigfoot/fledgling     one base set
    python3 tools/art/verify_seams.py thornguard/sworn/bigfoot

Exit 0 when every checked set passes, 1 otherwise.
"""

from __future__ import annotations

import json
import os
import sys

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit("error: needs Pillow and numpy  ->  pip install pillow numpy")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = json.load(open(os.path.join(ROOT, "assets", "manifest.json")))

BAND_PX = 24
JOINT_PX = 64
BAND_MIN = 0.98
COPY_MAX = 0.5
TEXTURE_DELTA = 8
TEXTURE_MIN_PX = 200
YELLOW = "\x1b[33m" if sys.stdout.isatty() else ""
GROUND_PX = 40
TRUNK = ("body", "head", "mane")
ACTS = ("head", "arm_l", "arm_r", "leg_l", "leg_r", "tail", "wings")

tty = sys.stdout.isatty()
RED, GREEN, DIM, RESET = ("\x1b[31m", "\x1b[32m", "\x1b[2m", "\x1b[0m") if tty else ("",) * 4


def part_sets():
    for sp in MANIFEST["species"]:
        for tier in MANIFEST["tiers"]:
            yield (f"{sp['id']}/{tier}", sp["id"], os.path.join(ROOT, "assets", "characters", sp["id"], tier),
                   os.path.join(ROOT, "art", "rig", f"{sp['id']}.rig.json"))
    for v in MANIFEST.get("rigVariants", []):
        yield (f"{v['class']}/{v['tier']}/{v['species']}", v["species"],
               os.path.join(ROOT, "assets", "character-rigs", v["class"], v["tier"], v["species"]),
               os.path.join(ROOT, "art", "rig", f"{v['class']}-{v['tier']}-{v['species']}.rig.json"))


def grow(mask: np.ndarray, steps: int) -> np.ndarray:
    """Dilate by `steps` pixels (8-connected: a square of side 2*steps+1)."""
    out = mask.copy()
    for _ in range(steps):
        g = out.copy()
        g[1:] |= out[:-1]; g[:-1] |= out[1:]; g[:, 1:] |= out[:, :-1]; g[:, :-1] |= out[:, 1:]
        g[1:, 1:] |= out[:-1, :-1]; g[1:, :-1] |= out[:-1, 1:]; g[:-1, 1:] |= out[1:, :-1]; g[:-1, :-1] |= out[1:, 1:]
        out = g
    return out


def hierarchy(cfg: dict, names: set[str]) -> dict[str, str]:
    root = cfg.get("root", "body")
    nb: dict[str, list[str]] = {}
    for a, b in cfg["adjacency"]:
        if a in names and b in names:
            nb.setdefault(a, []).append(b)
            nb.setdefault(b, []).append(a)
    parent: dict[str, str] = {}
    order, seen = [root], {root}
    for n in order:
        for m in nb.get(n, []):
            if m not in seen:
                seen.add(m); parent[m] = n; order.append(m)
    return parent


def check_set(label: str, base: str, cfg_path: str) -> tuple[list[str], list[str], list[str]]:
    """(problems, warnings, notes) for one part set; no problems means it passes."""
    problems: list[str] = []
    notes: list[str] = []
    warnings: list[str] = []
    parts_dir = os.path.join(base, "parts")
    cfg = json.load(open(cfg_path))
    z = [n for n in cfg["zOrder"] if os.path.exists(os.path.join(parts_dir, f"{n}.png"))]
    z += sorted(f[:-4] for f in os.listdir(parts_dir) if f.endswith(".png") and f[:-4] not in z)
    img = {n: np.asarray(Image.open(os.path.join(parts_dir, f"{n}.png")).convert("RGBA")) for n in z}
    alpha = {n: img[n][..., 3] for n in z}
    asm = np.asarray(Image.open(os.path.join(base, "assembled.png")).convert("RGBA"))
    parent = hierarchy(cfg, set(z))

    # Who is seen at rest: the front-most part painting each pixel solidly.
    owner = np.full(asm.shape[:2], -1, np.int16)
    for i, n in enumerate(z):
        owner[alpha[n] >= 128] = i
    zi = {n: i for i, n in enumerate(z)}
    # Where the approved art has texture: a pixel differing from a neighbour.
    rgb = asm[..., :3].astype(int)
    textured = np.zeros(asm.shape[:2], bool)
    textured[:, :-1] |= np.abs(rgb[:, :-1] - rgb[:, 1:]).max(axis=-1) > TEXTURE_DELTA
    textured[:-1] |= np.abs(rgb[:-1] - rgb[1:]).max(axis=-1) > TEXTURE_DELTA

    joints_path = os.path.join(base, "joints.json")
    joints = {}
    if not os.path.exists(joints_path):
        problems.append("joints: joints.json is missing")
    else:
        joints = {k: v for k, v in json.load(open(joints_path)).items() if not k.startswith("$")}
        for child, par in parent.items():
            if child not in joints:
                problems.append(f"joints: joints.json has no entry for '{child}' (parent '{par}')")
                continue
            # The pivot is where the child turns on its parent, so both must
            # paint it: a pivot outside either part swings the limb about
            # empty space.
            x, y = int(round(joints[child]["x"])), int(round(joints[child]["y"]))
            missing = [n for n in (par, child) if not (0 <= y < alpha[n].shape[0] and 0 <= x < alpha[n].shape[1]) or alpha[n][y, x] < 128]
            if child in ACTS and missing:
                problems.append(f"joints: the {par}/{child} pivot ({x},{y}) is not painted by {' or '.join(missing)}")

    pairs = [(par, ch) for ch, par in parent.items() if ch in ACTS]
    if "mane" in z and "body" in z:
        pairs.append(("body", "mane"))
    for par, ch in pairs:
        b, f = (par, ch) if zi[par] < zi[ch] else (ch, par)
        fi, bi = zi[f], zi[b]
        b_solid = alpha[b] == 255
        # F's paint that a part riding F covers at rest is not F's edge: the
        # rider (F's own descendant, drawn over F) moves with F, so however
        # F turns against B those pixels stay covered and B is never seen
        # there. Asking B to paint under them would make B paint beneath a
        # part it has nothing to do with (brief section 6.6) — an arm hanging
        # off the body, over the hip seam, is exactly that.
        riders = np.zeros_like(b_solid)
        for n in z:
            m = n
            while m in parent and parent[m] != f:
                m = parent[m]
            if n != f and parent.get(m) == f and zi[n] > zi[f]:
                riders |= alpha[n] == 255
        f_solid = (alpha[f] == 255) & ~riders
        # The visible seam: F's visible pixels that touch B's visible pixels.
        b_seen = owner == bi
        seam = (owner == fi) & grow(b_seen, 1)
        if not seam.any():
            # Legitimate when the joint is hidden at rest (a far leg's hip
            # behind the near leg); nothing to measure, so say so and move on.
            notes.append(f"{b}/{f}: no visible seam at rest, band not measured")
            continue
        band = f_solid & grow(seam, BAND_PX)
        cover = (b_solid & band).sum() / band.sum()
        if cover < BAND_MIN:
            problems.append(f"{b}/{f}: band {cover:.1%} of the {BAND_PX}px band under {f} is painted by {b} (need {BAND_MIN:.0%})")
        if par == b and parent.get(ch) == par and ch in joints:
            yy, xx = np.ogrid[: asm.shape[0], : asm.shape[1]]
            j = joints[ch]
            near = f_solid & ((xx - j["x"]) ** 2 + (yy - j["y"]) ** 2 <= JOINT_PX ** 2)
            if near.any():
                jc = (b_solid & near).sum() / near.sum()
                if jc < BAND_MIN:
                    problems.append(f"{b}/{f}: joint {jc:.1%} of {f} within {JOINT_PX}px of the pivot is painted by {b} (need {BAND_MIN:.0%})")
        hidden = band & b_solid & (owner != bi) & textured
        if hidden.sum() >= TEXTURE_MIN_PX:
            same = (np.abs(img[b][..., :3].astype(int) - asm[..., :3].astype(int)).max(axis=-1) == 0) & hidden
            share = same.sum() / hidden.sum()
            if share > COPY_MAX:
                warnings.append(f"{b}/{f}: copy? {share:.0%} of {b}'s textured hidden band equals assembled.png exactly; check it is {b}'s own continuation, not {f}'s art")

    ground_y = MANIFEST["canvas"]["originY"] - GROUND_PX
    for n in TRUNK:
        if n in zi:
            low = (owner == zi[n])[ground_y:].sum()
            if low:
                problems.append(f"ground: {n} owns {low} visible px within {GROUND_PX}px of the standing line (feet belong to the limbs)")
    return problems, warnings, notes


def main() -> int:
    wanted = [a for a in sys.argv[1:] if not a.startswith("-")]
    sets = [s for s in part_sets() if not wanted or any(w == s[0] or w == s[1] for w in wanted)]
    if wanted and not sets:
        print(f"error: {wanted} names no part set"); return 2
    failed = 0
    for label, _sp, base, cfg in sets:
        if not os.path.isdir(os.path.join(base, "parts")):
            print(f"  {DIM}skip  {label}  not delivered{RESET}"); continue
        problems, warnings, notes = check_set(label, base, cfg)
        if problems:
            failed += 1
            print(f"  {RED}FAIL{RESET}  {label}")
            for p in problems:
                print(f"        {p}")
        else:
            print(f"  {GREEN}ok{RESET}    {label}")
        for w in warnings:
            print(f"        {YELLOW}warn{RESET} {w}")
        for n in notes:
            print(f"        {DIM}note {n}{RESET}")
    print(f"\n{len(sets) - failed} passed   {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
