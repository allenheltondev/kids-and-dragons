"""Helpers for keeping exact-pose rig residuals on the correct bones."""

from __future__ import annotations

import numpy as np
from PIL import Image


def _manhattan_distance(alpha: np.ndarray) -> np.ndarray:
    """Return the distance to the nearest nonzero alpha pixel."""
    height, width = alpha.shape
    distance = np.where(alpha, 0, height + width).astype(np.int16)
    for y in range(1, height):
        distance[y] = np.minimum(distance[y], distance[y - 1] + 1)
    for y in range(height - 2, -1, -1):
        distance[y] = np.minimum(distance[y], distance[y + 1] + 1)
    for x in range(1, width):
        distance[:, x] = np.minimum(distance[:, x], distance[:, x - 1] + 1)
    for x in range(width - 2, -1, -1):
        distance[:, x] = np.minimum(distance[:, x], distance[:, x + 1] + 1)
    return distance


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
    nearest = np.full((height, width), height + width + 1, dtype=np.int16)
    for index, name in enumerate(names, 1):
        distance = _manhattan_distance(np.asarray(parts[name].getchannel("A")) > 0)
        closer = distance < nearest
        assignments[closer] = index
        nearest[closer] = distance[closer]

    for index, name in enumerate(names, 1):
        existing = np.asarray(parts[name].getchannel("A"), dtype=np.uint16)
        assigned = np.where(assignments == index, moving_alpha, 0).astype(np.uint16)
        combined = 255 - (((255 - existing) * (255 - assigned) + 127) // 255)
        parts[name].putalpha(Image.fromarray(combined.astype(np.uint8), "L"))

    return Image.fromarray(kept_alpha, "L")
