"""
Kids & Dragons - coat masks: the shared library under art:coat-draft, art:verify and art:sheet.

A coat mask (docs/hero-looks.md section 4) is an 8-bit RGB PNG on its painting's own canvas,
three channels with soft edges (fur is fluffy):

    R  the main part, which takes the kid's main colour
    G  the accent part, which takes her accent colour
    B  the figure: the hero's whole silhouette, which the special looks (sparkles, gold) go over.
       On a transparent painting it matches the painting's alpha; on an opaque gear portrait it
       is everything but the backdrop.

Which parts those are, per species, is assets/manifest.json -> coatMasks.regions (`main` and
`accent`), which the client reads too (packages/client/src/world/coat-masks.ts).

Three families of painting carry one each (section 4.1):

    base   assets/characters/<species>/<tier>/assembled.png       -> coat-mask.png beside it
    class  assets/character-rigs/<class>/<tier>/<species>/assembled.png -> coat-mask.png beside it
    gear   assets/gear-portraits/<class>/<tier>/<species>.png     -> <species>.coat-mask.png

This module knows those paths, drafts a mask's parts by colour as the 2026-11-07 proof of concept did
(section 2), and recolours a painting through one channel of a mask in OKLab as section 5.2 describes, for the
review sheet. The client's tinter (#666) is the one players see; this one is for reviewers.

Requires: Pillow, numpy
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FAMILIES = ("base", "class", "gear")


# ----------------------------------------------------------------------------- paths


@dataclass(frozen=True)
class Painting:
    family: str          # base | class | gear
    species: str
    tier: str
    cls: str | None      # None for a base painting
    painting: str        # relative to assets/, forward slashes
    mask: str            # relative to assets/, forward slashes

    @property
    def label(self) -> str:
        return self.painting


def mask_path_for(painting: str) -> str:
    """The mask beside a painting: `x/assembled.png` -> `x/coat-mask.png`,
    `x/<species>.png` -> `x/<species>.coat-mask.png`."""
    head, name = painting.rsplit("/", 1)
    if name == "assembled.png":
        return f"{head}/coat-mask.png"
    stem, ext = os.path.splitext(name)
    return f"{head}/{stem}.coat-mask{ext}"


def paintings(mf: dict, species: str | None = None) -> list[Painting]:
    """Every hero painting the manifest declares, in all three families.

    Base paintings are the species x tier grid; class paintings are figureVariants; gear
    portraits are the gearPortraits cross products. Whether the file is on disk is the
    caller's business (verify checks the paintings elsewhere)."""
    out: list[Painting] = []
    for sp in mf["species"]:
        if species and sp["id"] != species:
            continue
        for tier in mf["tiers"]:
            p = f"characters/{sp['id']}/{tier}/assembled.png"
            out.append(Painting("base", sp["id"], tier, None, p, mask_path_for(p)))
    for v in mf.get("figureVariants", []):
        if species and v["species"] != species:
            continue
        p = f"character-rigs/{v['class']}/{v['tier']}/{v['species']}/assembled.png"
        out.append(Painting("class", v["species"], v["tier"], v["class"], p, mask_path_for(p)))
    for group in mf.get("gearPortraits", []):
        for tier in group.get("tiers", []):
            for sp_id in group.get("species", []):
                if species and sp_id != species:
                    continue
                p = f"gear-portraits/{group['class']}/{tier}/{sp_id}.png"
                out.append(Painting("gear", sp_id, tier, group["class"], p, mask_path_for(p)))
    return out


def asset(rel: str, root: str | None = None) -> str:
    return os.path.join(root or ROOT, "assets", *rel.split("/"))


PARTS = ("main", "accent")  # the mask's R and G, in that order; B is the figure
CHANNELS = {"main": 0, "accent": 1, "figure": 2}


def region_of(mf: dict, species: str) -> dict:
    """A species' parts: {"main": {region, draftFrom, confirmed}, "accent": {...}}."""
    return mf["coatMasks"]["regions"][species]


def slots_of(part: dict) -> list[str]:
    """The palette slots a part drafts from: `draftFrom` is one slot name or a list of them
    (Bigfoot's fur is his cream coat and his brown mane: ["coat", "mane"])."""
    slots = part["draftFrom"]
    return [slots] if isinstance(slots, str) else list(slots)


def seeds_of(mf: dict, species: str, part: str) -> list[str]:
    """The palette colours (hex) a species' part drafts from."""
    palette = palette_of(mf, species)
    return [palette[slot] for slot in slots_of(region_of(mf, species)[part])]


def palette_of(mf: dict, species: str) -> dict:
    for sp in mf["species"]:
        if sp["id"] == species:
            return sp["palette"]
    raise KeyError(species)


# ----------------------------------------------------------------------------- colour


def hex_rgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0


def _to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _to_gamma(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


_M1 = np.array([
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
])
_M2 = np.array([
    [0.2104542553, 0.7936177850, -0.0040720468],
    [1.9779984951, -2.4285922050, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.8086757660],
])
_M2I = np.linalg.inv(_M2)
_M1I = np.linalg.inv(_M1)


def srgb_to_oklab(rgb: np.ndarray) -> np.ndarray:
    """sRGB in 0..1 (any shape ending in 3) -> OKLab."""
    lms = _to_linear(rgb) @ _M1.T
    return np.cbrt(lms) @ _M2.T


def oklab_to_linear(lab: np.ndarray) -> np.ndarray:
    lms = (lab @ _M2I.T) ** 3
    return lms @ _M1I.T


def oklab_to_srgb(lab: np.ndarray) -> np.ndarray:
    return _to_gamma(oklab_to_linear(lab))


# ----------------------------------------------------------------------------- the draft


# How the draft judges "this colour": OKLab distance with lightness counted at half weight,
# because the painted shading on one region spans far more lightness than hue or chroma.
LIGHTNESS_WEIGHT = 0.5


def _distance(lab: np.ndarray, seed: np.ndarray) -> np.ndarray:
    d = lab - seed
    d[..., 0] *= LIGHTNESS_WEIGHT
    return np.sqrt((d * d).sum(axis=-1))


def figure_mask(rgba: np.ndarray) -> np.ndarray:
    """The figure channel's draft, 0..1 (HxW): the hero's whole silhouette. On a transparent
    painting it is the painting's own alpha; on an opaque one (a gear portrait) it is
    everything the backdrop flood (`backdrop`) does not reach."""
    if rgba.shape[-1] == 4:
        alpha = rgba[..., 3].astype(np.float64) / 255.0
    else:
        alpha = np.ones(rgba.shape[:2])
    if alpha.min() >= 1.0:
        # an opaque painting (a gear portrait): its backdrop is never the figure
        alpha = alpha * (1.0 - backdrop(rgba))
    return alpha


def _walk(pixels: np.ndarray, origins: list[np.ndarray], reach: float, far: float) -> list[np.ndarray]:
    """Walk each part's seed from its palette colour to the middle of the nearest painted mass.

    Mean shift with a flat kernel no wider than the part's own tolerance, so a seed climbs to
    the nearest painted mode rather than being dragged to the biggest mass nearby (a griffin's
    white body beside her blue). It widens only while nothing is near enough, and never
    wanders further from the palette than `reach`: shading on a neighbouring part (a white
    body's blue shadows) is a path to the wrong region. The parts compete: each walks only on
    the pixels nearer to it than to the other part's seed, so two palette colours a shade
    apart (Bigfoot's cream coat and tan skin) settle on two masses, not one. `reach` is a
    little under the draft's `near`, so the two do not both slide into the shading between
    them (Bigfoot's shaded fur, which would leave his face shared by both parts)."""
    seeds = [o.copy() for o in origins]
    radii = [far] * len(seeds)
    settled = [False] * len(seeds)
    enough = max(16, len(pixels) // 500)
    dists = [None] * len(seeds)
    for _ in range(40):
        dists = [_distance(pixels, s) for s in seeds]
        for i, origin in enumerate(origins):
            if settled[i]:
                continue
            mine = dists[i] < radii[i]
            for j in range(len(seeds)):
                if j != i:
                    mine &= dists[i] <= dists[j]
            if mine.sum() < enough:
                if radii[i] > 0.4:
                    settled[i] = True
                else:
                    radii[i] *= 1.25
                continue
            moved = pixels[mine].mean(axis=0)
            shift = moved - origin
            moved_by = float(_distance(shift[None], np.zeros(3))[0])
            if moved_by > reach:
                moved = origin + shift * (reach / moved_by)
            settled[i] = np.abs(moved - seeds[i]).max() < 1e-4
            seeds[i] = moved
        if all(settled):
            break
    return seeds


def _clean(soft: np.ndarray) -> np.ndarray:
    """Close (fill strokes and thin outlines inside a part), open (drop specks), soften."""
    im = Image.fromarray((soft * 255).round().astype(np.uint8), "L")
    im = im.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
    im = im.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    im = im.filter(ImageFilter.GaussianBlur(1.5))
    return np.asarray(im, dtype=np.float64) / 255.0


def draft_parts(rgba: np.ndarray, main_hex: str | list[str], accent_hex: str | list[str],
                near: float = 0.06, far: float = 0.10, reach: float = 0.045) -> np.ndarray:
    """A draft coat mask (uint8, HxWx3): R the main part painted near `main_hex`, G the accent
    part near `accent_hex`, B the figure (`figure_mask`). A part may be painted in more than
    one colour (Bigfoot's fur: a cream coat and a brown mane): give it a list, and every one of
    its colours seeds it.

    As the proof of concept did (hero-looks.md section 2): pick each part out by colour. The
    palette colour is a target, not what was painted, so each seed first walks to the middle of
    the nearest painted mass (`_walk`). Pixels within `near` of a part's seed are in, beyond
    `far` are out, soft in between, and a pixel near both goes to the nearer, so no pixel is
    strongly in both parts. Small gaps (fur strokes, the outlines inside a coat) are closed,
    specks are dropped, the edge is softened, and nothing leaves the figure. It bleeds wherever
    two parts share a colour, which is why every shipped mask is hand-cleaned (section 4.3)."""
    rgb = rgba[..., :3].astype(np.float64) / 255.0
    figure = figure_mask(rgba)
    lab = srgb_to_oklab(rgb)
    solid = figure > 0.5

    # every colour of both parts walks at once, each competing with all the others
    owners: list[int] = []
    origins: list[np.ndarray] = []
    for owner, hexes in enumerate((main_hex, accent_hex)):
        for hexv in [hexes] if isinstance(hexes, str) else hexes:
            owners.append(owner)
            origins.append(srgb_to_oklab(hex_rgb(hexv)))
    seeds = _walk(lab[solid][::5], origins, reach, far)  # a sample is plenty to find a mode

    # a part's distance is to the nearest of its own colours
    d_main, d_accent = (np.min([_distance(lab, s) for s, o in zip(seeds, owners) if o == part], axis=0)
                        for part in (0, 1))
    soft_main = np.clip((far - d_main) / (far - near), 0.0, 1.0) * solid * (d_main <= d_accent)
    soft_accent = np.clip((far - d_accent) / (far - near), 0.0, 1.0) * solid * (d_accent < d_main)
    main = np.minimum(_clean(soft_main), figure)
    accent = np.minimum(_clean(soft_accent), figure)
    # the closing and the blur let the two parts grow into each other where their strokes
    # interleave: the stronger keeps the pixel and the weaker gets only what is left of it, so
    # a pixel is at most half in each, and only along the soft line where they meet
    main_wins = main >= accent
    accent = np.where(main_wins, np.minimum(accent, 1.0 - main), accent)
    main = np.where(main_wins, main, np.minimum(main, 1.0 - accent))
    out = np.stack([main, accent, figure], axis=-1)
    return (out * 255).round().astype(np.uint8)


def backdrop(rgba: np.ndarray, thresh: int = 45, scale: int = 4) -> np.ndarray:
    """An opaque painting's backdrop, 0..1 (HxW): what floods in from the canvas edges without
    crossing a colour step of more than `thresh` (summed over R, G, B) from where it started.
    Worked on a quarter-size copy and softened back up; a draft, like everything here."""
    h, w = rgba.shape[:2]
    small = Image.fromarray(rgba[..., :3].astype(np.uint8), "RGB").resize((max(1, w // scale), max(1, h // scale)), Image.BILINEAR)
    before = np.asarray(small).copy()
    sw, sh = small.size
    flood = small.copy()
    marker = (255, 0, 255)
    for x in range(0, sw, 8):
        for y in (0, sh - 1):
            if flood.getpixel((x, y)) != marker:
                ImageDraw.floodfill(flood, (x, y), marker, thresh=thresh)
    for y in range(0, sh, 8):
        for x in (0, sw - 1):
            if flood.getpixel((x, y)) != marker:
                ImageDraw.floodfill(flood, (x, y), marker, thresh=thresh)
    after = np.asarray(flood)
    changed = (after != before).any(axis=-1) | (after == marker).all(axis=-1)
    im = Image.fromarray((changed * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(3))
    im = im.resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(2))
    return np.asarray(im, dtype=np.float64) / 255.0


# ----------------------------------------------------------------------------- the colour swap


def _in_gamut(lab: np.ndarray, eps: float = 1e-4) -> np.ndarray:
    lin = oklab_to_linear(lab)
    return ((lin >= -eps) & (lin <= 1 + eps)).all(axis=-1)


# A two-tone coat's soft step (section 5.5): half its width in OKLab lightness, either side of
# the region's mean. The client's COAT_SWAP.twoToneStep.
TWO_TONE_STEP = 0.04


def tint(rgba: np.ndarray, mask: np.ndarray, coat_hex: str, dark_hex: str | None = None) -> np.ndarray:
    """Recolour the masked region to `coat_hex` (hero-looks.md section 5.2), for review.

    Lightness: the coat's, plus each pixel's step from the region's mean (softened x0.85
    going darker), clamped to 0.04..0.98. Hue: the coat's. Chroma: the coat's, times
    sqrt(pixel/mean) clamped 0.6..1.4, or the coat's as is for a near-grey region (mean
    chroma under 0.02). Out of gamut: chroma lowered at the same lightness and hue. Blended
    by the mask. Returns uint8 RGBA, alpha untouched.

    Given `dark_hex`, a two-tone coat (section 5.5): each pixel is swapped to both colours and
    the two mixed in sRGB, the light one above the region's mean lightness and the dark one
    below, across a smooth step TWO_TONE_STEP either side (the client's `twoToneWeight`)."""
    rgb = rgba[..., :3].astype(np.float64) / 255.0
    w = mask.astype(np.float64) / 255.0
    if w.sum() <= 0:
        return rgba.copy()
    lab = srgb_to_oklab(rgb)
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(a, b)
    total = w.sum()
    meanL = float((w * L).sum() / total)
    meanC = float((w * C).sum() / total)

    def swap(hexv: str) -> np.ndarray:
        t = srgb_to_oklab(hex_rgb(hexv))
        tL, tC, th = float(t[0]), float(np.hypot(t[1], t[2])), float(np.arctan2(t[2], t[1]))

        step = L - meanL
        if tL < meanL:
            step = step * 0.85
        nL = np.clip(tL + step, 0.04, 0.98)
        if meanC < 0.02:
            nC = np.full_like(L, tC)
        else:
            nC = tC * np.clip(np.sqrt(np.maximum(C, 0) / meanC), 0.6, 1.4)

        def at(scale: np.ndarray) -> np.ndarray:
            c = nC * scale
            return np.stack([nL, c * np.cos(th), c * np.sin(th)], axis=-1)

        # bring out-of-gamut pixels in by chroma only (bisection on a per-pixel scale)
        lo = np.zeros_like(L)
        hi = np.ones_like(L)
        ok = _in_gamut(at(hi))
        lo[ok] = 1.0
        for _ in range(14):
            mid = (lo + hi) / 2
            good = _in_gamut(at(mid))
            lo = np.where(good, mid, lo)
            hi = np.where(good, hi, mid)
        return oklab_to_srgb(at(lo))

    new = swap(coat_hex)
    if dark_hex is not None:
        x = np.clip((L - meanL + TWO_TONE_STEP) / (2 * TWO_TONE_STEP), 0.0, 1.0)
        light = (x * x * (3 - 2 * x))[..., None]
        new = new * light + swap(dark_hex) * (1 - light)

    out = rgb * (1 - w[..., None]) + new * w[..., None]
    res = rgba.copy()
    res[..., :3] = (np.clip(out, 0, 1) * 255).round().astype(np.uint8)
    return res


# ----------------------------------------------------------------------------- the gate


def _share(part: np.ndarray, bound: np.ndarray) -> float:
    """How much of `part` (0..1, HxW) lies beyond `bound`, as a share of it."""
    total = part.sum()
    return float(np.maximum(part - bound, 0).sum() / total) if total > 0 else 0.0


def mask_problems(mask_im: Image.Image, painting_im: Image.Image, tol: dict) -> list[tuple[str, object, object]]:
    """What is wrong with a mask against its painting, as (what, expected, actual) triples.
    Empty when it passes. `tol` is manifest coatMasks.tolerance.

    The mask is 8-bit RGB on the painting's canvas. R (main) and G (accent) each cover a sane
    share of the canvas (neither empty nor all of it), each lies inside B (the figure), and they
    barely overlap. B is neither empty nor the whole canvas, and on a transparent painting it
    lies inside the painting's alpha. A gear portrait is opaque, so the review sheet is the only
    check that its B leaves the backdrop out."""
    problems: list[tuple[str, object, object]] = []
    if mask_im.mode != "RGB":
        problems.append(("mode", "RGB (8-bit; R main, G accent, B figure)", mask_im.mode))
        return problems
    if mask_im.size != painting_im.size:
        problems.append(("canvas", f"{painting_im.size[0]}x{painting_im.size[1]} (its painting's)",
                         f"{mask_im.size[0]}x{mask_im.size[1]}"))
        return problems
    m = np.asarray(mask_im, dtype=np.float64) / 255.0
    main, accent, figure = m[..., 0], m[..., 1], m[..., 2]

    for name, part in (("main", main), ("accent", accent)):
        coverage = float(part.mean())
        if coverage < tol["minCoverage"]:
            problems.append((f"{name} coverage", f">= {tol['minCoverage']:.2%} of the canvas", f"{coverage:.2%} (empty)"))
        elif coverage > tol["maxCoverage"]:
            problems.append((f"{name} coverage", f"<= {tol['maxCoverage']:.0%} of the canvas",
                             f"{coverage:.1%} (the whole canvas)"))
    coverage = float(figure.mean())
    if coverage < tol["minCoverage"]:
        problems.append(("figure coverage", f">= {tol['minCoverage']:.2%} of the canvas", f"{coverage:.2%} (empty)"))
    elif coverage > tol["maxFigureCoverage"]:
        problems.append(("figure coverage", f"<= {tol['maxFigureCoverage']:.0%} of the canvas",
                         f"{coverage:.1%} (the backdrop too)"))

    for name, part in (("main", main), ("accent", accent)):
        spill = _share(part, figure)
        if spill > tol["maxSpill"]:
            problems.append((f"{name} inside the figure", f"<= {tol['maxSpill']:.1%} of it outside B",
                             f"{spill:.1%} outside"))

    smaller = min(main.sum(), accent.sum())
    if smaller > 0:
        overlap = float(np.minimum(main, accent).sum() / smaller)
        if overlap > tol["maxOverlap"]:
            problems.append(("overlap", f"<= {tol['maxOverlap']:.0%} of the smaller part also in the other",
                             f"{overlap:.1%}"))

    if "A" in painting_im.getbands():
        alpha = np.asarray(painting_im.getchannel("A"), dtype=np.float64) / 255.0
        if alpha.min() < 1.0:
            spill = _share(figure, alpha)
            if spill > tol["maxSpill"]:
                problems.append(("figure inside the alpha", f"<= {tol['maxSpill']:.1%} of B outside the painting's alpha",
                                 f"{spill:.1%} outside"))
    return problems
