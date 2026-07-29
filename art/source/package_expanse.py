from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "art" / "source"
BIOMES = ROOT / "assets" / "biomes"
REVIEW = ROOT / "art" / "review"

DESTINATION = "expanse"
BACKGROUND = "biome_expanse_bg_v2_raw.png"
TILES = "expanse_tiles_raw.png"
PROPS = "expanse_props_alpha.png"
PROP_NAMES = (
    "shattered_basalt_needle",
    "uplifted_plate_fragments",
    "lightning_fused_fulgurite",
    "mineral_crusted_boulder",
    "erased_ancient_marker",
    "suspended_storm_shards",
)

font_path = Path("C:/Windows/Fonts/consolab.ttf")
label_font = (
    ImageFont.truetype(str(font_path), 24)
    if font_path.exists()
    else ImageFont.load_default()
)


def label_centered(
    canvas: Image.Image, text: str, y: int, x_center: int
) -> None:
    draw = ImageDraw.Draw(canvas)
    bounds = draw.textbbox((0, 0), text, font=label_font)
    width = bounds[2] - bounds[0]
    draw.text(
        (x_center - width // 2, y),
        text,
        fill=(215, 223, 232),
        font=label_font,
    )


output_dir = BIOMES / DESTINATION
prop_dir = output_dir / "props"
output_dir.mkdir(parents=True, exist_ok=True)
prop_dir.mkdir(parents=True, exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)

background_source = Image.open(SOURCE / BACKGROUND).convert("RGB")
background = ImageOps.fit(
    background_source,
    (1920, 1080),
    method=Image.Resampling.LANCZOS,
    centering=(0.5, 0.5),
)
background.save(output_dir / "bg.webp", "WEBP", quality=95, method=6)

tile_source = Image.open(SOURCE / TILES).convert("RGB")
tile_sheet = Image.new("RGB", (512, 512))
for row in range(4):
    for col in range(4):
        left = round(col * tile_source.width / 4)
        right = round((col + 1) * tile_source.width / 4)
        top = round(row * tile_source.height / 4)
        bottom = round((row + 1) * tile_source.height / 4)
        inset = 4
        tile = tile_source.crop(
            (left + inset, top + inset, right - inset, bottom - inset)
        )
        tile = tile.resize((128, 128), Image.Resampling.LANCZOS)
        tile_sheet.paste(tile, (col * 128, row * 128))
tile_sheet.save(output_dir / "tiles.png", optimize=True)

prop_source = Image.open(SOURCE / PROPS).convert("RGBA")
packaged_props = []
for index, name in enumerate(PROP_NAMES):
    row, col = divmod(index, 3)
    left = round(col * prop_source.width / 3)
    right = round((col + 1) * prop_source.width / 3)
    top = round(row * prop_source.height / 2)
    bottom = round((row + 1) * prop_source.height / 2)
    cell = prop_source.crop((left, top, right, bottom))
    prop = cell.resize((512, 512), Image.Resampling.LANCZOS)
    prop.save(prop_dir / f"{name}.png", optimize=True)
    packaged_props.append(prop)

background_review = Image.new("RGB", (960, 590), (17, 19, 24))
background_review.paste(
    background.resize((960, 540), Image.Resampling.LANCZOS),
    (0, 0),
)
label_centered(background_review, "THE EXPANSE", 550, 480)
background_review.save(REVIEW / "expanse_backdrop.png", optimize=True)

tile_sheet.save(REVIEW / "expanse_tiles.png", optimize=True)

props_review = Image.new("RGB", (512, 390), (17, 19, 24))
for prop_index, prop in enumerate(packaged_props):
    row, col = divmod(prop_index, 3)
    cell = Image.new("RGB", (160, 160), (37, 40, 47))
    reduced = prop.resize((160, 160), Image.Resampling.LANCZOS)
    cell.paste(reduced.convert("RGB"), (0, 0), reduced)
    props_review.paste(cell, (col * 170 + 1, row * 160))
label_centered(props_review, "THE EXPANSE", 350, 256)
props_review.save(REVIEW / "expanse_props.png", optimize=True)
