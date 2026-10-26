"""Package the saved built-in imagegen exports; register and wire choice art."""
import hashlib
import json
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'art/source'
PAINTED = ROOT / 'packages/client/src/assets/painted'
catalog = json.loads((SOURCE / 'gemfall-497-options.json').read_text(encoding='utf-8'))
generated = json.loads((SOURCE / 'gemfall-497-option-generations.json').read_text(encoding='utf-8'))
by_id = {a['id']: a for a in generated}
records = []
pending = list(catalog['assets'])
while pending:
    progress = False
    for a in pending[:]:
        reuse = a['reuse']
        if reuse:
            source = ROOT / reuse if '/' in reuse else PAINTED / (reuse + '.webp')
            if not source.exists():
                continue
        else:
            record = by_id[a['id']]
            source = Path(record['output_hint'].split(' as ')[1].split('.png')[0] + '.png')
        target = PAINTED / (a['id'] + '.webp')
        with Image.open(source) as original:
            image = original.convert('RGBA')
            assert image.getextrema()[3][0] == 0, source
            bounds = image.getchannel('A').getbbox()
            safe_to_copy = min(bounds[0], bounds[1], image.width-bounds[2], image.height-bounds[3]) >= 16
            image = image.crop(image.getchannel('A').getbbox())
            image.thumbnail((224, 224), Image.Resampling.LANCZOS)
            canvas = Image.new('RGBA', (256, 256))
            canvas.paste(image, ((256-image.width)//2, (256-image.height)//2))
            if reuse and original.size == (256, 256) and safe_to_copy:
                shutil.copyfile(source, target)
            else:
                canvas.save(target, 'WEBP', quality=90, method=6)
        records.append({**a, 'sourceFile': str(source),
                        'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                        'productionSha256': hashlib.sha256(target.read_bytes()).hexdigest()})
        pending.remove(a)
        progress = True
    assert progress, pending
(SOURCE / 'gemfall-497-option-exports.json').write_text(json.dumps(records, indent=2)+'\n', encoding='utf-8')

manifest_path = ROOT / 'assets/manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
for a in catalog['assets']:
    if a['id'] not in manifest['paintedIcons']['ids']:
        manifest['paintedIcons']['ids'].append(a['id'])
manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')

registry_path = ROOT / 'packages/client/src/assets/artwork.ts'
registry = registry_path.read_text(encoding='utf-8')
imports, entries = [], []
for a in catalog['assets']:
    icon = a['id']
    if f'"./painted/{icon}.webp"' not in registry:
        imports.append(f'import {icon}Art from "./painted/{icon}.webp";')
        entries.append(f'  {icon}: {icon}Art,')
if imports:
    registry = '\n'.join(imports) + '\n' + registry
registry = registry.replace('export const PAINTED_ART: Record<string, string> = {', 'export const PAINTED_ART: Record<string, string> = {\n' + '\n'.join(entries))
registry_path.write_text(registry, encoding='utf-8')

chapters = {}
for key, icons in catalog['sets'].items():
    chapter_id, scene_id = key.split('/')
    path = ROOT / f'content/chapters/gemfall-{chapter_id}.json'
    chapter = chapters.setdefault(path, json.loads(path.read_text(encoding='utf-8')))
    options = chapter['scenes'][scene_id]['interaction']['options']
    assert len(options) == len(icons.split()), key
    for option, icon in zip(options, icons.split()):
        option['icon'] = icon
for path, chapter in chapters.items():
    path.write_text(json.dumps(chapter, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
print(f'Packaged {len(records)} icons and wired {len(catalog["sets"])} option sets')
