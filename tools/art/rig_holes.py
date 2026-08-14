#!/usr/bin/env python3
"""
Kids & Dragons - what a rig takes away with it when it moves.

Renders each rig at rest and mid-clip, finds the openings that are *enclosed*
by the figure, and maps each one back to the source art to see which part drew
those pixels. An opening drawn overwhelmingly by one part is artwork only that
part carries: when the part moves, the pixels go with it and a hole opens where
they were.

This is the defect the contact sheet in docs/briefs/part-fragments.md §1 shows,
and it is the opposite of the duplicated fragments that brief was written
about. A duplicate leaves no hole — the other copy stays. These leave holes
precisely because nothing else draws them, which is also why every source-level
check is blind to them: `check_recomposite` is satisfied by any partition of
the image, and the artwork is attached to the part's own blob, so it is not a
detached fragment either.

Two things it deliberately does not count:

  * Openings that reach the edge of the figure. A wing sweeping away leaves the
    space it occupied empty, and that is animation, not damage. Only openings
    the figure encloses on every side are holes.
  * Openings no single part dominates. Where several parts drew the pixels,
    something else is going on and the report would be guessing.

Needs the Rive CLI (KAD_RIVE_CLI, or `rive-mcp-build` on PATH) and a
Chromium for it — the same requirement as `art:verify:rig:rest`, which is why
this is not part of `art:verify`.

Usage:
    python3 tools/art/rig_holes.py                    # every rig, attack clip
    python3 tools/art/rig_holes.py --clip down
    python3 tools/art/rig_holes.py unicorn
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit("error: needs Pillow and numpy  ->  pip install pillow numpy")

from verify import MANIFEST, ROOT, components, load_rgba, opaque_mask

BOLD, DIM, YELLOW, RESET = (
    ("\033[1m", "\033[2m", "\033[33m", "\033[0m")
    if sys.stdout.isatty() and os.name != "nt" else ("", "", "", "")
)

# Below this an opening is antialiasing along a seam rather than a hole in the
# figure. The smallest one the contact sheet made visible is about 2,000 px.
MIN_HOLE_PX = 1000

# How much of an opening one part has to have drawn before the report names it.
SOLE_OWNER_SHARE = 0.80

# The rig stages a 1024px art canvas on a 1400px artboard, registered so the
# art's origin lands on the rig's ground point (art/rig/*.rig.json). Renders
# come back at 1024, so canvas -> render is this scale after that offset.
ARTBOARD = 1400
CANVAS = 1024


def resolve_cli() -> list[str] | None:
    env = os.environ.get("KAD_RIVE_CLI")
    if env:
        return [sys.executable.replace("python3", "node"), env] if env.endswith((".js", ".mjs")) \
            else [env]
    found = shutil.which("rive-mcp-build")
    return [found] if found else None


def render(cli: list[str], rig: str, clip: str, t: float, out: str) -> bool:
    if os.path.exists(out):
        return True
    try:
        r = subprocess.run(
            [*cli, "render", rig, "--animation", clip, "--time", str(t),
             "--width", str(CANVAS), "-o", out],
            capture_output=True, timeout=300,
        )
    except subprocess.TimeoutExpired:
        return False
    return r.returncode == 0 and os.path.exists(out)


def alpha_mask(path: str, thr: int) -> np.ndarray:
    return np.array(Image.open(path).convert("RGBA"))[..., 3] > thr


def enclosed_openings(rest: np.ndarray, moving: np.ndarray) -> list[np.ndarray]:
    """Regions the figure encloses now and drew at rest."""
    out = []
    for c in components(~moving, cap=60):
        if c[0].any() or c[-1].any() or c[:, 0].any() or c[:, -1].any():
            continue                      # reaches the outside: the figure moved, nothing broke
        gap = c & rest
        if gap.sum() >= MIN_HOLE_PX:
            out.append(gap)
    return out


def attribute(gap: np.ndarray, masks: dict[str, np.ndarray]) -> tuple[str, float] | None:
    """Which part drew these pixels in the source art, and what share of them."""
    scale = ARTBOARD / CANVAS
    ys, xs = np.where(gap)
    cy = (ys * scale - (ARTBOARD - CANVAS) // 2).astype(int)
    cx = (xs * scale - (ARTBOARD - CANVAS) // 2).astype(int)
    ok = (cy >= 0) & (cy < CANVAS) & (cx >= 0) & (cx < CANVAS)
    cy, cx = cy[ok], cx[ok]
    if not len(cy):
        return None
    owners = {n: int(m[cy, cx].sum()) for n, m in masks.items() if m[cy, cx].any()}
    if not owners:
        return None
    part, count = max(owners.items(), key=lambda kv: kv[1])
    return part, count / len(cy)


def main() -> int:
    argv = sys.argv[1:]
    clip = argv[argv.index("--clip") + 1] if "--clip" in argv else "attack"
    rest_args = [a for a in argv if not a.startswith("--") and a != clip]
    species = rest_args[0] if rest_args else None

    cli = resolve_cli()
    if not cli:
        sys.exit("error: no Rive CLI. Set KAD_RIVE_CLI to its cli.js, "
                 "or put rive-mcp-build on your PATH.")

    mf = json.load(open(MANIFEST))
    thr = mf["tolerance"]["alphaThreshold"]
    ticks = mf["rigContract"]["clips"][clip]["ticks"] / mf["rigContract"]["tickFps"]
    times = [round(ticks * f, 3) for f in (0.33, 0.66)]

    work = tempfile.mkdtemp(prefix="kad-holes-")
    found: list[tuple[str, int, str, float]] = []
    checked = 0

    for sp in mf["species"]:
        if species and sp["id"] != species:
            continue
        for tier in mf["tiers"]:
            tid = tier["id"] if isinstance(tier, dict) else tier
            base = os.path.join(ROOT, "assets", "characters", sp["id"], tid)
            rig = os.path.join(base, "rig.riv")
            if not os.path.exists(rig):
                continue
            label, tag = f"{sp['id']}/{tid}", f"{sp['id']}_{tid}"
            if not render(cli, rig, "idle", 0, os.path.join(work, f"{tag}_rest.png")):
                print(f"  {YELLOW}skip{RESET}  {label}  (rest render failed)")
                continue
            checked += 1
            masks = {n: opaque_mask(load_rgba(os.path.join(base, "parts", f"{n}.png")), thr)
                     for n in sp["parts"]
                     if os.path.exists(os.path.join(base, "parts", f"{n}.png"))}
            rest = alpha_mask(os.path.join(work, f"{tag}_rest.png"), thr)

            for t in times:
                out = os.path.join(work, f"{tag}_{clip}_{t}.png")
                if not render(cli, rig, clip, t, out):
                    continue
                for gap in enclosed_openings(rest, alpha_mask(out, thr)):
                    who = attribute(gap, masks)
                    if who and who[1] >= SOLE_OWNER_SHARE:
                        found.append((label, int(gap.sum()), who[0], who[1]))

    by: dict[str, list] = {}
    for label, px, part, share in found:
        by.setdefault(label, []).append((px, part, share))

    print(f"\n{BOLD}{len(found)} holes across {len(by)} of {checked} sets{RESET}  "
          f"(clip `{clip}`, {len(times)} ticks each)\n")
    print(f"{'set':<22}{'holes':>6}{'largest':>10}  carried off by")
    for label in sorted(by, key=lambda k: -max(v[0] for v in by[k])):
        v = sorted(by[label], key=lambda x: -x[0])
        print(f"{label:<22}{len(v):>6}{v[0][0]:>10,}  "
              + ", ".join(sorted({p for _, p, _ in v})))

    tally: dict[str, int] = {}
    for _, _, part, _ in found:
        tally[part] = tally.get(part, 0) + 1
    if tally:
        print("\nby part: " + ", ".join(f"{k} x{v}" for k, v in
                                        sorted(tally.items(), key=lambda kv: -kv[1])))
    print(f"\n{DIM}Two ticks of one clip. Other clips move other parts — this is a "
          f"floor, not an inventory.{RESET}")
    shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
