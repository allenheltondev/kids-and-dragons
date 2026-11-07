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
import copy
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
#   "coat"     unicorn: inside the box, her soft lavender is coat (inner ears, the far belly)
#   "cloth"    unicorn: inside the box, dull indigo paint is costume cloth, not mane shadow
#   "nose"     manticore: inside the box, the crimson paint is her nose, in neither part
#   "gear"     griffin: inside the box, what his dark paint (L < 0.45) shuts in is gear (a pendant)
#   "feathers" griffin: inside the box, his blue paint is feathers, not his class costume
#   "backdrop" griffin (gear portrait): inside the box, a piece of the figure apart from him is
#              the painted backdrop, not his figure (B)

FIXES: dict[str, dict[str, list[tuple[int, int, int, int]]]] = {
    # her inner ears and the shaded belly between her far legs, lavender like her mane
    "characters/unicorn/fledgling/assembled.png": {"coat": [(85, 165, 155, 185), (145, 212, 380, 415), (540, 625, 540, 622)]},
    "characters/unicorn/sworn/assembled.png": {"coat": [(160, 210, 395, 420), (550, 620, 544, 606)]},
    "characters/unicorn/radiant/assembled.png": {"coat": [(165, 218, 390, 415), (560, 605, 548, 595)]},
    "characters/unicorn/mythic/assembled.png": {"coat": [(590, 626, 552, 600)]},
    # the purple shading strokes under her jaw, coat and not a lock of mane
    "gear-portraits/songkeeper/sworn/unicorn.png": {"coat": [(455, 505, 395, 480)]},
    # Duskrunner's indigo scarf and vest, dyed near her own purple: where her dull cloth is
    "character-rigs/duskrunner/sworn/unicorn/assembled.png": {"cloth": [(432, 650, 255, 475), (400, 432, 445, 475)]},
    "character-rigs/duskrunner/radiant/unicorn/assembled.png": {"cloth": [(412, 670, 290, 530)]},
    "character-rigs/duskrunner/mythic/unicorn/assembled.png": {"cloth": [(395, 670, 305, 690)]},
    "gear-portraits/duskrunner/sworn/unicorn.png": {"cloth": [(548, 810, 330, 600), (515, 548, 540, 600)]},
    "gear-portraits/duskrunner/radiant/unicorn.png": {"cloth": [(530, 850, 335, 600)]},
    "gear-portraits/duskrunner/mythic/unicorn.png": {"cloth": [(500, 860, 365, 800)]},
    # her nose, painted in her mane's crimson
    "characters/manticore/fledgling/assembled.png": {"nose": [(360, 397, 186, 252)]},
    "characters/manticore/sworn/assembled.png": {"nose": [(362, 398, 196, 257)]},
    "characters/manticore/radiant/assembled.png": {"nose": [(353, 389, 189, 250)]},
    "characters/manticore/mythic/assembled.png": {"nose": [(373, 409, 206, 267)]},
    # griffin: on the duskrunner's Sworn paintings his crest and tail tuft are painted as indigo
    # as his hood (the crest's spikes stand up out of the top of it), and the crescent pendant
    # lies on his pale chest
    "character-rigs/duskrunner/sworn/griffin/assembled.png": {
        "feathers": [(85, 180, 195, 400), (85, 168, 400, 480), (680, 800, 760, 900)],
        "gear": [(410, 540, 330, 450)]},
    "gear-portraits/duskrunner/sworn/griffin.png": {
        "feathers": [(120, 205, 270, 500), (120, 222, 500, 570), (850, 1005, 915, 1085)],
        "gear": [(525, 680, 432, 532)]},
    # griffin: the duskrunner's Radiant buckle, at the strap's edge on his pale belly
    "character-rigs/duskrunner/radiant/griffin/assembled.png": {"gear": [(515, 592, 262, 345)]},
    # griffin: the hummingbird painted in the backdrop of two of his gear portraits
    "gear-portraits/thornguard/radiant/griffin.png": {"backdrop": [(140, 440, 780, 1140)]},
    "gear-portraits/thornguard/mythic/griffin.png": {"backdrop": [(140, 440, 780, 1140)]},
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
      part's hue) go to the nearer part, so no untinted lilac shows under a dark colour.

    Her class paintings and gear portraits (`character-rigs/`, `gear-portraits/`) go through
    `clean_unicorn_dressed`, which finds her costume first and keeps it out of both parts."""
    if not painting.startswith("characters/"):
        return clean_unicorn_dressed(look, draft, painting)
    return unicorn_parts(look, draft, painting)


def unicorn_parts(look: Look, draft: np.ndarray, painting: str, k: float = 1.0,
                  never: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """`clean_unicorn`'s rules. `k` scales its pixel sizes to the canvas (1 on a 1024 painting),
    `never` (her costume, on a class painting or gear portrait) is kept out of both parts as her
    horn is. With the defaults it is exactly the base family's cleaning."""
    def px(n: float) -> int:
        return max(1, int(round(n * k)))

    a = look.alpha
    ys = np.nonzero(a)[0]
    y0, y1 = ys.min(), ys.max()
    horn = unicorn_horn(look, k)
    if never is not None:
        horn = horn | never
    g = (draft[..., 1] > 96) & ~horn if never is not None else draft[..., 1] > 96
    labs, n = ndimage.label(g)
    keep = np.zeros_like(g)
    for i in range(1, n + 1):
        comp = labs == i
        if comp.sum() < 400 * k * k:
            continue
        if np.nonzero(comp)[0].mean() > y1 - 0.14 * (y1 - y0):  # a hoof
            continue
        keep |= comp
    mane = (draft[..., 1] > 128) & ndimage.binary_dilation(keep, iterations=px(3))
    mane = ndimage.binary_fill_holes(ndimage.binary_closing(mane, structure=SQUARE, iterations=1)) & a & ~horn
    mane_hue = np.median(look.hue[mane])
    dm = np.abs((look.hue - mane_hue + 180) % 360 - 180)
    glow = a & ~horn & ~look.ink & (dm < 25) & (look.C >= 0.12)
    mane |= ndimage.binary_propagation(mane, mask=glow | mane)
    # (ink outlines are brown, hue 0..30, and her hooves as purple as her mane: both stay out)
    shadow = a & ~horn & (look.C >= 0.06) & (look.L >= 0.2) & (look.hue > -115) & (look.hue < mane_hue - 8)
    reach = ndimage.binary_dilation(mane, structure=disk(px(25)))
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
    pale = mane & (look.L > 0.72) & (look.C < 0.075) & ndimage.binary_dilation(coat_, structure=disk(px(6)))
    pale = ndimage.binary_propagation(coat_, mask=pale | coat_) & pale
    mane &= ~pale
    coat_ |= pale

    # (white highlights too, except inside a small loop of ink: her eyes)
    loops = ndimage.binary_fill_holes(look.ink) & ~look.ink
    labs, n = ndimage.label(loops)
    eyes = np.zeros_like(a)
    if n:
        small = np.zeros(n + 1, bool)
        small[1:] = ndimage.sum(loops, labs, np.arange(1, n + 1)) < 2500 * k * k
        eyes = ndimage.binary_dilation(small[labs], structure=disk(px(2)))
    hued = (look.C >= 0.02) & ((dh < 40) | (dm < 40))
    white = (look.C < 0.02) & (look.L > 0.8)
    left = a & ~mane & ~coat_ & ~horn & ~look.ink & ~eyes & (hued | white)
    d_coat = ndimage.distance_transform_edt(~coat_)
    d_mane = ndimage.distance_transform_edt(~mane)
    coat_ |= left & (d_coat <= 5 * k) & (d_coat <= d_mane)
    mane |= left & (d_mane <= 5 * k) & (d_mane < d_coat)
    if never is not None:
        # (dressed) the shaded belly and far leg under her costume, and an inner ear, are a
        # soft lavender: a small piece of mane paler and duller than the mane is coat
        mC, mL = np.median(look.C[mane]), np.median(look.L[mane])
        labs, n = ndimage.label(mane)
        if n:
            i = np.arange(1, n + 1)
            soft = np.zeros(n + 1, bool)
            soft[1:] = ((ndimage.sum(mane, labs, i) < 0.1 * mane.sum())
                        & (ndimage.median(look.C, labs, i) < 0.8 * mC)
                        & (ndimage.median(look.L, labs, i) > mL + 0.06))
            coat_ |= soft[labs]
            mane &= ~soft[labs]
        # ...and the shade under her jaw, grown into the mane where a lock meets it: the
        # mane's soft, pale paint in pieces of 300px or more that touch the coat
        pale = mane & (look.C < 0.85 * mC) & (look.L > mL + 0.06)
        labs, n = ndimage.label(pale)
        if n:
            i = np.arange(1, n + 1)
            touch = np.zeros(n + 1, bool)
            touch[np.unique(labs[ndimage.binary_dilation(coat_, structure=SQUARE) & pale])] = True
            touch[0] = False
            soft = np.zeros(n + 1, bool)
            soft[1:] = ((ndimage.sum(pale, labs, i) >= 300 * k * k)
                        & (ndimage.median(look.L, labs, i) > mL + 0.1))
            coat_ |= (soft & touch)[labs]
            mane &= ~(soft & touch)[labs]
        # ...and a fleck of mane under 150px ringed by coat is a stroke of the coat's shading
        labs, n = ndimage.label(mane)
        if n:
            i = np.arange(1, n + 1)
            ring = ndimage.binary_dilation(mane, structure=disk(px(3))) & ~mane & a & ~look.ink
            near = ndimage.grey_dilation(labs, footprint=disk(px(3))) * ring
            coated = ndimage.sum(coat_, near, i) / np.maximum(ndimage.sum(ring, near, i), 1)
            fleck = np.zeros(n + 1, bool)
            fleck[1:] = (ndimage.sum(mane, labs, i) < 150 * k * k) & (coated > 0.8)
            coat_ |= fleck[labs]
            mane &= ~fleck[labs]
    # ink drawn as an outline (at her edge, or against her pale coat) is in neither part; the
    # strand lines inside her mane are its painting
    line = look.outline(light=0.78)
    return coat_ & ~mane & ~horn & ~line, mane & ~line


def unicorn_horn(look: Look, k: float = 1.0) -> np.ndarray:
    """Her horn, never coloured: the largest blue piece (OKLab hue 210..285) in the top of her
    figure and the blue pieces beside it (the crystals at its base), closed and filled, so its
    pale facets go with it. (`k` scales the reach and closing to the canvas; 1 is unchanged.)"""
    r = max(1, int(round(6 * k)))
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
    near = np.unique(labs[ndimage.binary_dilation(biggest, structure=disk(r))])
    horn = np.isin(labs, near[near > 0])
    horn = ndimage.binary_fill_holes(ndimage.binary_closing(horn, structure=disk(max(1, int(round(3 * k))))))
    return ndimage.binary_dilation(horn, structure=SQUARE) & a


def clean_unicorn_dressed(look: Look, draft: np.ndarray, painting: str) -> tuple[np.ndarray, ...]:
    """Her class paintings and gear portraits: `unicorn_parts` with her costume kept out. On a
    gear portrait her figure is found afresh (`unicorn_figure`) and returned as B too."""
    k = look.alpha.shape[0] / 1024
    figure = None
    if painting.startswith("gear-portraits/"):
        figure = unicorn_figure(look.rgba, draft, k)
        look = Look(look.rgba, figure > 0.5)
    never = unicorn_costume(look, k, boxes(painting, "cloth", look.alpha.shape))
    main, accent = unicorn_parts(look, draft, painting, k, never)
    return (main, accent) if figure is None else (main, accent, figure)


def unicorn_figure(rgba: np.ndarray, draft: np.ndarray, k: float) -> np.ndarray:
    """Her figure on an opaque gear portrait, 0..1. The draft's flood from the edges (a colour
    step of 45) stops short in the dark backdrop between her legs and under her costume, and
    bites into her darkest locks and hooves. Here the backdrop is modelled instead: its colour
    is the draft's sure backdrop (B ~ 0) averaged locally (a 40px gaussian, OKLab), and she is
    whatever differs from it by more than 0.07: closed across her ink lines, its pieces of
    2000px and more (at 1024; the floating gem is one), holes under 3000px filled; then her ink
    outline (within 2px, still 0.04 from the backdrop) and a ~1px soft edge."""
    def px(n: float) -> int:
        return max(1, int(round(n * k)))

    lab = coat.srgb_to_oklab(rgba[..., :3] / 255.0)
    sure = draft[..., 2] < 5
    s = 40 * k
    w = np.maximum(ndimage.gaussian_filter(sure.astype(float), s), 1e-6)
    mu = np.stack([ndimage.gaussian_filter(lab[..., i] * sure, s) / w for i in range(3)], -1)
    d = np.sqrt(((lab - mu) ** 2).sum(-1))
    fg = ndimage.binary_closing(d > 0.07, structure=disk(px(2)))
    labs, n = ndimage.label(fg)
    if n:
        sizes = np.zeros(n + 1)
        sizes[1:] = ndimage.sum(fg, labs, np.arange(1, n + 1))
        fg = (sizes >= 2000 * k * k)[labs]
    holes = ndimage.binary_fill_holes(fg) & ~fg
    labs, n = ndimage.label(holes)
    if n:
        small = np.zeros(n + 1, bool)
        small[1:] = ndimage.sum(holes, labs, np.arange(1, n + 1)) < 3000 * k * k
        fg |= small[labs]
    fg |= ndimage.binary_dilation(fg, structure=disk(px(2))) & (d > 0.04)
    return np.clip(ndimage.gaussian_filter(fg.astype(float), SOFTEN), 0, 1)


def unicorn_costume(look: Look, k: float, cloth: np.ndarray | None = None) -> np.ndarray:
    """Her class costume and anything she carries or wears, never coloured.

    Her own paint is one hue family (OKLab hue -75..-5): the pale lilac coat and the purple
    mane. Costume is (1) paint of any other hue (gold, brass, leather, green, teal, the blue of a
    gem) and (2) cloth dyed near her own hue but duller than her mane and darker than her coat
    (Duskrunner's indigo scarf and vest, dark enough that half of it reads as ink). Their pieces
    of 1500px and more (at 1024) after an opening, grown back, closed and filled, so the
    stitching, buckles and pale studs on them go with them. A dull piece ringed by her
    saturated mane paint is the deep shadow inside her tail or mane, not cloth."""
    def px(n: float) -> int:
        return max(1, int(round(n * k)))

    a, L, C, hue = look.alpha, look.L, look.C, look.hue
    hers = (hue > -75) & (hue < -5)
    # (and its darks, as dark as ink, where ink's brown and plum hue -40..30 is not: dark
    # leather, a deep teal cape)
    other = a & ~hers & (L >= 0.12) & (((C >= 0.04) & ~look.ink) | ((C >= 0.025) & ((hue > 40) | (hue < -100))))
    dull = a & (hue > -115) & (hue < -5) & (C >= 0.03) & (L >= 0.2) & (
        ((C < 0.10) & (L < 0.6) & (hue < -48)) | ((C < 0.125) & (L < 0.5) & (hue < -55)))
    dull = dull & cloth if cloth is not None else np.zeros_like(a)
    cand = ndimage.binary_closing(other | dull, structure=disk(px(2))) & a
    body = ndimage.binary_opening(cand, structure=disk(px(3)))
    labs, n = ndimage.label(body)
    if not n:
        return np.zeros_like(a)
    idx = np.arange(1, n + 1)
    sizes = ndimage.sum(body, labs, idx)
    dull_share = ndimage.mean(dull, labs, idx)
    hue_med = ndimage.median(hue, labs, idx)
    mane_paint = a & hers & (C >= 0.12) & ~look.ink
    objs = ndimage.find_objects(labs)
    big = np.zeros(n + 1, bool)
    for i in idx:
        if sizes[i - 1] < 1500 * k * k:
            continue
        # (a dull piece, or one of blue-violet paint: the galaxy deep in her tail)
        if dull_share[i - 1] > 0.5 or -130 < hue_med[i - 1] < -5:
            sl = objs[i - 1]
            pad = px(8)
            sl = (slice(max(sl[0].start - pad, 0), sl[0].stop + pad), slice(max(sl[1].start - pad, 0), sl[1].stop + pad))
            comp = labs[sl] == i
            ring = ndimage.binary_dilation(comp, structure=disk(px(6))) & ~comp & a[sl] & ~look.ink[sl]
            if ring.any() and mane_paint[sl][ring].mean() > RING_MANE:
                continue
        big[i] = True
    kept = big[labs]
    costume = ndimage.binary_propagation(kept, mask=cand & ndimage.binary_dilation(kept, structure=disk(px(4))))
    holes = ndimage.binary_fill_holes(costume) & ~costume
    labs, n = ndimage.label(holes)
    if n:
        small = np.zeros(n + 1, bool)
        small[1:] = ndimage.sum(holes, labs, np.arange(1, n + 1)) < 5000 * k * k
        costume |= small[labs]
    return costume & a


RING_MANE = 0.5


# ----------------------------------------------------------------------------- bigfoot

def clean_bigfoot(look: Look, draft: np.ndarray, painting: str) -> tuple[np.ndarray, np.ndarray]:
    """Skin (G) is found afresh from the painting; fur (R) is the rest of him that takes a colour.

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
    warm = look.warm(0.06, lmin=0.45) & ~look.ink
    leaves = ndimage.binary_dilation(a & (look.hue >= 100) & (look.hue < 170) & (C > 0.04), iterations=1) & a

    smooth_skin = warm & (C >= 0.075) & (L >= 0.5) & (look.rough < 0.045)
    core = ndimage.binary_opening(smooth_skin, structure=SQUARE, iterations=2)
    labs, n = ndimage.label(core)
    sizes = ndimage.sum(core, labs, np.arange(1, n + 1))
    top5 = np.isin(labs, np.argsort(sizes)[::-1][:5] + 1)
    beside = np.unique(labs[ndimage.binary_dilation(top5, structure=disk(15)) & core])
    seeds = np.isin(labs, beside[beside > 0])
    reach = ndimage.binary_dilation(seeds, structure=disk(30))
    skin = ndimage.binary_propagation(seeds, mask=(warm & (look.rough < 0.06) & reach & ~leaves) | seeds)

    lines = a & (L < 0.5)
    regions, rn = ndimage.label(a & ~ndimage.binary_dilation(lines, structure=SQUARE))
    idx = np.arange(1, rn + 1)
    warm_share = ndimage.mean(look.warm(0.07), regions, idx)
    thick = ndimage.maximum(ndimage.distance_transform_edt(regions > 0), regions, idx)
    area = ndimage.sum(np.ones_like(L), regions, idx)
    for _ in range(4):
        skin_share = ndimage.mean(skin, regions, idx)
        ok = np.zeros(rn + 1, bool)
        ok[1:] = (warm_share >= 0.6) & (thick >= 2.5) & ((area < 6000) | (skin_share >= 0.3))
        cand = ok[regions] & reach & ~leaves
        touched = np.unique(regions[ndimage.binary_dilation(skin, structure=disk(4)) & cand])
        new = np.isin(regions, touched[touched > 0]) & cand & ~skin
        if not new.any():
            break
        skin |= new
    skin |= ndimage.binary_dilation(skin, structure=SQUARE, iterations=2) & ~lines & warm
    skin = ndimage.binary_closing(skin, structure=disk(3))

    ys = np.nonzero(a)[0]
    rows = np.arange(a.shape[0])[:, None]
    limbs = skin & (rows > ys.min() + 0.45 * (ys.max() - ys.min()))
    shade = look.warm(0.065, lmin=0.36, lmax=0.66, h1=95) & ~leaves
    skin |= ndimage.binary_propagation(limbs, mask=(shade & ndimage.binary_dilation(limbs, structure=disk(14))) | limbs)
    skin = ndimage.binary_fill_holes(ndimage.binary_closing(skin, structure=disk(2)))

    for (r0, r1, c0, c1) in FIXES.get(painting, {}).get("skin", []):
        # the largest smooth, warm piece in the box, filled
        box = np.zeros_like(a)
        box[r0:r1, c0:c1] = True
        cand = box & look.warm(0.05, lmin=0.5) & (look.rough < 0.05) & ~leaves
        labs, n = ndimage.label(cand)
        if n:
            sizes = ndimage.sum(cand, labs, np.arange(1, n + 1))
            piece = labs == int(np.argmax(sizes)) + 1
            skin |= ndimage.binary_fill_holes(ndimage.binary_closing(piece, structure=disk(2))) & box
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
        small_warm[1:] = (ndimage.sum(R, labs, i) < 600) & (ndimage.mean(look.warm(0.06), labs, i) >= 0.5)
        touching = np.zeros(n + 1, bool)
        touching[np.unique(labs[ndimage.binary_dilation(G, structure=disk(4)) & R])] = True
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
    - Ink drawn as an outline is in neither part.

    Her class paintings and gear portraits (dressed, with props) are `kitsune_dressed`."""
    if not painting.startswith("characters/"):
        return kitsune_dressed(look, draft, painting)
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


def kitsune_eyes(look: Look, most: int = 2500, darkest: float = 1.01) -> np.ndarray:
    """Her eyes: small loops of ink (under `most` px, and of mean OKLab L under `darkest`: on a
    dressed painting, fur shut in by a costume's outlines is a pale loop), filled (their white
    highlights go with them)."""
    loops = ndimage.binary_fill_holes(look.ink) & ~look.ink
    labs, n = ndimage.label(loops)
    if not n:
        return np.zeros_like(look.alpha)
    small = np.zeros(n + 1, bool)
    i = np.arange(1, n + 1)
    small[1:] = (ndimage.sum(loops, labs, i) < most) & (ndimage.mean(look.L, labs, i) < darkest)
    return ndimage.binary_dilation(small[labs], structure=disk(2))


def kitsune_dressed(look: Look, draft: np.ndarray, painting: str):
    """Her class paintings (`character-rigs/`, cut-outs on 1024) and gear portraits
    (`gear-portraits/`, opaque on 1254): the same two parts as her base paintings, with her
    costume, gear and props left as painted. Pixel sizes are for the 1024 canvas, scaled by `s`.

    - Figure (gear portraits only): `kitsune_figure`, as the draft's leaks into her navy cloak.
    - Costume: `kitsune_costume`, the paint that is none of her colours (navy, gold, bark,
      moss, metal grey, silver, rose, the dark teal of the Starweaver cape) found between the
      ink lines, the Songkeeper mantles traced by hand (KITSUNE_COSTUME), and the props traced
      by hand (KITSUNE_PROPS: the Thornguard squirrel, the Starweaver crystal).
    - Tails: her bright teal (L >= 0.5), as on her base paintings, never the costume, grown
      over their deeper shading along an ink line. Other teal is a gem when it sits in the
      costume (the moon pendant's gloss, a mantle's stones), else a fleck of her tails.
    - Orange stays as painted (hue 15..62: her gold trim is 62 and up, and is costume); the
      socks rule as on her base paintings, plus the pale soft shading low on her legs and small
      soft warm pieces in a cloak's shadow, which are fur.
    - Fur: the rest of her, as on her base paintings (eyes are small, dark loops of ink: a
      pale loop is fur shut in by a costume's lines)."""
    s = look.alpha.shape[1] / 1024.0
    gear = painting.startswith("gear-portraits/")
    figure = None
    if gear:
        figure = kitsune_figure(look.rgba, painting, s)
        look = Look(look.rgba, figure > 0.5)
    a, L, C, hue = look.alpha, look.L, look.C, look.hue
    eyes = kitsune_eyes(look, int(2500 * s * s), 0.6)
    bright_teal = a & (C >= 0.03) & ((hue > 140) | (hue < -110)) & (L >= 0.5)
    props = kitsune_traced(KITSUNE_PROPS, painting, a.shape, 2, "prop")
    props |= kitsune_traced(KITSUNE_PROPS, painting, a.shape, 2, "beside_tails") & ~bright_teal
    costume = (kitsune_costume(look, painting, s) | props) & a

    teal = bright_teal & ~costume
    labs, n = ndimage.label(ndimage.binary_closing(teal, structure=SQUARE))
    sizes = ndimage.sum(teal, labs, np.arange(1, n + 1)) if n else np.zeros(0)
    tails = np.isin(labs, np.nonzero(sizes >= 3000 * s * s)[0] + 1) & teal
    tails = ndimage.binary_closing(tails, structure=disk(3))
    tails = ndimage.binary_fill_holes(tails) & a & ~costume
    # their deeper shading along an ink line, grown from them
    shade = a & ~costume & ~look.ink & (C >= 0.03) & ((hue > 140) | (hue < -110)) & (L >= 0.3)
    reach = ndimage.binary_dilation(tails, structure=disk(max(3, round(8 * s))))
    tails |= ndimage.binary_propagation(tails, mask=(shade & reach) | tails)
    # the rest of the teal is glass or a gem where it lies in her costume (a moon pendant's
    # gloss, a mantle's stones: its rim mostly costume), else flecks of her tails among their
    # white tips. A gem takes the pale glints shut in by it.
    rest = teal & ~tails
    labs, n = ndimage.label(rest)
    gems = np.zeros_like(a)
    if n:
        rim = ndimage.binary_dilation(rest, structure=disk(3)) & ~rest & ~look.ink & a
        near = ndimage.grey_dilation(labs, footprint=disk(3))
        i = np.arange(1, n + 1)
        worn = np.zeros(n + 1, bool)
        worn[1:] = ndimage.sum(rim & costume, near, i) >= 0.3 * np.maximum(ndimage.sum(rim, near, i), 1)
        gems = worn[labs]
        tails |= rest & ~gems
    gems = ndimage.binary_closing(gems, structure=disk(2))
    holes = ndimage.binary_fill_holes(gems) & ~gems
    labs, n = ndimage.label(holes)
    if n:
        small = np.zeros(n + 1, bool)
        small[1:] = ndimage.sum(holes, labs, np.arange(1, n + 1)) < 1500 * s * s
        gems |= small[labs]
    costume |= gems & a & ~tails

    orange = a & (C >= 0.085) & (hue > 15) & (hue < 62) & ~costume
    ys = np.nonzero(a)[0]
    labs, n = ndimage.label(orange)
    if n:
        i = np.arange(1, n + 1)
        rows = np.array([c[0] for c in ndimage.center_of_mass(orange, labs, i)])
        sock = np.zeros(n + 1, bool)
        sock[1:] = rows > ys.min() + 0.85 * (ys.max() - ys.min())
        orange &= ~sock[labs]
    # (and the soft, pale orange shading lower on her legs, wherever its piece is centred:
    # a crisp flame marking is stronger, C >= 0.13, and stays)
    low = np.arange(a.shape[0])[:, None] > ys.min() + 0.6 * (ys.max() - ys.min())
    orange &= ~(low & (C < 0.13) & (L >= 0.76))
    # (and a small piece of soft warm shade, C under 0.12 on the whole, where her fur meets a
    # cloak's shadow: her ruff and markings are painted at C ~0.15 and up)
    labs, n = ndimage.label(orange)
    if n:
        i = np.arange(1, n + 1)
        shade = np.zeros(n + 1, bool)
        shade[1:] = (ndimage.mean(C, labs, i) < 0.12) & (ndimage.sum(orange, labs, i) < 1500 * s * s)
        orange &= ~shade[labs]
    fur = a & ~tails & ~orange & ~look.ink & ~eyes & ~costume
    labs, n = ndimage.label(fur)
    if n:
        sizes = ndimage.sum(fur, labs, np.arange(1, n + 1))
        fur = np.isin(labs, np.nonzero(sizes >= 400 * s * s)[0] + 1)
    holes = ndimage.binary_fill_holes(fur) & ~fur
    labs, n = ndimage.label(holes)
    if n:
        small = np.zeros(n + 1, bool)
        small[1:] = ndimage.sum(holes, labs, np.arange(1, n + 1)) < 150 * s * s
        fur |= small[labs] & ~look.ink & ~eyes & ~costume
    fur |= ndimage.binary_dilation(fur, structure=SQUARE) & orange
    line = look.outline()
    if figure is None:
        return fur & ~line, tails & ~line
    return fur & ~line, tails & ~line, figure


def kitsune_figure(rgba: np.ndarray, painting: str, s: float) -> np.ndarray:
    """A gear portrait's figure (0..1): everything but the backdrop. The backdrop is one flat
    dusky violet (OKLab L ~0.29, C ~0.025, hue ~-59, a faint vignette), so it is found by its
    colour, read off the canvas border, wherever it joins the border (or makes a pocket of
    2000px or more, between tails or legs). Her navy cloak (hue ~-83, C ~0.06) and the ink are
    not that colour, though the draft's flood, which steps by RGB difference, leaked into them.
    Specks of figure under 300px (sparkles painted on the backdrop) are backdrop; the edge is
    softened as the draft's is."""
    lab = coat.srgb_to_oklab(rgba[..., :3] / 255.0)
    border = np.zeros(lab.shape[:2], bool)
    border[:6, :] = border[-6:, :] = True
    border[:, :6] = border[:, -6:] = True
    L = lab[..., 0]
    C = np.hypot(lab[..., 1], lab[..., 2])
    hue = np.degrees(np.arctan2(lab[..., 2], lab[..., 1]))
    ref_L, ref_C, ref_hue = np.median(L[border]), np.median(C[border]), np.median(hue[border])
    bg = (np.abs(L - ref_L) < 0.04) & (np.abs(C - ref_C) < 0.012) & (np.abs(hue - ref_hue) < 10)
    bg = ndimage.binary_closing(bg, structure=SQUARE)
    bg = ndimage.binary_opening(bg, structure=disk(2))
    labs, n = ndimage.label(bg)
    keep = np.zeros(n + 1, bool)
    keep[np.unique(labs[border & bg])] = True
    keep[1:] |= ndimage.sum(bg, labs, np.arange(1, n + 1)) >= 2000 * s * s
    keep[0] = False
    back = keep[labs] | (border & ~ndimage.binary_dilation(~bg, structure=disk(3)))
    # the dim glow painted on the backdrop round a prop (the Starweaver crystal), inside the
    # traced `glow` shapes: dark, greyish paint, out from the backdrop
    zone = kitsune_traced(KITSUNE_FIGURE, painting, L.shape, 0, "glow")
    haze = zone & (L >= 0.24) & (L < 0.5) & (C < 0.045)
    haze = ndimage.binary_opening(haze, structure=SQUARE)
    back |= haze
    fig = ~back
    # (the morphology above frays the canvas edge: an edge that is backdrop stays backdrop)
    fig[:3, :] = fig[-3:, :] = False
    fig[:, :3] = fig[:, -3:] = False
    labs, n = ndimage.label(fig)
    if n:
        sizes = ndimage.sum(fig, labs, np.arange(1, n + 1))
        body = ndimage.binary_fill_holes(labs == int(np.argmax(sizes)) + 1) & ~haze
        # a prop floating apart from her (the Starweaver crystal) without the dim glow and
        # sparkles painted round it on the backdrop
        props = fig & ~body & ~((L < 0.45) & (C < 0.08))
        props = ndimage.binary_opening(props, structure=SQUARE)
        labs, n = ndimage.label(props)
        big = np.zeros(n + 1, bool)
        if n:
            big[1:] = ndimage.sum(props, labs, np.arange(1, n + 1)) >= 300 * s * s
        fig = body | ndimage.binary_closing(big[labs], structure=disk(2))
    return np.clip(ndimage.gaussian_filter(fig.astype(float), 1.2), 0, 1)


def kitsune_costume(look: Look, painting: str, s: float) -> np.ndarray:
    """Her class costume and gear, never coloured: paint in none of her colours (navy and
    violet, OKLab hue -125..-20; gold, hue 62..110 at C >= 0.09; moss green; the brown of bark
    and leather, dark and dull; metal grey; the dark teal of a cape, L < 0.5; rose red, hue
    -20..28, which none of her own paint is; blue-white silver, pale with hue -135..-40, where
    her white tail tips are greenish), found between
    the ink lines: every piece mostly of those colours is costume whole, so its pale
    highlights and stitching go with it. Closed, and holes under 1500px filled (a buckle, a
    gem). The `costume` / `not_costume` traced shapes (KITSUNE_COSTUME) settle the rest."""
    a, L, C, hue = look.alpha, look.L, look.C, look.hue
    ink = look.ink
    navy = (C >= 0.03) & (hue > -125) & (hue < -20)
    gold = ((C >= 0.09) & (hue >= 62) & (hue < 110)) | ((C >= 0.04) & (hue >= 75) & (hue < 110) & (L >= 0.6))
    moss = (C >= 0.03) & (hue >= 100) & (hue < 140)
    bark = (C >= 0.015) & (C < 0.09) & (hue > 30) & (hue < 110) & (L < 0.6)
    grey = ((C < 0.025) & (L < 0.72)) | ((C < 0.012) & (L < 0.86))
    dark_teal = (C >= 0.03) & ((hue > 140) | (hue <= -125)) & (L < 0.5)
    rose = (C >= 0.06) & (hue > -20) & (hue <= 28)  # (none of her own paint is this red)
    silver = (C >= 0.012) & (C < 0.07) & (hue > -135) & (hue < -40) & (L >= 0.6)  # a moon, trim
    paint = a & ~ink & (navy | gold | moss | bark | grey | dark_teal | rose | silver)
    lines = ndimage.binary_dilation(ink, structure=SQUARE)
    regions, rn = ndimage.label(a & ~lines)
    idx = np.arange(1, rn + 1)
    share = np.zeros(rn + 1)
    share[1:] = ndimage.mean(paint, regions, idx)
    costume = (share >= 0.45)[regions] & (regions > 0)
    # (pixel by pixel too, but for the dark teal, grey and silver in and beside her tails:
    # their own shading near an ink line is as dark, their pale streaks as grey)
    bright = a & (C >= 0.03) & ((hue > 140) | (hue <= -110)) & (L >= 0.5)
    labs, n = ndimage.label(bright)
    if n:
        big = np.zeros(n + 1, bool)
        big[1:] = ndimage.sum(bright, labs, np.arange(1, n + 1)) >= 3000 * s * s
        bright = big[labs]
    near_tails = ndimage.binary_dilation(bright, structure=disk(max(3, round(8 * s))))
    near_tails = ndimage.binary_fill_holes(near_tails)  # (and the pale streaks inside them)
    # (and but for warm brown alone, hue under 60: her fur in the shadow of a cloak is as
    # brown, so only a piece that is mostly so is costume; bark and leather are yellower)
    shadow = bark & (hue < 60) & ~(navy | gold | moss | grey | rose | silver)
    costume |= paint & ~((dark_teal | grey | silver) & near_tails) & ~shadow
    costume = ndimage.binary_opening(costume, structure=disk(max(1, round(s))))
    costume = ndimage.binary_closing(costume, structure=disk(max(2, round(2 * s))))
    holes = ndimage.binary_fill_holes(costume) & ~costume
    labs, n = ndimage.label(holes)
    if n:
        small = np.zeros(n + 1, bool)
        small[1:] = ndimage.sum(holes, labs, np.arange(1, n + 1)) < 1500 * s * s
        costume |= small[labs]
    labs, n = ndimage.label(costume)
    if n:
        big = np.zeros(n + 1, bool)
        big[1:] = ndimage.sum(costume, labs, np.arange(1, n + 1)) >= 150 * s * s
        costume = big[labs]
    # a traced `costume` shape takes the pieces between the ink lines that are mostly inside
    # it, so the costume's edge is its own ink line, not the tracing
    zone = kitsune_traced(KITSUNE_COSTUME, painting, a.shape, 0, "costume")
    if zone.any():
        inside = np.zeros(rn + 1, bool)
        inside[1:] = ndimage.mean(zone, regions, idx) >= 0.5
        costume |= inside[regions] & (regions > 0)
        costume |= ndimage.binary_closing(costume, structure=disk(2)) & zone
    # a `costume_all` shape is all costume, traced to the garment's own edge (where cloth as
    # pale as her fur runs into her fur with no ink line between)
    # pale paint in that shape's edge (the cloth's lit rim) goes with it, her teal never does
    rim = ~((C >= 0.03) & ((hue > 140) | (hue < -110))) & ~ink
    costume |= kitsune_traced(KITSUNE_COSTUME, painting, a.shape, 0, "costume_all")
    costume |= kitsune_traced(KITSUNE_COSTUME, painting, a.shape, max(2, round(5 * s)), "costume_all") & rim
    costume &= ~kitsune_traced(KITSUNE_COSTUME, painting, a.shape, 0, "not_costume")
    return costume & a


# Hand-traced shapes on her dressed paintings, as (x, y) canvas points.
#   KITSUNE_PROPS    what floats by her or sits on her, never coloured (a margin of 2px):
#                    "prop" all of the shape (the Starweaver crystal, teal as her tails and
#                    touching them); "beside_tails" all but her bright teal (the Thornguard
#                    squirrel, whose cream muzzle and chest are as pale as her fur, traced
#                    loosely where its tail lies on hers)
#   KITSUNE_COSTUME  "costume": a garment the colour rules miss (the Songkeeper mantles' cream
#                    bands and patterns, and the Mythic mantle, as orange as her ruff); it
#                    takes the pieces between ink lines mostly inside it. "costume_all": all
#                    of the shape (a gear portrait's mantle, softer-edged). "not_costume":
#                    her own fur or tails the rules took for costume
KITSUNE_PROPS: dict[str, dict[str, list[list[tuple[int, int]]]]] = {
    "character-rigs/starweaver/sworn/kitsune/assembled.png": {"prop": [
        [(532, 77), (578, 162), (560, 210), (535, 240), (527, 240), (500, 200), (485, 162)]]},
    "character-rigs/starweaver/radiant/kitsune/assembled.png": {"prop": [
        [(717, 128), (766, 215), (748, 262), (717, 309), (688, 262), (668, 215)]]},
    "character-rigs/starweaver/mythic/kitsune/assembled.png": {"prop": [
        [(557, 100), (608, 198), (588, 247), (553, 292), (520, 243), (503, 200)]]},
    "gear-portraits/starweaver/sworn/kitsune.png": {"prop": [
        [(837, 186), (894, 287), (838, 380), (779, 285)]]},
    "gear-portraits/starweaver/radiant/kitsune.png": {"prop": [
        [(937, 199), (996, 302), (980, 347), (937, 412), (886, 333), (877, 302)]]},
    "gear-portraits/starweaver/mythic/kitsune.png": {"prop": [
        [(936, 147), (1028, 308), (938, 476), (881, 390), (847, 310)]]},
    "character-rigs/thornguard/radiant/kitsune/assembled.png": {"beside_tails": [
        [(398, 240), (410, 215), (426, 195), (445, 214), (470, 214), (486, 186), (500, 212),
         (522, 215), (560, 185), (600, 185), (634, 213), (636, 245), (610, 262), (602, 280),
         (615, 330), (600, 380), (540, 400), (500, 400), (440, 368), (415, 345), (418, 300),
         (396, 272)]]},
    "character-rigs/thornguard/mythic/kitsune/assembled.png": {"beside_tails": [
        [(352, 240), (378, 192), (396, 214), (430, 205), (442, 186), (452, 214), (468, 236),
         (500, 200), (545, 185), (575, 200), (582, 240), (560, 262), (552, 300), (548, 360),
         (450, 368), (360, 352), (350, 300)]]},
    "gear-portraits/thornguard/radiant/kitsune.png": {"beside_tails": [
        [(498, 330), (515, 265), (530, 262), (540, 285), (580, 280), (595, 255), (605, 270),
         (640, 265), (660, 255), (700, 252), (740, 262), (770, 290), (775, 320), (735, 330),
         (725, 360), (735, 420), (700, 470), (560, 470), (520, 450), (505, 400), (492, 360)]]},
    "gear-portraits/thornguard/mythic/kitsune.png": {"beside_tails": [
        [(440, 340), (455, 280), (470, 272), (478, 292), (510, 290), (525, 262), (540, 275),
         (565, 285), (590, 270), (620, 258), (660, 262), (690, 285), (710, 315), (690, 330),
         (670, 345), (675, 420), (660, 470), (560, 480), (460, 460), (450, 420), (438, 390)]]},
}
KITSUNE_COSTUME: dict[str, dict[str, list[list[tuple[int, int]]]]] = {
    "character-rigs/songkeeper/radiant/kitsune/assembled.png": {"costume": [
        [(280, 535), (295, 490), (380, 440), (460, 430), (530, 440), (560, 460), (585, 520),
         (595, 570), (565, 585), (520, 630), (460, 660), (390, 675), (345, 655), (330, 610),
         (300, 565)]]},
    "character-rigs/songkeeper/mythic/kitsune/assembled.png": {"costume": [
        [(300, 560), (380, 500), (450, 470), (520, 465), (560, 490), (610, 550), (650, 640),
         (685, 720), (705, 765), (690, 780), (620, 760), (520, 720), (420, 670), (330, 610),
         (295, 585)]]},
    "gear-portraits/songkeeper/radiant/kitsune.png": {"costume_all": [
        [(360, 640), (440, 600), (520, 560), (580, 520), (605, 508), (640, 535), (690, 555),
         (740, 575), (762, 600), (762, 650), (700, 712), (640, 760), (580, 792), (520, 815),
         (470, 828), (455, 790), (420, 745), (395, 715), (375, 680)]]},
    "gear-portraits/songkeeper/mythic/kitsune.png": {"costume_all": [
        [(500, 480), (560, 518), (640, 545), (692, 570), (728, 622), (752, 690), (772, 770),
         (794, 840), (826, 900), (870, 942), (900, 975), (895, 1000), (700, 995), (640, 955),
         (580, 915), (520, 880), (470, 850), (470, 700), (480, 560)]]},
}
#   KITSUNE_FIGURE   on a gear portrait, "glow": where the dim glow round a prop is backdrop
KITSUNE_FIGURE: dict[str, dict[str, list[list[tuple[int, int]]]]] = {
    "gear-portraits/starweaver/mythic/kitsune.png": {"glow": [[(690, 60), (1160, 60), (1160, 480), (690, 480)]]},
}


def kitsune_traced(table: dict, painting: str, shape: tuple[int, int], margin: int, kind: str) -> np.ndarray:
    """A table's traced shapes of one kind for one painting as a mask, grown by `margin` px."""
    from PIL import ImageDraw

    polys = table.get(painting, {}).get(kind, [])
    im = Image.new("1", (shape[1], shape[0]), 0)
    draw = ImageDraw.Draw(im)
    for poly in polys:
        draw.polygon(poly, fill=1, outline=1)
    out = np.array(im, bool)
    return ndimage.binary_dilation(out, structure=disk(margin)) if margin and out.any() else out


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

def clean_griffin(look: Look, draft: np.ndarray, painting: str) -> tuple[np.ndarray, ...]:
    """His parts on a base painting (`griffin_parts`), and on a class painting or gear portrait.

    On a class painting or gear portrait his class costume, gear and props are found first
    (`griffin_gear`) and cut out of the figure he is cleaned on, so neither part reaches them.
    On a gear portrait the draft's figure (B) is redrawn (`griffin_figure`): its flood fill
    from the edges runs into a navy cloak as dark as the painted backdrop. Pixel sizes are
    scaled to the canvas (a gear portrait is 1254 square, the others 1024)."""
    if painting.startswith("characters/"):
        return griffin_parts(look, painting, 1.0)
    s = look.alpha.shape[1] / 1024
    figure = None
    if painting.startswith("gear-portraits/"):
        figure = griffin_figure(look.rgba, draft[..., 2] / 255.0, painting, s)
        look = Look(look.rgba, figure > 0.5)
    whole = look.alpha
    gear = griffin_gear(look, painting, s)
    take = boxes(painting, "gear", gear.shape)
    if take is not None:  # a pendant or buckle lying on his coat, as pale as it: what its outline shuts in
        gear |= ndimage.binary_fill_holes(take & (look.L < 0.45)) & take & whole
    give = boxes(painting, "feathers", gear.shape)
    if give is not None:  # his own blue, painted as indigo as the hood
        gear &= ~(give & (look.hue > -150) & (look.hue < -60) & (look.C >= 0.04))
    look = copy.copy(look)
    look.alpha = whole & ~gear
    coat_, feathers = griffin_parts(look, painting, s)
    # these paintings' outlines are thin (2px): a 2px lip over the ink under each part's edge,
    # so the soft edge fades out over the dark line, not over his last light pixels
    lip = look.ink & whole
    coat_ |= ndimage.binary_dilation(coat_, structure=disk(2)) & lip & ~feathers
    feathers |= ndimage.binary_dilation(feathers, structure=disk(2)) & lip & ~coat_
    if figure is None:
        return coat_, feathers
    # an opaque portrait has no alpha to fade his edge into the backdrop: each part reaches
    # 2px past the figure's edge, so its soft edge falls where the figure's does and no pale
    # rim of untinted fur is left along it
    out = ~whole
    r = max(1, round(2 * s))
    coat_ |= ndimage.binary_dilation(coat_, structure=disk(r)) & out
    feathers |= ndimage.binary_dilation(feathers, structure=disk(r)) & out & ~coat_
    return coat_, feathers, figure


def griffin_parts(look: Look, painting: str, s: float) -> tuple[np.ndarray, np.ndarray]:
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
    4. The yellow wings stay as painted: the owner chose the blue plumage as the accent.
    On a class painting or gear portrait (`clean_griffin` has cut his costume out of `look`):
    a big blue piece is plumage only if as strong and deep as it (median C >= 0.062,
    L < 0.66): a cloak casts a blue shadow on his pale coat. Pixel sizes are at 1024 square
    and scaled by `s`."""
    base = painting.startswith("characters/")
    px, area = (lambda r: max(1, round(r * s))), (lambda n: n * s * s)
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
        if comp.sum() < area(2500):
            continue
        if np.nonzero(comp)[0].mean() > y1 - 0.12 * (y1 - y0):  # talons
            continue
        if not base and (np.median(C[comp]) < 0.062 or np.median(L[comp]) >= 0.66):
            continue  # a costume's blue shadow cast on his pale coat
        keep |= comp
    # the plumage's smaller pieces, cut off by a line or an ear, beside its big ones: as deep
    # a blue as the plumage (the shading on his chest and the stars are lighter)
    raw = a & blue & (C >= 0.05) & (L >= 0.3) & (L < 0.76)
    labs, n = ndimage.label(raw)
    if n:
        i = np.arange(1, n + 1)
        near = ndimage.minimum(ndimage.distance_transform_edt(~keep), labs, i) <= px(40)
        deep = (ndimage.mean(L, labs, i) < 0.56) & (ndimage.mean(C, labs, i) >= 0.06)
        add = np.zeros(n + 1, bool)
        add[1:] = near & deep & (ndimage.sum(raw, labs, i) >= area(20))
        keep |= add[labs] & (rows < y1 - 0.12 * (y1 - y0))
    reach = ndimage.binary_dilation(keep, structure=disk(px(12)))
    grow = a & ~yellow & ((blue & (C >= 0.04)) | (L < 0.5)) & reach
    feathers = ndimage.binary_propagation(keep, mask=grow | keep)
    feathers = ndimage.binary_closing(feathers, structure=disk(px(2)))
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
        glint = (size < area(400)) & (mL > 0.75) & (ndimage.mean(C, labs, i) < 0.03)  # a catch-light
        small[1:] = (size < area(2500)) & (dark | glint)
        eyes = ndimage.binary_dilation(small[labs], structure=disk(px(2)))

    never = yellow | eyes | (look.ink & ~feathers)
    cand = a & ~feathers & ~never & (L >= 0.45)
    labs, n = ndimage.label(cand)
    coat_ = np.zeros_like(a)
    if n:
        sizes = ndimage.sum(cand, labs, np.arange(1, n + 1))
        big = np.zeros(n + 1, bool)
        big[1:] = sizes >= max(area(1500), 0.02 * sizes.max())
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
        to_f[1:] = (d_f <= px(8)) & (d_f <= d_c)
        to_c[1:] = (d_c <= px(8)) & (d_c < d_f)
        feathers |= to_f[labs]
        coat_ |= to_c[labs]

    left = a &~coat_ & ~feathers & ~never & (L >= 0.36)
    d_coat = ndimage.distance_transform_edt(~coat_)
    d_feat = ndimage.distance_transform_edt(~feathers)
    coat_ |= left & (d_coat <= px(5)) & (d_coat <= d_feat)
    feathers |= left & (d_feat <= px(5)) & (d_feat < d_coat)
    line = look.outline(light=0.7)
    return coat_ & ~line, feathers & ~line


def griffin_figure(rgba: np.ndarray, drafted: np.ndarray, painting: str, s: float) -> np.ndarray:
    """A gear portrait's figure (B), 0..1, redrawn: everything but the painted backdrop.

    The backdrop is a dark navy wash with a soft vignette. The draft's flood fill steps from
    pixel to pixel and so drifts into anything as dark (the duskrunner's navy cloak and hood);
    here every pixel is measured against one smooth model of the backdrop instead.
    1. The model: a quadratic in x and y per OKLab channel, fitted (robustly) on what the
       draft called backdrop.
    2. Backdrop: pixels within 0.04 of the model (median of 3), opened by a 3px disk to cut
       the bridges through gaps in his outline, those that reach the canvas edge, then grown
       back to the paint they were opened off.
    3. Pockets: the backdrop seen between his legs or through a prop's ring, shut in by the
       figure: a piece of that opened paint that does not reach the edge, of 270px and more,
       as close to the model (mean < 0.025), as grey (chroma < 0.027) and as smooth (5px
       lightness spread < 0.018) as the backdrop. A cloak is bluer and painted in folds.
    4. The figure is the rest, less specks of under 2000px and anything touching the canvas
       edge, and less the `backdrop` fix boxes (a hummingbird painted in the backdrop);
       softened like the parts.
    Pixel sizes are at 1024 square and scaled by `s`."""
    h, w = rgba.shape[:2]
    lab = coat.srgb_to_oklab(rgba[..., :3] / 255.0)
    yy, xx = np.mgrid[0:h, 0:w] / max(h, w)
    X = np.stack([np.ones_like(xx), xx, yy, xx * xx, yy * yy, xx * yy], -1).reshape(-1, 6)
    known = np.nonzero((drafted < 0.05).ravel())[0][::7]
    model = np.zeros_like(lab)
    for c in range(3):
        A, y = X[known], lab[..., c].ravel()[known]
        for _ in range(3):  # refit without the outliers (whatever the draft let in)
            coef = np.linalg.lstsq(A, y, rcond=None)[0]
            res = np.abs(A @ coef - y)
            ok = res < np.percentile(res, 80) * 2.5
            A, y = A[ok], y[ok]
        model[..., c] = (X @ coef).reshape(h, w)
    dist = np.sqrt(((lab - model) ** 2).sum(-1))
    near = ndimage.median_filter(dist, 3) < 0.04
    r = max(1, round(3 * s))
    core = ndimage.binary_opening(near, structure=disk(r))
    edge = np.zeros((h, w), bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    back = ndimage.binary_propagation(core & edge, mask=core)

    labs, n = ndimage.label(core & ~back)
    if n:
        i = np.arange(1, n + 1)
        L = lab[..., 0]
        mu = ndimage.uniform_filter(L, 7)
        spread = np.sqrt(np.maximum(ndimage.uniform_filter(L * L, 7) - mu * mu, 0))
        chroma = np.hypot(lab[..., 1], lab[..., 2])
        pocket = np.zeros(n + 1, bool)
        pocket[1:] = ((ndimage.sum(core, labs, i) >= 270 * s * s)
                      & (ndimage.mean(dist, labs, i) < 0.025)
                      & (ndimage.median(chroma, labs, i) < 0.027)
                      & (ndimage.median(spread, labs, i) < 0.018))
        back |= pocket[labs]
    back = ndimage.binary_propagation(back, mask=near & ndimage.binary_dilation(back, structure=disk(r + 1)))

    figure = ~back
    labs, n = ndimage.label(figure)
    if n:
        i = np.arange(1, n + 1)
        keep = np.zeros(n + 1, bool)
        keep[1:] = ndimage.sum(figure, labs, i) >= 2000 * s * s
        keep[np.unique(labs[edge])] = False
        figure = keep[labs]
    gone = boxes(painting, "backdrop", figure.shape)
    if gone is not None:  # a piece apart from him, inside the box
        labs, n = ndimage.label(figure)
        him = labs == int(np.argmax(ndimage.sum(figure, labs, np.arange(1, n + 1)))) + 1
        figure &= ~(gone & ~him)
    return ndimage.gaussian_filter(figure.astype(float), SOFTEN)


def griffin_gear(look: Look, painting: str, s: float) -> np.ndarray:
    """His class costume, gear and props on a class painting or gear portrait, never coloured.

    Griffin paint is his feather blue (OKLab hue -140..-100, chroma >= 0.04), his pale coat
    and its blue-grey shading, and the yellow of his wings, beak and talons. A costume is
    painted in other colours: the duskrunner's navy (hue beyond -100), the starweaver's teal,
    the thornguard's browns and moss, and any thick dark paint (straps, the darkest cloaks).
    1. Seeds: that paint, opened to cut thin bridges, in pieces of 1500px and more.
    2. Grown over everything that is not griffin paint and not a thin ink line, opened by a
       1px disk so it never creeps along the thin blend of fur into outline round his edges.
    3. Its holes under 3000px (stars, crescents, buckles, emblems, rivets) go with it.
    `s` scales pixel sizes to the canvas (a gear portrait is 1254 square)."""
    a, L, C, hue = look.alpha, look.L, look.C, look.hue
    ink = look.ink & a
    r = max(2, round(2 * s))
    feather = (hue > -140) & (hue < -100) & (C >= 0.04) & (L >= 0.36)
    pale = (L >= 0.62) & ((C < 0.025) | ((hue > -150) & (hue < -80) & (C < 0.07)))
    yellow = (C >= 0.04) & (hue > 40) & (hue < 120) & (L >= 0.55)
    griffin = feather | pale | yellow
    navy = (hue > -100) & (hue < -20) & (C >= 0.02) & (L < 0.62)
    teal = (C >= 0.03) & ((hue < -138) | (hue > 140))
    brown = (L < 0.62) & (hue > -20) & (hue < 140) & (C >= 0.02)
    dark = ndimage.binary_opening(ink, structure=disk(r))
    seed = ndimage.binary_opening((a & ~ink & (navy | teal | brown)) | (a & dark), structure=disk(r))
    labs, n = ndimage.label(seed)
    if n:
        sizes = ndimage.sum(seed, labs, np.arange(1, n + 1))
        seed = np.isin(labs, np.nonzero(sizes >= 1500 * s * s)[0] + 1)
    # (opened, so it never creeps along the thin blend of fur into outline round his edges)
    grow = ndimage.binary_opening(a & ~griffin & ~(ink & ~dark), structure=disk(1))
    gear = ndimage.binary_propagation(seed, mask=grow | seed)
    holes = ndimage.binary_fill_holes(gear) & ~gear
    labs, n = ndimage.label(holes)
    if n:
        sizes = ndimage.sum(holes, labs, np.arange(1, n + 1))
        gear |= np.isin(labs, np.nonzero(sizes < 3000 * s * s)[0] + 1)
    # gems: small pieces of any paint set in gold (ringed mostly by yellow), such as the blue
    # stone in the songkeeper's Mythic clasp, as blue as his feathers
    gold = ndimage.binary_dilation(a & yellow & (C >= 0.06), structure=disk(r))
    labs, n = ndimage.label(a & ~gold & ~gear)
    if n:
        i = np.arange(1, n + 1)
        ring = ndimage.binary_dilation(labs > 0, structure=disk(r)) & ~(labs > 0)
        near = ndimage.grey_dilation(labs, footprint=disk(r))
        set_in = np.zeros(n + 1)
        set_in[1:] = ndimage.mean(gold[ring], near[ring], i)
        small = np.zeros(n + 1, bool)
        small[1:] = ndimage.sum(labs > 0, labs, i) < 1500 * s * s
        gem = (small & (set_in >= 0.85))[labs]
        gear |= ndimage.binary_dilation(gem, structure=disk(r)) & ~gold
    return gear & a


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
    parts = RULES[species](Look(rgba, draft[..., 2] > 127), draft, painting)
    main, accent = parts[0], parts[1]
    # (a species may return a better figure, 0..1, as a third value: the unicorn does on her
    # gear portraits, where the draft's backdrop flood bites into her and leaves dark backdrop in)
    B = parts[2] if len(parts) > 2 else draft[..., 2].astype(float) / 255.0
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
