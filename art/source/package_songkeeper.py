from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "art" / "source"
REVIEW = ROOT / "art" / "review"
SPECIES = ("unicorn", "dragonling", "griffin", "bigfoot", "kitsune", "manticore")
VERSIONS = {
    "unicorn": "v4",
    "dragonling": "v2",
    "griffin": "v2",
    "bigfoot": "v2",
    "kitsune": "v2",
    "manticore": "v2",
}


def crop_generated_border(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    pixels = np.asarray(rgb)
    dark_rows = np.any(np.max(pixels, axis=2) < 245, axis=1)
    indices = np.flatnonzero(dark_rows)
    if indices.size == 0:
        return rgb
    return rgb.crop((0, int(indices[0]), rgb.width, int(indices[-1]) + 1))


def load_font(size: int) -> ImageFont.ImageFont:
    font_path = Path("C:/Windows/Fonts/consolab.ttf")
    if font_path.exists():
        return ImageFont.truetype(str(font_path), size)
    return ImageFont.load_default()


REVIEW.mkdir(parents=True, exist_ok=True)
rows = []

for species in SPECIES:
    version = VERSIONS[species]
    raw_path = SOURCE / f"songkeeper_{species}_tiers_{version}_raw.png"
    row = crop_generated_border(Image.open(raw_path))
    review_path = REVIEW / f"songkeeper_{species}_tiers_{version}.png"
    row.save(review_path, optimize=True)
    rows.append((species, row))

sheet_width = 1086
header_height = 30
resized_rows = []
for species, row in rows:
    row_height = round(row.height * sheet_width / row.width)
    resized = row.resize((sheet_width, row_height), Image.Resampling.LANCZOS)
    resized_rows.append((species, resized))

background = (25, 23, 33)
sheet_height = sum(header_height + row.height for _, row in resized_rows)
sheet = Image.new("RGB", (sheet_width, sheet_height), background)
draw = ImageDraw.Draw(sheet)
font = load_font(13)

y = 0
for species, row in resized_rows:
    draw.text((11, y + 7), species.upper(), fill=(245, 242, 238), font=font)
    draw.line((0, y + header_height - 1, sheet_width, y + header_height - 1), fill=(175, 168, 180))
    sheet.paste(row, (0, y + header_height))
    y += header_height + row.height

sheet.save(REVIEW / "songkeeper_all_species_tiers_v2.png", optimize=True)
