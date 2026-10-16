"""Land the approved Skupper canon from the Riftlight brief without rewriting lore."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    brief = (ROOT/'docs/briefs/riftlight-art-and-audio.md').read_text(encoding='utf-8')
    entry = brief.split('```yaml\n', 1)[1].split('```', 1)[0].rstrip()+'\n\n'
    path = ROOT/'canon/npcs.yaml'
    text = path.read_text(encoding='utf-8')
    if '  - skupper\n' not in text:
        text = text.replace('  - boggart\n', '  - skupper\n  - boggart\n', 1)
    if '  - id: npc.skupper\n' not in text:
        text = text.replace('  - id: npc.boggart\n', entry+'  - id: npc.boggart\n', 1)
    start = text.index('  - id: npc.frogfolk\n')
    end = text.index('  - id:', start+5)
    frogfolk = text[start:end].replace('secondary_locations: [location.exchange]', 'secondary_locations: [location.exchange, biome.sallow_wastelands]')
    text = text[:start]+frogfolk+text[end:]
    path.write_text(text, encoding='utf-8')
    path = ROOT/'canon/biomes.yaml'
    text = path.read_text(encoding='utf-8')
    start = text.index('  - id: biome.sallow_wastelands\n')
    end = text.find('  - id:', start+5)
    if end < 0: end = len(text)
    biome = text[start:end].replace('primary_peoples: []', 'primary_peoples: [npc.skupper]', 1).replace('supporting_peoples: []', 'supporting_peoples: [npc.frogfolk]', 1)
    path.write_text(text[:start]+biome+text[end:], encoding='utf-8')


if __name__ == '__main__': main()
