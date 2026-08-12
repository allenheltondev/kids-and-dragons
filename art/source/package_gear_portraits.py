"""Package the approved class-specific character sheets as app portraits.

The four class sheets are the source of truth for the purpose-drawn armor fits.
Each source row contains fledgling, sworn, radiant, and mythic panels. Fledglings
wear no class gear, so this extracts only the latter three panels and places them
on the 1254px opaque square contract consumed by CharacterPortrait.

The 27 portraits already promoted from individually reviewed fit renders are
left byte-for-byte untouched. This script fills only missing combinations from
the accepted tier sheets and writes a complete matrix to art/review for QA.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "art" / "source"
PORTRAITS = ROOT / "assets" / "gear-portraits"
REVIEW = ROOT / "art" / "review" / "gear_portraits_complete_matrix.png"

CLASSES = ("thornguard", "duskrunner", "starweaver", "songkeeper")
SPECIES = ("unicorn", "dragonling", "griffin", "bigfoot", "kitsune", "manticore")
TIERS = ("sworn", "radiant", "mythic")
TIER_PANEL = {"sworn": 1, "radiant": 2, "mythic": 3}
PORTRAIT_SIZE = 1254


def panel_square(sheet: Image.Image, panel_index: int) -> Image.Image:
    """Return one square art panel without the source board's labels or border.

    The approved boards have four equal-width panels. Their art field uses the
    same proportions across all generations: an 8.5% top inset followed by one
    panel-width of picture. Cropping by proportions instead of magic source
    dimensions also covers the few 2120/2125px-wide accepted sheets.
    """

    left = round(sheet.width * panel_index / 4)
    right = round(sheet.width * (panel_index + 1) / 4)
    side = right - left
    top = round(sheet.height * 0.085)
    bottom = top + side
    if bottom > sheet.height:
        bottom = sheet.height
        top = bottom - side
    return sheet.crop((left, top, right, bottom)).convert("RGB")


def package_missing() -> list[Path]:
    written: list[Path] = []
    for character_class in CLASSES:
        for species in SPECIES:
            source_path = SOURCE / f"{character_class}_{species}_tiers_raw.png"
            with Image.open(source_path) as source_image:
                sheet = source_image.convert("RGB")
                for tier in TIERS:
                    output_path = PORTRAITS / character_class / tier / f"{species}.png"
                    if output_path.exists():
                        continue
                    portrait = panel_square(sheet, TIER_PANEL[tier]).resize(
                        (PORTRAIT_SIZE, PORTRAIT_SIZE), Image.Resampling.LANCZOS
                    )
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    portrait.save(output_path, compress_level=6)
                    written.append(output_path)
    return written


def font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    name = "consolab.ttf" if bold else "consola.ttf"
    path = Path("C:/Windows/Fonts") / name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def write_review() -> None:
    thumb = 174
    label_w = 148
    header_h = 46
    class_gap = 24
    species_h = thumb
    class_w = label_w + thumb * len(TIERS)
    sheet_w = class_w * 2 + class_gap * 3
    sheet_h = 78 + (header_h + species_h * len(SPECIES)) * 2 + class_gap * 3

    paper = (13, 19, 28)
    panel = (24, 34, 46)
    ink = (237, 241, 234)
    muted = (160, 178, 185)
    edge = (64, 88, 108)

    review = Image.new("RGB", (sheet_w, sheet_h), paper)
    draw = ImageDraw.Draw(review)
    draw.text((class_gap, 18), "PURPOSE-DRAWN GEAR PORTRAITS — COMPLETE MATRIX", font=font(27, bold=True), fill=ink)
    draw.text((class_gap, 51), "accepted model-sheet panels; existing reviewed portraits retained", font=font(15), fill=muted)

    for class_index, character_class in enumerate(CLASSES):
        col = class_index % 2
        row = class_index // 2
        x = class_gap + col * (class_w + class_gap)
        y = 78 + class_gap + row * (header_h + species_h * len(SPECIES) + class_gap)
        draw.rectangle((x, y, x + class_w, y + header_h + species_h * len(SPECIES)), fill=panel, outline=edge, width=2)
        draw.text((x + 12, y + 12), character_class.upper(), font=font(19, bold=True), fill=ink)
        for tier_index, tier in enumerate(TIERS):
            tx = x + label_w + tier_index * thumb
            draw.text((tx + 10, y + 14), tier.upper(), font=font(14, bold=True), fill=muted)

        for species_index, species in enumerate(SPECIES):
            sy = y + header_h + species_index * species_h
            draw.text((x + 12, sy + 74), species.upper(), font=font(14, bold=True), fill=ink)
            for tier_index, tier in enumerate(TIERS):
                portrait_path = PORTRAITS / character_class / tier / f"{species}.png"
                with Image.open(portrait_path) as portrait_image:
                    portrait = portrait_image.convert("RGB").resize((thumb, thumb), Image.Resampling.LANCZOS)
                px = x + label_w + tier_index * thumb
                review.paste(portrait, (px, sy))
                draw.rectangle((px, sy, px + thumb - 1, sy + thumb - 1), outline=edge, width=1)

    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    review.save(REVIEW, compress_level=6)


def main() -> None:
    written = package_missing()
    write_review()
    print(f"wrote {len(written)} missing portrait(s)")
    for path in written:
        print(path.relative_to(ROOT))
    print(f"review: {REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
