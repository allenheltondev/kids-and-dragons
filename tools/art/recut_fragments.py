#!/usr/bin/env python3
"""
Kids & Dragons - duplicated part fragment re-cut.

Removes the fragments that `check_part_fragments` in verify.py reports: a
detached component of one part that some *other* part in the same set already
draws. See docs/briefs/part-fragments.md.

The detection here is not a second implementation. It imports `components`,
`opaque_mask`, `FRAGMENT_MIN_PX` and `FRAGMENT_DUPLICATE_COVERAGE` from the
verifier, so what this deletes is by construction what the gate flags. A
re-cut that used its own rule could converge on a corpus the gate still
complains about, or worse, quietly delete something the gate would have kept.

Most of what the gate flags must not be deleted, and that is the whole
difficulty. Of 179 fragments in the corpus, 151 are load-bearing: `check_seams`
requires adjacent parts to share 2,000 px, and at most joints the duplicated
disc *is* that overlap, sitting on the pivot the rig derives from it. Four
guards, each measured against the same gate that would otherwise catch the
damage afterwards:

  * **Never the last copy.** Fragments are removed one at a time and each is
    re-checked for coverage against the set *as it currently stands*. Where two
    parts each carry a detached copy and nothing else draws it, the first
    deletion drops the second's coverage below threshold and the second copy
    stays, whatever order they are visited in.
  * **Never the only overlap at a joint.** Removing it satisfies the duplicate
    check and drops the pair to zero shared pixels, so the joint opens when the
    limb turns — a worse defect than the one being fixed, and invisible to
    every other check. 141 fragments are held by this.
  * **Never move the skeleton.** A pivot is the centroid of a seam band
    (`verify.joint_centroids`), so a fragment inside that band is part of the
    measurement even when it is not all of it. 10 fragments are held by this;
    without it, dragonling's cross-tier registration fails by 93 px.
  * **Only pixels another part draws.** A fragment at 97% coverage loses that
    97% and keeps the 3% that is genuinely its own, so the union of the set is
    preserved. In this corpus every fragment measures 100%, but the threshold
    is 0.95 and the guard belongs with it.

No guard is needed for the alpha threshold: every cleared pixel is opaque in
some other part by construction, and stacked alpha is never lower than the
parts it stacks, so `check_recomposite` cannot fall through this.

Usage:
    python tools/art/recut_fragments.py                 # report, write nothing
    python tools/art/recut_fragments.py --apply         # re-cut in place
    python tools/art/recut_fragments.py unicorn         # one species
    python tools/art/recut_fragments.py --rig-variants  # class rigs too

Requires: Pillow, numpy
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

from verify import (
    FRAGMENT_DUPLICATE_COVERAGE,
    FRAGMENT_MIN_PX,
    MANIFEST,
    ROOT,
    components,
    load_rgba,
    opaque_mask,
)

BOLD, DIM, GREEN, YELLOW, RESET = (
    ("\033[1m", "\033[2m", "\033[32m", "\033[33m", "\033[0m")
    if sys.stdout.isatty() and os.name != "nt"
    else ("", "", "", "", "")
)


def bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)


# How far a single deletion may move a structural joint. The rig derives every
# pivot as the centroid of a seam-overlap band (verify.joint_centroids), so a
# fragment that overlaps a joint is part of that measurement whether or not it
# is the whole of it. Removing artwork must not relocate the skeleton, and this
# is a long way inside the 70px the cross-tier gate allows.
MAX_JOINT_SHIFT_PX = 5.0


def recut_set(parts: dict[str, np.ndarray], thr: int,
              adjacency: list[list[str]], min_seam: int,
              structural: list[list[str]]) -> list[dict]:
    """
    Clear duplicated detached fragments from `parts`, in place.

    Returns one record per fragment considered, including the ones kept, so the
    caller can show what was left behind and why.

    Some of these fragments are load-bearing. `check_seams` requires adjacent
    parts to share at least `minSeamOverlapPx`, and at a few joints the
    duplicated disc *is* that overlap — delete it and the joint drops to zero
    shared pixels, which opens a gap when the rig rotates. Those are kept and
    reported: replacing them means drawing real overlap into the part, which is
    an art change, not a deletion.
    """
    masks = {k: opaque_mask(v, thr) for k, v in parts.items()}
    pairs = [(a, b) for a, b in adjacency if a in masks and b in masks]

    def seam_broken_by(name: str, drawn: np.ndarray) -> tuple[str, int] | None:
        """The adjacent pair, if any, that this removal would starve."""
        for a, b in pairs:
            if name not in (a, b):
                continue
            other = b if name == a else a
            after = int(((masks[name] & ~drawn) & masks[other]).sum())
            if after < min_seam <= int((masks[name] & masks[other]).sum()):
                return f"{a}/{b}", after
        return None

    def joint_moved_by(name: str, drawn: np.ndarray) -> tuple[str, float] | None:
        """The structural joint, if any, this removal would relocate."""
        for a, b in structural:
            if name not in (a, b) or a not in masks or b not in masks:
                continue
            band = masks[a] & masks[b]
            if band.sum() < 50 or not (band & drawn).any():
                continue
            after = band & ~drawn
            if after.sum() < 50:
                return f"{a}/{b}", float("inf")
            by, bx = np.where(band)
            ay, ax = np.where(after)
            shift = float(np.hypot(ax.mean() - bx.mean(), ay.mean() - by.mean()))
            if shift > MAX_JOINT_SHIFT_PX:
                return f"{a}/{b}", shift
        return None

    # Components are computed once. Clearing a fragment only ever removes that
    # component from its own part, so no other part's decomposition changes.
    candidates: list[tuple[str, np.ndarray, int]] = []
    for name, mask in masks.items():
        comps = components(mask)
        if len(comps) < 2:
            continue
        comps.sort(key=lambda c: -int(c.sum()))
        for frag in comps[1:]:
            n = int(frag.sum())
            if n >= FRAGMENT_MIN_PX:
                candidates.append((name, frag, n))

    # Largest first, then by part name and position: deterministic, so a re-run
    # on the same input keeps the same copy of a mutually-duplicated fragment.
    candidates.sort(key=lambda c: (-c[2], c[0], bbox(c[1])))

    out: list[dict] = []
    for name, frag, n in candidates:
        others = np.zeros_like(frag)
        for other, m in masks.items():
            if other != name:
                others |= m

        drawn = frag & others
        covered = float(drawn.sum()) / n
        x, y, w, h = bbox(frag)
        rec = {
            "part": name, "px": n, "bbox": (x, y, w, h),
            "coverage": covered, "removed": 0, "seam": None, "joint": None,
        }

        if covered >= FRAGMENT_DUPLICATE_COVERAGE:
            starved = seam_broken_by(name, drawn)
            moved = joint_moved_by(name, drawn)
            if starved:
                rec["seam"] = starved
            elif moved:
                rec["joint"] = moved
            else:
                parts[name][drawn] = 0
                masks[name] &= ~drawn
                rec["removed"] = int(drawn.sum())

        out.append(rec)

    return out


def part_sets(mf: dict, species_filter: str | None, rig_variants: bool) -> list[tuple[str, str, list[str]]]:
    """(label, parts_dir, declared part names) for every set to re-cut."""
    sets: list[tuple[str, str, list[str]]] = []

    for sp in mf["species"]:
        for tier in mf["tiers"]:
            tid = tier["id"] if isinstance(tier, dict) else tier
            label = f"{sp['id']}/{tid}"
            if species_filter and not label.startswith(species_filter):
                continue
            base = os.path.join(ROOT, "assets", "characters", sp["id"], tid)
            if os.path.isdir(os.path.join(base, "parts")):
                sets.append((label, os.path.join(base, "parts"), list(sp["parts"])))

    if rig_variants:
        for v in mf.get("rigVariants", []):
            label = f"character-rigs/{v['class']}/{v['tier']}/{v['species']}"
            if species_filter and v["species"] != species_filter:
                continue
            base = os.path.join(ROOT, "assets", "character-rigs", v["class"], v["tier"], v["species"])
            if os.path.isdir(os.path.join(base, "parts")):
                sets.append((label, os.path.join(base, "parts"), list(v["parts"])))

    return sets


def main() -> int:
    argv = [a for a in sys.argv[1:]]
    apply = "--apply" in argv
    rig_variants = "--rig-variants" in argv
    rest = [a for a in argv if not a.startswith("--")]
    species = rest[0] if rest else None

    with open(MANIFEST) as f:
        mf = json.load(f)
    thr = mf["tolerance"]["alphaThreshold"]

    total_frags = total_px = total_sets = 0
    kept: list[str] = []
    seam_held: list[str] = []
    joint_held: list[str] = []
    sizes: dict[tuple[int, int], int] = {}
    adjacency, min_seam = mf["adjacency"], mf["tolerance"]["minSeamOverlapPx"]
    structural = mf.get("structuralAdjacency", mf["adjacency"])

    for label, parts_dir, names in part_sets(mf, species, rig_variants):
        parts: dict[str, np.ndarray] = {}
        for name in names:
            path = os.path.join(parts_dir, f"{name}.png")
            if os.path.exists(path):
                parts[name] = load_rgba(path)
        if not parts:
            continue

        before = np.zeros(next(iter(parts.values())).shape[:2], bool)
        for m in parts.values():
            before |= opaque_mask(m, thr)

        records = recut_set(parts, thr, adjacency, min_seam, structural)
        for r in records:
            if r["seam"]:
                pair, after = r["seam"]
                seam_held.append(
                    f"{label} {r['part']} {r['px']:,}px is the whole of {pair} "
                    f"(would drop to {after:,}px, floor {min_seam:,})"
                )
            if r["joint"]:
                pair, shift = r["joint"]
                joint_held.append(
                    f"{label} {r['part']} {r['px']:,}px sits in the {pair} band "
                    f"(removing it moves that joint {shift:.0f}px)"
                )
        removed = [r for r in records if r["removed"]]
        if not removed:
            continue

        after = np.zeros_like(before)
        for m in parts.values():
            after |= opaque_mask(m, thr)
        lost = int((before & ~after).sum())
        if lost:
            print(f"  {YELLOW}refusing {label}: re-cut would lose {lost:,} px from the set{RESET}")
            continue

        total_sets += 1
        total_frags += len(removed)
        total_px += sum(r["removed"] for r in removed)
        for r in removed:
            _, _, w, h = r["bbox"]
            sizes[(w, h)] = sizes.get((w, h), 0) + 1
        for r in records:
            if not r["removed"] and r["coverage"] > 0:
                kept.append(f"{label} {r['part']} {r['px']:,}px at {r['coverage'] * 100:.0f}%")

        print(f"\n{BOLD}{label}{RESET}  {len(removed)} fragments, {sum(r['removed'] for r in removed):,} px")
        for r in sorted(removed, key=lambda r: (-r["px"], r["part"])):
            x, y, w, h = r["bbox"]
            print(f"  {r['part']:<16} {r['px']:>6,} px  {w}x{h} at ({x},{y})  "
                  f"{r['coverage'] * 100:.0f}% duplicated")

        if apply:
            # Only the parts that actually lost pixels. Re-encoding an
            # unchanged PNG still rewrites its bytes, which would put every
            # part of every touched set into the diff and bury the ~20 files
            # that changed among a hundred that did not.
            touched = {r["part"] for r in removed}
            for name in sorted(touched):
                Image.fromarray(parts[name], "RGBA").save(
                    os.path.join(parts_dir, f"{name}.png"))

    print(f"\n{BOLD}{total_frags} fragments, {total_px:,} px, across {total_sets} sets{RESET}")
    if sizes:
        top = sorted(sizes.items(), key=lambda kv: -kv[1])[:3]
        print("  most common: " + ", ".join(f"{w}x{h} x{n}" for (w, h), n in top))
    if kept:
        print(f"  {DIM}kept (detached, below the duplication threshold): {len(kept)}{RESET}")
        for k in kept[:10]:
            print(f"    {DIM}{k}{RESET}")

    if seam_held:
        print(f"\n{YELLOW}{len(seam_held)} kept because a joint has no other overlap{RESET}")
        print(f"  {DIM}Deleting these passes check_part_fragments and fails check_seams. They need "
              f"real overlap drawn into the part first — an art change, not a deletion.{RESET}")
        for s in seam_held:
            print(f"    {s}")

    if joint_held:
        print(f"\n{YELLOW}{len(joint_held)} kept because removing them would move a joint{RESET}")
        print(f"  {DIM}The rig derives each pivot from the seam band these sit in. "
              f"Re-cutting art must not relocate the skeleton.{RESET}")
        for s in joint_held:
            print(f"    {s}")

    if apply:
        print(f"\n{GREEN}written{RESET} - run `npm run art:verify`")
    else:
        print(f"\n{DIM}dry run - nothing written. Pass --apply to re-cut.{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
