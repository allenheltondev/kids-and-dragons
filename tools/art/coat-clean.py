#!/usr/bin/env python3
"""
Kids & Dragons - clean drafted coat masks (docs/hero-looks.md section 4.3, step 2).

`npm run art:coat-draft` picks a hero's two parts out by colour, which bleeds wherever two parts
share one (a Bigfoot's shaded fur is as warm as his skin; a unicorn's hooves are as purple as her
mane). This is the hand cleaning, written down so it can be run again: per-species rules, then a
per-painting table of hand fixes for what no rule separates (an artist's brush and eraser).

    R  the main part     G  the accent part     B  the figure (the draft's: the painting's alpha)

    unicorn     coat                              mane, forelock, tail
    bigfoot     fur (cream body and brown mane)   skin (face, hands, feet)
    dragonling  scales (with belly, wing bones)   wing webbing (with its glowing marks)
    griffin     coat (with shading and stars)     blue crest, ruff and tail tuft
    kitsune     fur (with white tail tips)        teal tails
    manticore   fur (with inner ears, belly)      crimson mane (with eyebrows)

Never in R or G: eyes, dark outlines, and each species' painted extras (a unicorn's horn and
hooves, Bigfoot's leaves, a dragonling's spikes and horns, a griffin's yellow wings, beak and
talons, a kitsune's orange ruff and markings, a manticore's scorpion tail, nose and claws).
Both parts get a soft edge (a ~1px blur), clipped to the figure, and are shared out where the
blurs meet so a pixel is never more than wholly coloured.

Usage:
    npm run art:coat-draft -- bigfoot --family base --out staging/coat-drafts
    npm run art:coat-clean -- bigfoot                 # base family, drafts from staging/coat-drafts
    npm run art:coat-clean -- bigfoot --tier mythic
    npm run art:coat-clean -- bigfoot --drafts DIR --out DIR2   # read DIR/assets/..., write DIR2/assets/...

It writes beside each painting in assets/ unless --out is given. Then review the result on
`npm run art:sheet -- --coat` and list the painting in assets/manifest.json -> coatMasks.paintings.

Every species has rules (#667, #668). A species' function is called for all three families;
it can tell them apart by `painting` (base `characters/`, class `character-rigs/`, gear
`gear-portraits/`). On a gear portrait, which is opaque, `look.alpha` is the draft's figure (B),
so the painted backdrop is never in either part. A class costume, gear and props stay as painted.

Requires: Pillow, numpy, scipy
"""

from __future__ import annotations

import argparse
import json
import os
import sys

try:
    import numpy as np
    from PIL import Image
    from scipy import ndimage
except ImportError:
    sys.exit("error: needs Pillow, numpy and scipy  ->  pip install pillow numpy scipy")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coat  # noqa: E402

SOFTEN = 0.8  # the parts' edge: a gaussian of this sigma (px) over the cleaned binary part


# ----------------------------------------------------------------------------- hand fixes
#
# Per painting (path under assets/), boxes as (top, bottom, left, right) in canvas pixels:
#   "skin"     Bigfoot: inside the box, the largest smooth warm piece is skin
#   "not_skin" Bigfoot: inside the box, nothing is skin (it is fur)
#   "hand"     Bigfoot: inside the box, all his skin-coloured paint is skin (a fist, its fingers
#              cut apart by their lines)
#   "face"     Bigfoot: inside the box, his lit skin-coloured paint (OKLab L >= 0.58) is skin, though
#              painted in strokes (the edge of his face against his darker mane)
#   "coat"     unicorn: inside the box, her soft lavender is coat (inner ears, the far belly)
#   "nose"     manticore: inside the box, the crimson paint is her nose, in neither part

FIXES: dict[str, dict[str, list[tuple[int, int, int, int]]]] = {
    # her inner ears and the shaded belly between her far legs, lavender like her mane
    "characters/unicorn/fledgling/assembled.png": {"coat": [(85, 165, 155, 185), (145, 212, 380, 415), (540, 625, 540, 622)]},
    "characters/unicorn/sworn/assembled.png": {"coat": [(160, 210, 395, 420), (550, 620, 544, 606)]},
    "characters/unicorn/radiant/assembled.png": {"coat": [(165, 218, 390, 415), (560, 605, 548, 595)]},
    "characters/unicorn/mythic/assembled.png": {"coat": [(590, 626, 552, 600)]},
    # her nose, painted in her mane's crimson
    "characters/manticore/fledgling/assembled.png": {"nose": [(360, 397, 186, 252)]},
    "characters/manticore/sworn/assembled.png": {"nose": [(362, 398, 196, 257)]},
    "characters/manticore/radiant/assembled.png": {"nose": [(353, 389, 189, 250)]},
    "characters/manticore/mythic/assembled.png": {"nose": [(373, 409, 206, 267)]},
    # Bigfoot dressed (class paintings and gear portraits): skin the rules missed (his brow and
    # cheek beside his mane; a hand or its curled fingers)
    "character-rigs/thornguard/radiant/bigfoot/assembled.png": {"skin": [(125, 275, 405, 535), (175, 235, 405, 460)], "face": [(140, 220, 408, 432)]},
    "character-rigs/thornguard/mythic/bigfoot/assembled.png": {"hand": [(640, 715, 305, 392), (624, 640, 320, 392), (608, 624, 334, 392), (598, 608, 348, 392)]},
    "character-rigs/duskrunner/sworn/bigfoot/assembled.png": {"hand": [(612, 705, 295, 375)]},
    "gear-portraits/thornguard/radiant/bigfoot.png": {"skin": [(190, 375, 495, 645), (225, 290, 498, 545)]},
    "gear-portraits/thornguard/mythic/bigfoot.png": {"skin": [(735, 880, 370, 470)]},
}


def boxes(painting: str, kind: str, shape: tuple[int, int]) -> np.ndarray | None:
    """The painting's fix boxes of one kind as a mask on its canvas, or None."""
    found = FIXES.get(painting, {}).get(kind, [])
    if not found:
        return None
    out = np.zeros(shape, bool)
    for (r0, r1, c0, c1) in found:
        out[r0:r1, c0:c1] = True
    return out


# ----------------------------------------------------------------------------- shared

def disk(r: int) -> np.ndarray:
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


SQUARE = np.ones((3, 3), bool)


class Look:
    """A painting's per-pixel colour in OKLab: lightness L, chroma C, hue (degrees), its alpha,
    and `rough`, the local spread of lightness (5px window) over the painted, non-ink pixels:
    skin is painted smooth, fur in strokes."""

    def __init__(self, rgba: np.ndarray, figure: np.ndarray | None = None):
        """`figure` (HxW bool) is her silhouette when the painting's alpha isn't: a gear portrait
        is opaque, so its figure is the draft's B channel (everything but the backdrop)."""
        self.rgba = rgba
        lab = coat.srgb_to_oklab(rgba[..., :3] / 255.0)
        self.L = lab[..., 0]
        self.C = np.hypot(lab[..., 1], lab[..., 2])
        self.hue = np.degrees(np.arctan2(lab[..., 2], lab[..., 1]))
        self.alpha = (rgba[..., 3] > 128) if figure is None else (figure & (rgba[..., 3] > 128))
        self.ink = self.L < 0.36
        w = (self.alpha & ~self.ink).astype(float)
        n = np.maximum(ndimage.uniform_filter(w, 5), 1e-6)
        mu = ndimage.uniform_filter(self.L * w, 5) / n
        m2 = ndimage.uniform_filter(self.L * self.L * w, 5) / n
        self.rough = np.sqrt(np.maximum(m2 - mu * mu, 0))

    def warm(self, cmin: float, lmin: float = 0.0, lmax: float = 1.01, h0: float = 30, h1: float = 100) -> np.ndarray:
        return self.alpha & (self.C >= cmin) & (self.L >= lmin) & (self.L < lmax) & (self.hue > h0) & (self.hue < h1)

    def outline(self, light: float = 0.62) -> np.ndarray:
        """Ink drawn as an outline: dark pixels at the figure's edge, or against light paint.
        (Dark strokes inside a dark part, such as a mane, are that part's painting.)"""
        edge = ndimage.binary_dilation(~self.alpha, structure=disk(4))
        lit = ndimage.binary_dilation(self.alpha & (self.L > light), structure=disk(2))
        return self.ink & (edge | lit)


def soften(part: np.ndarray) -> np.ndarray:
    return ndimage.gaussian_filter(part.astype(float), SOFTEN)


# ----------------------------------------------------------------------------- unicorn

def clean_unicorn(look: Look, draft: np.ndarray, painting: str) -> tuple[np.ndarray, np.ndarray]:
    """Mane (G) = mane, forelock and tail, from the draft's G; the coat (R) from the draft's R.

    - Her horn (blue, with pale facets) is in neither: see `unicorn_horn`.
    - Her hooves are as purple as her mane: G blobs low on the figure are dropped, as are
      specks under 400px.
    - The glow in her mane (a deeper magenta) and the indigo shadow inside her tail, which the
      draft left out, are grown back from the mane by hue.
    - Her inner ears and the shaded belly between her far legs are painted in the mane's
      lavender: the `coat` fix boxes give them back to the coat.
    - The coat's shaded underside (a deeper lavender) that the draft left out of R is grown
      back from the coat by hue.
    - Last, the specks left in neither part where coat meets mane (not ink, not horn, near one
      part's hue) go to the nearer part, so no untinted lilac shows under a dark colour."""
    a = look.alpha
    ys = np.nonzero(a)[0]
    y0, y1 = ys.min(), ys.max()
    horn = unicorn_horn(look)
    g = draft[..., 1] > 96
    labs, n = ndimage.label(g)
    keep = np.zeros_like(g)
    for i in range(1, n + 1):
        comp = labs == i
        if comp.sum() < 400:
            continue
        if np.nonzero(comp)[0].mean() > y1 - 0.14 * (y1 - y0):  # a hoof
            continue
        keep |= comp
    mane = (draft[..., 1] > 128) & ndimage.binary_dilation(keep, iterations=3)
    mane = ndimage.binary_fill_holes(ndimage.binary_closing(mane, structure=SQUARE, iterations=1)) & a & ~horn
    mane_hue = np.median(look.hue[mane])
    dm = np.abs((look.hue - mane_hue + 180) % 360 - 180)
    glow = a & ~horn & ~look.ink & (dm < 25) & (look.C >= 0.12)
    mane |= ndimage.binary_propagation(mane, mask=glow | mane)
    # (ink outlines are brown, hue 0..30, and her hooves as purple as her mane: both stay out)
    shadow = a & ~horn & (look.C >= 0.06) & (look.L >= 0.2) & (look.hue > -115) & (look.hue < mane_hue - 8)
    reach = ndimage.binary_dilation(mane, structure=disk(25))
    mane |= ndimage.binary_propagation(mane, mask=(shadow & reach) | mane)

    coat_ = (draft[..., 0] > 128) & a & ~mane & ~horn
    give = boxes(painting, "coat", a.shape)
    if give is not None:
        # only the soft lavender: a saturated lock of mane crossing the box stays mane
        moved = give & mane & (look.C < 0.115)
        mane &= ~moved
        coat_ |= moved | (give & a & ~mane & ~horn & ~look.ink)
    coat_hue = np.median(look.hue[coat_])
    dh = np.abs((look.hue - coat_hue + 180) % 360 - 180)
    shaded = a & ~mane & ~coat_ & ~horn & (look.L >= 0.6) & (dh < 25) & (look.C < 0.12)
    coat_ |= ndimage.binary_propagation(coat_, mask=shaded | coat_)
    # the pale coat showing between the mane's last strands is coat, not a pale fringe of mane
    pale = mane & (look.L > 0.72) & (look.C < 0.075) & ndimage.binary_dilation(coat_, structure=disk(6))
    pale = ndimage.binary_propagation(coat_, mask=pale | coat_) & pale
    mane &= ~pale
    coat_ |= pale

    # (white highlights too, except inside a small loop of ink: her eyes)
    loops = ndimage.binary_fill_holes(look.ink) & ~look.ink
    labs, n = ndimage.label(loops)
    eyes = np.zeros_like(a)
    if n:
        small = np.zeros(n + 1, bool)
        small[1:] = ndimage.sum(loops, labs, np.arange(1, n + 1)) < 2500
        eyes = ndimage.binary_dilation(small[labs], structure=disk(2))
    hued = (look.C >= 0.02) & ((dh < 40) | (dm < 40))
    white = (look.C < 0.02) & (look.L > 0.8)
    left = a & ~mane & ~coat_ & ~horn & ~look.ink & ~eyes & (hued | white)
    d_coat = ndimage.distance_transform_edt(~coat_)
    d_mane = ndimage.distance_transform_edt(~mane)
    coat_ |= left & (d_coat <= 5) & (d_coat <= d_mane)
    mane |= left & (d_mane <= 5) & (d_mane < d_coat)
    # ink drawn as an outline (at her edge, or against her pale coat) is in neither part; the
    # strand lines inside her mane are its painting
    line = look.outline(light=0.78)
    return coat_ & ~mane & ~horn & ~line, mane & ~line


def unicorn_horn(look: Look) -> np.ndarray:
    """Her horn, never coloured: the largest blue piece (OKLab hue 210..285) in the top of her
    figure and the blue pieces beside it (the crystals at its base), closed and filled, so its
    pale facets go with it."""
    a = look.alpha
    blue = a & (look.C > 0.035) & (look.hue > -150) & (look.hue < -75)
    ys = np.nonzero(a)[0]
    rows = np.arange(a.shape[0])[:, None]
    blue &= rows < ys.min() + 0.4 * (ys.max() - ys.min())
    labs, n = ndimage.label(ndimage.binary_closing(blue, structure=SQUARE))
    if not n:
        return np.zeros_like(a)
    sizes = ndimage.sum(labs > 0, labs, np.arange(1, n + 1))
    biggest = labs == (int(np.argmax(sizes)) + 1)
    near = np.unique(labs[ndimage.binary_dilation(biggest, structure=disk(6))])
    horn = np.isin(labs, near[near > 0])
    horn = ndimage.binary_fill_holes(ndimage.binary_closing(horn, structure=disk(3)))
    return ndimage.binary_dilation(horn, structure=SQUARE) & a


# ----------------------------------------------------------------------------- bigfoot

def clean_bigfoot(look: Look, draft: np.ndarray, painting: str) -> tuple[np.ndarray, ...]:
    """His base paintings by `bigfoot_body`; his class paintings and gear portraits, dressed, by
    `bigfoot_dressed`."""
    if painting.startswith("characters/"):
        return bigfoot_body(look, painting)
    return bigfoot_dressed(look, draft, painting)


def bigfoot_dressed(look: Look, draft: np.ndarray, painting: str) -> tuple[np.ndarray, ...]:
    """Bigfoot in his class costume (class `character-rigs/` and gear `gear-portraits/`). His
    costume, armour, belts, shawl, gems and everything else he wears or holds stay as painted,
    in neither part: see `bigfoot_costume`. (Its brown leather is as brown as his mane, and its
    gold as warm as his skin, so no colour rule tells them apart.)

    - A class painting that is his base painting of the same tier with the costume painted over
      it, pixel for pixel (most of them), takes its parts from that base painting's cleaning,
      less the costume: he then reads exactly as on his base painting.
    - Any other (a class painting drawn afresh, every gear portrait) is cleaned by his base rules,
      `bigfoot_body`, over his figure less the costume, with its sizes in pixels scaled to the
      canvas (a gear portrait is 1254 square) and its chroma thresholds raised by as much as his
      pale fur is more saturated than on his base paintings, then the fix boxes.
    - On a gear portrait the figure (B) is returned too: the draft's, less the pockets of
      backdrop it shut in (`bigfoot_pockets`)."""
    a = look.alpha
    base = bigfoot_base_of(painting, a.shape)
    costume = bigfoot_costume(look, painting, base)
    if base is not None:
        R, G = bigfoot_body(Look(base), bigfoot_base_path(painting))
        return R & a & ~costume, G & a & ~costume
    k = a.shape[0] / 1024
    # his pale paint (fur, and his lit skin), by its lower and upper quartiles, against ~0.056
    # and ~0.073 on his base paintings
    bare = a & ~costume & (look.L > 0.72) & (look.C < 0.11) & (look.hue > 50) & (look.hue < 95)
    dc = 0.0
    if bare.any():
        q1, q3 = np.percentile(look.C[bare], [25, 75])
        dc = max(0.0, float((q1 - 0.056) + (q3 - 0.073)) / 2)
    if not painting.startswith("gear-portraits/"):
        body = a & ~costume
        R, G = bigfoot_body(Look(look.rgba, body), painting, k, dc)
        return R & body, G & body
    pockets = bigfoot_pockets(look, costume)
    body = a & ~costume & ~pockets
    R, G = bigfoot_body(Look(look.rgba, body), painting, k, dc)
    hole = np.clip(soften(ndimage.binary_dilation(pockets, structure=SQUARE)), 0.0, 1.0)
    figure = draft[..., 2].astype(float) / 255.0 * (1.0 - hole)
    return R & body, G & body, figure


def bigfoot_pockets(look: Look, costume: np.ndarray) -> np.ndarray:
    """A gear portrait's backdrop shut inside the drafted figure (between an arm and his side,
    behind a leg, round a floating gem): its pieces of paint within 0.05 (OKLab) of the
    backdrop's own median colour, of 300px or more scaled to the canvas, outside the costume,
    grown 1px over its anti-aliased rim."""
    a = look.alpha
    lab = coat.srgb_to_oklab(look.rgba[..., :3] / 255.0)
    behind = ~a
    if not behind.any():
        return np.zeros_like(a)
    ref = np.median(lab[behind], axis=0)
    # (the glow round a floating gem is painted on the backdrop and its dark goes; inside his
    # costume, a navy vest's shadow is as dark as a navy backdrop and stays)
    near = a & ~(costume & ~bigfoot_held(a)) & (np.sqrt(((lab - ref) ** 2).sum(-1)) < 0.05)
    labs, n = ndimage.label(near)
    if not n:
        return np.zeros_like(a)
    k = a.shape[0] / 1024
    sizes = ndimage.sum(near, labs, np.arange(1, n + 1))
    big = np.isin(labs, np.nonzero(sizes >= 300 * k * k)[0] + 1)
    big = ndimage.binary_closing(big, structure=SQUARE)
    return ndimage.binary_dilation(big, structure=SQUARE) & a


def bigfoot_base_path(painting: str) -> str:
    """His base painting of the same tier as a class painting or gear portrait."""
    return f"characters/bigfoot/{painting.split('/')[2]}/assembled.png"


def bigfoot_base_of(painting: str, shape: tuple[int, int]) -> np.ndarray | None:
    """The base painting (RGBA) a class painting was made from, when it is that painting with the
    costume painted over it: on the same canvas and, over at least half his figure, identical to
    it. None for a class painting drawn afresh and for every gear portrait."""
    if not painting.startswith("character-rigs/"):
        return None
    path = coat.asset(bigfoot_base_path(painting))
    if not os.path.isfile(path):
        return None
    with Image.open(path) as im:
        base = np.asarray(im.convert("RGBA"))
    if base.shape[:2] != shape:
        return None
    with Image.open(coat.asset(painting)) as im:
        own = np.asarray(im.convert("RGBA"))
    fig = own[..., 3] > 0
    same = (np.abs(base.astype(int) - own.astype(int)).max(-1) == 0) & fig
    return base if same.sum() >= 0.5 * fig.sum() else None


def bigfoot_costume(look: Look, painting: str, base: np.ndarray | None) -> np.ndarray:
    """What he wears and holds, never coloured.

    - Over his base painting: every pixel the costume changed (by more than 8 of 255 in any
      channel, which leaves out the faint resampling noise), closed, its holes under 150px
      filled (a bigger one is his fur through a tear), specks under 30px dropped, grown 1px for
      the soft edge of its outline.
    - Anything not joined to his body (a floating gem): `bigfoot_held`.
    - Drawn afresh: the outlines traced by hand in BIGFOOT_COSTUME, each snapped to the painted
      edge: a watershed over the paint's colour gradient, from the outline shrunk by a band
      (costume) and grown by it (not), settles the line on the strongest edge within the band,
      which is the costume's own ink outline or the edge of a lock of mane lying over it. Then
      the tufts of fur poking out under its edge are given back, and a fringe of tassels is
      shared out between tassels and fur (below)."""
    a = look.alpha
    if base is not None:
        d = np.abs(base.astype(int) - look.rgba.astype(int)).max(-1)
        diff = ndimage.binary_closing(d > 8, structure=disk(2))
        holes = ndimage.binary_fill_holes(diff) & ~diff
        labs, n = ndimage.label(holes)
        if n:  # (a big hole is his fur showing through a tear in the tunic, and stays fur)
            sizes = ndimage.sum(holes, labs, np.arange(1, n + 1))
            diff |= np.isin(labs, np.nonzero(sizes < 150)[0] + 1)
        labs, n = ndimage.label(diff)
        if n:
            sizes = ndimage.sum(diff, labs, np.arange(1, n + 1))
            diff = np.isin(labs, np.nonzero(sizes >= 30)[0] + 1)
        return (ndimage.binary_dilation(diff, structure=SQUARE) | bigfoot_held(a)) & a
    traced = bigfoot_traced(painting, "worn", a.shape)
    fringe = bigfoot_traced(painting, "fringe", a.shape)
    worn = np.zeros_like(a)
    if traced.any():
        band = max(1, int(round(BIGFOOT_SNAP * a.shape[0] / 1024)))
        grad = bigfoot_gradient(look)
        markers = np.zeros(a.shape, np.int16)
        markers[~ndimage.binary_dilation(traced, structure=disk(band)) & ~fringe] = 2
        markers[ndimage.binary_erosion(traced, structure=disk(band))] = 1
        worn = ndimage.watershed_ift(grad, markers) == 1
        worn = ndimage.binary_fill_holes(ndimage.binary_opening(worn, structure=SQUARE))
    pale = (look.L > 0.74) & (look.C < 0.08) & (look.hue > 50) & (look.hue < 100) & a
    if traced.any():
        # the tufts of his pale fur poking out under the costume's edge, which the tracing took
        # in: pale fur in the costume's rim and joined to his fur outside it is fur
        rim = worn & ~ndimage.binary_erosion(worn, structure=disk(3 * band))
        # (in the costume's shadow, a tuft is a little darker and warmer than his lit fur)
        tuft = (look.L > 0.62) & (look.C < 0.095) & (look.hue > 50) & (look.hue < 95) & a
        tufts = ndimage.binary_propagation(pale & ~worn, mask=tuft & (rim | ~worn)) & rim
        worn &= ~ndimage.binary_opening(tufts, structure=SQUARE)
    if fringe.any():
        # a fringe of tassels, traced round the lot: its gold (OKLab chroma >= 0.1) and its ink
        # and deep shadow (L < 0.45) are costume, everything outside it is not, and a watershed
        # over the colour gradient shares out the rest (the fur showing between the tassels and
        # under them goes with his fur, a tassel's pale highlight with its tassel)
        markers = np.zeros(a.shape, np.int16)
        markers[~fringe & ~worn & ~traced] = 2
        markers[worn | (fringe & a & ((look.C >= 0.1) | (look.L < 0.45)))] = 1
        tassels = ndimage.watershed_ift(bigfoot_gradient(look), markers) == 1
        worn |= fringe & ndimage.binary_opening(tassels, structure=SQUARE)
    return (worn | bigfoot_held(a)) & a


def bigfoot_gradient(look: Look) -> np.ndarray:
    """The paint's colour gradient (OKLab, chroma weighted double), as uint16 for a watershed."""
    lab = coat.srgb_to_oklab(look.rgba[..., :3] / 255.0)
    grad = np.zeros(look.alpha.shape)
    for ch, w in ((0, 1.0), (1, 2.0), (2, 2.0)):
        smooth = ndimage.gaussian_filter(lab[..., ch], 1.0)
        grad += w * np.hypot(ndimage.sobel(smooth, 0), ndimage.sobel(smooth, 1))
    return (grad / max(grad.max(), 1e-9) * 65535).astype(np.uint16)


def bigfoot_held(a: np.ndarray) -> np.ndarray:
    """Everything in the figure not joined to his body (the largest piece): a floating gem."""
    labs, n = ndimage.label(a, structure=SQUARE)
    if n < 2:
        return np.zeros_like(a)
    sizes = ndimage.sum(a, labs, np.arange(1, n + 1))
    return (labs > 0) & (labs != int(np.argmax(sizes)) + 1)


def bigfoot_traced(painting: str, kind: str, shape: tuple[int, int]) -> np.ndarray:
    """The painting's BIGFOOT_COSTUME outlines of one kind, filled, as a mask."""
    from PIL import ImageDraw

    im = Image.new("1", (shape[1], shape[0]), 0)
    draw = ImageDraw.Draw(im)
    for poly in BIGFOOT_COSTUME.get(painting, {}).get(kind, []):
        draw.polygon(poly, fill=1, outline=1)
    return np.asarray(im, bool)


BIGFOOT_SNAP = 8  # px on a 1024 canvas: how far the snapped costume edge may move from the tracing

# His costume where it was drawn afresh: hand-traced outlines, as (x, y) canvas points.
#   "worn"    the costume: along the outside of its own ink outline and the edge of any lock of
#             mane lying over it, snapped to the painted edge (`bigfoot_costume`)
#   "fringe"  a fringe of tassels, traced round the lot: the fur showing between them is fur
BIGFOOT_COSTUME: dict[str, dict[str, list[list[tuple[int, int]]]]] = {
    # wooden armour with shoulder pads; his beard over its top
    "character-rigs/thornguard/radiant/bigfoot/assembled.png": {"worn": [
        [(300, 335), (318, 305), (345, 293), (372, 292), (385, 330), (385, 380), (395, 395),
         (420, 402), (450, 400), (475, 398), (500, 395), (525, 388), (545, 378), (560, 365),
         (580, 345), (598, 320), (605, 290), (615, 272), (640, 262), (675, 268), (705, 285),
         (735, 315), (755, 350), (760, 385), (745, 402), (705, 410), (665, 410), (655, 420),
         (655, 540), (630, 560), (560, 580), (480, 604), (450, 603), (410, 585), (372, 560),
         (365, 480), (360, 410), (340, 400), (310, 395), (298, 375)],
    ]},
    "character-rigs/thornguard/mythic/bigfoot/assembled.png": {"worn": [
        [(309, 412), (335, 404), (362, 406), (378, 440), (381, 468), (400, 482), (415, 489),
         (440, 478), (459, 494), (480, 478), (496, 464), (520, 450), (540, 439), (560, 432),
         (590, 430), (602, 410), (615, 385), (650, 380), (700, 382), (730, 400), (742, 430),
         (727, 452), (677, 480), (640, 470), (626, 470), (624, 600), (620, 620), (560, 640),
         (470, 668), (455, 660), (384, 617), (381, 520), (375, 485), (359, 477), (315, 474),
         (305, 450)],
    ]},
    # a leather vest crossed by straps, with a belt; his beard over it
    "character-rigs/duskrunner/sworn/bigfoot/assembled.png": {"worn": [
        [(356, 376), (384, 414), (415, 439), (440, 464), (470, 440), (509, 426), (540, 404),
         (565, 382), (584, 345), (602, 305), (640, 300), (665, 306), (640, 322), (620, 345),
         (612, 376), (605, 457), (604, 532), (598, 552), (492, 553), (488, 578), (446, 578),
         (440, 553), (384, 547), (379, 507), (360, 440)],
    ]},
    "character-rigs/duskrunner/radiant/bigfoot/assembled.png": {"worn": [
        [(349, 395), (377, 432), (415, 451), (452, 478), (477, 457), (515, 432), (540, 404),
         (565, 382), (590, 357), (615, 339), (640, 325), (672, 330), (650, 345), (620, 365),
         (608, 457), (607, 520), (602, 553), (495, 560), (493, 598), (470, 604), (468, 625),
         (459, 625), (457, 604), (437, 598), (437, 560), (377, 558), (372, 507), (352, 430)],
    ]},
    # a starry vest with a pendant; his beard over it (the floating gem: `bigfoot_held`)
    "character-rigs/starweaver/sworn/bigfoot/assembled.png": {"worn": [
        [(352, 375), (367, 398), (390, 429), (428, 462), (467, 462), (498, 439), (521, 421),
         (559, 383), (582, 352), (598, 316), (628, 318), (626, 340), (622, 514), (613, 518),
         (480, 565), (476, 593), (462, 593), (458, 566), (367, 516), (360, 450)],
    ]},
    "gear-portraits/thornguard/sworn/bigfoot.png": {"worn": [
        [(397, 492), (405, 455), (422, 422), (447, 409), (463, 472), (497, 522), (522, 545),
         (547, 563), (580, 540), (622, 526), (663, 505), (697, 472), (730, 447), (755, 422),
         (780, 397), (830, 388), (897, 409), (932, 480), (913, 494), (830, 507), (786, 528),
         (786, 705), (772, 715), (663, 740), (588, 765), (497, 722), (472, 697), (470, 540),
         (463, 519), (413, 511)],
    ]},
    "gear-portraits/thornguard/radiant/bigfoot.png": {"worn": [
        [(363, 505), (388, 422), (422, 397), (455, 405), (455, 480), (497, 513), (530, 526),
         (572, 532), (613, 524), (663, 497), (697, 463), (730, 422), (747, 388), (780, 363),
         (847, 372), (913, 413), (953, 480), (930, 511), (855, 519), (799, 532), (799, 705),
         (788, 715), (680, 749), (572, 774), (480, 749), (453, 722), (453, 540), (447, 532),
         (380, 524)],
    ]},
    "gear-portraits/thornguard/mythic/bigfoot.png": {"worn": [
        [(381, 580), (390, 540), (415, 525), (445, 522), (455, 560), (493, 562), (527, 599),
         (568, 574), (610, 553), (643, 574), (677, 545), (710, 515), (743, 490), (760, 463),
         (827, 445), (893, 461), (912, 530), (893, 561), (827, 586), (777, 578), (774, 590),
         (774, 747), (752, 765), (635, 799), (564, 824), (477, 774), (466, 747), (466, 613),
         (452, 590), (385, 589)],
    ]},
    "gear-portraits/duskrunner/sworn/bigfoot.png": {"worn": [
        [(439, 413), (460, 447), (493, 480), (527, 522), (552, 549), (577, 522), (610, 488),
         (652, 455), (693, 438), (727, 397), (752, 355), (790, 340), (830, 345), (800, 375),
         (779, 413), (770, 497), (762, 613), (754, 653), (612, 674), (572, 699), (550, 665),
         (466, 657), (462, 605), (441, 450)],
    ]},
    "gear-portraits/duskrunner/radiant/bigfoot.png": {"worn": [
        [(447, 460), (473, 495), (517, 530), (551, 556), (577, 571), (603, 556), (638, 530),
         (673, 495), (708, 460), (743, 417), (769, 382), (800, 360), (848, 360), (815, 385),
         (788, 434), (792, 547), (801, 626), (801, 669), (797, 697), (640, 700), (605, 734),
         (600, 770), (580, 770), (578, 734), (552, 712), (550, 700), (482, 697), (475, 626),
         (449, 470)],
    ]},
    "gear-portraits/duskrunner/mythic/bigfoot.png": {"worn": [
        [(460, 641), (490, 652), (505, 690), (520, 700), (534, 661), (560, 626), (600, 612),
         (621, 606), (656, 582), (690, 565), (725, 539), (772, 511), (768, 580), (764, 676),
         (764, 728), (760, 748), (605, 752), (560, 806), (570, 848), (546, 848), (550, 806),
         (512, 752), (469, 750), (462, 737)],
    ]},
    "gear-portraits/starweaver/sworn/bigfoot.png": {"worn": [
        [(425, 437), (446, 490), (477, 522), (498, 539), (540, 545), (583, 524), (605, 505),
         (635, 490), (667, 448), (688, 406), (709, 369), (762, 370), (740, 390), (732, 406),
         (727, 606), (580, 660), (566, 712), (544, 712), (544, 664), (456, 660), (435, 637),
         (430, 511), (419, 437)],
    ]},
    "gear-portraits/starweaver/radiant/bigfoot.png": {"worn": [
        [(422, 430), (449, 485), (485, 530), (522, 557), (558, 577), (595, 557), (640, 539),
         (685, 512), (731, 466), (767, 421), (795, 392), (815, 385), (800, 410), (788, 512),
         (778, 668), (658, 723), (631, 714), (581, 759), (535, 741), (449, 687), (426, 621)],
    ]},
    "gear-portraits/starweaver/mythic/bigfoot.png": {"worn": [
        [(449, 605), (495, 627), (522, 637), (540, 655), (558, 640), (585, 618), (631, 582),
         (667, 562), (704, 535), (740, 498), (767, 469), (775, 480), (767, 562), (752, 727),
         (685, 780), (655, 757), (615, 802), (570, 772), (552, 795), (552, 846), (530, 846),
         (528, 795), (458, 718), (445, 698)],
        # the floating gem, whose glow touches his mane
        [(850, 160), (1010, 160), (1015, 300), (990, 345), (880, 345), (855, 300)],
    ]},
    # a woven shawl with a medallion, its tassels and a fringe (and, at Sworn, an earring)
    "gear-portraits/songkeeper/sworn/bigfoot.png": {
        "worn": [
            [(365, 385), (390, 375), (405, 410), (420, 450), (440, 480), (460, 495), (500, 500),
             (540, 490), (590, 450), (670, 410), (760, 375), (840, 395), (880, 450), (885, 500),
             (870, 520), (780, 540), (720, 560), (700, 580), (600, 590), (530, 585), (470, 580),
             (450, 570), (400, 565), (360, 550), (350, 460)],
            [(455, 590), (500, 590), (500, 700), (455, 700)],
            [(612, 235), (640, 235), (645, 280), (640, 320), (652, 330), (650, 395), (622, 398),
             (620, 330), (630, 320), (612, 280)],
        ],
        "fringe": [
            [(345, 530), (460, 560), (520, 570), (700, 560), (780, 520), (885, 490), (890, 590),
             (720, 600), (715, 665), (520, 665), (500, 630), (455, 640), (345, 625)],
        ],
    },
    "gear-portraits/songkeeper/radiant/bigfoot.png": {
        "worn": [
            [(330, 345), (367, 358), (380, 400), (398, 455), (483, 495), (520, 430), (567, 379),
             (577, 358), (683, 324), (746, 335), (780, 389), (842, 474), (865, 537), (850, 560),
             (780, 580), (740, 620), (700, 640), (560, 650), (540, 620), (500, 560), (420, 560),
             (380, 560), (300, 520), (275, 500), (288, 474), (314, 410)],
        ],
        "fringe": [
            [(265, 490), (380, 540), (500, 540), (540, 600), (560, 640), (740, 610), (780, 570),
             (870, 520), (880, 620), (760, 620), (745, 715), (545, 715), (500, 700), (470, 700),
             (370, 700), (265, 640)],
        ],
    },
    "gear-portraits/songkeeper/mythic/bigfoot.png": {
        "worn": [
            [(363, 385), (410, 380), (422, 430), (430, 478), (519, 478), (563, 444), (597, 411),
             (630, 378), (685, 365), (785, 376), (874, 465), (921, 533), (935, 585), (900, 590),
             (800, 590), (740, 600), (700, 615), (540, 615), (510, 600), (400, 600), (330, 580),
             (290, 560), (300, 500), (341, 422)],
        ],
        "fringe": [
            [(280, 545), (400, 580), (520, 590), (700, 600), (900, 560), (945, 570), (945, 690),
             (745, 690), (745, 700), (530, 700), (515, 780), (395, 780), (395, 660), (280, 660)],
        ],
    },
}


def bigfoot_body(look: Look, painting: str, k: float = 1.0, dc: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """His base paintings (and, through `bigfoot_dressed`, his class paintings and gear portraits).
    `k` scales every size in pixels to his figure (1 on the base canvas, where the sizes below are
    given), and `dc` raises every chroma threshold below by as much as his pale fur is more
    saturated than on his base paintings (0 there).

    Skin (G) is found afresh from the painting; fur (R) is the rest of him that takes a colour.

    1. Seeds: smooth, warm, saturated paint (OKLab chroma >= 0.075, hue 30..100, L >= 0.5; the
       cream fur is ~0.05) opened to cut thin bridges; his five largest patches (face, two hands,
       two feet) and anything beside them. The amber locks of his mane are warm too, but
       painted in strokes, so never smooth.
    2. Grown over smooth warm paint within reach of the seeds.
    3. The pieces between drawn lines (toes, nails, fingertips) join a patch when mostly warm,
       thick enough not to be a fur stroke, and touching it.
    4. Shaded skin (the underside of a fist, a heel), darker but still warm, is grown from the
       hands and feet only: his face borders his mane, which is as warm and as dark.
    5. Holes filled; ink, eye whites and leaves left out.
    6. Fur: the figure less skin, ink outlines, leaves and eye whites. A small piece of it cut
       off by lines, skin-coloured and beside skin (a curled fingertip), is skin."""
    a, L, C = look.alpha, look.L, look.C

    def px(n: int) -> int:
        return n if k == 1 else max(1, int(round(n * k)))
    warm = look.warm(0.06 + dc, lmin=0.45) & ~look.ink
    leaves = ndimage.binary_dilation(a & (look.hue >= 100) & (look.hue < 170) & (C > 0.04), iterations=1) & a

    smooth_skin = warm & (C >= 0.075 + dc) & (L >= 0.5) & (look.rough < 0.045)
    core = ndimage.binary_opening(smooth_skin, structure=SQUARE, iterations=2)
    labs, n = ndimage.label(core)
    sizes = ndimage.sum(core, labs, np.arange(1, n + 1))
    top5 = np.isin(labs, np.argsort(sizes)[::-1][:5] + 1)
    beside = np.unique(labs[ndimage.binary_dilation(top5, structure=disk(px(15))) & core])
    seeds = np.isin(labs, beside[beside > 0])
    reach = ndimage.binary_dilation(seeds, structure=disk(px(30)))
    skin = ndimage.binary_propagation(seeds, mask=(warm & (look.rough < 0.06) & reach & ~leaves) | seeds)

    lines = a & (L < 0.5)
    regions, rn = ndimage.label(a & ~ndimage.binary_dilation(lines, structure=SQUARE))
    idx = np.arange(1, rn + 1)
    warm_share = ndimage.mean(look.warm(0.07 + dc), regions, idx)
    thick = ndimage.maximum(ndimage.distance_transform_edt(regions > 0), regions, idx)
    area = ndimage.sum(np.ones_like(L), regions, idx)
    for _ in range(4):
        skin_share = ndimage.mean(skin, regions, idx)
        ok = np.zeros(rn + 1, bool)
        ok[1:] = (warm_share >= 0.6) & (thick >= 2.5 * k) & ((area < 6000 * k * k) | (skin_share >= 0.3))
        cand = ok[regions] & reach & ~leaves
        touched = np.unique(regions[ndimage.binary_dilation(skin, structure=disk(px(4))) & cand])
        new = np.isin(regions, touched[touched > 0]) & cand & ~skin
        if not new.any():
            break
        skin |= new
    skin |= ndimage.binary_dilation(skin, structure=SQUARE, iterations=2) & ~lines & warm
    skin = ndimage.binary_closing(skin, structure=disk(px(3)))

    ys = np.nonzero(a)[0]
    rows = np.arange(a.shape[0])[:, None]
    limbs = skin & (rows > ys.min() + 0.45 * (ys.max() - ys.min()))
    shade = look.warm(0.065 + dc, lmin=0.36, lmax=0.66, h1=95) & ~leaves
    skin |= ndimage.binary_propagation(limbs, mask=(shade & ndimage.binary_dilation(limbs, structure=disk(px(14)))) | limbs)
    skin = ndimage.binary_fill_holes(ndimage.binary_closing(skin, structure=disk(px(2))))

    for (r0, r1, c0, c1) in FIXES.get(painting, {}).get("skin", []):
        # the largest smooth, warm piece in the box, filled
        box = np.zeros_like(a)
        box[r0:r1, c0:c1] = True
        cand = box & look.warm(0.05 + dc, lmin=0.5) & (look.rough < 0.05) & ~leaves
        labs, n = ndimage.label(cand)
        if n:
            sizes = ndimage.sum(cand, labs, np.arange(1, n + 1))
            piece = labs == int(np.argmax(sizes)) + 1
            skin |= ndimage.binary_fill_holes(ndimage.binary_closing(piece, structure=disk(px(2)))) & box
    hand = boxes(painting, "hand", a.shape)
    if hand is not None:
        cand = hand & look.warm(0.075 + dc, lmin=0.4) & ~look.ink & ~leaves
        skin |= ndimage.binary_fill_holes(ndimage.binary_closing(cand, structure=disk(px(2)))) & hand
    face = boxes(painting, "face", a.shape)
    if face is not None:
        cand = face & look.warm(0.075 + dc, lmin=0.58) & ~look.ink & ~leaves
        skin |= ndimage.binary_fill_holes(ndimage.binary_closing(cand, structure=disk(px(2)))) & face
    remove = boxes(painting, "not_skin", a.shape)
    if remove is not None:
        skin &= ~remove

    eye_white = (C < 0.03) & (L > 0.86)
    G = skin & a & ~look.ink & ~eye_white & ~leaves
    R = a & ~ndimage.binary_dilation(skin, structure=SQUARE) & ~look.outline() & ~leaves & ~eye_white

    labs, n = ndimage.label(R)
    if n:
        i = np.arange(1, n + 1)
        small_warm = np.zeros(n + 1, bool)
        small_warm[1:] = (ndimage.sum(R, labs, i) < 600 * k * k) & (ndimage.mean(look.warm(0.06 + dc), labs, i) >= 0.5)
        touching = np.zeros(n + 1, bool)
        touching[np.unique(labs[ndimage.binary_dilation(G, structure=disk(px(4))) & R])] = True
        touching[0] = False
        pocket = (small_warm & touching)[labs]
        if remove is not None:
            pocket &= ~remove
        R &= ~pocket
        G |= pocket
    return R, G


# ----------------------------------------------------------------------------- kitsune

def clean_kitsune(look: Look, draft: np.ndarray, painting: str) -> tuple[np.ndarray, np.ndarray]:
    """Fur (R) is her pale peach body and the white tips of her tails; tails (G) are the teal.
    The draft is not used: her markings are as warm as her shaded fur, so it bled into them.

    - Tails: teal paint (OKLab chroma >= 0.03, hue beyond 140 / -110), its pieces of 3000px or
      more, closed and filled so the crystal facets and sparkles painted in them go with them.
      The white tips are fur (a fox's white tail tip; under a colour they read as one coat).
    - Orange stays as painted, in neither part: her ruff, crest, outer ears and the flame
      markings on her face and legs (chroma >= 0.085, hue 15..80; her peach fur is ~0.05, its
      shading ~0.07). Its pieces low on her legs (centre in the bottom 15% of her) are the soft
      warm shading at her paws, painted as a gradient: those are fur, or her feet go ragged.
    - Fur: the rest of her, less ink, her eyes (small filled ink loops, with their highlights)
      and the Mythic crystals (KITSUNE_CRYSTALS, traced by hand); pieces under 400px dropped,
      holes under 150px (a fleck of orange stroke in the pale fur) filled, then grown 1px into
      the orange so the soft edge leaves no pale rim untinted.
    - Ink drawn as an outline is in neither part."""
    a, C, hue = look.alpha, look.C, look.hue
    eyes = kitsune_eyes(look)

    # tails: teal paint, its largest pieces, closed and filled (crystal facets, sparkles)
    teal = a & (C >= 0.03) & ((hue > 140) | (hue < -110))
    labs, n = ndimage.label(ndimage.binary_closing(teal, structure=SQUARE))
    sizes = ndimage.sum(teal, labs, np.arange(1, n + 1)) if n else np.zeros(0)
    tails = np.isin(labs, np.nonzero(sizes >= 3000)[0] + 1) & teal
    tails = ndimage.binary_closing(tails, structure=disk(3))
    tails = ndimage.binary_fill_holes(tails) & a

    # orange: her ruff, ears, crest and the markings on her face and legs, kept as painted
    orange = a & (C >= 0.085) & (hue > 15) & (hue < 80)
    # ...but the warm shading at her paws (socks, painted as a soft gradient) is fur
    ys = np.nonzero(a)[0]
    labs, n = ndimage.label(orange)
    if n:
        i = np.arange(1, n + 1)
        rows = np.array([c[0] for c in ndimage.center_of_mass(orange, labs, i)])
        sock = np.zeros(n + 1, bool)
        sock[1:] = rows > ys.min() + 0.85 * (ys.max() - ys.min())
        orange &= ~sock[labs]
    crystals = kitsune_crystals(painting, a.shape)
    fur = a & ~tails & ~orange & ~look.ink & ~eyes & ~crystals
    labs, n = ndimage.label(fur)
    if n:
        sizes = ndimage.sum(fur, labs, np.arange(1, n + 1))
        fur = np.isin(labs, np.nonzero(sizes >= 400)[0] + 1)
    # a fleck of orange stroke inside her pale fur is that fur's painting
    holes = ndimage.binary_fill_holes(fur) & ~fur
    labs, n = ndimage.label(holes)
    if n:
        small = np.zeros(n + 1, bool)
        small[1:] = ndimage.sum(holes, labs, np.arange(1, n + 1)) < 150
        fur |= small[labs] & ~look.ink & ~eyes & ~crystals
    # the soft edge sits on the orange side of the line, so no pale rim is left untinted
    fur |= ndimage.binary_dilation(fur, structure=SQUARE) & orange & ~crystals
    return fur & ~look.outline(), tails & ~look.outline()


# The Mythic kitsune's crystals, on her crest and in her ruff: hand-traced outlines, as (x, y)
# canvas points. They are glassy and see-through (her orange shows through them) and their pale
# facets are as pale as her fur, so no colour rule finds them. The crystals inside her tails
# are the tails' painting and take the tails' colour.
KITSUNE_CRYSTALS: dict[str, list[list[tuple[int, int]]]] = {
    "characters/kitsune/mythic/assembled.png": [
        # crest, her right: two shards in a V
        [(151, 176), (166, 200), (181, 184), (191, 210), (181, 240), (178, 265), (172, 292),
         (166, 285), (161, 255), (159, 228), (156, 205)],
        # crest, her left: three long shards, and a sliver at the ear
        [(298, 161), (301, 170), (298, 198), (290, 230), (275, 253), (260, 263), (245, 280),
         (230, 289), (222, 294), (223, 285), (237, 237), (252, 213), (263, 202), (283, 173)],
        [(307, 176), (312, 179), (305, 204), (299, 201)],
        # ruff
        [(378, 393), (420, 384), (410, 402), (385, 403)],
        [(368, 404), (378, 401), (413, 442), (400, 445), (372, 426)],
        [(366, 448), (376, 445), (387, 492), (378, 495), (365, 470)],
        [(318, 441), (325, 450), (325, 488), (281, 523), (275, 516), (288, 474), (300, 461)],
        [(338, 493), (344, 497), (339, 521), (323, 543), (317, 539), (321, 515)],
        [(165, 469), (171, 473), (163, 500), (147, 519), (142, 515), (150, 490)],
    ],
}


def kitsune_crystals(painting: str, shape: tuple[int, int]) -> np.ndarray:
    """The painting's crystals (KITSUNE_CRYSTALS) as a mask, with a 2px margin; never coloured."""
    from PIL import ImageDraw

    im = Image.new("1", (shape[1], shape[0]), 0)
    draw = ImageDraw.Draw(im)
    for poly in KITSUNE_CRYSTALS.get(painting, []):
        draw.polygon(poly, fill=1, outline=1)
    return ndimage.binary_dilation(np.asarray(im, bool), structure=disk(2))


def kitsune_eyes(look: Look) -> np.ndarray:
    """Her eyes: small loops of ink, filled (their white highlights go with them)."""
    loops = ndimage.binary_fill_holes(look.ink) & ~look.ink
    labs, n = ndimage.label(loops)
    if not n:
        return np.zeros_like(look.alpha)
    small = np.zeros(n + 1, bool)
    small[1:] = ndimage.sum(loops, labs, np.arange(1, n + 1)) < 2500
    return ndimage.binary_dilation(small[labs], structure=disk(2))


# ----------------------------------------------------------------------------- dragonling

def clean_dragonling(look: Look, draft: np.ndarray, painting: str) -> tuple[np.ndarray, np.ndarray]:
    """Scales (R) and wings (G) are found afresh from the painting; the draft gives only B.

    1. Between the ink lines, every piece that is mostly dark green paint (OKLab hue 100..200,
       chroma >= 0.045, L < 0.72) is a spike, horn, claw, ear frill or Mythic's crest crystal,
       never coloured, and its pale facets and tip go with it. (Fledgling's slate spikes and
       claws are dark enough to be ink.)
    2. Wings: the orange webbing (hue 15..110, chroma >= 0.07) in pieces of 3000px or more (an
       orange eye is smaller), closed and filled so its lighter spots go with it. The glowing
       mint marks painted on it (Radiant's spots, Mythic's stars, veins and edge line) are grown
       from it and take its colour, staying lighter than it; then the faded orange where the
       webbing meets a bone or the ink.
    3. Scales: the rest of the pale paint (chroma < 0.09, L >= 0.5, not orange): the mint body
       and its spots, the grey-lavender (or mint) belly and the mint wing bones, all one
       colour. Never: ink, eyes (small loops of ink: pupils, highlights, fangs), orange eyes.
    4. Last, the specks left in neither part (not ink, eyes or a spike's pale rim) go to the
       nearer part within 5px."""
    a, L, C, hue = look.alpha, look.L, look.C, look.hue
    ink = look.ink
    lines = ndimage.binary_dilation(ink, structure=SQUARE)
    regions, rn = ndimage.label(a & ~lines)
    idx = np.arange(1, rn + 1)

    green = a & (hue > 100) & (hue < 200) & (C >= 0.045) & (L < 0.72) & ~ink
    green_share = np.zeros(rn + 1)
    green_share[1:] = ndimage.mean(green, regions, idx)
    spike = (green_share >= 0.5)[regions] & (regions > 0)
    spike |= green & ndimage.binary_dilation(spike, structure=disk(3))
    spike = ndimage.binary_fill_holes(ndimage.binary_closing(spike, structure=disk(2))) & a
    # the spike's own ink edge belongs with it
    spike |= ndimage.binary_dilation(spike, structure=SQUARE, iterations=2) & ink

    orange = a & (hue > 15) & (hue < 110) & (C >= 0.07) & ~ink
    labs, n = ndimage.label(orange)
    wing = np.zeros_like(a)
    if n:
        sizes = ndimage.sum(orange, labs, np.arange(1, n + 1))
        big = np.zeros(n + 1, bool)
        big[1:] = sizes >= 3000
        wing = big[labs]
    wing = ndimage.binary_fill_holes(ndimage.binary_closing(wing, structure=disk(3))) & a & ~spike

    loops = ndimage.binary_fill_holes(ink) & ~ink
    labs, n = ndimage.label(loops)
    eyes = np.zeros_like(a)
    if n:
        small = np.zeros(n + 1, bool)
        small[1:] = ndimage.sum(loops, labs, np.arange(1, n + 1)) < 2500
        eyes = ndimage.binary_dilation(small[labs], structure=disk(2))
    # the glowing marks painted on the webbing (Radiant's spots, Mythic's stars, veins and edge
    # line) take the wing's colour, staying lighter than it; the ones the fill missed, where a
    # star touches a wing bone or the line runs along the wing's edge, are grown from the wing,
    # and then the faded orange beyond them, up to the ink
    marks = a & ~ink & ~spike & (hue > 110) & (hue < 220) & (C >= 0.08) & (L >= 0.75)
    wing |= ndimage.binary_propagation(wing, mask=marks | wing)
    fade = a & ~ink & ~spike & (hue > 0) & (hue < 120) & (C >= 0.035)
    wing |= ndimage.binary_propagation(wing, mask=(fade & ndimage.binary_dilation(wing, structure=disk(5))) | wing)

    warm = (hue > 0) & (hue < 120) & (C >= 0.05)
    scales = a & ~ink & ~spike & ~wing & ~eyes & ~warm & (C < 0.09) & (L >= 0.5)

    # specks in neither (not ink, eyes, an orange eye or a spike's pale rim) go to the nearer part
    near_spike = ndimage.binary_dilation(spike, structure=disk(3))
    iris = ndimage.binary_dilation(orange & ~wing, structure=disk(2))
    left = a & ~ink & ~spike & ~near_spike & ~eyes & ~iris & ~scales & ~wing & (L >= 0.5)
    d_s = ndimage.distance_transform_edt(~scales)
    d_w = ndimage.distance_transform_edt(~wing)
    scales |= left & (d_s <= 5) & (d_s <= d_w)
    wing |= left & (d_w <= 5) & (d_w < d_s)
    return scales & ~wing, wing


# ----------------------------------------------------------------------------- griffin

def clean_griffin(look: Look, draft: np.ndarray, painting: str) -> tuple[np.ndarray, np.ndarray]:
    """Feathers (G) and coat (R) are found afresh from the painting; the draft is not read.

    He is painted in one blue hue (OKLab ~-105) at every depth: the white body (C ~0.02), its
    blue-grey shading (C ~0.03..0.045), the stars on it, and the blue plumage (C ~0.07, L ~0.55).
    So the parts are told apart by chroma and lightness, then by size and place.

    1. Feathers: blue paint at least as strong as the plumage's shade (C >= 0.05, L < 0.76),
       opened to cut bridges; the pieces of 2500px and more (crest and ruff, tail tuft) that
       are not low on the figure (talons are blue-black too). Grown back over blue paint and
       the dark strokes between feathers within reach, and over the mythic crest's icy
       crystals; closed and holes filled.
    2. Never coloured: ink outlines (dark at the figure's edge or against light paint),
       the talons and every other dark piece outside the plumage, the yellow wings, beak and
       feet (any warm or yellow hue with C >= 0.04), the mouth and eyes (small loops of ink).
    3. Coat: the rest of him that is pale or blue-grey, as its largest pieces (the body, head
       and any limb cut off by a line); the stars and shading on it are coat. Specks between
       coat and feathers that are neither go to the nearer part.
    4. The yellow wings stay as painted: the owner chose the blue plumage as the accent."""
    a, L, C, hue = look.alpha, look.L, look.C, look.hue
    ys = np.nonzero(a)[0]
    y0, y1 = ys.min(), ys.max()
    rows = np.arange(a.shape[0])[:, None]
    blue = (hue > -150) & (hue < -60)
    yellow = a & (C >= 0.04) & (hue > -20) & (hue < 140)
    yellow = ndimage.binary_closing(yellow, structure=SQUARE) & a

    core = a & blue & (C >= 0.05) & (L >= 0.3) & (L < 0.76)
    core = ndimage.binary_opening(core, structure=SQUARE, iterations=1)
    labs, n = ndimage.label(core)
    keep = np.zeros_like(a)
    for i in range(1, n + 1):
        comp = labs == i
        if comp.sum() < 2500:
            continue
        if np.nonzero(comp)[0].mean() > y1 - 0.12 * (y1 - y0):  # talons
            continue
        keep |= comp
    # the plumage's smaller pieces, cut off by a line or an ear, beside its big ones: as deep
    # a blue as the plumage (the shading on his chest and the stars are lighter)
    raw = a & blue & (C >= 0.05) & (L >= 0.3) & (L < 0.76)
    labs, n = ndimage.label(raw)
    if n:
        i = np.arange(1, n + 1)
        near = ndimage.minimum(ndimage.distance_transform_edt(~keep), labs, i) <= 40
        deep = (ndimage.mean(L, labs, i) < 0.56) & (ndimage.mean(C, labs, i) >= 0.06)
        add = np.zeros(n + 1, bool)
        add[1:] = near & deep & (ndimage.sum(raw, labs, i) >= 20)
        keep |= add[labs] & (rows < y1 - 0.12 * (y1 - y0))
    reach = ndimage.binary_dilation(keep, structure=disk(12))
    grow = a & ~yellow & ((blue & (C >= 0.04)) | (L < 0.5)) & reach
    feathers = ndimage.binary_propagation(keep, mask=grow | keep)
    feathers = ndimage.binary_closing(feathers, structure=disk(2))
    feathers = ndimage.binary_fill_holes(feathers) & a & ~yellow

    # eyes: small loops of ink holding mostly dark paint (the iris round its catch-light); a
    # pale loop, such as the cheek shut in between eye, beak and outline, is coat
    loops = ndimage.binary_fill_holes(look.ink) & ~look.ink
    labs, n = ndimage.label(loops)
    eyes = np.zeros_like(a)
    if n:
        i = np.arange(1, n + 1)
        small = np.zeros(n + 1, bool)
        size, mL = ndimage.sum(loops, labs, i), ndimage.mean(L, labs, i)
        dark = (mL < 0.6) | (ndimage.mean(yellow, labs, i) > 0.4)  # a brown or a gold iris
        glint = (size < 400) & (mL > 0.75) & (ndimage.mean(C, labs, i) < 0.03)  # a catch-light
        small[1:] = (size < 2500) & (dark | glint)
        eyes = ndimage.binary_dilation(small[labs], structure=disk(2))

    never = yellow | eyes | (look.ink & ~feathers)
    cand = a & ~feathers & ~never & (L >= 0.45)
    labs, n = ndimage.label(cand)
    coat_ = np.zeros_like(a)
    if n:
        sizes = ndimage.sum(cand, labs, np.arange(1, n + 1))
        big = np.zeros(n + 1, bool)
        big[1:] = sizes >= max(1500, 0.02 * sizes.max())
        coat_ = big[labs]
    coat_ = ndimage.binary_fill_holes(coat_) & ~never & ~feathers & a
    # the small pale pieces left over go to the nearer part: the tips of the mythic crest's
    # crystals and a lit feather edge cut off by a line to the plumage, a cheek shut in between
    # eye, beak and outline to the coat
    rest = cand & ~coat_
    labs, n = ndimage.label(rest)
    if n:
        i = np.arange(1, n + 1)
        d_c = ndimage.minimum(ndimage.distance_transform_edt(~coat_), labs, i)
        d_f = ndimage.minimum(ndimage.distance_transform_edt(~feathers), labs, i)
        to_f = np.zeros(n + 1, bool)
        to_c = np.zeros(n + 1, bool)
        to_f[1:] = (d_f <= 8) & (d_f <= d_c)
        to_c[1:] = (d_c <= 8) & (d_c < d_f)
        feathers |= to_f[labs]
        coat_ |= to_c[labs]

    left = a &~coat_ & ~feathers & ~never & (L >= 0.36)
    d_coat = ndimage.distance_transform_edt(~coat_)
    d_feat = ndimage.distance_transform_edt(~feathers)
    coat_ |= left & (d_coat <= 5) & (d_coat <= d_feat)
    feathers |= left & (d_feat <= 5) & (d_feat < d_coat)
    line = look.outline(light=0.7)
    return coat_ & ~line, feathers & ~line


# ----------------------------------------------------------------------------- manticore

def clean_manticore(look: Look, draft: np.ndarray, painting: str) -> tuple[np.ndarray, np.ndarray]:
    """Fur (R) = her pink body fur; mane (G) = her crimson mane, from the draft's two channels.

    - Her scorpion tail and stinger (green, OKLab hue 100..170) are in neither: see
      `manticore_tail`.
    - Her claws are as crimson as her mane: G pieces low on the figure (the paws) are claws, in
      neither part, and so are her eyes: see `manticore_eyes`.
    - The mane is the draft's largest G piece; the other G pieces join it when dark and crimson
      and either near it (a lock cut off by a strand line), big and dark (the Mythic's tuft
      under her chest) or wider than tall in the top half of her (her eyebrows, painted in the
      mane's crimson, go with it). The rest (her inner ears, the shaded fur between her legs)
      are given back to the pool for the fur.
    - Mythic: the black crystal shards in her mane are in neither part, but the crimson glints
      in them and the dark grey streaks between her locks are mane.
    - Her nose is painted in the mane's crimson too: the `nose` fix boxes leave it (the largest
      crimson piece in the box) out of both.
    - The mane is grown by hue over the bright crimson the draft left out of it.
    - The fur is the draft's R, grown by hue over the shaded pink the draft left out (inner
      ears, the belly and far legs in shadow), never into crimson or the mane's own edge.
    - Last, the specks left in neither where fur meets mane go to the nearer part, and ink
      drawn as an outline leaves both but for a 2px lip under each part's edge (and over the
      dark rims of her eyes and nose), so the soft edge never leaves a pale ring of untinted
      fur inside an outline. The whisker dots on her muzzle are fur."""
    a = look.alpha
    ys = np.nonzero(a)[0]
    y0, y1 = ys.min(), ys.max()
    rows = np.arange(a.shape[0])[:, None]
    paws = rows > y1 - 0.14 * (y1 - y0)
    tail = manticore_tail(look)

    eyes = manticore_eyes(look)
    nose = np.zeros_like(a)
    box = boxes(painting, "nose", a.shape)
    if box is not None:
        nose = box & a & (look.hue > 12) & (look.hue < 35) & (look.C > 0.085) & (look.L < 0.75)
        nose = ndimage.binary_fill_holes(ndimage.binary_closing(nose, structure=disk(2))) & box
        labs, n = ndimage.label(nose)
        if n:  # the nose itself, not the whisker dots beside it, with its dark nostrils
            nose = labs == int(np.argmax(ndimage.sum(nose, labs, np.arange(1, n + 1)))) + 1
            nose |= ndimage.binary_dilation(nose, structure=disk(6)) & box & (look.L < 0.5)
            nose = ndimage.binary_fill_holes(ndimage.binary_closing(nose, structure=disk(3)))
        nose &= a

    g = (draft[..., 1] > 96) & a & ~tail
    labs, n = ndimage.label(g)
    mane = np.zeros_like(a)
    claws = np.zeros_like(a)
    if n:
        idx = np.arange(1, n + 1)
        sizes = ndimage.sum(g, labs, idx)
        core = labs == int(np.argmax(sizes)) + 1
        near_core = ndimage.binary_dilation(core, structure=disk(30))
        mane |= core
        for i in idx:
            comp = labs == i
            if comp.sum() < 40 or (comp & core).any():
                continue
            cy, cx = np.nonzero(comp)
            if cy.mean() > y1 - 0.14 * (y1 - y0):
                claws |= comp
                continue
            if np.median(look.hue[comp]) > 32 or np.median(look.L[comp]) >= 0.47:
                continue
            wide = (cx.max() - cx.min()) > (cy.max() - cy.min())
            dark = comp.sum() >= 500 and np.median(look.L[comp]) < 0.4
            if dark or (comp & near_core).any() or (wide and cy.mean() < y0 + 0.5 * (y1 - y0)):
                mane |= comp
    # the claws, whole: their crimson paint within the paws, beside the drafted claws
    crimson = a & paws & (look.hue > 12) & (look.hue < 35) & (look.C > 0.06) & (look.L < 0.7)
    claws = ndimage.binary_propagation(claws, mask=crimson | claws)
    claws = ndimage.binary_dilation(ndimage.binary_fill_holes(claws), structure=SQUARE) & a
    never = tail | claws | eyes | nose
    mane = manticore_fill_holes(ndimage.binary_closing(mane, structure=SQUARE), 400) & a & ~never
    # Mythic: black crystal shards in her mane (grey paint with pale facets) are in neither;
    # the dark grey streaks between her locks are the mane's own shadow, and go with it
    grey = a & (look.C < 0.045) & ~never
    labs, n = ndimage.label(grey)
    if n:
        i = np.arange(1, n + 1)
        faceted = np.zeros(n + 1, bool)
        # (a dark piece with pale facets: her face's white fur is pale all over)
        faceted[1:] = ((ndimage.sum(grey & (look.L > 0.5), labs, i) >= 20)
                       & (ndimage.mean(look.L, labs, i) < 0.45)
                       & (ndimage.sum(grey, labs, i) >= 300))
        by_mane = np.zeros(n + 1, bool)
        by_mane[np.unique(labs[ndimage.binary_dilation(mane, structure=disk(3)) & grey])] = True
        by_mane[0] = False
        shards = (faceted & by_mane)[labs]
        shards = ndimage.binary_fill_holes(ndimage.binary_closing(shards, structure=disk(2)))
        shards = ndimage.binary_dilation(shards, structure=SQUARE) & a
        # (the crimson glints in a shard are her mane seen through it, and take its colour)
        glint = shards & (look.hue > -5) & (look.hue < 35) & (look.C > 0.08)
        shards &= ~glint
        never |= shards
        mane = (mane & ~shards) | glint
        inside = ndimage.binary_closing(mane, structure=disk(6)) & ~shards
        mane |= ndimage.binary_propagation(mane, mask=(grey & inside & ~shards) | mane)

    # the bright crimson the draft left out of her mane (a crystal spike's lit face) grown back
    # from it by hue; her inner ears are a softer pink, under this chroma
    mane_hue = np.median(look.hue[mane])
    dm = np.abs((look.hue - mane_hue + 180) % 360 - 180)
    bright = a & ~never & (dm < 10) & (look.C >= 0.13)
    mane |= ndimage.binary_propagation(mane, mask=bright | mane)

    fur = (draft[..., 0] > 128) & a & ~mane & ~never
    # the pale pink of her cheek where it meets her mane is fur, not a pale fringe of mane
    pale = mane & (look.hue < 12) & (look.L > 0.55)
    pale = ndimage.binary_propagation(fur, mask=pale | fur) & pale
    mane &= ~pale
    fur |= pale
    edge = ndimage.binary_dilation(mane, structure=disk(3)) & (dm < 8)
    pink = (a & ~mane & ~never & ~look.ink & ~edge & (look.hue > -15) & (look.hue < 30)
            & (look.L >= 0.4) & (look.C < 0.13))
    fur |= ndimage.binary_propagation(fur, mask=pink | fur)

    left = a & ~mane & ~fur & ~never & ~look.ink & (look.hue > -15) & (look.hue < 35)
    d_fur = ndimage.distance_transform_edt(~fur)
    d_mane = ndimage.distance_transform_edt(~mane)
    fur |= left & (d_fur <= 5) & (d_fur <= d_mane)
    mane |= left & (d_mane <= 5) & (d_mane < d_fur)
    # ink drawn as an outline is in neither part, except a 2px lip of it under each part's
    # edge: the soft edge then fades out over dark ink, not over the last light pixels of fur
    line = look.outline(light=0.7)
    fur &= ~line
    mane &= ~line
    # (the whisker dots on her muzzle: small holes in the fur, not ink, are fur)
    fur |= manticore_fill_holes(fur, 80) & ~fur & ~never & ~mane & ~look.ink
    face = eyes | nose
    lid = face & (look.L < 0.45) & ~ndimage.binary_erosion(face, structure=disk(2))
    lip = (line & ~never) | lid
    fur_lip = ndimage.binary_dilation(fur, structure=disk(2)) & lip
    mane_lip = ndimage.binary_dilation(mane, structure=disk(2)) & lip & ~fur_lip
    return (fur | fur_lip) & ~mane, mane | mane_lip


def manticore_eyes(look: Look) -> np.ndarray:
    """Her eyes, never coloured: each a dark blob (OKLab L < 0.5: the iris, pupil and lid line,
    whose browns are as warm as her mane) of under 6000px with a white catchlight inside it,
    filled, so the green or brown ring of the iris goes with it. The blobs are found with the
    thin lines opened away (her near eye touches the line of her cheek), then given back the
    dark paint beside them, but not the pale lids around them (those are fur)."""
    a = look.alpha
    dark = a & (look.L < 0.5)
    blobs = ndimage.binary_opening(dark, structure=disk(2))
    labs, n = ndimage.label(blobs)
    eyes = np.zeros_like(a)
    if not n:
        return eyes
    sizes = ndimage.sum(blobs, labs, np.arange(1, n + 1))
    white = a & (look.L > 0.85) & (look.C < 0.035)
    h, w = a.shape
    for i, sl in enumerate(ndimage.find_objects(labs), start=1):
        if sl is None or sizes[i - 1] >= 6000:
            continue
        sl = (slice(max(sl[0].start - 6, 0), min(sl[0].stop + 6, h)),
              slice(max(sl[1].start - 6, 0), min(sl[1].stop + 6, w)))
        comp = labs[sl] == i
        # (closed first: a pale iris can leave the ring open beside the catchlight)
        filled = ndimage.binary_fill_holes(ndimage.binary_closing(comp, structure=disk(4)))
        if (filled & ~comp & white[sl]).any():
            eyes[sl] |= filled
    near = ndimage.binary_dilation(eyes, structure=disk(3))
    return ndimage.binary_fill_holes(eyes | (near & dark)) & a


def manticore_fill_holes(part: np.ndarray, most: int) -> np.ndarray:
    """The part with its holes of under `most` pixels filled (a big hole, such as the face her
    mane rings, stays out)."""
    holes = ndimage.binary_fill_holes(part) & ~part
    labs, n = ndimage.label(holes)
    if not n:
        return part
    small = np.zeros(n + 1, bool)
    small[1:] = ndimage.sum(holes, labs, np.arange(1, n + 1)) < most
    return part | small[labs]


def manticore_tail(look: Look) -> np.ndarray:
    """Her scorpion tail and stinger, never coloured: the green paint (OKLab hue 100..170),
    closed and filled so its pale highlights and crystal facets go with it."""
    a = look.alpha
    green = a & (look.C > 0.035) & (look.hue > 100) & (look.hue < 170)
    labs, n = ndimage.label(ndimage.binary_closing(green, structure=SQUARE))
    if not n:
        return np.zeros_like(a)
    sizes = ndimage.sum(labs > 0, labs, np.arange(1, n + 1))
    big = np.zeros(n + 1, bool)
    big[1:] = sizes >= 200
    tail = ndimage.binary_fill_holes(ndimage.binary_closing(big[labs], structure=disk(3)))
    return ndimage.binary_dilation(tail, structure=disk(2)) & a


RULES = {
    "unicorn": clean_unicorn,
    "bigfoot": clean_bigfoot,
    "kitsune": clean_kitsune,
    "dragonling": clean_dragonling,
    "griffin": clean_griffin,
    "manticore": clean_manticore,
}


# ----------------------------------------------------------------------------- main

def clean(rgba: np.ndarray, draft: np.ndarray, species: str, painting: str) -> np.ndarray:
    """A drafted mask (HxWx3 uint8) cleaned: R and G by the species' rules and the painting's
    hand fixes, softened, clipped to the figure and shared out; B as drafted."""
    # Her figure is the draft's B: the painting's alpha on a cut-out (base and class), and
    # everything but the painted backdrop on a gear portrait, which is opaque.
    main, accent = RULES[species](Look(rgba, draft[..., 2] > 127), draft, painting)
    B = draft[..., 2].astype(float) / 255.0
    R, G = soften(main & ~accent), soften(accent)
    total = R + G
    share = np.where(total > 1, 1.0 / np.maximum(total, 1e-9), 1.0)
    R, G = np.minimum(R * share, B), np.minimum(G * share, B)
    return (np.stack([R, G, B], -1) * 255).round().clip(0, 255).astype(np.uint8)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="art:coat-clean", description="Clean drafted coat masks for one species.")
    ap.add_argument("species", choices=sorted(RULES))
    ap.add_argument("--family", choices=coat.FAMILIES, default="base")
    ap.add_argument("--tier")
    ap.add_argument("--drafts", default=os.path.join(coat.ROOT, "staging", "coat-drafts"),
                    help="where art:coat-draft --out wrote the drafts (DIR/assets/...); default staging/coat-drafts")
    ap.add_argument("--out", help="write under OUT/assets/... instead of the repository's assets/")
    args = ap.parse_args(argv)

    with open(os.path.join(coat.ROOT, "assets", "manifest.json"), encoding="utf-8") as f:
        mf = json.load(f)
    done = missing = 0
    for p in coat.paintings(mf, args.species):
        if p.family != args.family or (args.tier and p.tier != args.tier):
            continue
        draft_path = coat.asset(p.mask, args.drafts)
        if not os.path.isfile(draft_path):
            print(f"  no draft  {draft_path}")
            missing += 1
            continue
        with Image.open(coat.asset(p.painting)) as im:
            rgba = np.asarray(im.convert("RGBA"))
        with Image.open(draft_path) as im:
            draft = np.asarray(im.convert("RGB"))
        mask = clean(rgba, draft, args.species, p.painting)
        out = coat.asset(p.mask, args.out)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        Image.fromarray(mask, "RGB").save(out, optimize=True)
        share = mask.astype(float).mean(axis=(0, 1)) / 255.0
        print(f"  clean {p.mask}  main {share[0]:.1%}, accent {share[1]:.1%}, figure {share[2]:.1%}")
        done += 1
    print(f"\n{done} mask(s) cleaned, {missing} draft(s) missing.")
    if done:
        print("Review them on `npm run art:sheet -- --coat`, then list each painting in "
              "assets/manifest.json -> coatMasks.paintings.")
    return 0 if done and not missing else 1


if __name__ == "__main__":
    sys.exit(main())
