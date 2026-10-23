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
            if not opaque_mask(img[:, i * size : (i + 1) * size], tol["alphaThreshold"]).any()
        ]
        if blanks:
            rep.fail(f"{label}  {len(blanks)} blank frame(s)",
                     "every frame has visible pixels", f"frames {blanks[:6]} are empty")
            continue

        if not check_effect_composition(rep, label, img, entry, frames, size, tol):
            continue

        rep.ok(f"{label}  {frames} frames @ {entry.get('fps', '?')}fps, {size}px")


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
        return img[:, i * size : (i + 1) * size]

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
    kinds = {e["id"] for e in mf.get("entities", [])} | {s["id"] for s in mf["species"]}
    if basis not in kinds:
        rep.fail(f"{label} basis", "an entity or species id", basis or "none")
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
            stem, _ = os.path.splitext(filename)
            plate = os.path.relpath(os.path.join(folder, stem), os.path.join(ROOT, "assets")).replace(os.sep, "/")
            if plate not in declared:
                rep.fail(f"{plate} undeclared", "listed in manifest.storyPlates.ids", "undeclared file")
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


def check_painted_icons(rep: Report, mf: dict) -> None:
    """Additional #421 icons: real alpha and a clear border at their shipped size."""
    spec = mf.get("paintedIcons")
    if not spec:
        return
    size = (spec["canvas"]["width"], spec["canvas"]["height"])
    for icon in spec["ids"]:
        label = f"painted/{icon}"
        path = os.path.join(ROOT, "packages", "client", "src", "assets", "painted", f"{icon}.webp")
        if not os.path.isfile(path):
            rep.fail(label, "declared painted icon present", "missing")
            continue
        with Image.open(path) as im:
            if im.format != "WEBP" or im.mode != "RGBA" or im.size != size:
                rep.fail(label, f"WEBP RGBA {size}", f"{im.format} {im.mode} {im.size}")
                continue
            alpha = np.asarray(im)[..., 3]
            ys, xs = np.where(alpha > 8)
            if not len(xs):
                rep.fail(label, "nonempty icon", "fully transparent")
                continue
            margin = int(min(xs.min(), ys.min(), size[0]-1-xs.max(), size[1]-1-ys.max()))
            if margin < 8:
                rep.fail(label, "at least 8px transparent margin", margin)
                continue
        rep.ok(f"{label}  {size[0]}x{size[1]} RGBA  margin={margin}px")


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
    check_campaign_art(rep, mf)
    check_story_plates(rep, mf)
    check_scene_illustrations(rep, mf)
    check_painted_icons(rep, mf)

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
