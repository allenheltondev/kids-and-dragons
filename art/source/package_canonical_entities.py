#!/usr/bin/env python3
"""Package canonical entity cutouts and build visual-review sheets."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "assets" / "manifest.json"
SOURCE = ROOT / "art" / "source" / "canonical_entities"
DESTINATION = ROOT / "assets" / "entities"
REVIEW = ROOT / "art" / "review"

CANVAS = 1024
CONTENT_WIDTH = 900
CONTENT_HEIGHT = 840
BASELINE = 900
ALPHA_THRESHOLD = 8

CLASSIFICATION_TITLES = {
    "supporting_people": "Supporting Peoples",
    "cultural_order": "Cultural Order",
    "legendary_beast": "Legendary Beast",
    "ambient_creature": "Ambient Creatures",
    "dangerous_creature": "Dangerous Creatures",
    "supernatural_manifestation": "Supernatural Manifestations",
}


def load_font(size: int, bold: bool = False):
    names = (
        ("C:/Windows/Fonts/seguisb.ttf", "C:/Windows/Fonts/segoeui.ttf")
        if bold
        else ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf")
    )
    for name in names:
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default()


FONT_TITLE = load_font(34, bold=True)
FONT_LABEL = load_font(18, bold=True)
FONT_META = load_font(14)


def content_box(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A").point(
        lambda value: 255 if value > ALPHA_THRESHOLD else 0
    )
    box = alpha.getbbox()
    if box is None:
        raise ValueError("source is fully transparent")
    return box


def package(source: Image.Image) -> Image.Image:
    crop = source.crop(content_box(source))
    scale = min(CONTENT_WIDTH / crop.width, CONTENT_HEIGHT / crop.height, 1.0)
    size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    resized = crop.resize(size, Image.Resampling.LANCZOS)

    output = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - resized.width) // 2
    y = min((CANVAS - resized.height) // 2, BASELINE - resized.height)
    output.alpha_composite(resized, (x, y))
    return output


def checker(size: tuple[int, int], step: int = 16) -> Image.Image:
    image = Image.new("RGB", size, (232, 226, 217))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], step):
        for x in range(0, size[0], step):
            if (x // step + y // step) % 2:
                draw.rectangle(
                    (x, y, x + step - 1, y + step - 1),
                    fill=(211, 203, 193),
                )
    return image


def review_sheet(title: str, entries: list[dict], packaged: dict[str, Image.Image]) -> Image.Image:
    columns = 4
    cell_width = 300
    art_height = 250
    label_height = 72
    rows = (len(entries) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (columns * cell_width + 40, rows * (art_height + label_height) + 92),
        (24, 28, 42),
    )
    draw = ImageDraw.Draw(sheet)
    draw.text((20, 18), title, font=FONT_TITLE, fill=(244, 241, 250))
    draw.text(
        (20, 59),
        "Transparent runtime assets shown against checkerboard",
        font=FONT_META,
        fill=(164, 184, 214),
    )

    for index, entity in enumerate(entries):
        row, column = divmod(index, columns)
        x = 20 + column * cell_width
        y = 88 + row * (art_height + label_height)
        plate = checker((cell_width - 12, art_height))
        art = packaged[entity["id"]].copy()
        art.thumbnail((cell_width - 34, art_height - 18), Image.Resampling.LANCZOS)
        plate.paste(
            art,
            ((plate.width - art.width) // 2, (plate.height - art.height) // 2),
            art,
        )
        sheet.paste(plate, (x, y))
        draw.text(
            (x + 8, y + art_height + 8),
            entity["id"].replace("_", " "),
            font=FONT_LABEL,
            fill=(244, 241, 250),
        )
        draw.text(
            (x + 8, y + art_height + 34),
            f'{entity["primaryBiome"].replace("_", " ")} · {entity["scale"].replace("_", " ")}',
            font=FONT_META,
            fill=(164, 184, 214),
        )
    return sheet


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entities = manifest["entities"]
    packaged: dict[str, Image.Image] = {}

    for entity in entities:
        entity_id = entity["id"]
        source_path = SOURCE / f"{entity_id}_alpha.png"
        if not source_path.exists():
            raise FileNotFoundError(source_path)
        output = package(Image.open(source_path).convert("RGBA"))
        output_dir = DESTINATION / entity_id
        output_dir.mkdir(parents=True, exist_ok=True)
        output.save(output_dir / "assembled.png", optimize=True)
        packaged[entity_id] = output
        print(f"wrote assets/entities/{entity_id}/assembled.png")

    REVIEW.mkdir(parents=True, exist_ok=True)
    for classification, title in CLASSIFICATION_TITLES.items():
        matching = [
            entity for entity in entities
            if entity["classification"] == classification
        ]
        if not matching:
            continue
        output_path = REVIEW / f"canonical_entities_{classification}.png"
        review_sheet(title, matching, packaged).save(output_path, optimize=True)
        print(f"wrote art/review/{output_path.name}")


if __name__ == "__main__":
    main()
