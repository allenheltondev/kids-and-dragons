"""
Kids & Dragons - coat masks: the shared library under art:coat-draft, art:verify and art:sheet.

A coat mask (docs/hero-looks.md section 4) is an 8-bit greyscale PNG on its painting's own
canvas: white is the one region of the hero that takes her chosen colour, black is not, and the
edges are soft. Which region that is, per species, is assets/manifest.json -> coatMasks.regions,
which the client reads too (packages/client/src/world/coat-masks.ts).

Three families of painting carry one each (section 4.1):

    base   assets/characters/<species>/<tier>/assembled.png       -> coat-mask.png beside it
    class  assets/character-rigs/<class>/<tier>/<species>/assembled.png -> coat-mask.png beside it
    gear   assets/gear-portraits/<class>/<tier>/<species>.png     -> <species>.coat-mask.png

This module knows those paths, drafts a mask by colour as the 2026-11-07 proof of concept did
(section 2), and recolours a painting through a mask in OKLab as section 5.2 describes, for the
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


def region_of(mf: dict, species: str) -> dict:
    return mf["coatMasks"]["regions"][species]


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


def draft_mask(rgba: np.ndarray, seed_hex: str, near: float = 0.06, far: float = 0.10) -> np.ndarray:
    """A draft mask (uint8, HxW) for the region painted near `seed_hex`.

    As the proof of concept did (hero-looks.md section 2): pick the region out by colour.
    The palette colour is a target, not what was painted, so the seed first walks toward the
    middle of the nearest painted mass (a few mean-shift steps, never far). On an opaque
    painting the backdrop (flooded in from the edges) is left out first. Pixels within `near` of it
    are in, beyond `far` are out, soft in between; small gaps (fur strokes, the outlines
    inside a coat) are closed, specks are dropped, the edge is softened, and the result never
    leaves the painting's alpha. It bleeds wherever two parts share a colour, which is why
    every shipped mask is hand-cleaned (section 4.3)."""
    rgb = rgba[..., :3].astype(np.float64) / 255.0
    alpha = rgba[..., 3].astype(np.float64) / 255.0 if rgba.shape[-1] == 4 else np.ones(rgb.shape[:2])
    lab = srgb_to_oklab(rgb)
    if alpha.min() >= 1.0:
        # an opaque painting (a gear portrait): its backdrop is never the region
        alpha = alpha * (1.0 - backdrop(rgba))
    solid = alpha > 0.5

    # Mean shift with a flat kernel no wider than the region's own tolerance, so the seed climbs
    # to the nearest painted mode rather than being dragged to the biggest mass nearby (a
    # griffin's white body beside her blue). It widens only while nothing is near enough.
    seed = origin = srgb_to_oklab(hex_rgb(seed_hex))
    pixels = lab[solid][::5]  # a sample is plenty to find a mode
    enough = max(16, len(pixels) // 500)
    radius = far
    for _ in range(30):
        sel = _distance(pixels, seed) < radius
        if sel.sum() < enough:
            if radius > 0.4:
                break
            radius *= 1.25
            continue
        moved = pixels[sel].mean(axis=0)
        # never wander further from the palette than the region's tolerance: shading on a
        # neighbouring part (a white body's blue shadows) is a path to the wrong region
        shift = moved - origin
        reach = float(_distance(shift[None], np.zeros(3))[0])
        if reach > near:
            moved = origin + shift * (near / reach)
        done = np.abs(moved - seed).max() < 1e-4
        seed = moved
        if done:
            break

    d = _distance(lab, seed)
    soft = np.clip((far - d) / (far - near), 0.0, 1.0) * solid
    im = Image.fromarray((soft * 255).round().astype(np.uint8), "L")
    # close (fill strokes and thin outlines inside the region), then open (drop specks)
    im = im.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
    im = im.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    im = im.filter(ImageFilter.GaussianBlur(1.5))
    out = np.asarray(im, dtype=np.float64) / 255.0
    out = np.minimum(out, alpha)
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


def tint(rgba: np.ndarray, mask: np.ndarray, coat_hex: str) -> np.ndarray:
    """Recolour the masked region to `coat_hex` (hero-looks.md section 5.2), for review.

    Lightness: the coat's, plus each pixel's step from the region's mean (softened x0.85
    going darker), clamped to 0.04..0.98. Hue: the coat's. Chroma: the coat's, times
    sqrt(pixel/mean) clamped 0.6..1.4, or the coat's as is for a near-grey region (mean
    chroma under 0.02). Out of gamut: chroma lowered at the same lightness and hue. Blended
    by the mask. Returns uint8 RGBA, alpha untouched."""
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

    t = srgb_to_oklab(hex_rgb(coat_hex))
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
    new = oklab_to_srgb(at(lo))

    out = rgb * (1 - w[..., None]) + new * w[..., None]
    res = rgba.copy()
    res[..., :3] = (np.clip(out, 0, 1) * 255).round().astype(np.uint8)
    return res


# ----------------------------------------------------------------------------- the gate


def mask_problems(mask_im: Image.Image, painting_im: Image.Image, tol: dict) -> list[tuple[str, object, object]]:
    """What is wrong with a mask against its painting, as (what, expected, actual) triples.
    Empty when it passes. `tol` is manifest coatMasks.tolerance."""
    problems: list[tuple[str, object, object]] = []
    if mask_im.mode != "L":
        problems.append(("mode", "L (8-bit greyscale)", mask_im.mode))
        return problems
    if mask_im.size != painting_im.size:
        problems.append(("canvas", f"{painting_im.size[0]}x{painting_im.size[1]} (its painting's)",
                         f"{mask_im.size[0]}x{mask_im.size[1]}"))
        return problems
    m = np.asarray(mask_im, dtype=np.float64) / 255.0
    coverage = float(m.mean())
    if coverage < tol["minCoverage"]:
        problems.append(("coverage", f">= {tol['minCoverage']:.2%} of the canvas", f"{coverage:.2%} (empty)"))
    elif coverage > tol["maxCoverage"]:
        problems.append(("coverage", f"<= {tol['maxCoverage']:.0%} of the canvas", f"{coverage:.1%} (the whole canvas)"))
    if "A" in painting_im.getbands():
        alpha = np.asarray(painting_im.getchannel("A"), dtype=np.float64) / 255.0
        if alpha.min() < 1.0 and m.sum() > 0:
            spill = float(np.maximum(m - alpha, 0).sum() / m.sum())
            if spill > tol["maxSpill"]:
                problems.append(("inside the figure", f"<= {tol['maxSpill']:.1%} of the mask outside the painting's alpha",
                                 f"{spill:.1%} outside"))
    return problems
