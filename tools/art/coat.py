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


# How a part's lightness is mapped (section 5.2), named once; the client's COAT_SWAP.
LIGHT_BINS = 1024      # the histograms a part's lightness and chroma percentiles are read from
CHROMA_TOP = 0.5       # the chroma histogram's top: OKLab chroma in sRGB stays under it
LOW_Q, HIGH_Q = 0.05, 0.95  # the part's spread: its 5th to 95th percentile of lightness
SPAN = 0.30            # a part spread wider than this has its steps compressed to fit it
FLOOR, CEIL = 0.14, 0.95  # the steps are compressed so the spread stays inside these
DARK_SOFTEN = 0.85     # going darker than the part's anchor, the steps are softened
MIN_L, MAX_L = 0.04, 0.98


def _quantiles(values: np.ndarray, w: np.ndarray, top: float, qs: tuple[float, ...]) -> list[float]:
    """Weighted quantiles of `values` (0..top) from a LIGHT_BINS histogram: for each q, the
    centre of the first bin whose running weight reaches q of the total. The client's
    `coatRegionStats` reads them the same way."""
    total = float(w.sum())
    idx = np.clip(np.floor(values / top * LIGHT_BINS), 0, LIGHT_BINS - 1).astype(np.int64)
    cum = np.cumsum(np.bincount(idx.ravel(), weights=w.ravel(), minlength=LIGHT_BINS))
    out = []
    for q in qs:
        b = int(np.searchsorted(cum, q * total, side="left"))
        out.append((min(b, LIGHT_BINS - 1) + 0.5) / LIGHT_BINS * top)
    return out


def region_stats(L: np.ndarray, C: np.ndarray, w: np.ndarray) -> dict:
    """A region's lightness anchor and spread, and its chroma anchor (section 5.2).

    The anchors are mask-weighted medians: the lightness and chroma of most of the part, where
    the chosen colour lands (a Bigfoot's cream body, not halfway to his brown mane). The spread
    is the weighted 5th to 95th percentile of lightness."""
    low, anchor, high = _quantiles(L, w, 1.0, (LOW_Q, 0.5, HIGH_Q))
    (anchor_c,) = _quantiles(C, w, CHROMA_TOP, (0.5,))
    return {"anchorL": anchor, "lowL": low, "highL": high, "anchorC": anchor_c}


def _lightness(L: np.ndarray, st: dict, tL: float) -> np.ndarray:
    """Each pixel's new lightness (section 5.2): the colour's, plus its step from the part's
    anchor, the steps compressed so a wide part's spread fits SPAN (and softened going darker),
    and further so the spread stays inside FLOOR..CEIL around the colour, so nothing is crushed
    to black or clamped to white. A narrow part away from the ends keeps its steps as painted."""
    anchor, low, high = st["anchorL"], st["lowL"], st["highL"]
    k = 1.0
    spread = high - low
    if spread > SPAN:
        k = SPAN / spread
    if tL < anchor:
        k *= DARK_SOFTEN
    up = (high - anchor) * k
    down = (anchor - low) * k
    k_up = max(0.0, CEIL - tL) / up if up > 0 and tL + up > CEIL else 1.0
    k_down = max(0.0, tL - FLOOR) / down if down > 0 and tL - down < FLOOR else 1.0
    step = L - anchor
    step = step * k * np.where(step > 0, k_up, k_down)
    return np.clip(tL + step, MIN_L, MAX_L)


def _swap(L: np.ndarray, C: np.ndarray, st: dict, hexv: str) -> np.ndarray:
    """Every pixel swapped to `hexv` by the section 5.2 rules, before the mask's blend: sRGB 0..1."""
    t = srgb_to_oklab(hex_rgb(hexv))
    tL, tC, th = float(t[0]), float(np.hypot(t[1], t[2])), float(np.arctan2(t[2], t[1]))

    nL = _lightness(L, st, tL)
    anchor_c = st["anchorC"]
    if anchor_c < 0.02:
        nC = np.full_like(L, tC)
    else:
        nC = tC * np.clip(np.sqrt(np.maximum(C, 0) / anchor_c), 0.6, 1.4)

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


def _tint_regions(rgba: np.ndarray, regions: list[tuple[np.ndarray, str]]) -> np.ndarray:
    """Recolour each (mask HxW uint8, colour hex) region of `rgba`, each by its own region's
    anchor, spread and chroma, blended by its mask. Where the soft edges of two regions reach one
    pixel and their weights add to more than 1, they are shared out (each scaled by 1/total), so
    a pixel is never more than wholly recoloured. Regions with an empty mask are skipped. The
    client's `tintHeroPixels` / `tintCoatPixels`. Returns uint8 RGBA, alpha untouched."""
    rgb = rgba[..., :3].astype(np.float64) / 255.0
    live = [(m.astype(np.float64) / 255.0, hexv) for m, hexv in regions if m.astype(np.float64).sum() > 0]
    if not live:
        return rgba.copy()
    lab = srgb_to_oklab(rgb)
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(a, b)
    total = sum(w for w, _ in live)
    share = np.where(total > 1, 1.0 / np.maximum(total, 1e-12), 1.0)
    out = rgb * (1 - total * share)[..., None]
    for w, hexv in live:
        out = out + _swap(L, C, region_stats(L, C, w), hexv) * (w * share)[..., None]
    res = rgba.copy()
    res[..., :3] = (np.clip(out, 0, 1) * 255).round().astype(np.uint8)
    return res


def tint(rgba: np.ndarray, mask: np.ndarray, coat_hex: str) -> np.ndarray:
    """Recolour one masked region (`mask`, HxW uint8: one channel of a coat mask) to `coat_hex`
    (hero-looks.md section 5.2), for review.

    Lightness: the colour's, plus each pixel's step from the region's anchor (its weighted
    median lightness), the steps compressed when the region's 5th..95th percentile spread is
    wider than SPAN, softened x0.85 going darker, and compressed again to keep the spread inside
    FLOOR..CEIL (`_lightness`), then clamped to 0.04..0.98. Hue: the colour's. Chroma: the colour's, times
    sqrt(pixel/anchor) clamped 0.6..1.4 (the anchor the region's weighted median chroma), or
    the colour's as is for a near-grey region (anchor under 0.02). Out of gamut: chroma lowered at the same lightness and hue. Blended
    by the mask. Returns uint8 RGBA, alpha untouched.

    A gilded special (section 5.5) is this on the mask's figure channel (blue) with its gold:
    the whole figure, its lightness steps kept."""
    return _tint_regions(rgba, [(mask, coat_hex)])


def tint_parts(rgba: np.ndarray, mask_rgb: np.ndarray, main_hex: str | None, accent_hex: str | None) -> np.ndarray:
    """Her two colours in one pass (section 5.2, two parts): the RGB mask's red channel (her
    main part) takes `main_hex` and its green (her accent part) `accent_hex`, each swapped with
    its own region's means; None leaves a part as painted. The client's `tintHeroPixels`."""
    regions = []
    if main_hex is not None:
        regions.append((mask_rgb[..., 0], main_hex))
    if accent_hex is not None:
        regions.append((mask_rgb[..., 1], accent_hex))
    return _tint_regions(rgba, regions)


def gild(rgba: np.ndarray, mask_rgb: np.ndarray, gold_hex: str) -> np.ndarray:
    """A gilded special (section 5.5): her whole figure (the RGB mask's blue channel) swapped
    toward `gold_hex`, keeping its lightness steps, her colours ignored."""
    return tint(rgba, mask_rgb[..., 2], gold_hex)


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
