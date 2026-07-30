#!/usr/bin/env python3
"""
Kids & Dragons - asset verifier.

The machine gate for commissioned art. Reads assets/manifest.json and checks every
delivered character set against it. Exits non-zero on any failure.

Usage:
    python tools/art/verify.py                 # verify everything present
    python tools/art/verify.py unicorn         # one species
    python tools/art/verify.py unicorn/sworn   # one species/tier
    python tools/art/verify.py --strict        # also fail on not-yet-delivered sets

What this CANNOT check: whether it looks right. That is the human gate.
See docs/asset-brief.md section6.2.

Requires: Pillow, numpy
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit("error: needs Pillow and numpy  ->  pip install pillow numpy")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "assets", "manifest.json")

RED, GREEN, YELLOW, DIM, BOLD, RESET = (
    ("\033[31m", "\033[32m", "\033[33m", "\033[2m", "\033[1m", "\033[0m")
    if sys.stdout.isatty() and os.name != "nt"
    else ("", "", "", "", "", "")
)


@dataclass
class Report:
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    passed: int = 0

    def ok(self, label: str) -> None:
        self.passed += 1
        print(f"  {GREEN}pass{RESET}  {label}")

    def fail(self, label: str, expected: object, actual: object) -> None:
        self.failures.append(label)
        print(f"  {RED}FAIL{RESET}  {label}")
        print(f"        expected: {expected}")
        print(f"        actual:   {actual}")

    def warn(self, label: str, detail: str = "") -> None:
        self.warnings.append(label)
        print(f"  {YELLOW}warn{RESET}  {label}")
        if detail:
            print(f"        {detail}")


def load_rgba(path: str) -> np.ndarray:
    return np.array(Image.open(path).convert("RGBA"))


def opaque_mask(img: np.ndarray, threshold: int) -> np.ndarray:
    return img[..., 3] > threshold


# ----------------------------------------------------------------------------- checks


def check_format(rep: Report, path: str, canvas: dict, tol: dict) -> np.ndarray | None:
    """Format, canvas size, colour profile, real alpha, edge margin."""
    rel = os.path.relpath(path, ROOT)
    im = Image.open(path)

    if im.size != (canvas["width"], canvas["height"]):
        rep.fail(f"{rel} canvas", f'{canvas["width"]}x{canvas["height"]}', f"{im.size[0]}x{im.size[1]}")
        return None

    if im.mode != "RGBA":
        rep.fail(f"{rel} mode", "RGBA", im.mode)
        return None

    icc = im.info.get("icc_profile")
    if icc and b"sRGB" not in icc:
        rep.warn(f"{rel} colour profile", "non-sRGB ICC embedded; strip it or embed sRGB")

    a = load_rgba(path)
    alpha = a[..., 3]

    corners = [int(alpha[0, 0]), int(alpha[0, -1]), int(alpha[-1, 0]), int(alpha[-1, -1])]
    if max(corners) > tol["maxCornerAlpha"]:
        rep.fail(f"{rel} transparency", f'all corners <= {tol["maxCornerAlpha"]}', f"corners={corners}")
        return a

    m = opaque_mask(a, tol["alphaThreshold"])
    if not m.any():
        rep.fail(f"{rel} content", "non-empty layer", "fully transparent")
        return a

    ys, xs = np.where(m)
    margin = int(min(xs.min(), canvas["width"] - 1 - xs.max(), ys.min(), canvas["height"] - 1 - ys.max()))
    if margin < tol["edgeMarginPx"]:
        rep.fail(f"{rel} edge margin", f'>= {tol["edgeMarginPx"]}px', f"{margin}px")
        return a

    rep.ok(f"{rel}  {im.size[0]}x{im.size[1]} RGBA  margin={margin}px")
    return a


def check_recomposite(rep: Report, label: str, assembled: np.ndarray,
                      parts: dict[str, np.ndarray], z_order: list[str], tol: dict) -> None:
    """Stacking parts in z-order must reproduce assembled.png."""
    h, w = assembled.shape[:2]
    comp = np.zeros((h, w, 4), dtype=float)

    for name in z_order:
        if name not in parts:
            continue
        src = parts[name].astype(float)
        sa = src[..., 3:4] / 255.0
        comp[..., :3] = src[..., :3] * sa + comp[..., :3] * (1 - sa)
        comp[..., 3:4] = sa * 255.0 + comp[..., 3:4] * (1 - sa)

    thr = tol["alphaThreshold"]
    am = assembled[..., 3] > thr
    cm = comp[..., 3] > thr

    inter, union = int((am & cm).sum()), int((am | cm).sum())
    iou = inter / union if union else 0.0
    dropped = int((am & ~cm).sum())
    added = int((cm & ~am).sum())

    if iou < tol["recompositeIouMin"]:
        rep.fail(
            f"{label} recomposite coverage",
            f'IoU >= {tol["recompositeIouMin"]}',
            f"IoU={iou:.5f}  ({dropped:,} px in assembled but not in parts, {added:,} px the reverse)",
        )
        return

    both = am & cm
    delta = np.abs(assembled[..., :3].astype(float) - comp[..., :3])[both]
    mean_delta = float(delta.mean()) if delta.size else 0.0

    if mean_delta > tol["recompositeMeanRgbDeltaMax"]:
        rep.fail(
            f"{label} recomposite colour",
            f'mean |RGB delta| <= {tol["recompositeMeanRgbDeltaMax"]}',
            f"{mean_delta:.2f} (max {float(delta.max()):.0f})",
        )
        return

    rep.ok(f"{label} recomposite  IoU={iou:.5f}  mean delta={mean_delta:.2f}")


def check_seams(rep: Report, label: str, parts: dict[str, np.ndarray],
                adjacency: list[list[str]], tol: dict) -> None:
    """Adjacent parts must overdraw, or joints open gaps when the rig rotates."""
    thr, need = tol["alphaThreshold"], tol["minSeamOverlapPx"]
    masks = {k: opaque_mask(v, thr) for k, v in parts.items()}
    bad = []

    for a, b in adjacency:
        if a not in masks or b not in masks:
            continue
        overlap = int((masks[a] & masks[b]).sum())
        if overlap < need:
            bad.append((a, b, overlap))

    if bad:
        detail = ", ".join(f"{a}/{b}={n:,}px" for a, b, n in bad)
        rep.fail(f"{label} seam overdraw", f"every adjacent pair >= {need:,}px shared", detail)
        if all(n == 0 for _, _, n in bad):
            print(f"        {DIM}all zero -> parts are exact cutouts. See asset-brief.md section 3.3.{RESET}")
    else:
        rep.ok(f"{label} seam overdraw  ({len(adjacency)} pairs checked)")


def check_silhouette(rep: Report, label: str, assembled: np.ndarray,
                     signature: np.ndarray | None, sig_name: str, tol: dict) -> None:
    """The species signature must survive downscaling to phone size."""
    if signature is None:
        return

    thr = tol["alphaThreshold"]
    ys, xs = np.where(assembled[..., 3] > thr)
    height = int(ys.max() - ys.min() + 1)
    scale = tol["silhouetteHeightPx"] / height

    sig_img = Image.fromarray(signature)
    small = sig_img.resize(
        (max(1, int(sig_img.width * scale)), max(1, int(sig_img.height * scale))),
        Image.LANCZOS,
    )
    px = int((np.array(small)[..., 3] > thr).sum())
    need = tol["minSignaturePxAtSilhouette"]

    if px < need:
        rep.fail(
            f"{label} signature legibility ({sig_name})",
            f'>= {need}px at {tol["silhouetteHeightPx"]}px tall',
            f"{px}px - too thin to read on a phone",
        )
    else:
        rep.ok(f"{label} signature legibility  {sig_name}={px}px at {tol['silhouetteHeightPx']}px tall")


def dominant_hue(img: np.ndarray, thr: int) -> float | None:
    """Saturation-weighted circular mean hue. Ignores outline and blown highlights."""
    px = img[img[..., 3] > 200][:, :3].astype(float) / 255.0
    if len(px) == 0:
        return None

    mx, mn = px.max(1), px.min(1)
    val, chroma = mx, mx - mn
    sat = np.where(mx > 0, chroma / np.maximum(mx, 1e-6), 0.0)

    keep = (val > 0.15) & (val < 0.97) & (sat > 0.02)
    if keep.sum() < 50:
        return None
    px, val, chroma, sat = px[keep], val[keep], chroma[keep], sat[keep]

    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    c = np.maximum(chroma, 1e-6)
    hue = np.where(
        val == r, ((g - b) / c) % 6,
        np.where(val == g, (b - r) / c + 2, (r - g) / c + 4),
    ) * 60.0

    rad = np.deg2rad(hue)
    x = float((np.cos(rad) * sat).sum())
    y = float((np.sin(rad) * sat).sum())
    return float(np.rad2deg(np.arctan2(y, x)) % 360)


def hex_hue(h: str) -> float:
    rgb = np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float) / 255.0
    mx, mn = rgb.max(), rgb.min()
    if mx == mn:
        return 0.0
    r, g, b = rgb
    c = mx - mn
    if mx == r:
        return ((g - b) / c % 6) * 60
    if mx == g:
        return ((b - r) / c + 2) * 60
    return ((r - g) / c + 4) * 60


def hue_delta(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


def check_palette(rep: Report, label: str, species: dict,
                  parts: dict[str, np.ndarray], tol: dict) -> None:
    """Species colour identity. WARN only - hexes are targets, not requirements."""
    pal = species.get("palette")
    if not pal:
        return

    slots = [("coat", "body"), ("mane", "mane"), ("accent", species["signature"])]
    drifted = []
    thr = tol["alphaThreshold"]

    for slot, part in slots:
        if part not in parts or slot not in pal:
            continue

        # Measure only pixels unique to this part. Seam overdraw (section 3.3) means
        # each layer carries a rim of its neighbours' pixels; including those would
        # contaminate the reading - e.g. a blue horn reads violet because it
        # overdraws into the mane.
        own = opaque_mask(parts[part], thr)
        for other, arr in parts.items():
            if other != part:
                own &= ~opaque_mask(arr, thr)

        if own.sum() < 200:
            continue
        exclusive = parts[part].copy()
        exclusive[..., 3] = np.where(own, exclusive[..., 3], 0)

        got = dominant_hue(exclusive, thr)
        if got is None:
            continue
        want = hex_hue(pal[slot])
        d = hue_delta(got, want)
        if d > tol["paletteHueToleranceDeg"]:
            drifted.append(f"{slot}({part}.png) target={pal[slot]} hue {want:.0f}deg, got {got:.0f}deg, off by {d:.0f}deg")

    if drifted:
        rep.warn(f"{label} palette drift", "; ".join(drifted))
    else:
        rep.ok(f"{label} palette  (3 slots within {tol['paletteHueToleranceDeg']}deg)")


def joint_centroids(parts: dict[str, np.ndarray], assembled: np.ndarray,
                    adjacency: list[list[str]], thr: int) -> dict[str, tuple[float, float]]:
    """Joint locations as the centroid of each seam-overlap band, normalised to the
    character's bounding box.

    Normalised because tiers legitimately get bigger - a `mythic` is taller than a
    `fledgling`, and a rig absorbs that with a per-tier scale. What must not change
    is where a joint sits *relative to the body*.

    Only structural pairs are passed in. Growth parts (mane, horn, wings, tail) get
    much larger between tiers, which moves the centroid of their seam band without
    moving the attachment point - measuring them measures growth, not drift.
    """
    masks = {k: opaque_mask(v, thr) for k, v in parts.items()}
    ys, xs = np.where(opaque_mask(assembled, thr))
    bx0, by0 = float(xs.min()), float(ys.min())
    bw, bh = float(xs.max() - bx0), float(ys.max() - by0)
    if bw <= 0 or bh <= 0:
        return {}

    joints: dict[str, tuple[float, float]] = {}
    for a, b in adjacency:
        if a not in masks or b not in masks:
            continue
        band = masks[a] & masks[b]
        if band.sum() < 50:
            continue
        jy, jx = np.where(band)
        joints[f"{a}/{b}"] = ((float(jx.mean()) - bx0) / bw, (float(jy.mean()) - by0) / bh)
    return joints


def check_cross_tier(rep: Report, species: dict,
                     per_tier: dict[str, tuple[dict[str, np.ndarray], np.ndarray]],
                     adjacency: list[list[str]], canvas: dict, tol: dict) -> None:
    """All tiers of a species share one rig skeleton, so structural joints must stay
    in the same place relative to the body.

    Dormant until two tiers of the same species exist. If this fails, the level-up
    transformation is impossible - each tier would need its own rig.
    """
    tiers = [t for t in ["fledgling", "sworn", "radiant", "mythic"] if t in per_tier]
    if len(tiers) < 2:
        return

    thr = tol["alphaThreshold"]
    limit = tol["jointDriftToleranceNormalizedPx"]
    ref_tier = tiers[0]
    ref = joint_centroids(*per_tier[ref_tier], adjacency, thr)
    if not ref:
        return

    print(f"\n{BOLD}{species['id']} cross-tier{RESET}")
    scale = float(canvas["height"])  # express normalised drift back in canvas px

    for tier in tiers[1:]:
        got = joint_centroids(*per_tier[tier], adjacency, thr)
        drifted, checked, worst = [], 0, 0.0
        for name, (rx, ry) in ref.items():
            if name not in got:
                continue
            checked += 1
            gx, gy = got[name]
            d = (((gx - rx) * scale) ** 2 + ((gy - ry) * scale) ** 2) ** 0.5
            worst = max(worst, d)
            if d > limit:
                drifted.append(f"{name} drifted {d:.0f}px")

        label = f"{species['id']} {ref_tier}->{tier} joint registration"
        if drifted:
            rep.fail(label, f"structural joints within {limit}px (normalised)", "; ".join(drifted))
            print(f"        {DIM}tiers share one skeleton. See asset-brief.md section 3.2.{RESET}")
        elif checked:
            rep.ok(f"{label}  ({checked} structural joints, worst {worst:.0f}px of {limit})")


def check_origin(rep: Report, label: str, assembled: np.ndarray, canvas: dict, tol: dict) -> None:
    ys, _ = np.where(assembled[..., 3] > tol["alphaThreshold"])
    feet = int(ys.max())
    drift = abs(feet - canvas["originY"])
    if drift > tol["originYTolerancePx"]:
        rep.fail(f"{label} origin", f'feet at y={canvas["originY"]} (+/-{tol["originYTolerancePx"]})', f"y={feet}")
    else:
        rep.ok(f"{label} origin  feet at y={feet}")


# ----------------------------------------------------------------------------- driver


def verify_set(rep: Report, mf: dict, species: dict, tier: str):
    canvas, tol = mf["canvas"], mf["tolerance"]
    sid = species["id"]
    label = f"{sid}/{tier}"
    base = os.path.join(ROOT, "assets", "characters", sid, tier)

    print(f"\n{BOLD}{label}{RESET}")

    asm_path = os.path.join(base, "assembled.png")
    if not os.path.exists(asm_path):
        rep.fail(f"{label} assembled.png", "present", "missing")
        return None

    assembled = check_format(rep, asm_path, canvas, tol)
    if assembled is None:
        return None

    expected = species["parts"]
    parts_dir = os.path.join(base, "parts")
    found = sorted(
        os.path.splitext(f)[0] for f in os.listdir(parts_dir) if f.endswith(".png")
    ) if os.path.isdir(parts_dir) else []

    missing = [p for p in expected if p not in found]
    extra = [p for p in found if p not in expected]

    if missing or extra:
        rep.fail(
            f"{label} part inventory",
            f"exactly {expected}",
            f"missing={missing or 'none'}  unexpected={extra or 'none'}",
        )
    else:
        rep.ok(f"{label} part inventory  ({len(expected)} parts)")

    parts: dict[str, np.ndarray] = {}
    for name in expected:
        p = os.path.join(parts_dir, f"{name}.png")
        if not os.path.exists(p):
            continue
        arr = check_format(rep, p, canvas, tol)
        if arr is not None:
            parts[name] = arr

    if not parts:
        return None

    check_origin(rep, label, assembled, canvas, tol)
    check_recomposite(rep, label, assembled, parts, mf["zOrder"], tol)
    check_seams(rep, label, parts, mf["adjacency"], tol)
    check_silhouette(rep, label, assembled, parts.get(species["signature"]), species["signature"], tol)
    check_palette(rep, label, species, parts, tol)
    return parts, assembled


def check_effects(rep: Report, mf: dict) -> None:
    """Effect sheets — declared, present, and the size they say they are.

    This check exists because it was missing. Six `aura_*` sheets shipped with
    no manifest entry at all and nothing noticed, because `verify.py` walked
    `mf["species"]` and never opened `assets/effects/`. A gate that cannot see a
    directory is not a gate over that directory, however many other checks pass.

    Both directions matter. An undeclared sheet is dead weight the renderer will
    never load; a declared sheet with no file is a runtime 404 in the middle of
    a fight, which is worse. So neither side is allowed to be longer than the
    other.
    """
    directory = os.path.join(ROOT, "assets", "effects")
    if not os.path.isdir(directory):
        rep.warn("assets/effects/ is missing", "No effect sheets to check.")
        return

    on_disk = {
        f[: -len(".sheet.png")]
        for f in os.listdir(directory)
        if f.endswith(".sheet.png")
    }
    declared = {e["id"]: e for e in mf.get("effects", [])}

    for eid in sorted(on_disk - set(declared)):
        rep.fail(f"effects/{eid}  undeclared",
                 "an entry in manifest.effects[]",
                 "a sheet on disk that the manifest never mentions")
    for eid in sorted(set(declared) - on_disk):
        rep.fail(f"effects/{eid}  missing sheet",
                 f"assets/effects/{eid}.sheet.png",
                 "declared in the manifest, not on disk")

    for eid in sorted(on_disk & set(declared)):
        entry = declared[eid]
        frames, size = entry.get("frames"), entry.get("size")
        label = f"effects/{eid}"

        # The sidecar is what the renderer reads at runtime, so a manifest that
        # disagrees with it describes an animation nobody will ever play.
        side = os.path.join(directory, f"{eid}.json")
        if os.path.exists(side):
            with open(side, encoding="utf-8") as f:
                meta = json.load(f)
            for key in ("frames", "fps", "size"):
                if key in meta and key in entry and meta[key] != entry[key]:
                    rep.fail(f"{label}  {key} disagrees with its sidecar",
                             f"{key}={meta[key]} (from {eid}.json)", f"{key}={entry[key]}")
        else:
            rep.fail(f"{label}  no sidecar", f"assets/effects/{eid}.json", "missing")

        # A strip is frames laid left to right at `size` square. Getting this
        # wrong shows up as a sprite sampling half of the next frame.
        img = load_rgba(os.path.join(directory, f"{eid}.sheet.png"))
        h, w = img.shape[0], img.shape[1]
        if (w, h) != (frames * size, size):
            rep.fail(f"{label}  sheet is the wrong size",
                     f"{frames * size}x{size}  ({frames} frames of {size}px)", f"{w}x{h}")
            continue

        # An empty frame is a dropped frame, and it reads as a stutter rather
        # than as a missing file.
        blanks = [
            i for i in range(frames)
            if not opaque_mask(img[:, i * size : (i + 1) * size], 8).any()
        ]
        if blanks:
            rep.fail(f"{label}  {len(blanks)} blank frame(s)",
                     "every frame has visible pixels", f"frames {blanks[:6]} are empty")
            continue

        rep.ok(f"{label}  {frames} frames @ {entry.get('fps', '?')}fps, {size}px")


def verify_entity(rep: Report, mf: dict, entity: dict) -> None:
    """Canonical NPCs and creatures are single, non-rigged runtime cutouts."""
    entity_id = entity["id"]
    label = f"entity/{entity_id}"
    print(f"\n{BOLD}{label}{RESET}")

    path = os.path.join(ROOT, "assets", "entities", entity_id, "assembled.png")
    if not os.path.exists(path):
        rep.fail(f"{label} assembled.png", "present", "missing")
        return

    if entity.get("primaryBiome") not in mf["biomes"]:
        rep.fail(
            f"{label} primary biome",
            "an id in manifest.biomes",
            entity.get("primaryBiome"),
        )
    else:
        rep.ok(f"{label} primary biome  {entity['primaryBiome']}")

    if not entity.get("canonicalLocations"):
        rep.fail(f"{label} canonical locations", "at least one location", "none")
    else:
        rep.ok(
            f"{label} canonical locations  "
            f"{', '.join(entity['canonicalLocations'])}"
        )

    check_format(rep, path, mf["canvas"], mf["tolerance"])


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    strict = "--strict" in sys.argv

    if not os.path.exists(MANIFEST):
        sys.exit(f"error: no manifest at {MANIFEST}")
    with open(MANIFEST, encoding="utf-8") as f:
        mf = json.load(f)

    targets: list[tuple[dict, str]] = []
    for sp in mf["species"]:
        for tier in mf["tiers"]:
            if args:
                if not any(
                    a == sp["id"] or a == f'{sp["id"]}/{tier}'
                    for a in args
                ):
                    continue
            targets.append((sp, tier))

    rep = Report()
    skipped: list[str] = []

    print(f"{BOLD}Kids & Dragons - asset verify{RESET}")
    print(f"{DIM}manifest: {os.path.relpath(MANIFEST, ROOT)}{RESET}")

    collected: dict[str, dict[str, tuple]] = {}

    for sp, tier in targets:
        base = os.path.join(ROOT, "assets", "characters", sp["id"], tier)
        if not os.path.isdir(base):
            skipped.append(f'{sp["id"]}/{tier}')
            continue
        result = verify_set(rep, mf, sp, tier)
        if result:
            collected.setdefault(sp["id"], {})[tier] = result

    for sp in mf["species"]:
        per_tier = collected.get(sp["id"])
        if per_tier:
            check_cross_tier(rep, sp, per_tier,
                             mf.get("structuralAdjacency", mf["adjacency"]),
                             mf["canvas"], mf["tolerance"])

    for entity in mf.get("entities", []):
        if args and entity["id"] not in args:
            continue
        verify_entity(rep, mf, entity)

    # Not gated on `args`: the effect sheets are shared by every species, so
    # narrowing to one character should not stop checking them.
    check_effects(rep, mf)

    print(f"\n{BOLD}{'-' * 60}{RESET}")
    if skipped:
        word = "FAIL" if strict else "not yet delivered"
        print(f"{DIM}{word}: {len(skipped)} set(s) - {', '.join(skipped[:6])}"
              f"{'...' if len(skipped) > 6 else ''}{RESET}")

    print(f"{GREEN}{rep.passed} passed{RESET}"
          f"{f'   {YELLOW}{len(rep.warnings)} warnings{RESET}' if rep.warnings else ''}"
          f"{f'   {RED}{len(rep.failures)} FAILED{RESET}' if rep.failures else ''}")

    if rep.failures:
        print(f"\n{RED}{BOLD}FAILED{RESET} - see docs/asset-brief.md for the spec behind each rule.")
        return 1
    if strict and skipped:
        print(f"\n{RED}{BOLD}FAILED{RESET} - --strict and {len(skipped)} set(s) undelivered.")
        return 1

    print(f"\n{GREEN}{BOLD}PASS{RESET} - mechanical checks clean. "
          f"Artistic review is still required (asset-brief.md section 6.2).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
