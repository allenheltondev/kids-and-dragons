from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "art" / "source"
BIOMES = ROOT / "assets" / "biomes"
REVIEW = ROOT / "art" / "review"

DESTINATIONS = {
    "frostfang_peaks": {
        "background": "biome_frostfang_peaks_bg_raw.png",
        "props": "frostfang_peaks_props_alpha.png",
        "prop_names": (
            "rock_spire",
            "snow_boulder",
            "ice_crystals",
            "snow_pine",
            "mountain_cairn",
            "fallen_pine",
        ),
    },
    "glacier_of_origins": {
        "background": "biome_glacier_of_origins_bg_v2_raw.png",
        "props": "glacier_of_origins_props_alpha.png",
        "prop_names": (
            "trapped_stone_pillar",
            "ice_arch",
            "meltwater_pool",
            "banded_ice_boulder",
            "glacier_crystals",
            "ice_bridge",
        ),
    },
}

font_path = Path("C:/Windows/Fonts/consolab.ttf")
label_font = (
    ImageFont.truetype(str(font_path), 24)
    if font_path.exists()
    else ImageFont.load_default()
)


def package_background(source_name: str, output_dir: Path) -> Image.Image:
    image = Image.open(SOURCE / source_name).convert("RGB")
    background = ImageOps.fit(
        image,
        (1920, 1080),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    background.save(output_dir / "bg.webp", "WEBP", quality=95, method=6)
    return background


def package_tiles() -> Image.Image:
    source = Image.open(SOURCE / "frozen_north_tiles_raw.png").convert("RGB")
    sheet = Image.new("RGB", (512, 512))
    for row in range(4):
        for col in range(4):
            left = round(col * source.width / 4)
            right = round((col + 1) * source.width / 4)
            top = round(row * source.height / 4)
            bottom = round((row + 1) * source.height / 4)
            inset = 4
            tile = source.crop(
                (left + inset, top + inset, right - inset, bottom - inset)
            )
            tile = tile.resize((128, 128), Image.Resampling.LANCZOS)
            sheet.paste(tile, (col * 128, row * 128))
    return sheet


def package_props(config: dict, output_dir: Path) -> list[Image.Image]:
    source = Image.open(SOURCE / config["props"]).convert("RGBA")
    prop_dir = output_dir / "props"
    prop_dir.mkdir(parents=True, exist_ok=True)
    packaged = []
    row_edges = (0, round(source.height * 0.53), source.height)

    for index, name in enumerate(config["prop_names"]):
        row, col = divmod(index, 3)
        left = round(col * source.width / 3)
        right = round((col + 1) * source.width / 3)
        top = row_edges[row]
        bottom = row_edges[row + 1]
        cell = source.crop((left, top, right, bottom))

        square_size = max(cell.size)
        square = Image.new("RGBA", (square_size, square_size))
        square.alpha_composite(
            cell,
            ((square_size - cell.width) // 2, (square_size - cell.height) // 2),
        )
        prop = square.resize((512, 512), Image.Resampling.LANCZOS)
        prop.save(prop_dir / f"{name}.png", optimize=True)
        packaged.append(prop)

    return packaged


def label_centered(
    canvas: Image.Image, text: str, y: int, x_center: int
) -> None:
    draw = ImageDraw.Draw(canvas)
    bounds = draw.textbbox((0, 0), text, font=label_font)
    width = bounds[2] - bounds[0]
    draw.text(
        (x_center - width // 2, y),
        text,
        fill=(232, 226, 210),
        font=label_font,
    )


BIOMES.mkdir(parents=True, exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)

backgrounds = {}
all_props = {}
shared_tiles = package_tiles()
for destination, config in DESTINATIONS.items():
    output_dir = BIOMES / destination
    output_dir.mkdir(parents=True, exist_ok=True)
    backgrounds[destination] = package_background(config["background"], output_dir)
    shared_tiles.save(output_dir / "tiles.png", optimize=True)
    all_props[destination] = package_props(config, output_dir)

background_review = Image.new("RGB", (1920, 590), (18, 17, 24))
for index, (destination, background) in enumerate(backgrounds.items()):
    x = index * 960
    thumb = background.resize((960, 540), Image.Resampling.LANCZOS)
    background_review.paste(thumb, (x, 0))
    label_centered(
        background_review,
        destination.replace("_", " ").upper(),
        550,
        x + 480,
    )
background_review.save(REVIEW / "frozen_north_backdrops_v2.png", optimize=True)

shared_tiles.save(REVIEW / "frozen_north_tiles.png", optimize=True)

props_review = Image.new("RGB", (1024, 390), (18, 17, 24))
for destination_index, (destination, props) in enumerate(all_props.items()):
    panel_x = destination_index * 512
    for prop_index, prop in enumerate(props):
        row, col = divmod(prop_index, 3)
        cell = Image.new("RGB", (160, 160), (40, 38, 48))
        reduced = prop.resize((160, 160), Image.Resampling.LANCZOS)
        cell.paste(reduced.convert("RGB"), (0, 0), reduced)
        props_review.paste(cell, (panel_x + col * 170 + 1, row * 160))
    label_centered(
        props_review,
        destination.replace("_", " ").upper(),
        350,
        panel_x + 256,
    )
props_review.save(REVIEW / "frozen_north_props.png", optimize=True)
