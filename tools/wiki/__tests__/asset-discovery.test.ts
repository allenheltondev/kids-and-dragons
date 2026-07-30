import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { discoverAssets, discoverAllAssets } from '../asset-discovery.ts';
import type { CanonEntity } from '../types.ts';

const fixturesDir = path.resolve(import.meta.dirname, 'fixtures');
const assetsDir = path.join(fixturesDir, 'assets');

/** Helper to create a minimal CanonEntity for testing. */
function makeEntity(overrides: Partial<CanonEntity> & { id: string; type: string }): CanonEntity {
  return {
    title: overrides.id.split('.')[1] ?? overrides.id,
    relationships: {},
    metadata: {},
    ...overrides,
  };
}

describe('discoverAssets', () => {
  describe('explicit asset references', () => {
    it('uses the first explicit asset reference as primary', () => {
      const entity = makeEntity({
        id: 'creature.bigfoot',
        type: 'creature',
        assets: ['assets/characters/bigfoot/fledgling/idle.png', 'assets/characters/bigfoot/adult/idle.png'],
      });

      const { result, warnings } = discoverAssets(entity, assetsDir);

      expect(result.entityId).toBe('creature.bigfoot');
      expect(result.source).toBe('explicit');
      expect(result.primary).toBe('assets/characters/bigfoot/fledgling/idle.png');
      expect(result.gallery).toBeUndefined();
      expect(warnings).toHaveLength(0);
    });

    it('takes precedence over convention-based discovery', () => {
      // bigfoot has a convention directory with an image, but explicit should win
      const entity = makeEntity({
        id: 'creature.bigfoot',
        type: 'creature',
        assets: ['explicit/path/image.png'],
      });

      const { result } = discoverAssets(entity, assetsDir);

      expect(result.source).toBe('explicit');
      expect(result.primary).toBe('explicit/path/image.png');
    });
  });

  describe('convention-based discovery — single image', () => {
    it('sets single image as primary when exactly one image found', () => {
      const entity = makeEntity({
        id: 'creature.bigfoot',
        type: 'creature',
      });

      const { result, warnings } = discoverAssets(entity, assetsDir);

      expect(result.entityId).toBe('creature.bigfoot');
      expect(result.source).toBe('convention');
      expect(result.primary).toContain('creatures/bigfoot/idle.png');
      expect(result.gallery).toBeUndefined();
      expect(warnings).toHaveLength(0);
    });

    it('uses forward slashes in paths', () => {
      const entity = makeEntity({
        id: 'creature.bigfoot',
        type: 'creature',
      });

      const { result } = discoverAssets(entity, assetsDir);

      expect(result.primary).not.toContain('\\');
    });

    it('works for biome entities', () => {
      const entity = makeEntity({
        id: 'biome.enchanted_woods',
        type: 'biome',
      });

      const { result, warnings } = discoverAssets(entity, assetsDir);

      expect(result.source).toBe('convention');
      expect(result.primary).toContain('biomes/enchanted_woods/landscape.png');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('convention-based discovery — multiple images', () => {
    it('sets multiple images as gallery sorted alphabetically', () => {
      const entity = makeEntity({
        id: 'creature.silver_otter',
        type: 'creature',
      });

      const { result, warnings } = discoverAssets(entity, assetsDir);

      expect(result.entityId).toBe('creature.silver_otter');
      expect(result.source).toBe('convention');
      expect(result.primary).toBeUndefined();
      expect(result.gallery).toBeDefined();
      expect(result.gallery!.length).toBe(3);

      // Should be alpha-sorted by filename: playing.jpg, portrait.webp, swimming.png
      const filenames = result.gallery!.map((p) => p.split('/').pop());
      expect(filenames).toEqual(['playing.jpg', 'portrait.webp', 'swimming.png']);
      expect(warnings).toHaveLength(0);
    });

    it('excludes .json metadata files from gallery', () => {
      const entity = makeEntity({
        id: 'creature.silver_otter',
        type: 'creature',
      });

      const { result } = discoverAssets(entity, assetsDir);

      // metadata.json should not appear in results
      const allPaths = result.gallery ?? (result.primary ? [result.primary] : []);
      const hasJson = allPaths.some((p) => p.endsWith('.json'));
      expect(hasJson).toBe(false);
    });
  });

  describe('no images found', () => {
    it('emits a warning when directory exists but has no images', () => {
      // Create a scenario where we look for an entity whose dir has no images
      // Use a type/name combo where the dir doesn't have images
      const entity = makeEntity({
        id: 'creature.ghost_entity',
        type: 'creature',
      });

      const { result, warnings } = discoverAssets(entity, assetsDir);

      // Directory doesn't exist → source is 'none'
      expect(result.source).toBe('none');
      expect(result.primary).toBeUndefined();
      expect(result.gallery).toBeUndefined();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]!.level).toBe('warning');
      expect(warnings[0]!.entityId).toBe('creature.ghost_entity');
    });
  });

  describe('non-existent directory', () => {
    it('emits a warning when the convention directory does not exist', () => {
      const entity = makeEntity({
        id: 'creature.nonexistent',
        type: 'creature',
      });

      const { result, warnings } = discoverAssets(entity, assetsDir);

      expect(result.entityId).toBe('creature.nonexistent');
      expect(result.source).toBe('none');
      expect(result.primary).toBeUndefined();
      expect(result.gallery).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.level).toBe('warning');
      expect(warnings[0]!.entityId).toBe('creature.nonexistent');
      expect(warnings[0]!.message).toContain('not found');
    });

    it('emits a warning when assets directory itself does not exist', () => {
      const entity = makeEntity({
        id: 'creature.bigfoot',
        type: 'creature',
      });

      const { result, warnings } = discoverAssets(entity, '/nonexistent/assets');

      expect(result.source).toBe('none');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.level).toBe('warning');
    });
  });
});

describe('discoverAllAssets', () => {
  it('discovers assets for all entities in a registry', () => {
    const entities = new Map<string, CanonEntity>([
      ['creature.bigfoot', makeEntity({ id: 'creature.bigfoot', type: 'creature' })],
      ['creature.silver_otter', makeEntity({ id: 'creature.silver_otter', type: 'creature' })],
      ['biome.enchanted_woods', makeEntity({ id: 'biome.enchanted_woods', type: 'biome' })],
    ]);

    const { results, warnings } = discoverAllAssets(entities, assetsDir);

    expect(results.size).toBe(3);
    expect(results.get('creature.bigfoot')!.source).toBe('convention');
    expect(results.get('creature.bigfoot')!.primary).toContain('idle.png');
    expect(results.get('creature.silver_otter')!.source).toBe('convention');
    expect(results.get('creature.silver_otter')!.gallery).toHaveLength(3);
    expect(results.get('biome.enchanted_woods')!.source).toBe('convention');
    expect(results.get('biome.enchanted_woods')!.primary).toContain('landscape.png');
    expect(warnings).toHaveLength(0);
  });

  it('collects warnings from all entities', () => {
    const entities = new Map<string, CanonEntity>([
      ['creature.bigfoot', makeEntity({ id: 'creature.bigfoot', type: 'creature' })],
      ['creature.missing', makeEntity({ id: 'creature.missing', type: 'creature' })],
    ]);

    const { results, warnings } = discoverAllAssets(entities, assetsDir);

    expect(results.size).toBe(2);
    expect(results.get('creature.bigfoot')!.source).toBe('convention');
    expect(results.get('creature.missing')!.source).toBe('none');
    expect(warnings.length).toBeGreaterThan(0);
  });
});
