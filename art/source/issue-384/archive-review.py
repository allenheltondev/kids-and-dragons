"""Encode review screenshots as portable WebP documentation; never edits game assets."""
import json
from pathlib import Path
from PIL import Image

review = Path('art/review/issue-384')
dest = Path('docs/reviews/issue-384')
dest.mkdir(parents=True, exist_ok=True)
data = json.loads((review / 'scenes.json').read_text())
for scene, figure in zip(data['scenes'], data['ids']):
    for suffix, name in [('tv', 'tv'), ('phone', 'phone-before'), ('phone-guest-2', 'phone-after')]:
        source = review / f'cast-{scene}-{suffix}.png'
        if source.exists():
            Image.open(source).save(dest / f'{figure}-{name}.webp', quality=84, method=4)
for name in ['cast', 'overlays']:
    Image.open(review / f'{name}.png').save(dest / f'{name}.webp', quality=88, method=4)
print(f'Archived {len(list(dest.glob("*.webp")))} review images to {dest}')
