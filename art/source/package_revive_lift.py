import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "art" / "source" / "revive_lift_storyboard_raw.png"
EFFECTS = ROOT / "assets" / "effects"
REVIEW = ROOT / "art" / "review"
FRAME_SIZE = 256
FRAME_COUNT = 12
COLS = 4
ROWS = 3


def to_transparent_effect(cell: Image.Image) -> Image.Image:
    rgb = np.asarray(cell.convert("RGB"), dtype=np.float32)
    intensity = np.max(rgb, axis=2)
    alpha = np.clip((intensity - 3.0) * 1.04, 0, 255)
    alpha[alpha < 5] = 0

    safe_alpha = np.maximum(alpha[..., None], 1)
    straight_rgb = np.clip(rgb * 255.0 / safe_alpha, 0, 255)
    rgba = np.dstack((straight_rgb, alpha)).astype(np.uint8)
    effect = Image.fromarray(rgba, "RGBA")

    bbox = effect.getchannel("A").getbbox()
    if bbox is None:
        return Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE))

    effect = effect.crop(bbox)
    scale = min(0.66, 236 / max(effect.size))
    resized = effect.resize(
        (max(1, round(effect.width * scale)), max(1, round(effect.height * scale))),
        Image.Resampling.LANCZOS,
    )

    frame = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE))
    frame.alpha_composite(
        resized,
        ((FRAME_SIZE - resized.width) // 2, (FRAME_SIZE - resized.height) // 2),
    )
    return frame


source = Image.open(SOURCE).convert("RGB")
frames = []
for row in range(ROWS):
    top = round(row * source.height / ROWS)
    bottom = round((row + 1) * source.height / ROWS)
    for col in range(COLS):
        left = round(col * source.width / COLS)
        right = round((col + 1) * source.width / COLS)
        frames.append(to_transparent_effect(source.crop((left, top, right, bottom))))

EFFECTS.mkdir(parents=True, exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)

strip = Image.new("RGBA", (FRAME_SIZE * FRAME_COUNT, FRAME_SIZE))
for index, frame in enumerate(frames):
    strip.alpha_composite(frame, (index * FRAME_SIZE, 0))
strip.save(EFFECTS / "revive_lift.sheet.png", optimize=True)

(EFFECTS / "revive_lift.json").write_text(
    json.dumps({"frames": FRAME_COUNT, "fps": 12, "size": FRAME_SIZE}, indent=2) + "\n",
    encoding="utf-8",
)

review = Image.new("RGB", (COLS * FRAME_SIZE, ROWS * FRAME_SIZE), (29, 27, 38))
draw = ImageDraw.Draw(review)
font_path = Path("C:/Windows/Fonts/consolab.ttf")
font = ImageFont.truetype(str(font_path), 14) if font_path.exists() else ImageFont.load_default()
for index, frame in enumerate(frames):
    x = (index % COLS) * FRAME_SIZE
    y = (index // COLS) * FRAME_SIZE
    review.paste(frame.convert("RGB"), (x, y), frame)
    draw.text((x + 10, y + 9), f"{index + 1:02}", fill=(210, 205, 216), font=font)
review.save(REVIEW / "revive_lift_frames.png", optimize=True)
