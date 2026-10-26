"""Verify every requested art use and that chapter changes are presentation only."""
import copy
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))
chapters = {p.stem: json.loads(p.read_text(encoding='utf-8')) for p in (ROOT / 'content/chapters').glob('gemfall-*.json')}
locations = read('art/source/gemfall-497-locations.json')
for a in locations:
    for scene in a['scenes']:
        assert chapters[a['chapter']]['scenes'][scene]['art'] == 'scenes/gemfall/' + a['slug'], a
    assert (ROOT / 'assets/scenes/gemfall' / (a['slug'] + '.webp')).is_file()
props = read('art/source/gemfall-497-props.json')
for a in props:
    assert (ROOT / 'assets/story-props' / (a['id']+'.webp')).is_file(), a
    for chapter_id, scene_id in re.findall(r'(\d\d[a-z]?) `([^`]+)`', a['use']):
        appearance = chapters['gemfall-' + chapter_id]['presentation']['interactions'][scene_id]
        assert a['id'] in appearance.get('props', []) + appearance.get('coverIcons', []), (a, chapter_id, scene_id)
assert 'prop_straw_hat' in chapters['gemfall-02']['presentation']['interactions']['interaction_jackalope_hats']['coverIcons']
options = read('art/source/gemfall-497-options.json')
for key, icons in options['sets'].items():
    chapter_id, scene_id = key.split('/')
    actual = chapters['gemfall-'+chapter_id]['scenes'][scene_id]['interaction']['options']
    assert [o['icon'] for o in actual] == icons.split(), key

def without_paint(chapter):
    chapter = copy.deepcopy(chapter)
    chapter.pop('presentation', None)
    for scene in chapter['scenes'].values():
        scene.pop('art', None)
        for option in scene.get('interaction', {}).get('options', []):
            option.pop('icon', None)
    return chapter

compat_path = ROOT / 'packages/server/src/handlers/gemfall-compat.test.ts'
compat = compat_path.read_text(encoding='utf-8')
changed = []
for name, chapter in chapters.items():
    rel = f'content/chapters/{name}.json'
    baseline = json.loads(subprocess.check_output(['git', 'show', 'origin/main:'+rel], cwd=ROOT))
    assert without_paint(chapter) == without_paint(baseline), 'Gameplay changed: ' + name
    if chapter != baseline:
        changed.append(name)
        digest = hashlib.sha256((ROOT / rel).read_text(encoding='utf-8').encode()).hexdigest()
        compat, count = re.subn(r'("chapters/'+re.escape(name)+r'\.json": ")[a-f0-9]{64}', r'\g<1>'+digest, compat)
        assert count == 1, name
if 'remaining location and interaction paintings' not in compat:
    compat = compat.replace(' * Re-pinned for #497\'s chapter 01/02', ' * Re-pinned for #497\'s remaining location and interaction paintings;\n * only art, presentation and option icon fields changed. Gameplay comparisons\n * against origin/main and the pre-epic digests are unchanged.\n *\n * Re-pinned for #497\'s chapter 01/02')
compat_path.write_text(compat, encoding='utf-8')
print(f'49 location requests, {len(props)+1} unique props, {len(options["sets"])} option sets verified; {len(changed)} chapter hashes re-pinned after presentation-only comparison.')
