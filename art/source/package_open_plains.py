from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "art" / "source"
BIOMES = ROOT / "assets" / "biomes"
REVIEW = ROOT / "art" / "review"

DESTINATIONS = {
    "plains": {
        "background": "biome_plains_bg_raw.png",
        "props": "plains_props_alpha.png",
        "prop_names": (
            "standing_stone",
            "trail_sign",
            "thorn_shrub",
            "field_rocks",
            "wagon_wheel",
            "traveler_cairn",
        ),
    },
    "eastern_plains": {
        "background": "biome_eastern_plains_bg_raw.png",
        "props": "eastern_plains_props_alpha.png",
        "prop_names": (
            "wind_tree",
            "river_stones",
            "river_reeds",
            "driftwood_log",
            "streamer_cairn",
            "sage_shrub",
        ),
    },
    "sunward_fields": {
        "background": "biome_sunward_fields_bg_raw.png",
        "props": "sunward_fields_props_alpha.png",
        "prop_names": (
            "haystack",
            "wheat_sheaf",
            "fence",
            "fieldstone_wall",
            "orchard_tree",
            "harvest_crates",
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
    source = Image.open(SOURCE / "open_plains_tiles_raw.png").convert("RGB")
    sheet = Image.new("RGB", (512, 512))
    for row in range(4):
        for col in range(4):
            left = round(col * source.width / 4)
            right = round((col + 1) * source.width / 4)
            top = round(row * source.height / 4)
            bottom = round((row + 1) * source.height / 4)

            # Remove the generated slicing guides before downscaling each cell.
            inset = 4
            tile = source.crop(
                (left + inset, top + inset, right - inset, bottom - inset)
            )
            tile = tile.resize((128, 128), Image.Resampling.LANCZOS)
            sheet.paste(tile, (col * 128, row * 128))
    return sheet


def package_props(destination: str, config: dict, output_dir: Path) -> list[Image.Image]:
    source = Image.open(SOURCE / config["props"]).convert("RGBA")
    prop_dir = output_dir / "props"
    prop_dir.mkdir(parents=True, exist_ok=True)
    packaged = []

    for index, name in enumerate(config["prop_names"]):
        row, col = divmod(index, 3)
        left = round(col * source.width / 3)
        right = round((col + 1) * source.width / 3)
        top = round(row * source.height / 2)
        bottom = round((row + 1) * source.height / 2)
        cell = source.crop((left, top, right, bottom))

        # Preserve the relative scale authored in the source sheet.
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
    canvas: Image.Image, text: str, y: int, x_center: int, font: ImageFont.ImageFont
) -> None:
    draw = ImageDraw.Draw(canvas)
    bounds = draw.textbbox((0, 0), text, font=font)
    width = bounds[2] - bounds[0]
    draw.text(
        (x_center - width // 2, y),
        text,
        fill=(232, 226, 210),
        font=font,
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
    all_props[destination] = package_props(destination, config, output_dir)

background_review = Image.new("RGB", (1920, 400), (18, 17, 24))
for index, (destination, background) in enumerate(backgrounds.items()):
    x = index * 640
    thumb = background.resize((640, 360), Image.Resampling.LANCZOS)
    background_review.paste(thumb, (x, 0))
    label_centered(
        background_review,
        destination.replace("_", " ").upper(),
        367,
        x + 320,
        label_font,
    )
background_review.save(REVIEW / "open_plains_backdrops.png", optimize=True)

shared_tiles.save(REVIEW / "open_plains_tiles.png", optimize=True)

props_review = Image.new("RGB", (1536, 390), (18, 17, 24))
for destination_index, (destination, props) in enumerate(all_props.items()):
    panel_x = destination_index * 512
    for prop_index, prop in enumerate(props):
        row, col = divmod(prop_index, 3)
        checker = Image.new("RGB", (160, 160), (40, 38, 48))
        reduced = prop.resize((160, 160), Image.Resampling.LANCZOS)
        checker.paste(reduced.convert("RGB"), (0, 0), reduced)
        props_review.paste(checker, (panel_x + col * 170 + 1, row * 160))
    label_centered(
        props_review,
        destination.replace("_", " ").upper(),
        350,
        panel_x + 256,
        label_font,
    )
props_review.save(REVIEW / "open_plains_props.png", optimize=True)
