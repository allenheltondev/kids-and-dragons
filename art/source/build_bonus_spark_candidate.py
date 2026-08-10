"""Build the review candidate for the eight-frame tintable bonus_spark effect."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source" / "bonus_spark_candidate"
REVIEW_DIR = ROOT / "art" / "review"
FRAME_SIZE = 256


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = ["arialbd.ttf" if bold else "arial.ttf", "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"]
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def neutralize(source: Image.Image) -> Image.Image:
    """Force all visible RGB to luminance so runtime accent tinting stays honest."""
    alpha = source.getchannel("A")
    luminance = ImageOps.grayscale(source)
    return Image.merge("RGBA", (luminance, luminance, luminance, alpha))


def visible_crop(source: Image.Image, pad: int = 8) -> Image.Image:
    bbox = source.getchannel("A").point(lambda value: 255 if value > 8 else 0).getbbox()
    if bbox is None:
        raise RuntimeError("source contains no visible pixels")
    left, top, right, bottom = bbox
    return source.crop(
        (
            max(0, left - pad),
            max(0, top - pad),
            min(source.width, right + pad),
            min(source.height, bottom + pad),
        )
    )


def multiply_alpha(image: Image.Image, factor: float) -> Image.Image:
    result = image.copy()
    result.putalpha(result.getchannel("A").point(lambda value: round(value * factor)))
    return result


def render_frame(source: Image.Image, scale: float, opacity: float, angle: float, dx: int, dy: int) -> Image.Image:
    base_width = 120
    width = max(1, round(base_width * scale))
    height = max(1, round(width * source.height / source.width))
    painted = source.resize((width, height), Image.Resampling.LANCZOS)
    painted = painted.rotate(angle, Image.Resampling.BICUBIC, expand=True)
    painted = multiply_alpha(painted, opacity)

    frame = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    centre_x = 128 + dx
    centre_y = 139 + dy
    frame.alpha_composite(
        painted,
        (round(centre_x - painted.width / 2), round(centre_y - painted.height / 2)),
    )
    return frame


def checkerboard(size: tuple[int, int], square: int = 16) -> Image.Image:
    board = Image.new("RGBA", size, (31, 38, 52, 255))
    draw = ImageDraw.Draw(board)
    for y in range(0, size[1], square):
        for x in range(0, size[0], square):
            if (x // square + y // square) % 2:
                draw.rectangle((x, y, x + square - 1, y + square - 1), fill=(43, 52, 69, 255))
    return board


def build_review(frames: list[Image.Image], output: Path) -> None:
    margin, gap, card, header, footer = 30, 10, 256, 104, 44
    width = margin * 2 + card * 4 + gap * 3
    height = header + card * 2 + gap + footer + margin
    board = Image.new("RGB", (width, height), (18, 23, 34))
    draw = ImageDraw.Draw(board)
    draw.text((margin, 22), "bonus_spark — 8 frame review", font=load_font(28, True), fill=(244, 238, 222))
    draw.text(
        (margin, 61),
        "Roll bonus · luminance-only source for runtime accent tint · 12 fps",
        font=load_font(17),
        fill=(169, 182, 204),
    )

    for index, frame in enumerate(frames):
        col, row = index % 4, index // 4
        x = margin + col * (card + gap)
        y = header + row * (card + gap)
        backing = checkerboard((card, card))
        backing.alpha_composite(frame)
        tile_draw = ImageDraw.Draw(backing)
        tile_draw.rectangle((64, 64, 191, 191), outline=(113, 194, 213, 105), width=1)
        tile_draw.line((0, 64, 255, 64), fill=(209, 147, 121, 95), width=1)
        board.paste(backing.convert("RGB"), (x, y))
        draw.rounded_rectangle((x + 8, y + 8, x + 42, y + 34), radius=7, fill=(13, 17, 25))
        draw.text((x + 18, y + 10), str(index + 1), font=load_font(17, True), fill=(239, 227, 198))

    draw.text(
        (margin, height - footer - 2),
        "Blue square: centre-energy check · coral line: protected top band (review guides only)",
        font=load_font(15),
        fill=(139, 151, 171),
    )
    board.save(output, optimize=True)


def build_gif(frames: list[Image.Image], output: Path) -> None:
    playback = []
    for frame in frames:
        backing = checkerboard((FRAME_SIZE, FRAME_SIZE), 12)
        backing.alpha_composite(frame)
        playback.append(backing.convert("RGB"))
    playback[0].save(
        output,
        save_all=True,
        append_images=playback[1:],
        duration=83,
        loop=0,
        disposal=2,
        optimize=False,
    )


def main() -> None:
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    source = neutralize(Image.open(SOURCE_DIR / "source_alpha.png").convert("RGBA"))
    source.save(SOURCE_DIR / "source_neutral.png", optimize=True)
    source = visible_crop(source)

    timing = [
        # scale, opacity, rotation, x shift, y shift
        (0.20, 0.56, -7.0, -2, 14),
        (0.44, 0.78, -5.0, -1, 10),
        (0.72, 0.94, -3.0, 0, 6),
        (0.96, 1.00, -1.0, 0, 2),
        (1.00, 1.00, 1.0, 0, -1),
        (0.86, 0.84, 3.0, 1, -5),
        (0.56, 0.64, 5.0, 2, -9),
        (0.20, 0.50, 7.0, 3, -13),
    ]
    frames = [render_frame(source, *values) for values in timing]

    sheet = Image.new("RGBA", (FRAME_SIZE * len(frames), FRAME_SIZE), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (index * FRAME_SIZE, 0))
    sheet.save(SOURCE_DIR / "bonus_spark.sheet.png", optimize=True)

    build_review(frames, REVIEW_DIR / "bonus_spark_candidate.png")
    build_gif(frames, REVIEW_DIR / "bonus_spark_candidate.gif")


if __name__ == "__main__":
    main()
