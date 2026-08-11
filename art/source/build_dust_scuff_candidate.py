"""Build the review candidate for the eight-frame dust_scuff combat effect."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "source" / "dust_scuff_candidate"
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


def render_frame(source: Image.Image, scale_x: float, scale_y: float, opacity: float, dy: int) -> Image.Image:
    base_width = 160
    base_height = round(base_width * source.height / source.width)
    width = max(1, round(base_width * scale_x))
    height = max(1, round(base_height * scale_y))
    painted = source.resize((width, height), Image.Resampling.LANCZOS)
    painted = multiply_alpha(painted, opacity)

    frame = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    centre_x = 128
    centre_y = 160 + dy
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
    draw.text((margin, 22), "dust_scuff — 8 frame review", font=load_font(28, True), fill=(244, 238, 222))
    draw.text(
        (margin, 61),
        "Takeoff, landing, or harmless shove · low outward ground motion · 12 fps",
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
    source = visible_crop(Image.open(SOURCE_DIR / "source_alpha.png").convert("RGBA"))
    timing = [
        # horizontal scale, vertical scale, opacity, vertical shift
        (0.20, 0.55, 0.58, 5),
        (0.42, 0.72, 0.80, 4),
        (0.70, 0.88, 0.95, 2),
        (0.92, 1.00, 1.00, 0),
        (1.00, 1.04, 0.95, -1),
        (1.05, 1.03, 0.70, -3),
        (1.08, 0.92, 0.42, -5),
        (1.10, 0.75, 0.10, -7),
    ]
    frames = [render_frame(source, *values) for values in timing]

    sheet = Image.new("RGBA", (FRAME_SIZE * len(frames), FRAME_SIZE), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (index * FRAME_SIZE, 0))
    sheet.save(SOURCE_DIR / "dust_scuff.sheet.png", optimize=True)

    build_review(frames, REVIEW_DIR / "dust_scuff_candidate.png")
    build_gif(frames, REVIEW_DIR / "dust_scuff_candidate.gif")


if __name__ == "__main__":
    main()
