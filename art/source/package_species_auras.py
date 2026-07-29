import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
EFFECTS = ROOT / "assets" / "effects"
REVIEW = ROOT / "art" / "review"
FRAME_SIZE = 256
FRAME_COUNT = 12
COLS = 4
ROWS = 3
SPECIES = ("dragonling", "griffin", "bigfoot", "kitsune", "manticore")


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


def split_storyboard(source: Image.Image) -> list[Image.Image]:
    frames = []
    row_edges = (
        0,
        round(source.height / 3),
        round(source.height * 0.64),
        source.height,
    )
    for row in range(ROWS):
        top = row_edges[row]
        bottom = row_edges[row + 1]
        for col in range(COLS):
            left = round(col * source.width / COLS)
            right = round((col + 1) * source.width / COLS)
            frames.append(to_transparent_effect(source.crop((left, top, right, bottom))))
    return frames


def save_strip(species: str, frames: list[Image.Image]) -> None:
    strip = Image.new("RGBA", (FRAME_SIZE * FRAME_COUNT, FRAME_SIZE))
    for index, frame in enumerate(frames):
        strip.alpha_composite(frame, (index * FRAME_SIZE, 0))
    strip.save(EFFECTS / f"aura_{species}.sheet.png", optimize=True)

    (EFFECTS / f"aura_{species}.json").write_text(
        json.dumps({"frames": FRAME_COUNT, "fps": 12, "size": FRAME_SIZE}, indent=2)
        + "\n",
        encoding="utf-8",
    )


def save_frame_review(
    species: str, frames: list[Image.Image], font: ImageFont.ImageFont
) -> None:
    review = Image.new("RGB", (COLS * FRAME_SIZE, ROWS * FRAME_SIZE), (29, 27, 38))
    draw = ImageDraw.Draw(review)
    for index, frame in enumerate(frames):
        x = (index % COLS) * FRAME_SIZE
        y = (index // COLS) * FRAME_SIZE
        review.paste(frame.convert("RGB"), (x, y), frame)
        draw.text((x + 10, y + 9), f"{index + 1:02}", fill=(210, 205, 216), font=font)
    review.save(REVIEW / f"aura_{species}_frames.png", optimize=True)


def make_composite(species: str, frame: Image.Image) -> Image.Image:
    composite = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (29, 27, 38, 255))
    composite.alpha_composite(frame)
    character_path = (
        ROOT / "assets" / "characters" / species / "mythic" / "assembled.png"
    )
    character = Image.open(character_path).convert("RGBA").resize(
        (FRAME_SIZE, FRAME_SIZE), Image.Resampling.LANCZOS
    )
    composite.alpha_composite(character)
    result = composite.resize((512, 512), Image.Resampling.LANCZOS).convert("RGB")
    result.save(REVIEW / f"aura_{species}_mythic_composite.png", optimize=True)
    return result


EFFECTS.mkdir(parents=True, exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)
font_path = Path("C:/Windows/Fonts/consolab.ttf")
font = (
    ImageFont.truetype(str(font_path), 14)
    if font_path.exists()
    else ImageFont.load_default()
)
label_font = (
    ImageFont.truetype(str(font_path), 24)
    if font_path.exists()
    else ImageFont.load_default()
)

composites = {}
for species in SPECIES:
    source_path = ROOT / "art" / "source" / f"aura_{species}_storyboard_raw.png"
    source = Image.open(source_path).convert("RGB")
    species_frames = split_storyboard(source)
    save_strip(species, species_frames)
    save_frame_review(species, species_frames, font)
    composites[species] = make_composite(species, species_frames[6])

unicorn_composite = Image.open(
    REVIEW / "aura_unicorn_mythic_composite_v2.png"
).convert("RGB")
composites = {"unicorn": unicorn_composite, **composites}

tile_width = 512
tile_height = 548
overview = Image.new("RGB", (tile_width * 3, tile_height * 2), (18, 17, 24))
overview_draw = ImageDraw.Draw(overview)
for index, (species, composite) in enumerate(composites.items()):
    x = (index % 3) * tile_width
    y = (index // 3) * tile_height
    overview.paste(composite, (x, y))
    label = species.upper()
    label_box = overview_draw.textbbox((0, 0), label, font=label_font)
    label_width = label_box[2] - label_box[0]
    overview_draw.text(
        (x + (tile_width - label_width) // 2, y + 514),
        label,
        fill=(226, 220, 235),
        font=label_font,
    )
overview.save(REVIEW / "mythic_species_auras.png", optimize=True)

frame_reviews = {
    "unicorn": Image.open(REVIEW / "aura_unicorn_frames_v2.png").convert("RGB")
}
for species in SPECIES:
    frame_reviews[species] = Image.open(
        REVIEW / f"aura_{species}_frames.png"
    ).convert("RGB")

frame_tile_width = 512
frame_tile_height = 420
frame_overview = Image.new(
    "RGB", (frame_tile_width * 2, frame_tile_height * 3), (18, 17, 24)
)
frame_overview_draw = ImageDraw.Draw(frame_overview)
for index, (species, frame_review) in enumerate(frame_reviews.items()):
    x = (index % 2) * frame_tile_width
    y = (index // 2) * frame_tile_height
    reduced = frame_review.resize((512, 384), Image.Resampling.LANCZOS)
    frame_overview.paste(reduced, (x, y))
    label = species.upper()
    label_box = frame_overview_draw.textbbox((0, 0), label, font=label_font)
    label_width = label_box[2] - label_box[0]
    frame_overview_draw.text(
        (x + (frame_tile_width - label_width) // 2, y + 388),
        label,
        fill=(226, 220, 235),
        font=label_font,
    )
frame_overview.save(REVIEW / "species_aura_frames_overview.png", optimize=True)
