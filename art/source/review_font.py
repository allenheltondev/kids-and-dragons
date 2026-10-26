"""Portable review-sheet typography; Pillow's bundled default is the last resort."""
from PIL import ImageFont


def review_font(size):
    for name in ('C:/Windows/Fonts/segoeui.ttf', 'DejaVuSans.ttf',
                 '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow before 10.1 ships a fixed-size default font.
        return ImageFont.load_default()
