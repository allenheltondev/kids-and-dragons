"""Helpers for keeping exact-pose rig residuals on the correct bones."""

from __future__ import annotations

import numpy as np
from PIL import Image


def keep_body_residual(
    parts: dict[str, Image.Image],
    residual_alpha: np.ndarray,
    envelope: tuple[int, int, int, int],
) -> Image.Image:
    """Keep upper-body overhangs together and return their alpha mask.

    Exact-pose portraits rarely match the base anatomy masks pixel-for-pixel.
    Treating every pixel outside those masks as torso armor makes slivers of
    feet, tails, and mane ride the body bone. They become visible below the
    standing line when the real limb moves away.

    Pixels outside the commissioned armor/companion envelope are assigned to
    the nearest existing anatomy part. Alpha is combined as source-over, so the
    registered rest composite remains pixel-exact while motion follows the
    appropriate bone.
    """
    height, width = residual_alpha.shape
    left, top, right, bottom = envelope
    yy, xx = np.indices((height, width))
    body_bound = (xx >= left) & (xx < right) & (yy >= top) & (yy < bottom)
    moving_alpha = np.where(body_bound, 0, residual_alpha).astype(np.uint8)
    kept_alpha = np.where(body_bound, residual_alpha, 0).astype(np.uint8)

    names = tuple(parts)
    assignments = np.zeros((height, width), dtype=np.int16)
    for index, name in enumerate(names, 1):
        alpha = np.asarray(parts[name].getchannel("A")) > 0
        assignments[(assignments == 0) & alpha] = index

    # Grow every anatomy label by one Manhattan pixel per pass. Residuals sit
    # immediately along anatomy edges, so this reaches every target quickly
    # without the heavyweight image-distance dependencies the art scripts avoid.
    targets = moving_alpha > 0
    while np.any(targets & (assignments == 0)):
        previous = assignments
        grown = previous.copy()
        for source, target in (
            (previous[:-1, :], grown[1:, :]),
            (previous[1:, :], grown[:-1, :]),
            (previous[:, :-1], grown[:, 1:]),
            (previous[:, 1:], grown[:, :-1]),
        ):
            take = (target == 0) & (source != 0)
            target[take] = source[take]
        assignments = grown

    for index, name in enumerate(names, 1):
        existing = np.asarray(parts[name].getchannel("A"), dtype=np.uint16)
        assigned = np.where(assignments == index, moving_alpha, 0).astype(np.uint16)
        combined = 255 - (((255 - existing) * (255 - assigned) + 127) // 255)
        parts[name].putalpha(Image.fromarray(combined.astype(np.uint8), "L"))

    return Image.fromarray(kept_alpha, "L")
