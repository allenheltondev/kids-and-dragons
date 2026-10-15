import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCanonDirectory } from '../canon-parser.ts';
import { generatePage, resolveConventionAssets } from '../page-generator.ts';

const { registry } = parseCanonDirectory(path.resolve('canon'));
const assetsDir = path.resolve('assets');

describe('delivered canon artwork', () => {
  it.each([
    ['individual.pib', 'assets/cast/pib/assembled.png'],
    ['individual.marda_thorn', 'assets/cast/marda_thorn/assembled.png'],
    ['individual.old_ossley', 'assets/cast/old_ossley/assembled.png'],
    ['item.crimson_shard', 'assets/items/crimson_shard/assembled.png'],
    ['item.crystal_heart', 'assets/items/crystal_heart/assembled.png'],
    ['item.marsh_lantern', 'assets/items/marsh_lantern/assembled.png'],
    ['faction.skywardens', 'assets/entities/skywardens/assembled.png'],
    ['location.hollow_gate', 'assets/scenes/gemfall/hollow-gate.webp'],
    ['biome.open_sea', 'assets/biomes/open_sea/bg.webp'],
    ...['mosshome', 'mount_red_sky', 'exchange', 'stone_crossing',
      'skullwater_cave', 'redspire_citadel', 'bone_yard', 'bramblewood', 'the_whirlpool']
      .map(id => [`location.${id}`, `assets/biomes/${id}/bg.webp`]),
    ['route.stone_crossing', 'assets/biomes/stone_crossing/bg.webp'],
  ])('connects %s to its existing image', (id, full) => {
    const result = resolveConventionAssets(registry.entities.get(id!)!, assetsDir);
    expect(result.primary?.full).toBe(full);
    expect(fs.existsSync(path.resolve(result.primary!.src))).toBe(true);
    expect(result.gallery?.map(image => image.full) ?? []).not.toContain(full);
    expect(result.gallery?.some(image => image.full.endsWith('/portrait.webp')) ?? false).toBe(false);
  });

  it('uses the derived cast preview and keeps the full image for the lightbox', () => {
    const result = resolveConventionAssets(registry.entities.get('individual.marda_thorn')!, assetsDir);
    expect(result.primary).toEqual({
      src: 'assets/cast/marda_thorn/portrait.webp',
      full: 'assets/cast/marda_thorn/assembled.png',
    });
  });

  it('does not turn the Gate page into a gallery of unrelated campaign scenes', () => {
    expect(resolveConventionAssets(registry.entities.get('location.hollow_gate')!, assetsDir).gallery)
      .toBeUndefined();
  });

  it('shows tile sheets themselves instead of reusing a backdrop thumbnail', () => {
    const result = resolveConventionAssets(registry.entities.get('location.exchange')!, assetsDir);
    expect(result.gallery).toContainEqual({
      src: 'assets/biomes/exchange/tiles.png',
      full: 'assets/biomes/exchange/tiles.png',
    });
  });

  it('preserves body spacing when regenerating a Windows checkout', () => {
    const entity = registry.entities.get('individual.marda_thorn')!;
    const assets = resolveConventionAssets(entity, assetsDir);
    const initial = generatePage({ entity, assets, reverseRefs: [] }, registry).content;
    const windowsPage = initial.replaceAll('\n', '\r\n');
    const regenerated = generatePage({ entity, assets, reverseRefs: [], existingContent: windowsPage }, registry).content;
    expect(regenerated.replaceAll('\r\n', '\n')).toBe(initial);
    expect(generatePage({ entity, assets, reverseRefs: [], existingContent: regenerated }, registry).content)
      .toBe(regenerated);
  });

  it.each(['faction.deep_hollow_cult', 'item.hollow_crown_shard', 'route.exchange_to_sunward_fields'])(
    'leaves %s without invented artwork', id => {
      expect(resolveConventionAssets(registry.entities.get(id)!, assetsDir).primary).toBeUndefined();
    },
  );
});
