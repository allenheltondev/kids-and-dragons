"""Build the review candidate for the eight-frame miss_veer combat effect.

The generated source supplies the painted crescent and chips. This script only
registers, times, and presents that art at the runtime's fixed 256px frame size.
It intentionally writes outside assets/effects until the review gate is passed.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source" / "miss_veer"
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


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
    if bbox is None:
        raise RuntimeError("source contains no visible pixels")
    return bbox


def multiply_alpha(image: Image.Image, factor: float) -> Image.Image:
    result = image.copy()
    alpha = result.getchannel("A").point(lambda value: round(value * factor))
    result.putalpha(alpha)
    return result


def render_frame(source: Image.Image, scale: float, opacity: float, angle: float, dx: int, dy: int) -> Image.Image:
    base_width = 154
    width = max(1, round(base_width * scale))
    height = max(1, round(width * source.height / source.width))
    painted = source.resize((width, height), Image.Resampling.LANCZOS)
    painted = painted.rotate(angle, Image.Resampling.BICUBIC, expand=True)
    painted = multiply_alpha(painted, opacity)

    frame = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    centre_x = 128 + dx
    centre_y = 145 + dy
    x = round(centre_x - painted.width / 2)
    y = round(centre_y - painted.height / 2)
    frame.alpha_composite(painted, (x, y))
    return frame


def checkerboard(size: tuple[int, int], square: int = 16) -> Image.Image:
    board = Image.new("RGBA", size, (31, 38, 52, 255))
    draw = ImageDraw.Draw(board)
    light = (43, 52, 69, 255)
    for y in range(0, size[1], square):
        for x in range(0, size[0], square):
            if (x // square + y // square) % 2:
                draw.rectangle((x, y, x + square - 1, y + square - 1), fill=light)
    return board


def build_review(frames: list[Image.Image], output: Path) -> None:
    margin = 30
    gap = 10
    card = 256
    header = 104
    footer = 44
    width = margin * 2 + card * 4 + gap * 3
    height = header + card * 2 + gap + footer + margin
    board = Image.new("RGB", (width, height), (18, 23, 34))
    draw = ImageDraw.Draw(board)
    draw.text((margin, 22), "miss_veer — 8 frame review", font=load_font(28, True), fill=(244, 238, 222))
    draw.text(
        (margin, 61),
        "Attack miss · crescent passes beside the empty target pocket · 12 fps",
        font=load_font(17),
        fill=(169, 182, 204),
    )

    for index, frame in enumerate(frames):
        col = index % 4
        row = index // 4
        x = margin + col * (card + gap)
        y = header + row * (card + gap)
        backing = checkerboard((card, card))
        backing.alpha_composite(frame)
        tile_draw = ImageDraw.Draw(backing)
        # Guides are review-only: centre 128px tile and protected top band.
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
    playback: list[Image.Image] = []
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
    source = Image.open(SOURCE_DIR / "source_alpha.png").convert("RGBA")
    left, top, right, bottom = alpha_bbox(source)
    pad = 8
    source = source.crop((max(0, left - pad), max(0, top - pad), min(source.width, right + pad), min(source.height, bottom + pad)))

    timing = [
        # scale, opacity, rotation, x shift, y shift
        (0.22, 0.58, -14.0, -13, 5),
        (0.48, 0.78, -10.0, -9, 3),
        (0.76, 0.92, -5.0, -4, 1),
        (0.96, 1.00, -1.0, 0, 0),
        (1.00, 1.00, 2.0, 3, 0),
        (0.88, 0.84, 7.0, 8, 2),
        (0.58, 0.66, 12.0, 13, 4),
        (0.22, 0.52, 17.0, 18, 7),
    ]
    frames = [render_frame(source, *values) for values in timing]

    sheet = Image.new("RGBA", (FRAME_SIZE * len(frames), FRAME_SIZE), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (index * FRAME_SIZE, 0))
    sheet.save(SOURCE_DIR / "miss_veer.sheet.png", optimize=True)

    build_review(frames, REVIEW_DIR / "miss_veer.png")
    build_gif(frames, REVIEW_DIR / "miss_veer.gif")


if __name__ == "__main__":
    main()
