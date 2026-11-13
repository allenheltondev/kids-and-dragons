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
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("error: needs Pillow and numpy  ->  pip install pillow numpy")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coat  # noqa: E402  (coat masks: tools/art/coat.py)

# KAD_REPO_ROOT lets a test point the gate at a temporary tree.
ROOT = os.environ.get("KAD_REPO_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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

    def fail(self, label: str, expected: object, actual: object, hint: str = "") -> None:
        self.failures.append(label)
        print(f"  {RED}FAIL{RESET}  {label}")
        print(f"        expected: {expected}")
        print(f"        actual:   {actual}")
        # A failure an artist cannot act on is a failure they will ask about.
        # The hint carries the section of the brief that decided the rule.
        if hint:
            print(f"        {DIM}{hint}{RESET}")

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


def check_origin(rep: Report, label: str, assembled: np.ndarray, canvas: dict, tol: dict) -> None:
    ys, _ = np.where(assembled[..., 3] > tol["alphaThreshold"])
    if not ys.size:
        rep.fail(f"{label} content", "visible figure", "empty")
        return
    feet = int(ys.max())
    drift = abs(feet - canvas["originY"])
    if drift > tol["originYTolerancePx"]:
        rep.fail(f"{label} origin", f'feet at y={canvas["originY"]} (+/-{tol["originYTolerancePx"]})', f"y={feet}")
    else:
        rep.ok(f"{label} origin  feet at y={feet}")


# ----------------------------------------------------------------------------- driver


def check_together_overlays(rep: Report, mf: dict) -> None:
    """Together overlays: every declared state exists, fits and registers (§7.4)."""
    directory = os.path.join(ROOT, "assets", "together")
    declared: set[str] = set()
    moves: set[str] = set()
    threshold = mf["tolerance"]["alphaThreshold"]
    margin = mf["tolerance"]["edgeMarginPx"]
    band_states = {"heave": ["slack", "taut"], "hum": ["wobble", "together"], "tiptoe": ["hush", "over"]}
    for entry in mf.get("togetherOverlays", []):
        move = entry.get("move")
        if move not in band_states or move in moves:
            rep.fail("together move", "a unique heave, hum or tiptoe", move)
            continue
        moves.add(move)
        for kind in ("band", "token"):
            label = f"together/{move}/{kind}"
            expected = (
                dict(width=1600, height=360, clearTopPx=90, fadeSidePx=48, states=band_states[move])
                if kind == "band" else
                dict(size=192, holeRadius=62, states=["empty", "holding", "done", "helped"])
            )
            if entry.get(kind) != expected:
                rep.fail(f"{label} declaration", expected, entry.get(kind))
                continue
            width, height = (1600, 360) if kind == "band" else (192, 192)
            painted: list[tuple[str, np.ndarray, tuple[float, float]]] = []
            for state in expected["states"]:
                relative = f"{move}/{kind}-{state}.png"
                declared.add(relative)
                path = os.path.join(directory, move, f"{kind}-{state}.png")
                name = f"together/{relative}"
                if not os.path.isfile(path):
                    rep.fail(name, "present", "missing")
                    continue
                try:
                    with Image.open(path) as image:
                        if image.format != "PNG" or image.mode != "RGBA" or image.size != (width, height):
                            rep.fail(f"{name} format", f"{width}x{height} RGBA PNG", f"{image.size} {image.mode} {image.format}")
                            continue
                        pixels = np.array(image)
                except Exception as error:
                    rep.fail(f"{name} format", "a decodable PNG", str(error))
                    continue
                cap = 256000 if kind == "band" else 30720
                if os.path.getsize(path) > cap:
                    rep.fail(f"{name} bytes", f"at most {cap}", os.path.getsize(path))
                else:
                    rep.ok(f"{name} format and bytes")
                alpha = pixels[..., 3]
                yy, xx = np.indices(alpha.shape)
                if kind == "band":
                    clear = bool((alpha[:expected["clearTopPx"]] <= threshold).all())
                    sides = expected["fadeSidePx"]
                    fades = bool((alpha[:, :sides] < 255).all() and (alpha[:, -sides:] < 255).all())
                    if not clear or not fades:
                        rep.fail(f"{name} transparency", "clear top 90 rows and fading outer 48 columns", f"clear={clear}, fades={fades}")
                    else:
                        rep.ok(f"{name} transparency")
                else:
                    clear_area = ((xx < margin) | (xx >= width - margin) | (yy < margin) | (yy >= height - margin)
                                  | ((xx - (width - 1) / 2) ** 2 + (yy - (height - 1) / 2) ** 2 <= expected["holeRadius"] ** 2))
                    if (alpha[clear_area] > threshold).any():
                        rep.fail(f"{name} transparency", "clear 62px-radius centre and 8px edge", "paint in a clear region")
                    else:
                        rep.ok(f"{name} transparency")
                ys, xs = np.where(alpha > threshold)
                if not len(xs):
                    rep.fail(f"{name} visible", "painted subject", "blank")
                    continue
                centre = (float(xs.mean()), float(ys.mean()))
                if kind == "token" and np.hypot(centre[0] - (width - 1) / 2, centre[1] - (height - 1) / 2) > margin:
                    rep.fail(f"{name} registration", f"centred within {margin}px", centre)
                else:
                    rep.ok(f"{name} visible and registered")
                for prior_state, prior, _ in painted:
                    if np.array_equal(prior, pixels):
                        rep.fail(f"{label} distinct states", f"{state} differs from {prior_state}", "identical pixels")
                painted.append((state, pixels, centre))
            if kind == "band" and len(painted) == 2:
                distance = np.hypot(*(np.subtract(painted[0][2], painted[1][2])))
                if distance > margin:
                    rep.fail(f"{label} registration", f"state centroids within {margin}px", float(distance))
                else:
                    rep.ok(f"{label} state registration")
    if os.path.isdir(directory):
        for base, _, files in os.walk(directory):
            for filename in files:
                if filename.lower().endswith(".png"):
                    relative = os.path.relpath(os.path.join(base, filename), directory).replace(os.sep, "/")
                    if relative not in declared:
                        rep.fail(f"together/{relative} undeclared", "declared in manifest.togetherOverlays", "undeclared PNG")


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
    tol = mf["tolerance"]
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
            for key in ("frames", "fps", "size", "columns"):
                if key in meta and key in entry and meta[key] != entry[key]:
                    rep.fail(f"{label}  {key} disagrees with its sidecar",
                             f"{key}={meta[key]} (from {eid}.json)", f"{key}={entry[key]}")
        else:
            rep.fail(f"{label}  no sidecar", f"assets/effects/{eid}.json", "missing")

        # Old sheets are strips; an explicit column count enables a row-major
        # grid without changing their default layout.
        img = load_rgba(os.path.join(directory, f"{eid}.sheet.png"))
        h, w = img.shape[0], img.shape[1]
        columns = entry.get("columns", frames)
        rows = (frames + columns - 1) // columns
        if (w, h) != (columns * size, rows * size):
            rep.fail(f"{label}  sheet is the wrong size",
                     f"{columns * size}x{rows * size}  ({frames} frames of {size}px)", f"{w}x{h}")
            continue

        # An empty frame is a dropped frame, and it reads as a stutter rather
        # than as a missing file.
        blanks = [
            i for i in range(frames)
            if not opaque_mask(effect_frame(img, entry, i, size), tol["alphaThreshold"]).any()
        ]
        if blanks:
            rep.fail(f"{label}  {len(blanks)} blank frame(s)",
                     "every frame has visible pixels", f"frames {blanks[:6]} are empty")
            continue

        if not check_effect_composition(rep, label, img, entry, frames, size, tol):
            continue

        rep.ok(f"{label}  {frames} frames @ {entry.get('fps', '?')}fps, {size}px")


def effect_frame(img: np.ndarray, entry: dict, index: int, size: int) -> np.ndarray:
    columns = entry.get("columns", img.shape[1] // size)
    x, y = (index % columns) * size, (index // columns) * size
    return img[y:y + size, x:x + size]


def check_effect_composition(rep: Report, label: str, img: np.ndarray,
                             entry: dict, frames: int, size: int, tol: dict) -> bool:
    """Where an effect's mass sits, and how long it runs — asset-brief.md §9.4/§9.6.

    Geometry is not enough. A sheet can be exactly the right size, have no blank
    frames, and still be unusable in a fight for four reasons, all of which are
    decidable from the pixels and none of which a human notices reliably at 12fps
    on a television across the room.

    None of these is about taste. Each one is a specific thing an 8-year-old
    cannot do if the sheet gets it wrong: tell which figure was hit, read the
    damage number, see the effect fade in rather than pop, or see the colour the
    renderer tinted it.
    """
    alpha = tol["alphaThreshold"]
    ok = True

    def frame(i: int) -> np.ndarray:
        return effect_frame(img, entry, i, size)

    # Three of the checks below only make sense for a **one-shot effect that
    # plays during a turn**, and getting that scoping wrong is how the first
    # version of this function failed eight shipped sheets for doing their job:
    #
    #   - A `loop: true` aura must NOT fade in and out. It is continuous, so a
    #     fade at either end is a pulse to nothing once a second.
    #   - An `outOfCombat: true` cutscene has no damage numbers to crowd. There
    #     is nothing else on the screen; that is what makes it a cutscene.
    #
    # So the flags are load-bearing and the manifest has to carry them honestly.
    # An unflagged sheet is measured as an in-combat one-shot, which is the
    # strictest reading and the right default.
    one_shot = not entry.get("loop")
    in_combat = not entry.get("outOfCombat")

    # --- fade in and out. The first and last frame are a fade, not a pose. A
    # sheet that starts at full brightness pops, and a pop reads as a second,
    # separate event on a screen that already has a lot happening.
    end_max = tol["effectEndFrameCoverageMax"]
    if one_shot:
        for name, i in (("first", 0), ("last", frames - 1)):
            # A story transition joins a continuous loop at one endpoint.
            # Only that endpoint is exempt: its other end must still fade.
            handoff = entry.get("handoff") if not in_combat else None
            if (handoff == "toLoop" and name == "last") or (handoff == "fromLoop" and name == "first"):
                continue
            coverage = float(opaque_mask(frame(i), alpha).mean())
            if coverage > end_max:
                rep.fail(f"{label}  {name} frame does not fade",
                         f"≤ {end_max:.0%} of the frame opaque",
                         f"{coverage:.1%}  (frame {i})",
                         "§9.4: an effect that starts or ends at full strength pops, and a pop is a second event. "
                         "A continuously-playing effect is exempt — mark it loop: true.")
                ok = False

    # --- tile-scoped mass. Three players and up to four enemies means the
    # neighbouring tiles are usually occupied, so an effect that straddles two of
    # them is a question: which figure did that? `tileScoped: false` is the opt
    # out for effects that play on a figure rather than on a tile (the auras).
    if entry.get("tileScoped", True):
        centre_min = tol["effectCentreEnergyMin"]
        lo, hi = size // 4, size - size // 4
        total = 0.0
        inside = 0.0
        for i in range(frames):
            mask = opaque_mask(frame(i), alpha)
            total += float(mask.sum())
            inside += float(mask[lo:hi, lo:hi].sum())
        share = inside / total if total > 0 else 0.0
        if share < centre_min:
            rep.fail(f"{label}  mass escapes its tile",
                     f"≥ {centre_min:.0%} of opaque mass inside the centre {hi - lo}x{hi - lo}",
                     f"{share:.1%}",
                     "§9.6: an effect spilling onto a neighbouring occupied tile leaves her guessing who was hit. "
                     "Set tileScoped: false only if it plays on a figure.")
            ok = False

    # --- the top band belongs to the damage numbers (§9.4). They are the only
    # text in a fight she has to read, and an effect drawn behind a number is a
    # number that does not exist.
    # Scoped to the effects that play *at the moment a number appears* — the
    # tile-scoped impacts. A figure aura is a draw-order question for the client,
    # and a cutscene has no numbers at all.
    if in_combat and entry.get("tileScoped", True):
        band_px = tol["effectTopBandPx"]
        band_max = tol["effectTopBandCoverageMax"]
        worst_band = 0.0
        for i in range(frames):
            worst_band = max(worst_band, float(opaque_mask(frame(i)[:band_px], alpha).mean()))
        if worst_band > band_max:
            rep.fail(f"{label}  crowds the damage numbers",
                     f"≤ {band_max:.0%} of the top {band_px}px opaque",
                     f"{worst_band:.1%} at its worst frame",
                     "§9.4: damage numbers own the top band. It is the only text in a fight she has to read.")
            ok = False

    # --- tint safety. A sheet the renderer recolours has to be near-greyscale,
    # or the tint fights the art it is multiplied into and the result is neither
    # colour. Measured as HSV saturation over opaque pixels only — the
    # transparent ones carry whatever RGB the exporter left behind.
    if entry.get("tintable"):
        sat_max = tol["tintableMaxSaturation"]
        worst_sat = 0.0
        for i in range(frames):
            f = frame(i)
            mask = opaque_mask(f, alpha)
            if not mask.any():
                continue
            rgb = f[..., :3][mask].astype(np.float32) / 255.0
            mx = rgb.max(axis=1)
            mn = rgb.min(axis=1)
            sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
            worst_sat = max(worst_sat, float(np.percentile(sat, 99)))
        if worst_sat > sat_max:
            rep.fail(f"{label}  too saturated to tint",
                     f"99th-percentile HSV saturation ≤ {sat_max:.2f}",
                     f"{worst_sat:.2f}",
                     "§9.4: a tintable sheet is recoloured at runtime. Colour already in the art fights the tint.")
            ok = False

    # --- combat frame budget. 12 frames at 12fps is one second, and §9.2's turn
    # has no room for more. An effect longer than that is out of combat by
    # definition, and saying so is a one-word manifest change — so the flag is
    # the honest way to ask, and its absence is not an oversight to tolerate.
    if not entry.get("outOfCombat") and frames > tol["combatEffectMaxFrames"]:
        rep.fail(f"{label}  too long for a turn",
                 f"≤ {tol['combatEffectMaxFrames']} frames, or outOfCombat: true",
                 f"{frames} frames",
                 "§9.2's turn budget is 45 ticks total. Mark it outOfCombat if it plays between turns.")
        ok = False

    return ok


def verify_cast_figure(rep: Report, mf: dict, figure: dict) -> None:
    """A named character's own story figure (manifest.castFigures)."""
    figure_id = figure["id"]
    label = f"cast/{figure_id}"
    print(f"\n{BOLD}{label}{RESET}")

    path = os.path.join(ROOT, "assets", "cast", figure_id, "assembled.png")
    if not os.path.exists(path):
        rep.fail(f"{label} assembled.png", "present", "missing")
        return

    basis = figure.get("basis", "")
    kinds = {e["id"] for e in mf.get("entities", [])} | {s["id"] for s in mf["species"]} | {s["id"] for s in mf.get("stageFigures", [])}
    if basis not in kinds:
        rep.fail(f"{label} basis", "an entity, species or stage-animal id", basis or "none")
    else:
        rep.ok(f"{label} basis  {basis}")

    a = check_format(rep, path, mf["canvas"], mf["tolerance"])
    if a is None:
        return
    # Standing on the floor: the stage hangs every figure from the canvas
    # origin, so feet that stop short float and feet past it sink.
    m = opaque_mask(a, mf["tolerance"]["alphaThreshold"])
    if m.any():
        bottom = int(np.where(m)[0].max())
        origin = mf["canvas"]["originY"]
        if abs(bottom - origin) > 12:
            rep.fail(f"{label} feet", f"lowest opaque row within 12px of y={origin}", f"y={bottom}")
        else:
            rep.ok(f"{label} feet  y={bottom}")


def verify_stage_figure(rep: Report, mf: dict, figure: dict) -> None:
    """Ordinary stage animals use the same cutout format as canonical entities."""
    label = f"stage/{figure['id']}"
    print(f"\n{BOLD}{label}{RESET}")
    path = os.path.join(ROOT, "assets", "entities", figure["id"], "assembled.png")
    if not os.path.isfile(path):
        rep.fail(f"{label} assembled.png", "present", "missing")
        return
    check_format(rep, path, mf["canvas"], mf["tolerance"])


def verify_entity(rep: Report, mf: dict, entity: dict) -> None:
    """Canonical NPCs and creatures are single, non-rigged runtime cutouts."""
    entity_id = entity["id"]
    label = f"entity/{entity_id}"
    print(f"\n{BOLD}{label}{RESET}")

    path = os.path.join(ROOT, "assets", "entities", entity_id, "assembled.png")
    if not os.path.exists(path):
        rep.fail(f"{label} assembled.png", "present", "missing")
        return

    declared_biomes = set(mf["biomes"]) | set(mf.get("backgroundOnlyBiomes", []))
    if entity.get("primaryBiome") not in declared_biomes:
        rep.fail(
            f"{label} primary biome",
            "an id in manifest.biomes or manifest.backgroundOnlyBiomes",
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

    # Colossal, multi-tile individuals may declare their own canvas while the
    # ordinary one-tile entity contract continues to use manifest.canvas.
    check_format(rep, path, entity.get("canvas", mf["canvas"]), mf["tolerance"])

    # A people may deliver named appearance states beside its ordinary cutout.
    # Check every declared state, rather than letting a valid assembled.png
    # conceal a missing or opaque alternate (Riftlight's puffed Skupper).
    directory = os.path.dirname(path)
    for state, relative in entity.get("states", {}).items():
        state_path = os.path.normpath(os.path.join(ROOT, "assets", relative))
        if os.path.normcase(os.path.dirname(state_path)) != os.path.normcase(directory):
            rep.fail(f"{label} state {state}", "a file in this entity's directory", relative)
        elif not os.path.isfile(state_path):
            rep.fail(f"{label} state {state}", "present", "missing")
        elif os.path.normcase(state_path) != os.path.normcase(path):
            check_format(rep, state_path, entity.get("canvas", mf["canvas"]), mf["tolerance"])


def check_gear_portraits(rep: Report, mf: dict) -> None:
    """Opaque portrait composites, distinct from transparent rig gear.

    Each declaration is a deliberate cross-product of exact species, class,
    and tier combinations. A missing file would otherwise degrade silently to
    base species art in the client, so the manifest owns both existence and the
    square canvas these commissioned illustrations were approved on.
    """
    root = os.path.join(ROOT, "assets", "gear-portraits")
    declared: set[str] = set()

    for group in mf.get("gearPortraits", []):
        cls = group["class"]
        canvas = group["canvas"]
        expected_size = (canvas["width"], canvas["height"])
        for tier in group.get("tiers", []):
            for species in group.get("species", []):
                rel = os.path.join(cls, tier, f"{species}.png")
                label = f"gear-portraits/{cls}/{tier}/{species}.png"
                path = os.path.join(root, rel)
                declared.add(os.path.normcase(os.path.normpath(path)))
                if not os.path.exists(path):
                    rep.fail(label, "present", "missing")
                    continue
                try:
                    with Image.open(path) as im:
                        actual_size = im.size
                        mode = im.mode
                        image_format = im.format
                        im.verify()
                except Exception as err:  # noqa: BLE001 - a bad PNG is the finding
                    rep.fail(label, "a decodable PNG", str(err))
                    continue
                if image_format != "PNG":
                    rep.fail(f"{label} format", "PNG", image_format)
                    continue
                if actual_size != expected_size:
                    rep.fail(
                        f"{label} canvas",
                        f"{expected_size[0]}x{expected_size[1]}",
                        f"{actual_size[0]}x{actual_size[1]}",
                    )
                    continue
                if mode not in ("RGB", "RGBA"):
                    rep.fail(f"{label} mode", "RGB or RGBA", mode)
                    continue
                rep.ok(f"{label}  {actual_size[0]}x{actual_size[1]} {mode}")

    if not os.path.isdir(root):
        return
    for base, _, files in os.walk(root):
        for filename in files:
            if not filename.lower().endswith(".png"):
                continue
            if filename.lower().endswith(".coat-mask.png"):
                continue  # a hero-looks mask: check_coat_masks owns it (and its strays)
            path = os.path.normcase(os.path.normpath(os.path.join(base, filename)))
            if path not in declared:
                rep.fail(
                    os.path.relpath(path, ROOT),
                    "declared in manifest.gearPortraits",
                    "undeclared PNG",
                )


def check_figure_variants(rep: Report, mf: dict) -> None:
    """Validate finished transparent class illustrations, without rig inputs."""
    for variant in mf.get("figureVariants", []):
        cls, tier, species = variant["class"], variant["tier"], variant["species"]
        label = f"character-rigs/{cls}/{tier}/{species}"
        path = os.path.join(ROOT, "assets", label, "assembled.png")
        if not os.path.isfile(path):
            rep.fail(label, "finished illustration", "missing")
            continue
        image = load_rgba(path)
        check_format(rep, path, mf["canvas"], mf["tolerance"])
        check_origin(rep, label, image, mf["canvas"], mf["tolerance"])


def check_campaign_art(rep: Report, mf: dict) -> None:
    """Lobby key art: the declared size, opaque, and nothing undeclared.

    A missing painting is not a failure: the lobby stands in a scene from the
    campaign's story until it lands (CampaignArt.tsx). `art:inventory` lists
    what is still owed.
    """
    spec = mf.get("campaignArt")
    if not spec:
        return
    canvas = spec["canvas"]
    directory = os.path.join(ROOT, "assets", "campaigns")
    declared = set(spec["campaigns"])
    for cid in spec["campaigns"]:
        path = os.path.join(directory, f"{cid}.webp")
        label = f"campaigns/{cid}"
        if not os.path.isfile(path):
            rep.warn(f"{label}  not yet delivered", "the lobby shows a stand-in scene")
            continue
        with Image.open(path) as im:
            if im.format != "WEBP":
                rep.fail(f"{label} format", "WEBP", im.format)
                continue
            if im.size != (canvas["width"], canvas["height"]):
                rep.fail(f"{label} canvas", f"{canvas['width']}x{canvas['height']}", f"{im.size[0]}x{im.size[1]}")
                continue
            if im.mode == "RGBA" and np.asarray(im)[..., 3].min() < 255:
                rep.fail(f"{label} opaque", "no transparent pixels", "transparency")
                continue
        rep.ok(f"{label}  {canvas['width']}x{canvas['height']}")
    if os.path.isdir(directory):
        for filename in sorted(os.listdir(directory)):
            stem, _ = os.path.splitext(filename)
            if stem not in declared:
                rep.fail(f"campaigns/{filename} undeclared", "listed in manifest.campaignArt.campaigns", "undeclared file")


def check_story_plates(rep: Report, mf: dict) -> None:
    """Story plates (docs/story-plates.md): the declared size, opaque, nothing undeclared.

    A missing painting is not a failure: the story leaves that plate out until it
    lands. `art:inventory` lists what is still owed.
    """
    spec = mf.get("storyPlates")
    if not spec:
        return
    canvas = spec["canvas"]
    declared = set(spec["ids"])
    for plate in spec["ids"]:
        path = os.path.join(ROOT, "assets", f"{plate}.webp")
        if not os.path.isfile(path):
            rep.warn(f"{plate}  not yet delivered", "the story plays without this plate")
            continue
        with Image.open(path) as im:
            if im.format != "WEBP":
                rep.fail(f"{plate} format", "WEBP", im.format)
                continue
            if im.size != (canvas["width"], canvas["height"]):
                rep.fail(f"{plate} canvas", f"{canvas['width']}x{canvas['height']}", f"{im.size[0]}x{im.size[1]}")
                continue
            if im.mode == "RGBA" and np.asarray(im)[..., 3].min() < 255:
                rep.fail(f"{plate} opaque", "no transparent pixels", "transparency")
                continue
        rep.ok(f"{plate}  {canvas['width']}x{canvas['height']}")
    root = os.path.join(ROOT, "assets", "plates")
    for folder, _, files in os.walk(root):
        for filename in sorted(files):
            if "@" in filename:
                continue  # a derived copy (`npm run art:small`): its painting is what is declared
            stem, _ = os.path.splitext(filename)
            plate = os.path.relpath(os.path.join(folder, stem), os.path.join(ROOT, "assets")).replace(os.sep, "/")
            if plate not in declared:
                rep.fail(f"{plate} undeclared", "listed in manifest.storyPlates.ids", "undeclared file")


CAMP_ACTIONS = {"warmUp", "lookUp", "peek", "rest", "greet", "pet"}
CAMP_MOTIONS = {"flicker", "sway", "ripple", "lift"}
CAMP_FACES = {"left", "right"}
# The backdrop prompt (docs/camp-art-prompts.json, docs/briefs/camp.md) promises open, nearly
# level grass from 45 to 75 percent of the height; every lane's ground line, and so every stand
# point, lies in it. The client slides the cover-fitted painting so this band stands in the
# lobby's window (docs/camp.md §8.3, packages/client/src/world/camp-framing.ts).
CAMP_GROUND_TOP = 0.45
CAMP_GROUND_BOTTOM = 0.75
CAMP_SEATS = {0, 1, 2, 3}
# The backdrop fills the screen's width (cover-fit, camp-framing.ts), so the camp spreads across
# the clearing; a portrait phone crops the outer edges a little, so pieces and stand points keep
# within this much of the width. The trailhead, where the party leaves camp, is the one exception.
CAMP_X_MIN = 0.08
CAMP_X_MAX = 0.92
# Phase 2 (#623): the shared hotspot kinds a frame lays out (docs/camp.md §4.2) and where a
# piece's art comes from. A piece at a hotspot whose stand point animates it (§8.4) needs a
# moving part; resting at a tent sways its flap, which every tent style carries.
CAMP_HOTSPOT_KINDS = {"cookfire", "awning", "lanterns", "friends_corner", "banner_pole", "trophy"}
CAMP_ANIMATED_ACTIONS = {"warmUp", "lookUp", "peek"}
CAMP_CREW_GROUPS = {"frame", "kept", "find", "starter-shop", "stage2-shop", "stage3-shop", "stage4-shop", "trophy"}
CAMP_KIT_GROUPS = {"catalog", "find", "milestone"}
CAMP_DISTINCTIONS = ("apprentice", "expert", "master")
# Content sits beside the manifest; the tests point ROOT at a scratch tree for the art alone.
CONTENT_ROOT = ROOT


def check_camp_layout(rep: Report, mf: dict) -> None:
    """The camp's layout data (docs/camp.md §8.3, §8.4): lanes, crossings, pieces, stand points.

    This is authored data the client walks figures over, so a mistake in it fails
    here rather than as a figure standing in mid-air.
    """
    spec = mf.get("camp")
    if not spec:
        return
    families = set(mf.get("biomeFamilies", {}))
    backdrops = spec.get("backdrops", [])
    seen_families: set[str] = set()
    lane_sets: list[dict[str, dict]] = []
    for backdrop in backdrops:
        family = backdrop.get("family")
        label = f"camp/backdrop/{family}"
        if family not in families or family in seen_families:
            rep.fail(f"{label} family", "one backdrop per manifest.biomeFamilies id", family)
            continue
        seen_families.add(family)
        lanes = backdrop.get("lanes", [])
        by_id = {lane["id"]: lane for lane in lanes}
        problems: list[str] = []
        if not 2 <= len(lanes) <= 4 or len(by_id) != len(lanes):
            problems.append("two to four lanes with unique ids")
        for lane in lanes:
            if not (CAMP_GROUND_TOP <= lane["y"] <= CAMP_GROUND_BOTTOM and 0 <= lane["x0"] < lane["x1"] <= 1 and lane["scale"] > 0):
                problems.append(
                    f"lane {lane['id']} on the open ground, y {CAMP_GROUND_TOP} to {CAMP_GROUND_BOTTOM}, with x0 < x1"
                )
        for back, near in zip(lanes, lanes[1:]):
            if not (back["y"] < near["y"] and back["scale"] <= near["scale"]):
                problems.append(f"lanes back to near: {near['id']} lower and no smaller than {back['id']}")
        for crossing in backdrop.get("crossings", []):
            named = crossing.get("lanes", [])
            if len(named) < 2 or any(
                n not in by_id or not by_id[n]["x0"] <= crossing["x"] <= by_id[n]["x1"] for n in named
            ):
                problems.append(f"crossing at x={crossing['x']} joins two or more lanes it lies on")
        if problems:
            rep.fail(f"{label} lanes", "a walkable floor", "; ".join(problems))
        else:
            rep.ok(f"{label} lanes  {', '.join(by_id)}")
        lane_sets.append(by_id)
    if "open_plains" not in seen_families:
        rep.fail("camp backdrops", "an open_plains backdrop, the fallback for every family", "none")

    crew = {piece["id"]: piece for piece in spec.get("crewPieces", [])}
    tents = {tent["path"] for tent in spec.get("tentStyles", [])}

    def on_lane(lane: str, x: float) -> bool:
        # Frames are shared by every backdrop, so a spot must be on its lane in each.
        return bool(lane_sets) and all(lane in lanes and lanes[lane]["x0"] <= x <= lanes[lane]["x1"] for lanes in lane_sets)

    stages = [frame.get("stage") for frame in spec.get("frames", [])]
    if stages != list(range(1, len(stages) + 1)):
        rep.fail("camp frames", "stages 1, 2, 3... in order", stages)
    for frame in spec.get("frames", []):
        label = f"camp/stage{frame.get('stage')}"
        problems = []
        pieces = {piece["id"]: piece for piece in frame.get("pieces", [])}
        if len(pieces) != len(frame.get("pieces", [])):
            problems.append("unique piece ids")
        for piece in frame.get("pieces", []):
            if not on_lane(piece["lane"], piece["x"]):
                problems.append(f"piece {piece['id']} on its lane")
            if not CAMP_X_MIN <= piece["x"] <= CAMP_X_MAX:
                problems.append(f"piece {piece['id']} within x {CAMP_X_MIN} to {CAMP_X_MAX}")
            height = piece.get("heightCm")
            owner = piece.get("ownerSeat")
            if owner is not None and (type(owner) is not int or owner not in CAMP_SEATS):
                problems.append(f"piece {piece['id']} ownerSeat a seat from 0 to 3")
            if height is not None and (isinstance(height, bool) or not isinstance(height, (int, float)) or height <= 0):
                problems.append(f"piece {piece['id']} heightCm a positive number")
        for part in frame.get("movingParts", []):
            if part.get("piece") not in pieces or part.get("motion") not in CAMP_MOTIONS:
                problems.append(f"moving part {part.get('path')} on a piece, with a motion in {sorted(CAMP_MOTIONS)}")
        # Shared hotspots (§4.2): where a crew piece of that kind stands at this stage.
        hotspots = {spot["id"]: spot for spot in frame.get("hotspots", [])}
        if len(hotspots) != len(frame.get("hotspots", [])) or set(hotspots) & set(pieces):
            problems.append("unique hotspot ids, none a piece id")
        for spot in frame.get("hotspots", []):
            hid = spot["id"]
            if spot.get("kind") not in CAMP_HOTSPOT_KINDS:
                problems.append(f"hotspot {hid} kind in {sorted(CAMP_HOTSPOT_KINDS)}")
            if not on_lane(spot.get("lane", ""), spot.get("x", -1)):
                problems.append(f"hotspot {hid} on its lane")
            if not CAMP_X_MIN <= spot.get("x", -1) <= CAMP_X_MAX:
                problems.append(f"hotspot {hid} within x {CAMP_X_MIN} to {CAMP_X_MAX}")
            if "default" in spot and crew.get(spot["default"], {}).get("hotspot") != spot.get("kind"):
                problems.append(f"hotspot {hid} default a crew piece for {spot.get('kind')}")
        moving = {part.get("piece") for part in frame.get("movingParts", [])}
        points = frame.get("standPoints", [])
        if len({point["id"] for point in points}) != len(points):
            problems.append("unique stand point ids")
        seats: list[int] = []
        friends: list[int] = []
        for point in points:
            pid = point["id"]
            if not on_lane(point["lane"], point["x"]):
                problems.append(f"stand point {pid} on its lane")
            if not CAMP_X_MIN <= point["x"] <= CAMP_X_MAX:
                problems.append(f"stand point {pid} within x {CAMP_X_MIN} to {CAMP_X_MAX}")
            if point.get("face") not in CAMP_FACES:
                problems.append(f"stand point {pid} faces left or right")
            action = point.get("action")
            if action is not None and action not in CAMP_ACTIONS:
                problems.append(f"stand point {pid} action in {sorted(CAMP_ACTIONS)}")
            if "hotspot" in point and point["hotspot"] not in pieces and point["hotspot"] not in hotspots:
                problems.append(f"stand point {pid} hotspot names a piece or a hotspot")
            animated = action in CAMP_ANIMATED_ACTIONS or (
                action == "rest" and pieces.get(point.get("hotspot"), {}).get("path") in tents
            )
            if animated and point.get("hotspot") in pieces and point["hotspot"] not in moving:
                problems.append(f"piece {point['hotspot']} a moving part, for stand point {pid}")
            if action in CAMP_ANIMATED_ACTIONS and point.get("hotspot") in hotspots:
                kind = hotspots[point["hotspot"]].get("kind")
                still = sorted(cid for cid, piece in crew.items() if piece.get("hotspot") == kind and not piece.get("movingParts"))
                if still:
                    problems.append(f"crew pieces {', '.join(still)} a moving part, for stand point {pid}")
            if "seat" in point:
                if point["seat"] not in CAMP_SEATS or action != "rest":
                    problems.append(f"stand point {pid} seat 0-3, on a rest spot")
                seats.append(point["seat"])
            if "friend" in point:
                if point["friend"] not in CAMP_SEATS or action is not None or "seat" in point or "hotspot" in point:
                    problems.append(f"stand point {pid} friend 0-3, with no seat, action or hotspot")
                friends.append(point["friend"])
        # Every frame seats the full party (docs/camp.md §12): one rest spot per seat.
        if sorted(seats) != sorted(CAMP_SEATS):
            problems.append(f"one rest spot per seat 0-3, found {sorted(seats)}")
        # ...and the four friends out (§4.4, §12.3; #624): one friend spot each.
        if sorted(friends) != sorted(CAMP_SEATS):
            problems.append(f"one friend spot per friend 0-3, found {sorted(friends)}")
        trailhead = frame.get("trailhead") or {}
        if not on_lane(trailhead.get("lane", ""), trailhead.get("x", -1)):
            problems.append("a trailhead on a lane")
        if problems:
            rep.fail(f"{label} layout", "pieces and stand points on the backdrop's lanes", "; ".join(problems))
        else:
            rep.ok(f"{label} layout  {len(pieces)} pieces, {len(points)} stand points")


def check_camp_catalog(rep: Report, mf: dict) -> None:
    """The Phase 2 camp art catalog (docs/camp.md §4.3, §4.5, §5.4; #623): the crew's hotspot
    pieces, the tent styles, the souvenir line, the kit decorations and the camp's icons.

    Only the art's declarations: what a piece costs or which chapter gives it is
    content/camp.json's, so nothing here names a price or a reward.
    """
    spec = mf.get("camp")
    if not spec:
        return
    problems: list[str] = []
    figure = mf["canvas"]

    def unique(entries: list[dict], what: str) -> None:
        ids = [entry.get("id") for entry in entries]
        if len(set(ids)) != len(ids):
            problems.append(f"unique {what} ids")

    def height(entry: dict) -> None:
        value = entry.get("heightCm")
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            problems.append(f"{entry.get('id')} heightCm a positive number")

    def chapter(entry: dict) -> None:
        if "chapter" in entry and not os.path.isfile(os.path.join(CONTENT_ROOT, "content", "chapters", f"{entry['chapter']}.json")):
            problems.append(f"{entry['id']} chapter a chapter in content/chapters")

    crew = spec.get("crewPieces", [])
    unique(crew, "crew piece")
    for piece in crew:
        pid = piece.get("id")
        height(piece)
        chapter(piece)
        # Its painted width, as heightCm is its height: the box the stage-2 layout keeps clear
        # of the tents and the other pieces (packages/client/src/world/camp-boxes.ts).
        width = piece.get("widthCm")
        if isinstance(width, bool) or not isinstance(width, (int, float)) or width <= 0:
            problems.append(f"{pid} widthCm a positive number")
        if piece.get("hotspot") not in CAMP_HOTSPOT_KINDS:
            problems.append(f"{pid} hotspot a kind in {sorted(CAMP_HOTSPOT_KINDS)}")
        if piece.get("group") not in CAMP_CREW_GROUPS:
            problems.append(f"{pid} group in {sorted(CAMP_CREW_GROUPS)}")
        if (piece.get("group") == "find") != ("chapter" in piece):
            problems.append(f"{pid} a chapter exactly when it is a find")
        if (piece.get("group") == "trophy") != (piece.get("hotspot") == "trophy"):
            problems.append(f"{pid} a trophy exactly at a trophy hotspot")
        if piece.get("group") == "trophy" and not os.path.isfile(
            os.path.join(CONTENT_ROOT, "content", "campaigns", f"{piece.get('campaign')}.json")
        ):
            problems.append(f"{pid} campaign a campaign in content/campaigns")
        for part in piece.get("movingParts", []):
            if part.get("motion") not in CAMP_MOTIONS:
                problems.append(f"{pid} moving part motion in {sorted(CAMP_MOTIONS)}")

    kits = {kit["id"] for kit in spec.get("kitStyles", [])}
    tents = spec.get("tentStyles", [])
    unique(tents, "tent style")
    tiers = set(mf.get("tiers", [])) - {"fledgling"}
    for tent in tents:
        tid = tent.get("id")
        height(tent)
        if not tent.get("flap") or tent.get("tint") != "svg-cloth-mask" or tent.get("paletteSlot") != "accent":
            problems.append(f"tent {tid} a flap, tinted like kitStyles (svg-cloth-mask, accent)")
        if tent.get("group") == "catalog" and tent.get("kit") not in kits:
            problems.append(f"tent {tid} kit a kitStyles id")
        elif tent.get("group") == "milestone" and tent.get("tier") not in tiers:
            problems.append(f"tent {tid} tier in manifest.tiers, past fledgling")
        elif tent.get("group") not in {"catalog", "milestone"}:
            problems.append(f"tent {tid} group catalog or milestone")
        # Its decoration spots, one per slot (the guidebook hangs a decoration's middle there).
        spots = tent.get("hangPoints", [])
        if len(spots) < 2 or not all(
            0 < spot.get("x", -1) < figure["width"] and 0 < spot.get("y", -1) < figure["originY"] for spot in spots
        ):
            problems.append(f"tent {tid} hangPoints, a spot per decoration slot on its canvas, above the ground contact")
    if tents and kits - {tent.get("kit") for tent in tents}:
        problems.append(f"a catalog tent for every kit style, missing {sorted(kits - {tent.get('kit') for tent in tents})}")

    display = spec.get("souvenirDisplay")
    if display:
        height(display)
        points = display.get("hangPoints", [])
        if not points or not all(
            0 < point.get("x", -1) < figure["width"] and 0 < point.get("y", -1) < figure["originY"] for point in points
        ):
            problems.append("souvenir hangPoints on its canvas, above the ground contact")

    decorations = spec.get("decorations", [])
    unique(decorations, "decoration")
    classes = set(json.load(open(os.path.join(CONTENT_ROOT, "content", "rules.json"), encoding="utf-8"))["classes"])
    earned: list[tuple[str, str]] = []
    for deco in decorations:
        did = deco.get("id")
        height(deco)
        chapter(deco)
        if deco.get("group") not in CAMP_KIT_GROUPS:
            problems.append(f"{did} group in {sorted(CAMP_KIT_GROUPS)}")
        if (deco.get("group") == "find") != ("chapter" in deco):
            problems.append(f"{did} a chapter exactly when it is a find")
        if deco.get("group") == "milestone":
            earned.append((deco.get("class"), deco.get("distinction")))
    if decorations and sorted(earned) != sorted((c, d) for c in classes for d in CAMP_DISTINCTIONS):
        problems.append("one milestone decoration per class and distinction (apprentice, expert, master)")

    for icon in spec.get("paintedIcons", []):
        if not isinstance(icon, str) or not icon:
            problems.append("paintedIcons ids")

    if problems:
        rep.fail("camp catalog", "crew pieces, tents and decorations declared for #618 to name", "; ".join(problems))
    elif crew or tents or decorations:
        rep.ok(f"camp catalog  {len(crew)} crew pieces, {len(tents)} tents, {len(decorations)} decorations")


def painted_icon_problem(path: str, size: tuple[int, int]) -> tuple[str, object] | None:
    """What is wrong with a painted icon (WEBP RGBA, real alpha, 8px clear border), if anything."""
    with Image.open(path) as im:
        if im.format != "WEBP" or im.mode != "RGBA" or im.size != size:
            return (f"WEBP RGBA {size}", f"{im.format} {im.mode} {im.size}")
        alpha = np.asarray(im)[..., 3]
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        return ("nonempty icon", "fully transparent")
    margin = int(min(xs.min(), ys.min(), size[0]-1-xs.max(), size[1]-1-ys.max()))
    if margin < 8:
        return ("at least 8px transparent margin", margin)
    return None


def check_camp_art(rep: Report, mf: dict) -> None:
    """Camp art (docs/briefs/camp.md): backdrops opaque 1920x1080 WebP, pieces and moving
    parts figure-canvas RGBA PNG cutouts; nothing undeclared under assets/camp.

    A missing painting is not a failure: the client draws a stand-in until it lands, and
    `art:inventory` lists it as owed.
    """
    spec = mf.get("camp")
    if not spec:
        return
    canvas = spec["backdropCanvas"]
    declared: set[str] = set()
    for backdrop in spec.get("backdrops", []):
        rel = backdrop["path"]
        declared.add(rel)
        path = os.path.join(ROOT, "assets", rel)
        if not os.path.isfile(path):
            rep.warn(f"{rel}  not yet delivered", "the camp draws a stand-in backdrop")
            continue
        with Image.open(path) as im:
            if im.format != "WEBP":
                rep.fail(f"{rel} format", "WEBP", im.format)
                continue
            if im.size != (canvas["width"], canvas["height"]):
                rep.fail(f"{rel} canvas", f"{canvas['width']}x{canvas['height']}", f"{im.size[0]}x{im.size[1]}")
                continue
            if im.convert("RGBA").getchannel("A").getextrema()[0] < 255:
                rep.fail(f"{rel} opaque", "no transparent pixels", "transparency")
                continue
        rep.ok(f"{rel}  {canvas['width']}x{canvas['height']} opaque")

    cutouts: dict[str, bool] = {}  # path -> stands on the ground (a piece) or lies over one (a part)
    for frame in spec.get("frames", []):
        for piece in frame.get("pieces", []):
            cutouts[piece["path"]] = True
        for part in frame.get("movingParts", []):
            cutouts.setdefault(part["path"], False)
    tol = mf["tolerance"]
    figure = mf["canvas"]
    for kit in spec.get("kitStyles", []):
        cutouts[kit["path"]] = True
    # Phase 2 (#623): the crew's hotspot pieces and the hero's tents and souvenir line stand on
    # the ground like frame pieces; their moving parts and the tents' flaps lie over them.
    for piece in spec.get("crewPieces", []):
        cutouts[piece["path"]] = True
    spots_on: dict[str, list[dict]] = {}
    for tent in spec.get("tentStyles", []):
        cutouts[tent["path"]] = True
        spots_on[tent["path"]] = [s for s in tent.get("hangPoints", []) if 0 <= s.get("x", -1) < figure["width"] and 0 <= s.get("y", -1) < figure["height"]]
    if spec.get("souvenirDisplay"):
        cutouts[spec["souvenirDisplay"]["path"]] = True
    for piece in spec.get("crewPieces", []):
        for part in piece.get("movingParts", []):
            cutouts.setdefault(part["path"], False)
    for tent in spec.get("tentStyles", []):
        if tent.get("flap"):
            cutouts.setdefault(tent["flap"], False)
    for rel, grounded in cutouts.items():
        declared.add(rel)
        path = os.path.join(ROOT, "assets", rel)
        if not os.path.isfile(path):
            rep.warn(f"{rel}  not yet delivered", "the camp draws a stand-in")
            continue
        with Image.open(path) as im:
            if im.format != "PNG":
                rep.fail(f"{rel} format", "PNG", im.format)
                continue
        image = check_format(rep, path, figure, tol)
        if image is None:
            continue
        if grounded:
            check_origin(rep, rel, image, figure, tol)
            # A tent's decoration spots are on its paint, never in the air beside it.
            spots = spots_on.get(rel, [])
            off = [s for s in spots if image[int(s.get("y", 0)), int(s.get("x", 0)), 3] <= tol["alphaThreshold"]]
            if off:
                rep.fail(f"{rel} hangPoints", "every decoration spot on the painted tent", ", ".join(f"({s.get('x')}, {s.get('y')})" for s in off))
            elif spots:
                rep.ok(f"{rel} hangPoints on the tent")
        else:
            # A moving part is registered to its piece's canvas, so it never reaches
            # below the ground contact the piece stands on.
            ys, _ = np.where(image[..., 3] > tol["alphaThreshold"])
            if ys.size and int(ys.max()) > figure["originY"] + tol["originYTolerancePx"]:
                rep.fail(f"{rel} origin", f"nothing below y={figure['originY']} (+/-{tol['originYTolerancePx']})", f"y={int(ys.max())}")
            else:
                rep.ok(f"{rel} registered over its piece")

    # Kit decorations hang in a tent's slots and are their own phone picture: the story-prop
    # canvas (512x512, 24px clear margin), with no ground contact.
    decoration_canvas = spec.get("decorationCanvas")
    for deco in spec.get("decorations", []):
        rel = deco["path"]
        declared.add(rel)
        path = os.path.join(ROOT, "assets", rel)
        if not os.path.isfile(path):
            rep.warn(f"{rel}  not yet delivered", "the kit picker and the tent show nothing in that slot")
            continue
        with Image.open(path) as im:
            if im.format != "PNG":
                rep.fail(f"{rel} format", "PNG", im.format)
                continue
        check_format(rep, path, decoration_canvas, {**tol, "edgeMarginPx": decoration_canvas["edgeMarginPx"]})

    # The camp's icons join the painted icons (manifest.paintedIcons) once painted.
    icons = mf.get("paintedIcons", {}).get("canvas", {"width": 256, "height": 256})
    for icon in spec.get("paintedIcons", []):
        label = f"painted/{icon}"
        path = os.path.join(ROOT, "packages", "client", "src", "assets", "painted", f"{icon}.webp")
        if not os.path.isfile(path):
            rep.warn(f"{label}.webp  not yet delivered", "the camp shows the tally without its icon")
            continue
        problem = painted_icon_problem(path, (icons["width"], icons["height"]))
        if problem:
            rep.fail(label, *problem)
        else:
            rep.ok(f"{label}  {icons['width']}x{icons['height']} RGBA")

    directory = os.path.join(ROOT, "assets", "camp")
    for folder, _, files in os.walk(directory):
        for filename in sorted(files):
            if "@" in filename:
                continue  # a derived copy (`npm run art:small`): its painting is what is declared
            rel = os.path.relpath(os.path.join(folder, filename), os.path.join(ROOT, "assets")).replace(os.sep, "/")
            if rel not in declared:
                rep.fail(f"{rel} undeclared", "a path in manifest.camp", "undeclared file")


def check_camp_paint(rep: Report) -> None:
    """The camp's painted footprints (tools/art/camp-paint.py): the table the layout's boxes and
    both renderers read must match the paintings on disk, so a repainted piece is never laid out
    by its old shape."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import importlib

    paint = importlib.import_module("camp-paint")
    problems = paint.stale(ROOT)
    if problems:
        rep.fail("camp paint table", "packages/client/src/world/camp-paint.json matches the paintings",
                 "; ".join(problems[:4]) + (" ..." if len(problems) > 4 else ""),
                 "run `npm run art:camp-paint` and commit the table")
    else:
        rep.ok("camp paint table matches the paintings")


def check_scene_illustrations(rep: Report, mf: dict) -> None:
    """Declared story backdrops are opaque; entry portraits use their tall canvas."""
    for art in mf.get("sceneIllustrations", []):
        path = os.path.join(ROOT, "assets", f"{art}.webp")
        if not os.path.isfile(path):
            rep.fail(art, "declared scene illustration present", "missing")
            continue
        expected = (900, 1600) if art.endswith("-portrait") else (1920, 1080)
        with Image.open(path) as im:
            if im.format != "WEBP" or im.size != expected:
                rep.fail(art, f"WEBP {expected}", f"{im.format} {im.size}")
                continue
            if im.convert("RGBA").getchannel("A").getextrema()[0] < 255:
                rep.fail(art, "opaque backdrop", "transparent pixels")
                continue
        rep.ok(f"{art}  {expected[0]}x{expected[1]} opaque")


def check_painted_icons(rep: Report, mf: dict, section: str = "paintedIcons", directory: str = "painted") -> None:
    """Painted icons and badge medals: real alpha and a clear shipped border."""
    spec = mf.get(section)
    if not spec:
        return
    size = (spec["canvas"]["width"], spec["canvas"]["height"])
    for icon in spec["ids"]:
        label = f"{directory}/{icon}"
        path = os.path.join(ROOT, "packages", "client", "src", "assets", directory, f"{icon}.webp")
        if not os.path.isfile(path):
            rep.fail(label, "declared painted icon present", "missing")
            continue
        problem = painted_icon_problem(path, size)
        if problem:
            rep.fail(label, *problem)
            continue
        rep.ok(f"{label}  {size[0]}x{size[1]} RGBA")


def check_nameplate_frames(rep: Report, mf: dict) -> None:
    """Delivered nine-slice frames keep their canvas, alpha and usable center (#665, #680)."""
    spec = mf.get("nameplateFrames", {})
    canvas = spec.get("canvas", {})
    size = (canvas.get("width"), canvas.get("height"))
    for frame_id in spec.get("ids", []):
        label = f"nameplates/{frame_id}"
        path = os.path.join(ROOT, "assets", "nameplates", f"{frame_id}.webp")
        if not os.path.isfile(path):
            rep.fail(label, "delivered frame present", "missing")
            continue
        with Image.open(path) as im:
            if im.format != "WEBP" or im.size != size:
                rep.fail(label, f"WEBP {size}", f"{im.format} {im.size}")
                continue
            alpha = np.asarray(im.convert("RGBA"))[:, :, 3]
        if not (alpha == 0).any() or not (alpha > 200).any():
            rep.fail(label, "transparent margins and visible painting", "missing alpha or empty painting")
            continue
        cut = spec["slice"]
        center = alpha[cut["top"]:size[1] - cut["bottom"], cut["left"]:size[0] - cut["right"]]
        if center.size == 0 or float((center > 200).mean()) < 0.95:
            rep.fail(label, "opaque center behind light name and title", "empty or translucent center")
            continue
        rep.ok(f"{label}  {size[0]}x{size[1]} nine-slice, alpha margins")


def check_guide_art(rep: Report, mf: dict) -> None:
    """Guide banners are opaque; the two isolated part emblems retain alpha."""
    for asset in mf.get("guideArt", []):
        label = f"guide/{asset['id']}"
        file = os.path.join(ROOT, "packages", "client", "src", "assets", "guide", f"{asset['id']}.webp")
        if not os.path.isfile(file):
            rep.fail(label, "declared guide painting present", "missing")
            continue
        size = (asset["width"], asset["height"])
        mode = "RGBA" if asset["alpha"] else "RGB"
        with Image.open(file) as im:
            if im.format != "WEBP" or im.mode != mode or im.size != size:
                rep.fail(label, f"WEBP {mode} {size}", f"{im.format} {im.mode} {im.size}")
                continue
            if asset["alpha"]:
                alpha = np.asarray(im)[..., 3]
                ys, xs = np.where(alpha > 8)
                if not len(xs) or alpha.min() != 0:
                    rep.fail(label, "visible isolated emblem with transparent background", "empty or opaque")
                    continue
                margin = min(xs.min(), ys.min(), size[0]-1-xs.max(), size[1]-1-ys.max())
                if margin < 8:
                    rep.fail(label, "at least 8px clear margin", int(margin))
                    continue
        rep.ok(f"{label}  {size[0]}x{size[1]} {mode}")


def check_story_props(rep: Report, mf: dict) -> None:
    """Reusable transparent interaction objects and their decorative motion presets."""
    spec = mf.get("storyProps")
    if not spec:
        return
    directory = os.path.join(ROOT, "assets", "story-props")
    ids = spec["ids"]
    declared = set(ids)
    if len(declared) != len(ids):
        rep.fail("story props ids", "unique ids", "duplicate declaration")
    motions = spec.get("motions", {})
    if set(motions) != declared:
        rep.fail("story props motions", "one motion per declared prop", "missing or undeclared motion")
    tolerance = {**mf["tolerance"], "edgeMarginPx": spec.get("edgeMarginPx", 24)}
    presets = {"still", "swing", "relay", "sway", "surge", "pulse", "peek"}
    for id in ids:
        label = f"story-props/{id}"
        path = os.path.join(directory, f"{id}.webp")
        if not os.path.isfile(path):
            rep.fail(label, "declared story prop present", "missing")
            continue
        with Image.open(path) as im:
            if im.format != "WEBP":
                rep.fail(f"{label} format", "WEBP", im.format)
                continue
        check_format(rep, path, spec["canvas"], tolerance)
        motion = motions.get(id, {})
        duration = motion.get("durationMs")
        if motion.get("preset") not in presets or type(duration) is not int or not 1000 <= duration <= 20000:
            rep.fail(f"{label} motion", "known preset and integer duration 1000-20000ms", motion)
        else:
            rep.ok(f"{label} motion  {motion['preset']} {duration}ms")
    if os.path.isdir(directory):
        for filename in os.listdir(directory):
            stem, extension = os.path.splitext(filename)
            if extension.lower() == ".webp" and stem not in declared:
                rep.fail(f"story-props/{stem}", "declared in manifest.storyProps.ids", "undeclared file")



def slot_list(draft_from: object) -> list:
    """A part's `draftFrom` as a list: one slot name, or a non-empty list of distinct names."""
    if isinstance(draft_from, str):
        return [draft_from]
    if isinstance(draft_from, list) and draft_from and all(isinstance(s, str) for s in draft_from) \
            and len(set(draft_from)) == len(draft_from):
        return draft_from
    return []


def check_coat_masks(rep: Report, mf: dict) -> None:
    """Hero-look coat masks (docs/hero-looks.md section 4.3, step 4).

    Every species names its two parts, a main and an accent, and every mask is gated: listed in
    coatMasks.paintings exactly when it is on disk (a draft is never shipped as is), 8-bit RGB
    on its painting's own canvas (R main, G accent, B the figure), each part neither empty nor
    the whole canvas and inside the figure, the parts barely overlapping, and the figure not
    empty and, on a transparent painting, inside the painting's alpha. A gear portrait is
    opaque, so the review sheet is its only check that the background stays out."""
    section = mf.get("coatMasks")
    if section is None:
        rep.fail("manifest coatMasks", "declared (hero-looks.md section 4.2)", "missing")
        return
    # a part's name is the kid's shelf label (capitalised): plain words, one per part
    allowed_regions = {"coat", "mane", "scales", "feathers", "fur", "skin", "wings", "tails", "tail", "belly"}
    for sp in mf["species"]:
        parts = section["regions"].get(sp["id"])
        if not isinstance(parts, dict) or set(parts) != set(coat.PARTS):
            rep.fail(f"coatMasks.regions.{sp['id']}", "a main and an accent part for every species",
                     "missing" if parts is None else sorted(parts) if isinstance(parts, dict) else parts)
            continue
        for name in coat.PARTS:
            part = parts[name]
            where = f"coatMasks.regions.{sp['id']}.{name}"
            if part.get("region") not in allowed_regions:
                rep.fail(f"{where}.region", sorted(allowed_regions), part.get("region"))
            elif not slot_list(part.get("draftFrom")) or any(s not in sp["palette"] for s in slot_list(part.get("draftFrom"))):
                rep.fail(f"{where}.draftFrom", f"a palette slot of {sp['id']}, or a list of them", part.get("draftFrom"))
            elif not isinstance(part.get("confirmed"), bool):
                rep.fail(f"{where}.confirmed", "true or false", part.get("confirmed"))
        if parts["main"].get("region") == parts["accent"].get("region"):
            rep.fail(f"coatMasks.regions.{sp['id']}", "two different parts", parts["main"].get("region"))
        elif set(slot_list(parts["main"].get("draftFrom"))) & set(slot_list(parts["accent"].get("draftFrom"))):
            rep.fail(f"coatMasks.regions.{sp['id']}", "each part drafted from its own palette slots",
                     sorted(set(slot_list(parts["main"].get("draftFrom"))) & set(slot_list(parts["accent"].get("draftFrom")))))

    tol = section["tolerance"]
    known = {p.painting: p for p in coat.paintings(mf)}
    listed = section.get("paintings", [])
    for painting in listed:
        if painting not in known:
            rep.fail(f"coatMasks.paintings {painting}", "a declared hero painting", "unknown painting")
    if len(set(listed)) != len(listed):
        rep.fail("coatMasks.paintings", "each painting once", "duplicates")

    by_mask = {os.path.normcase(os.path.normpath(coat.asset(p.mask, ROOT))): p for p in known.values()}
    for p in known.values():
        mask_path = coat.asset(p.mask, ROOT)
        on_disk = os.path.isfile(mask_path)
        if p.painting in listed and not on_disk:
            rep.fail(p.mask, "present (listed in coatMasks.paintings)", "missing")
            continue
        if not on_disk:
            continue
        if p.painting not in listed:
            rep.fail(p.mask, "listed in manifest coatMasks.paintings once hand-cleaned and reviewed",
                     "unlisted (a draft?)", "hero-looks.md section 4.3: a draft is never shipped as is")
        painting_path = coat.asset(p.painting, ROOT)
        if not os.path.isfile(painting_path):
            rep.fail(p.mask, "a mask beside a delivered painting", f"{p.painting} missing")
            continue
        try:
            with Image.open(mask_path) as mask_im, Image.open(painting_path) as painting_im:
                mask_im.load()
                painting_im.load()
                problems = coat.mask_problems(mask_im, painting_im, tol)
        except Exception as err:  # noqa: BLE001 - a bad PNG is the finding
            rep.fail(p.mask, "a decodable PNG", str(err))
            continue
        for what, expected, actual in problems:
            rep.fail(f"{p.mask} {what}", expected, actual, "hero-looks.md section 4.2-4.3")
        if not problems:
            rep.ok(f"{p.mask}  coat mask")

    # a mask-shaped file beside no declared painting
    for directory in ("characters", "character-rigs", "gear-portraits"):
        base_dir = os.path.join(ROOT, "assets", directory)
        if not os.path.isdir(base_dir):
            continue
        for base, _, files in os.walk(base_dir):
            for filename in files:
                if "coat-mask" not in filename:
                    continue
                path = os.path.normcase(os.path.normpath(os.path.join(base, filename)))
                if path not in by_mask:
                    rep.fail(os.path.relpath(path, ROOT), "a mask beside a declared hero painting", "stray mask")


def unpulled_art(prefix: str = "assets") -> list[str]:
    """The lock's paths under prefix that are not on disk (#725, tools/assets/lib.ts unpulledArt).

    Presence only. Empty when there is no assets.lock.json: before the cutover the art is in git.
    """
    lock_path = os.path.join(ROOT, "assets.lock.json")
    if not os.path.exists(lock_path):
        return []
    with open(lock_path, encoding="utf-8") as f:
        files = json.load(f).get("files", {})
    return sorted(
        p for p in files
        if (p == prefix or p.startswith(prefix + "/")) and not os.path.exists(os.path.join(ROOT, p))
    )


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    strict = "--strict" in sys.argv

    # After the cutover the art lives in the asset store. Checking an unpulled tree would fail
    # every delivered painting as missing, so say what to do instead (#725).
    missing = unpulled_art()
    if missing:
        sys.exit(
            f"art:verify: {len(missing)} file(s) assets.lock.json names under assets/ are not on disk "
            f"(e.g. {missing[0]}).\n"
            "  The art lives in the asset store; run npm run assets:pull -- assets first (docs/asset-store.md)."
        )

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

    for sp, tier in targets:
        path = os.path.join(ROOT, "assets", "characters", sp["id"], tier, "assembled.png")
        label = f'{sp["id"]}/{tier}'
        if not os.path.isfile(path):
            skipped.append(label)
            continue
        image = load_rgba(path)
        check_format(rep, path, mf["canvas"], mf["tolerance"])
        check_origin(rep, label, image, mf["canvas"], mf["tolerance"])

    for entity in mf.get("entities", []):
        if args and entity["id"] not in args:
            continue
        verify_entity(rep, mf, entity)

    for figure in mf.get("stageFigures", []):
        if args and figure["id"] not in args:
            continue
        verify_stage_figure(rep, mf, figure)

    for figure in mf.get("castFigures", []):
        if args and figure["id"] not in args:
            continue
        verify_cast_figure(rep, mf, figure)

    # Not gated on `args`: the effect sheets are shared by every species, so
    # narrowing to one character should not stop checking them.
    check_effects(rep, mf)
    check_together_overlays(rep, mf)

    # Nor is gear: it is per-class, not per-species, and the whole point of
    # checking it is that nobody was going to remember to ask.
    check_gear_portraits(rep, mf)
    check_figure_variants(rep, mf)
    check_coat_masks(rep, mf)
    check_campaign_art(rep, mf)
    check_story_plates(rep, mf)
    check_camp_layout(rep, mf)
    check_camp_catalog(rep, mf)
    check_camp_art(rep, mf)
    check_camp_paint(rep)
    check_scene_illustrations(rep, mf)
    check_painted_icons(rep, mf)
    check_painted_icons(rep, mf, "badgeArt", "badges")
    check_guide_art(rep, mf)
    check_nameplate_frames(rep, mf)
    check_story_props(rep, mf)

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
