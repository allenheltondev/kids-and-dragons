"""Register generated issue-170 cutouts without changing their painted contents.

Usage: python art/source/package_gemfall_expansion_cast.py id=source.png [...]
Source originals stay untouched. Outputs use the manifest's 1024px canvas and
900px standing line. Run npm run art:verify after packaging.
"""
from pathlib import Path
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]

for argument in sys.argv[1:]:
    figure_id, source = argument.split('=', 1)
    if not figure_id.replace('_', '').isalnum():
        raise ValueError(f'Invalid figure id: {figure_id}')
    image = Image.open(source).convert('RGBA')
    # Ignore faint fringe pixels for tight packing. Preserve soft antialiasing
    # inside the crop; the art verifier independently checks alpha at threshold 8.
    bounds = image.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox()
    if bounds is None:
        raise ValueError(f'Empty cutout: {source}')
    figure = image.crop(bounds)
    factor = min(880 / figure.height, 976 / figure.width)
    figure = figure.resize((round(figure.width * factor), round(figure.height * factor)), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (1024, 1024))
    canvas.alpha_composite(figure, ((1024 - figure.width) // 2, 901 - figure.height))
    target = ROOT / 'assets' / 'cast' / figure_id / 'assembled.png'
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target, optimize=True)
    print(f'{figure_id}: {image.size} -> {target.relative_to(ROOT)}')
