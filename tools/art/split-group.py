"""Cut a group figure into one figure per member, for the story stage.

Some entity art is a whole group in one 1024 canvas (the Skywardens are a
griffin, a faun and a centaur side by side). Standing that on the stage as one
"medium" figure draws each member at a third of their width and short of a
hero, so the stage reads them as tiny. This cuts the group along the emptiest
vertical seams between members and writes each as its own cast figure under
the figure contract (docs/briefs/story-cast-art.md Part A): 1024 canvas, the
member filling the canvas height with feet on y=900, facing left.

    python tools/art/split-group.py assets/entities/skywardens/assembled.png \
        "--seam=330:480;420-610=399:404;625-745=381:392;775-796=436:452;797-900=424:430" "--seam=640:720;360-560=690:694" \
        --out cast/skywarden_griffin:flip --out cast/skywarden_faun --out cast/skywarden_centaur

`--seam a:b` is the column band to search for the cut between two neighbours,
left to right, with optional `;y0-y1=x0:x1` windows that hold those rows to
those columns where two members overlap; `--out id[:flip]` names each member in order, `flip` mirroring
one drawn facing right. Requires Pillow and NumPy.
"""

import argparse
import os
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CANVAS = 1024
FEET_Y = 900
TOP_Y = 60  # where the entities' heads sit: they fill 60..900
MARGIN = 12
ALPHA = 16


def seam(alpha: np.ndarray, lo: int, hi: int, windows=(), reach: int = 3) -> np.ndarray:
    """The column, per row, of the cheapest top-to-bottom path through [lo, hi).

    Cost is the alpha it cuts through, so the path runs down the gap between
    two members and crosses only where they actually touch. Each window
    `(y0, y1, x0, x1)` holds rows y0..y1 to columns x0..x1, for where two
    members overlap and the emptiest line is not the one between them.
    """
    band = alpha[:, lo:hi].astype(np.float64)
    h, w = band.shape
    for y0, y1, x0, x1 in windows:
        rows = band[y0 : y1 + 1]
        rows[:, : max(x0 - lo, 0)] = 1e9
        rows[:, x1 - lo + 1 :] = 1e9
    cost = band.copy()
    back = np.zeros((h, w), dtype=np.int64)
    for y in range(1, h):
        prev = cost[y - 1]
        best = np.full(w, np.inf)
        arg = np.zeros(w, dtype=np.int64)
        for d in range(-reach, reach + 1):
            shifted = np.full(w, np.inf)
            if d >= 0:
                shifted[: w - d] = prev[d:]
            else:
                shifted[-d:] = prev[: w + d]
            # A small toll per step sideways keeps the cut straight in open air.
            shifted = shifted + abs(d) * 0.5
            better = shifted < best
            best[better] = shifted[better]
            arg[better] = (np.arange(w) + d)[better]
        cost[y] += best
        back[y] = arg
    path = np.zeros(h, dtype=np.int64)
    path[-1] = int(np.argmin(cost[-1]))
    for y in range(h - 1, 0, -1):
        path[y - 1] = back[y, path[y]]
    return path + lo


def keep_main(mask: np.ndarray) -> np.ndarray:
    """Drop slivers of a neighbour the seam left behind: keep the components
    that are a real part of this member (at least a tenth of the largest)."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    sizes = [0]
    for sy, sx in zip(*np.nonzero(mask)):
        if labels[sy, sx]:
            continue
        n = len(sizes)
        labels[sy, sx] = n
        count = 0
        queue = deque([(sy, sx)])
        while queue:
            y, x = queue.popleft()
            count += 1
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = n
                    queue.append((ny, nx))
        sizes.append(count)
    biggest = max(sizes)
    keep = [i for i, s in enumerate(sizes) if i and s >= biggest * 0.1]
    return np.isin(labels, keep)


def place(rgba: np.ndarray) -> Image.Image:
    """Fit one member to the contract canvas: heads at TOP_Y, feet on FEET_Y."""
    ys, xs = np.nonzero(rgba[:, :, 3] > ALPHA)
    crop = Image.fromarray(rgba[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1])
    scale = min((FEET_Y - TOP_Y) / crop.height, (CANVAS - 2 * MARGIN) / crop.width)
    size = (round(crop.width * scale), round(crop.height * scale))
    crop = crop.resize(size, Image.LANCZOS)
    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    out.alpha_composite(crop, ((CANVAS - size[0]) // 2, FEET_Y - size[1] + 1))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source")
    parser.add_argument("--seam", action="append", default=[], help="lo:hi column band for one cut")
    parser.add_argument("--out", action="append", default=[], help="cast/<id>[:flip], left to right")
    args = parser.parse_args()
    if len(args.out) != len(args.seam) + 1:
        parser.error("one more --out than --seam")

    rgba = np.array(Image.open(args.source).convert("RGBA"))
    alpha = rgba[:, :, 3]
    h, w = alpha.shape
    cuts = [np.zeros(h, dtype=np.int64)]
    for spec in args.seam:
        band, *rest = spec.split(";")
        lo, hi = (int(v) for v in band.split(":"))
        windows = []
        for window in rest:
            ys, xs = window.split("=")
            windows.append((*(int(v) for v in ys.split("-")), *(int(v) for v in xs.split(":"))))
        cuts.append(seam(alpha, lo, hi, windows))
    cuts.append(np.full(h, w, dtype=np.int64))

    cols = np.arange(w)[None, :]
    for i, spec in enumerate(args.out):
        target, _, flag = spec.partition(":")
        region = (cols >= cuts[i][:, None]) & (cols < cuts[i + 1][:, None])
        body = keep_main(region & (alpha > ALPHA))
        # Grown by two pixels so the soft antialiased rim comes with the body.
        for _ in range(2):
            grown = body.copy()
            grown[1:] |= body[:-1]
            grown[:-1] |= body[1:]
            grown[:, 1:] |= body[:, :-1]
            grown[:, :-1] |= body[:, 1:]
            body = grown
        member = rgba.copy()
        member[:, :, 3] = np.where(body & region, alpha, 0)
        figure = place(member)
        if flag == "flip":
            figure = figure.transpose(Image.FLIP_LEFT_RIGHT)
        path = os.path.join(ROOT, "assets", target, "assembled.png")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        figure.save(path, optimize=True)
        print(f"{target}: cut at x~{int(np.median(cuts[i]))}..{int(np.median(cuts[i + 1]))} -> {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()
