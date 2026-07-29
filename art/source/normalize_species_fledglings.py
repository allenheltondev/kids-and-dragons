from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SPECIES = ("dragonling", "griffin", "bigfoot", "kitsune", "manticore")
TIERS = ("fledgling", "sworn", "radiant", "mythic")
TARGET_VISIBLE_HEIGHT = 821
TARGET_CENTER_X = 512
TARGET_FEET_Y = 899


def shift_hue(
    pixels: np.ndarray,
    selection: np.ndarray,
    degrees: float,
) -> None:
    hsv = np.array(Image.fromarray(pixels[:, :, :3], "RGB").convert("HSV"))
    hue = hsv[:, :, 0].astype(np.int16)
    hue[selection] = (hue[selection] + round(degrees * 255 / 360)) % 256
    hsv[:, :, 0] = hue.astype(np.uint8)
    corrected = np.array(Image.fromarray(hsv, "HSV").convert("RGB"))
    pixels[:, :, :3][selection] = corrected[selection]


def set_hue(
    pixels: np.ndarray,
    selection: np.ndarray,
    degrees: float,
) -> None:
    hsv = np.array(Image.fromarray(pixels[:, :, :3], "RGB").convert("HSV"))
    hsv[:, :, 0][selection] = round(degrees * 255 / 360)
    corrected = np.array(Image.fromarray(hsv, "HSV").convert("RGB"))
    pixels[:, :, :3][selection] = corrected[selection]


def apply_palette_corrections(
    species: str,
    tier: str,
    pixels: np.ndarray,
    visible: np.ndarray,
) -> None:
    rgb = pixels[:, :, :3].astype(np.float32) / 255.0
    maximum = rgb.max(2)
    minimum = rgb.min(2)
    saturation = np.divide(
        maximum - minimum,
        maximum,
        out=np.zeros_like(maximum),
        where=maximum > 0,
    )
    hsv = np.array(Image.fromarray(pixels[:, :, :3], "RGB").convert("HSV"))
    hue = hsv[:, :, 0].astype(float) * 360 / 255
    yy, xx = np.indices(visible.shape)

    if species == "dragonling":
        # Lock the low-saturation coat to emerald without touching the saturated
        # coral wing membranes or dark dorsal frill.
        selection = (
            visible
            & (maximum > 0.45)
            & (saturation > 0.02)
            & (saturation < 0.42)
        )
        set_hue(pixels, selection, 145)
    elif species == "manticore":
        # Lock the pale coat to rose and the scorpion tail to venom green.
        coat = (
            visible
            & (maximum > 0.45)
            & (saturation > 0.02)
            & (saturation < 0.42)
        )
        set_hue(pixels, coat, 349)
        tail = (
            visible
            & (xx > 575)
            & (yy < 610)
            & (saturation > 0.15)
            & (hue > 35)
            & (hue < 125)
        )
        set_hue(pixels, tail, 100)


def base_scale(species: str) -> float:
    source = Image.open(ROOT / f"art/source/{species}_fledgling_alpha_raw.png").convert("RGBA")
    alpha = np.array(source.getchannel("A"))
    ys, _ = np.where(alpha > 8)
    return TARGET_VISIBLE_HEIGHT / (ys.max() - ys.min() + 1)


def normalize(species: str, tier: str = "fledgling") -> Path:
    source_path = ROOT / f"art/source/{species}_{tier}_alpha_raw.png"
    target_path = ROOT / f"assets/characters/{species}/{tier}/assembled.png"
    source = Image.open(source_path).convert("RGBA")
    alpha = np.array(source.getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise RuntimeError(f"{source_path} is empty")

    left, top, right, bottom = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    scale = base_scale(species)
    if tier != "fledgling":
        # Preserve the approved fledgling's body scale whenever the expanded
        # signature still fits; only shrink enough to keep the 8px safety edge.
        scale = min(scale, 883 / (bottom - top), 990 / (right - left))
    resized = source.resize(
        (round(source.width * scale), round(source.height * scale)),
        Image.Resampling.LANCZOS,
    )
    center_x = (left + right - 1) * 0.5 * scale
    feet_y = (bottom - 1) * scale
    offset_x = round(TARGET_CENTER_X - center_x)
    offset_y = round(TARGET_FEET_Y - feet_y)

    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    canvas.alpha_composite(resized, (offset_x, offset_y))
    pixels = np.array(canvas)
    # The built-in chroma helper can interpret very pale, species-tinted coats as
    # a soft matte. These are opaque painted characters, so harden the recovered
    # subject after registration; this also prevents repeated seam layers from
    # changing colour during alpha compositing.
    visible = pixels[:, :, 3] > 8
    pixels[:, :, 3] = np.where(visible, 255, 0).astype(np.uint8)
    rgb = pixels[:, :, :3]

    pure_black = visible & np.all(rgb == 0, axis=2)
    pure_white = visible & np.all(rgb == 255, axis=2)
    rgb[pure_black] = (43, 33, 24)
    rgb[pure_white] = (255, 246, 232)

    # Remove any residual chroma spill without altering intentional green accents:
    # only treat pixels as spill if they are close to the sampled key hue.
    max_rb = np.maximum(rgb[:, :, 0], rgb[:, :, 2])
    green_fringe = (
        visible
        & (rgb[:, :, 1] > 145)
        & (rgb[:, :, 1].astype(np.int16) - max_rb.astype(np.int16) > 95)
    )
    rgb[:, :, 1][green_fringe] = max_rb[green_fringe]
    rgb[~visible] = 0
    pixels[:, :, :3] = rgb
    apply_palette_corrections(species, tier, pixels, visible)

    target_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, "RGBA").save(target_path, format="PNG", compress_level=9)

    alpha = pixels[:, :, 3]
    ys, xs = np.where(alpha > 8)
    print(
        f"{species}/{tier}: scale={scale:.4f} offset=({offset_x},{offset_y}) "
        f"bbox>8=({xs.min()},{ys.min()},{xs.max()+1},{ys.max()+1}) feet={ys.max()}"
    )
    return target_path


def contact_sheet(paths: list[Path]) -> None:
    tile = 340
    label_h = 36
    columns = 3
    rows = 2
    sheet = Image.new("RGB", (columns * tile, rows * (tile + label_h)), "#17131f")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for index, path in enumerate(paths):
        species = path.parents[1].name
        image = Image.open(path).convert("RGBA")
        image.thumbnail((tile - 24, tile - 24), Image.Resampling.LANCZOS)
        x0 = (index % columns) * tile
        y0 = (index // columns) * (tile + label_h)
        checker = Image.new("RGBA", (tile, tile), "#302a38")
        checker.alpha_composite(image, ((tile - image.width) // 2, (tile - image.height) // 2))
        sheet.paste(checker.convert("RGB"), (x0, y0))
        bbox = draw.textbbox((0, 0), species, font=font)
        draw.text(
            (x0 + (tile - (bbox[2] - bbox[0])) / 2, y0 + tile + 7),
            species,
            fill="#f7efff",
            font=font,
        )

    review = ROOT / "art/review/species_fledglings_assembled.png"
    review.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(review, compress_level=9)
    print(f"wrote {review.relative_to(ROOT)}")


def tier_contact_sheet(species: str) -> None:
    tile = 360
    label_h = 34
    sheet = Image.new("RGB", (4 * tile, tile + label_h), "#17131f")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, tier in enumerate(TIERS):
        image = Image.open(
            ROOT / f"assets/characters/{species}/{tier}/assembled.png"
        ).convert("RGBA")
        image.thumbnail((tile - 18, tile - 18), Image.Resampling.LANCZOS)
        panel = Image.new("RGBA", (tile, tile), "#302a38")
        panel.alpha_composite(image, ((tile - image.width) // 2, (tile - image.height) // 2))
        sheet.paste(panel.convert("RGB"), (index * tile, 0))
        draw.text((index * tile + 12, tile + 8), tier, fill="#f7efff", font=font)
    output = ROOT / f"art/review/{species}_tiers_assembled.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, compress_level=9)


def refresh_unicorn_tiers() -> None:
    paths = [
        ROOT / f"assets/characters/unicorn/{tier}/assembled.png"
        for tier in ("fledgling", "sworn", "radiant", "mythic")
    ]
    tile = 360
    label_h = 34
    sheet = Image.new("RGB", (4 * tile, tile + label_h), "#17131f")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, path in enumerate(paths):
        image = Image.open(path).convert("RGBA")
        image.thumbnail((tile - 20, tile - 20), Image.Resampling.LANCZOS)
        panel = Image.new("RGBA", (tile, tile), "#302a38")
        panel.alpha_composite(image, ((tile - image.width) // 2, (tile - image.height) // 2))
        sheet.paste(panel.convert("RGB"), (index * tile, 0))
        label = path.parent.name
        bbox = draw.textbbox((0, 0), label, font=font)
        draw.text(
            (index * tile + (tile - (bbox[2] - bbox[0])) / 2, tile + 6),
            label,
            fill="#f7efff",
            font=font,
        )
    review_dir = ROOT / "art/review"
    sheet.save(review_dir / "unicorn_tiers_assembled.png", compress_level=9)
    sheet.resize((720, round((tile + label_h) * 0.5)), Image.Resampling.LANCZOS).save(
        review_dir / "unicorn_tiers_120px.png",
        compress_level=9,
    )


def main() -> None:
    paths = []
    for species in SPECIES:
        for tier in TIERS:
            path = normalize(species, tier)
            if tier == "fledgling":
                paths.append(path)
        tier_contact_sheet(species)
    contact_sheet(paths)


if __name__ == "__main__":
    main()
