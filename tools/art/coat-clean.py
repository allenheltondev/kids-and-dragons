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
#   "coat"     unicorn: inside the box, her soft lavender is coat (inner ears, the far belly)
#   "nose"     manticore: inside the box, the crimson paint is her nose, in neither part
#   "gear"     manticore: inside the box, everything is her costume or gear, in neither part
#   "figure"   manticore, gear portraits: inside the box, the figure (B) is closed over wide gaps

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
    # her nose on her class paintings and gear portraits (#679)
    "character-rigs/thornguard/sworn/manticore/assembled.png": {"nose": [(360, 402, 205, 262)]},
    "character-rigs/thornguard/radiant/manticore/assembled.png": {"nose": [(345, 388, 164, 228)]},
    "character-rigs/thornguard/mythic/manticore/assembled.png": {"nose": [(360, 405, 150, 216)]},
    "character-rigs/duskrunner/sworn/manticore/assembled.png": {"nose": [(354, 396, 199, 266)]},
    "character-rigs/duskrunner/radiant/manticore/assembled.png": {"nose": [(357, 400, 134, 203)]},
    "character-rigs/duskrunner/mythic/manticore/assembled.png": {"nose": [(361, 400, 162, 227)]},
    "character-rigs/starweaver/sworn/manticore/assembled.png": {"nose": [(358, 425, 195, 266)]},
    "character-rigs/starweaver/radiant/manticore/assembled.png": {"nose": [(352, 397, 114, 181)]},
    "character-rigs/starweaver/mythic/manticore/assembled.png": {"nose": [(345, 394, 154, 223)]},
    "character-rigs/songkeeper/sworn/manticore/assembled.png": {"nose": [(352, 396, 185, 254)]},
    "character-rigs/songkeeper/radiant/manticore/assembled.png": {"nose": [(339, 382, 165, 232)]},
    "character-rigs/songkeeper/mythic/manticore/assembled.png": {"nose": [(345, 388, 195, 264)]},
    "gear-portraits/thornguard/sworn/manticore.png": {"nose": [(442, 495, 216, 296)]},
    "gear-portraits/thornguard/radiant/manticore.png": {"nose": [(440, 493, 200, 280)]},
    "gear-portraits/thornguard/mythic/manticore.png": {"nose": [(441, 497, 184, 265)]},
    "gear-portraits/duskrunner/sworn/manticore.png": {"nose": [(427, 482, 241, 329)]},
    "gear-portraits/duskrunner/radiant/manticore.png": {"nose": [(431, 488, 157, 246)]},
    "gear-portraits/duskrunner/mythic/manticore.png": {"nose": [(437, 487, 193, 278)], "figure": [(420, 780, 600, 990), (740, 900, 840, 1010)]},
    "gear-portraits/starweaver/sworn/manticore.png": {"nose": [(471, 563, 170, 258)]},
    "gear-portraits/starweaver/radiant/manticore.png": {"nose": [(470, 520, 112, 185)]},
    "gear-portraits/starweaver/mythic/manticore.png": {"nose": [(470, 520, 120, 192)]},
    "gear-portraits/songkeeper/sworn/manticore.png": {"nose": [(467, 520, 281, 362)]},
    "gear-portraits/songkeeper/radiant/manticore.png": {"nose": [(465, 512, 243, 308)]},
    "gear-portraits/songkeeper/mythic/manticore.png": {"nose": [(465, 518, 200, 282)]},
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

def clean_manticore(look: Look, draft: np.ndarray, painting: str) -> tuple[np.ndarray, ...]:
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
      fur inside an outline. The whisker dots on her muzzle are fur.

    Dressed (class `character-rigs/` and gear `gear-portraits/` paintings, #679):
    - Her class costume, gear and props stay as painted, in neither part: see `manticore_gear`.
      Red cloth, a red gem or a tassel is gear too, however close to her colours.
    - Pixel sizes (radii, the smallest pieces) scale with the canvas: a gear portrait is 1254
      square, the base and class paintings 1024.
    - A gear portrait's figure is redrawn (`manticore_figure`): the draft's flood from the edges
      runs into a dark cloak painted as dark as the backdrop. It is returned as a third channel."""
    a = look.alpha
    s = a.shape[0] / 1024  # 1 on the base and class paintings; a gear portrait is 1254 square

    def px(n: int) -> int:
        return max(1, round(n * s))

    def area(n: int) -> int:
        return round(n * s * s)

    dressed = not painting.startswith("characters/")  # a class painting or gear portrait
    figure = None
    if painting.startswith("gear-portraits/"):
        figure = manticore_figure(look, draft, s, painting)
        look = Look(look.rgba, figure > 0.5)
        a = look.alpha
    ys = np.nonzero(a)[0]
    y0, y1 = ys.min(), ys.max()
    rows = np.arange(a.shape[0])[:, None]
    paws = rows > y1 - 0.14 * (y1 - y0)
    tail = manticore_tail(look)
    gear = manticore_gear(look, painting, s, tail) if dressed else np.zeros_like(a)

    eyes = manticore_eyes(look, s)
    if dressed:
        # (dressed, a dark tuft or gem with a glint in it is no eye: her eyes are in her head)
        eyes &= rows < y0 + 0.45 * (y1 - y0)
    nose = np.zeros_like(a)
    box = boxes(painting, "nose", a.shape)
    if box is not None:
        nose = box & a & (look.hue > 12) & (look.hue < 35) & (look.C > 0.085) & (look.L < 0.75)
        nose = ndimage.binary_fill_holes(ndimage.binary_closing(nose, structure=disk(px(2)))) & box
        labs, n = ndimage.label(nose)
        if n:  # the nose itself, not the whisker dots beside it, with its dark nostrils
            nose = labs == int(np.argmax(ndimage.sum(nose, labs, np.arange(1, n + 1)))) + 1
            nose |= ndimage.binary_dilation(nose, structure=disk(px(6))) & box & (look.L < 0.5)
            nose = ndimage.binary_fill_holes(ndimage.binary_closing(nose, structure=disk(px(3))))
        nose &= a

    g = (draft[..., 1] > 96) & a & ~tail & ~gear
    if dressed:
        # (on a dark costume the draft runs on from her mane over the dark leather and cloth
        # beside it: the mane's own darkest strokes are still crimson, dark grey-brown is not)
        g &= ~(look.ink & (look.C < 0.05))
    labs, n = ndimage.label(g)
    mane = np.zeros_like(a)
    claws = np.zeros_like(a)
    if n:
        idx = np.arange(1, n + 1)
        sizes = ndimage.sum(g, labs, idx)
        core = labs == int(np.argmax(sizes)) + 1
        near_core = ndimage.binary_dilation(core, structure=disk(px(30)))
        mane |= core
        for i in idx:
            comp = labs == i
            if comp.sum() < area(40) or (comp & core).any():
                continue
            cy, cx = np.nonzero(comp)
            if cy.mean() > y1 - 0.14 * (y1 - y0):
                # (dressed, the draft also finds a cloak's dark hem down there: a claw is small
                # and crimson)
                hue_ = np.median(look.hue[comp])
                if not dressed or (comp.sum() < area(2500) and 12 < hue_ < 35):
                    claws |= comp
                continue
            if np.median(look.hue[comp]) > 32 or np.median(look.L[comp]) >= 0.47:
                continue
            if dressed and np.median(look.hue[comp]) < 5:  # (navy or grey, not crimson)
                continue
            wide = (cx.max() - cx.min()) > (cy.max() - cy.min())
            dark = comp.sum() >= area(500) and np.median(look.L[comp]) < 0.4
            if dark or (comp & near_core).any() or (wide and cy.mean() < y0 + 0.5 * (y1 - y0)):
                mane |= comp
    # the claws, whole: their crimson paint within the paws, beside the drafted claws
    crimson = a & paws & ~gear & (look.hue > 12) & (look.hue < 35) & (look.C > 0.06) & (look.L < 0.7)
    claws = ndimage.binary_propagation(claws, mask=crimson | claws)
    claws = ndimage.binary_dilation(ndimage.binary_fill_holes(claws), structure=SQUARE) & a
    never = tail | claws | eyes | nose | gear
    mane = manticore_fill_holes(ndimage.binary_closing(mane, structure=SQUARE), area(400)) & a & ~never
    # Mythic: black crystal shards in her mane (grey paint with pale facets) are in neither;
    # the dark grey streaks between her locks are the mane's own shadow, and go with it
    grey = a & (look.C < 0.045) & ~never
    labs, n = ndimage.label(grey)
    if n:
        i = np.arange(1, n + 1)
        faceted = np.zeros(n + 1, bool)
        # (a dark piece with pale facets: her face's white fur is pale all over)
        faceted[1:] = ((ndimage.sum(grey & (look.L > 0.5), labs, i) >= area(20))
                       & (ndimage.mean(look.L, labs, i) < 0.45)
                       & (ndimage.sum(grey, labs, i) >= area(300)))
        if dressed:
            # (a shard is small: dressed, the grey runs on into a cloak's ink and pale legs)
            faceted[1:] &= ndimage.sum(grey, labs, i) < area(5000)
        by_mane = np.zeros(n + 1, bool)
        by_mane[np.unique(labs[ndimage.binary_dilation(mane, structure=disk(px(3))) & grey])] = True
        by_mane[0] = False
        shards = (faceted & by_mane)[labs]
        shards = ndimage.binary_fill_holes(ndimage.binary_closing(shards, structure=disk(px(2))))
        shards = ndimage.binary_dilation(shards, structure=SQUARE) & a
        # (the crimson glints in a shard are her mane seen through it, and take its colour)
        glint = shards & (look.hue > -5) & (look.hue < 35) & (look.C > 0.08)
        shards &= ~glint
        never |= shards
        mane = (mane & ~shards) | glint
        inside = ndimage.binary_closing(mane, structure=disk(px(6))) & ~shards
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
    edge = ndimage.binary_dilation(mane, structure=disk(px(3))) & (dm < 8)
    pink = (a & ~mane & ~never & ~look.ink & ~edge & (look.hue > -15) & (look.hue < 30)
            & (look.L >= 0.4) & (look.C < 0.13))
    fur |= ndimage.binary_propagation(fur, mask=pink | fur)
    if dressed:
        # dressed, her costume cuts pieces of her off (the belly under a cape, the far legs
        # between its folds): pink pieces of 400px or more are fur wherever they are
        labs, n = ndimage.label(pink & ~fur)
        if n:
            i = np.arange(1, n + 1)
            keep = np.zeros(n + 1, bool)
            keep[1:] = (ndimage.sum(labs > 0, labs, i) >= area(400)) & (ndimage.mean(look.L, labs, i) >= 0.45)
            fur |= keep[labs]

    left = a & ~mane & ~fur & ~never & ~look.ink & (look.hue > -15) & (look.hue < 35)
    d_fur = ndimage.distance_transform_edt(~fur)
    d_mane = ndimage.distance_transform_edt(~mane)
    fur |= left & (d_fur <= 5 * s) & (d_fur <= d_mane)
    mane |= left & (d_mane <= 5 * s) & (d_mane < d_fur)
    # ink drawn as an outline is in neither part, except a 2px lip of it under each part's
    # edge: the soft edge then fades out over dark ink, not over the last light pixels of fur
    line = look.outline(light=0.7)
    fur &= ~line
    mane &= ~line
    # (the whisker dots on her muzzle: small holes in the fur, not ink, are fur)
    fur |= manticore_fill_holes(fur, area(80)) & ~fur & ~never & ~mane & ~look.ink
    face = eyes | nose
    lid = face & (look.L < 0.45) & ~ndimage.binary_erosion(face, structure=disk(px(2)))
    # (the lip may run onto the gear's own ink outline, never onto its paint)
    lip = (line & ~(never & ~(gear & look.ink))) | lid
    fur_lip = ndimage.binary_dilation(fur, structure=disk(px(2))) & lip
    mane_lip = ndimage.binary_dilation(mane, structure=disk(px(2))) & lip & ~fur_lip
    fur, mane = (fur | fur_lip) & ~mane, mane | mane_lip
    if figure is not None:
        return fur, mane, figure
    return fur, mane


def manticore_eyes(look: Look, s: float = 1.0) -> np.ndarray:
    """Her eyes, never coloured: each a dark blob (OKLab L < 0.5: the iris, pupil and lid line,
    whose browns are as warm as her mane) of under 6000px with a white catchlight inside it,
    filled, so the green or brown ring of the iris goes with it. The blobs are found with the
    thin lines opened away (her near eye touches the line of her cheek), then given back the
    dark paint beside them, but not the pale lids around them (those are fur)."""
    a = look.alpha
    r = lambda n: max(1, round(n * s))  # noqa: E731  (radii scale with the canvas)
    dark = a & (look.L < 0.5)
    blobs = ndimage.binary_opening(dark, structure=disk(r(2)))
    labs, n = ndimage.label(blobs)
    eyes = np.zeros_like(a)
    if not n:
        return eyes
    sizes = ndimage.sum(blobs, labs, np.arange(1, n + 1))
    white = a & (look.L > 0.85) & (look.C < 0.035)
    h, w = a.shape
    for i, sl in enumerate(ndimage.find_objects(labs), start=1):
        if sl is None or sizes[i - 1] >= 6000 * s * s:
            continue
        sl = (slice(max(sl[0].start - r(6), 0), min(sl[0].stop + r(6), h)),
              slice(max(sl[1].start - r(6), 0), min(sl[1].stop + r(6), w)))
        comp = labs[sl] == i
        # (closed first: a pale iris can leave the ring open beside the catchlight)
        filled = ndimage.binary_fill_holes(ndimage.binary_closing(comp, structure=disk(r(4))))
        if (filled & ~comp & white[sl]).any():
            eyes[sl] |= filled
    near = ndimage.binary_dilation(eyes, structure=disk(r(3)))
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


def manticore_gear(look: Look, painting: str, s: float, tail: np.ndarray) -> np.ndarray:
    """Her class costume, gear and props (and a Thornguard's bird), never coloured.

    Off her colours: paint with OKLab chroma >= 0.025 outside her hues (pink fur ~0..25,
    crimson mane ~15..35), so gold, bronze, teal, navy, green and brown; and grey metal
    (chroma < 0.012; her palest fur keeps ~0.014). Between the ink lines, every piece that is
    mostly off her colours is gear, with its highlights, and so is every small piece shut in
    by gear (a red gem, a tassel's bead), and the ink around it. The `gear` fix boxes add
    what no rule can tell from her (red cloth, a feather charm)."""
    a, L, C, hue = look.alpha, look.L, look.C, look.hue
    ink = look.ink
    off = a & ~ink & ~tail & (((C >= 0.025) & ((hue > 40) | (hue < -20))) | ((C < 0.012) & (L < 0.97)))
    lines = ndimage.binary_dilation(ink, structure=SQUARE)
    regions, rn = ndimage.label(a & ~lines)
    gear = np.zeros_like(a)
    if rn:
        idx = np.arange(1, rn + 1)
        share = np.zeros(rn + 1)
        share[1:] = ndimage.mean(off, regions, idx)
        gear = (share >= 0.5)[regions] & (regions > 0)
    # a cloak painted as dark as ink (a Duskrunner's navy) is gear where it is big
    dark = a & ink & ~tail & (C >= 0.025) & ((hue > 40) | (hue < -20))
    labs, n = ndimage.label(ndimage.binary_closing(dark, structure=SQUARE))
    if n:
        big = np.zeros(n + 1, bool)
        big[1:] = ndimage.sum(labs > 0, labs, np.arange(1, n + 1)) >= 800 * s * s
        gear |= big[labs] & dark
    # ...and so is the near-black of a hood or cloak, broad where her ink is drawn in lines
    black = ndimage.binary_opening(a & ink & ~tail & (C < 0.04), structure=disk(max(1, round(4 * s))))
    labs, n = ndimage.label(black)
    if n:
        big = np.zeros(n + 1, bool)
        big[1:] = ndimage.sum(labs > 0, labs, np.arange(1, n + 1)) >= 3000 * s * s
        gear |= big[labs]
    off |= dark
    # and the gold fringe and beads hanging in her mane, where no line parts them from it
    labs, n = ndimage.label(off & ~ink)
    if n:
        big = np.zeros(n + 1, bool)
        big[1:] = ndimage.sum(labs > 0, labs, np.arange(1, n + 1)) >= 150 * s * s
        gear |= big[labs]
    gear |= ndimage.binary_propagation(gear, mask=off | gear)
    # ...but where no line parts her from it (her rump fur under a mantle's edge), the big
    # pieces of her own pink and crimson inside it are hers
    hers = a & ~ink & ~off & (C >= 0.02) & (hue > -15) & (hue < 34)
    labs, n = ndimage.label(gear & hers)
    if n:
        big = np.zeros(n + 1, bool)
        big[1:] = ndimage.sum(labs > 0, labs, np.arange(1, n + 1)) >= 1500 * s * s
        gear &= ~big[labs]
    gear = ndimage.binary_closing(gear, structure=disk(max(1, round(2 * s))))
    # the ink inside and around the gear is the gear's
    gear |= ndimage.binary_dilation(gear, structure=SQUARE, iterations=max(1, round(2 * s))) & ink
    # small pieces shut in by gear and ink (gems, beads, a stitch of red) are gear
    gear = manticore_fill_holes(gear | (ink & ndimage.binary_dilation(gear, structure=disk(round(6 * s)))), round(900 * s * s)) & ~(ink & ~gear)
    add = boxes(painting, "gear", a.shape)
    if add is not None:
        gear |= add & a
    return gear & a & ~tail


def manticore_figure(look: Look, draft: np.ndarray, s: float, painting: str = "") -> np.ndarray:
    """A gear portrait's figure (B), 0..1, redrawn. The draft's flood from the canvas edges stops
    at any colour step, so it runs into a cloak painted nearly as dark as the backdrop (a
    Duskrunner's navy) and never reaches the backdrop shut in between her legs or her tail and
    back. The backdrop is one smooth dark colour with a faint texture: it is modelled from what
    the draft called backdrop (a quadratic over the canvas, per OKLab channel), and the figure is
    the paint that differs from it by more than 0.02 over a 7px window, less her cast shadow
    (the backdrop's own colour, darker and smooth), in pieces of 2000px or more, closed, its
    small holes filled (a big hole is backdrop seen through her), and softened."""
    rgb = look.rgba[..., :3] / 255.0
    lab = coat.srgb_to_oklab(rgb)
    h, w = lab.shape[:2]
    drafted = draft[..., 2].astype(float) / 255.0
    back = ndimage.binary_erosion(drafted < 0.02, iterations=round(8 * s))
    yy, xx = np.mgrid[0:h, 0:w] / max(h, w)
    feats = np.stack([np.ones_like(xx), xx, yy, xx * xx, yy * yy, xx * yy], -1)
    sample = feats[back][::7]
    model = np.zeros_like(lab)
    for k in range(3):
        coef, *_ = np.linalg.lstsq(sample, lab[..., k][back][::7], rcond=None)
        model[..., k] = feats @ coef
    smooth = np.stack([ndimage.uniform_filter(lab[..., k], 7) for k in range(3)], -1)
    diff = smooth - model
    fig = np.sqrt((diff ** 2).sum(-1)) > 0.02
    L = lab[..., 0]
    mean = ndimage.uniform_filter(L, 9)
    rough = np.sqrt(np.maximum(ndimage.uniform_filter(L * L, 9) - mean * mean, 0))
    # (her shadow is cast on the ground: below the middle of her, where a cloak's smooth folds
    # as dark as the backdrop are rarer)
    ys = np.nonzero(fig)[0]
    low = (np.arange(h) > ys.min() + 0.55 * (ys.max() - ys.min()))[:, None] if ys.size else np.zeros((h, 1), bool)
    shadow = (diff[..., 0] < -0.01) & (np.hypot(diff[..., 1], diff[..., 2]) < 0.012) & (rough < 0.006) & low
    fig &= ~ndimage.binary_opening(shadow, structure=disk(round(4 * s)))
    fig = ndimage.binary_opening(fig, structure=disk(2))
    labs, n = ndimage.label(fig)
    if n:
        sizes = ndimage.sum(fig, labs, np.arange(1, n + 1))
        fig = np.isin(labs, np.nonzero(sizes >= 2000 * s * s)[0] + 1)
    fig = ndimage.binary_closing(fig, structure=disk(round(12 * s)))
    fig = manticore_fill_holes(fig, round(6000 * s * s))
    box = boxes(painting, "figure", fig.shape)
    if box is not None:  # a dark edge of cloth faint against the backdrop, closed by hand
        fig |= box & ndimage.binary_fill_holes(ndimage.binary_closing(fig, structure=disk(round(24 * s))))
    return ndimage.gaussian_filter(fig.astype(float), 1.5)


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
