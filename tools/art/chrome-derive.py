"""Derive chrome pieces that are a delivered piece with its painted middle keyed out.

The gold "your turn" strip (PlayerPanel.css, `.sheet--turn`) is the one signal the game uses for
"we are waiting on you", so it stays gold; the nameplate's brass frame goes round it instead. The
delivered nameplate (`strip-identity`) is the frame and a dark plum middle in one picture, so this
keys the plum out and keeps the brass, its corner leaves and the thin dark line inside the rim.

    python3 tools/art/chrome-derive.py

Writes `strip-identity-frame.webp` next to its source. Rerun it if `strip-identity.webp` changes.
"""

from pathlib import Path

import numpy as np
from PIL import Image

CHROME = Path(__file__).resolve().parents[2] / "packages/client/src/assets/chrome"
PLUM = np.array([32, 24, 49])


def frame_of(source: Path, target: Path) -> None:
    image = np.array(Image.open(source).convert("RGBA")).astype(np.int32)
    rgb, alpha = image[..., :3], image[..., 3]
    # Plum: near the interior's color, and dark. Brass is bright and warm, so it never matches.
    distance = np.abs(rgb - PLUM).sum(axis=-1)
    plum = (distance < 48) & (rgb.max(axis=-1) < 80)
    # A soft edge where the key meets the rim, so the gold does not show a hard seam.
    fade = np.clip((distance - 48) / 32.0, 0.0, 1.0)
    keyed = np.where(plum, 0, np.where(distance < 80, (alpha * fade).astype(np.int32), alpha))
    image[..., 3] = keyed
    Image.fromarray(image.astype(np.uint8), "RGBA").save(target, "WEBP", quality=90, alpha_quality=80, method=6)


if __name__ == "__main__":
    frame_of(CHROME / "strip-identity.webp", CHROME / "strip-identity-frame.webp")
