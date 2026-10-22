"""Derive chrome pieces from delivered ones, where the CSS needs a piece the art has as part of
a bigger picture.

- The gold "your turn" strip (PlayerPanel.css, `.sheet--turn`) is the one signal the game uses for
  "we are waiting on you", so it stays gold; the nameplate's brass frame goes round it instead. The
  delivered nameplate (`strip-identity`) is the frame and a dark plum middle in one picture, so this
  keys the plum out and keeps the brass, its corner leaves and the thin dark line inside the rim.
- A story choice's plate (`button-choice`, and its picked and pressed states) has the round socket
  for the choice's icon painted into its left end, which a nine-slice stretches oval when a choice
  is taller than the plate. So each is split in two: the plate with its left end replaced by its
  own right end turned round (no socket, stretches freely), and the socket alone (what differs
  between the two), drawn at its own shape.

    python3 tools/art/chrome-derive.py

Writes the derived files next to their sources. Rerun it if a source changes.
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


SOCKET_END = 112  # file pixels: the plate's left inset, which holds the socket


def split_choice(source: Path, plate_target: Path, socket_target: Path) -> None:
    image = np.array(Image.open(source).convert("RGBA")).astype(np.int32)
    height, width = image.shape[:2]
    # The plate is symmetric but for the socket: its left half is its right half turned round.
    plate = image.copy()
    half = width // 2
    plate[:, :half] = image[:, width - half:][:, ::-1]
    # The socket: what differs from that plain plate, in the left end only.
    end = image[:, :SOCKET_END]
    difference = np.abs(end[..., :3] - plate[:, :SOCKET_END, :3]).sum(axis=-1)
    weight = np.clip((difference - 24) / 48.0, 0.0, 1.0)
    socket = end.copy()
    socket[..., 3] = (end[..., 3] * weight).astype(np.int32)
    # The brief's weight (under 8KB a piece): quality 80 is the plates' and sockets' own look at 2x.
    save = lambda array, path: Image.fromarray(array.astype(np.uint8), "RGBA").save(
        path, "WEBP", quality=80, alpha_quality=70, method=6)
    save(plate, plate_target)
    save(socket, socket_target)


if __name__ == "__main__":
    frame_of(CHROME / "strip-identity.webp", CHROME / "strip-identity-frame.webp")
    for state in ("", "-picked", "-pressed"):
        split_choice(
            CHROME / f"button-choice{state}.webp",
            CHROME / f"button-choice{state}-plate.webp",
            CHROME / f"button-choice{state}-socket.webp",
        )
