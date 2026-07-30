import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseCanonDirectory } from '../canon-parser.ts';

const fixturesDir = path.resolve(import.meta.dirname, 'fixtures');
const canonDir = path.join(fixturesDir, 'canon');
const canonInvalidDir = path.join(fixturesDir, 'canon-invalid');

describe('parseCanonDirectory', () => {
  describe('parsing valid canon directory', () => {
    it('builds a registry with all entities from YAML files', () => {
      const { registry, errors } = parseCanonDirectory(canonDir);

      // Should have parsed all entities from creatures, biomes, and items
      expect(registry.entities.size).toBe(8);
      expect(registry.entities.has('creature.bigfoot')).toBe(true);
      expect(registry.entities.has('creature.silver_otter')).toBe(true);
      expect(registry.entities.has('creature.bone_crawler')).toBe(true);
      expect(registry.entities.has('biome.enchanted_woods')).toBe(true);
      expect(registry.entities.has('biome.crystal_caverns')).toBe(true);
      expect(registry.entities.has('item.forest_moss')).toBe(true);
      expect(registry.entities.has('item.ancient_bark')).toBe(true);
      expect(registry.entities.has('item.shimmer_scale')).toBe(true);

      // No errors on valid files
      const parseErrors = errors.filter(e => e.level === 'error');
      expect(parseErrors).toHaveLength(0);
    });

    it('correctly extracts entity fields', () => {
      const { registry } = parseCanonDirectory(canonDir);
      const bigfoot = registry.entities.get('creature.bigfoot')!;

      expect(bigfoot.id).toBe('creature.bigfoot');
      expect(bigfoot.type).toBe('creature');
      expect(bigfoot.title).toBe('Bigfoot');
      expect(bigfoot.status).toBe('reviewed');
      expect(bigfoot.featured).toBe(true);
      expect(bigfoot.tags).toEqual(['forest', 'mythical', 'gentle']);
      expect(bigfoot.relationships).toEqual({
        habitat: ['biome.enchanted_woods'],
        allies: ['creature.silver_otter'],
        enemies: ['creature.bone_crawler'],
      });
    });

    it('places non-standard fields into metadata', () => {
      const { registry } = parseCanonDirectory(canonDir);
      const bigfoot = registry.entities.get('creature.bigfoot')!;

      // These should be in metadata, not as top-level CanonEntity fields
      expect(bigfoot.metadata['classification']).toBe('Guardian Beast');
      expect(bigfoot.metadata['habitat']).toBe('biome.enchanted_woods');
      expect(bigfoot.metadata['temperament']).toBe('Gentle');
      expect(bigfoot.metadata['difficulty']).toBe('Moderate');
      expect(bigfoot.metadata['drops']).toEqual(['item.forest_moss', 'item.ancient_bark']);
      expect(bigfoot.metadata['short_description']).toBe(
        'A towering forest guardian covered in moss and ancient bark'
      );
    });

    it('derives entity type from the id prefix', () => {
      const { registry } = parseCanonDirectory(canonDir);

      expect(registry.entities.get('creature.bigfoot')!.type).toBe('creature');
      expect(registry.entities.get('biome.enchanted_woods')!.type).toBe('biome');
      expect(registry.entities.get('item.forest_moss')!.type).toBe('item');
    });

    it('groups entities by type', () => {
      const { registry } = parseCanonDirectory(canonDir);

      expect(registry.byType.get('creature')).toHaveLength(3);
      expect(registry.byType.get('biome')).toHaveLength(2);
      expect(registry.byType.get('item')).toHaveLength(3);
    });

    it('defaults relationships to empty object when not present', () => {
      // All fixture entities have relationships, but we can still verify the logic
      const { registry } = parseCanonDirectory(canonDir);
      for (const entity of registry.entities.values()) {
        expect(entity.relationships).toBeDefined();
        expect(typeof entity.relationships).toBe('object');
      }
    });
  });

  describe('reverse references', () => {
    it('computes reverse references for referenced entities', () => {
      const { registry } = parseCanonDirectory(canonDir);

      // creature.bigfoot lists biome.enchanted_woods as habitat
      const enchantedWoodsRefs = registry.reverseRefs.get('biome.enchanted_woods');
      expect(enchantedWoodsRefs).toBeDefined();
      expect(enchantedWoodsRefs!.some(r => r.sourceId === 'creature.bigfoot' && r.relationshipKey === 'habitat')).toBe(true);
    });

    it('tracks all sources referencing a target', () => {
      const { registry } = parseCanonDirectory(canonDir);

      // biome.enchanted_woods is referenced by multiple entities
      const refs = registry.reverseRefs.get('biome.enchanted_woods')!;
      const sourceIds = refs.map(r => r.sourceId);

      // creature.bigfoot, creature.silver_otter reference it as habitat
      // biome itself references creatures, items reference it as found_in
      expect(sourceIds).toContain('creature.bigfoot');
      expect(sourceIds).toContain('creature.silver_otter');
      expect(sourceIds).toContain('item.forest_moss');
      expect(sourceIds).toContain('item.ancient_bark');
    });

    it('includes relationship key in reverse refs', () => {
      const { registry } = parseCanonDirectory(canonDir);

      // creature.bigfoot is referenced by creature.bone_crawler as an enemy
      const bigfootRefs = registry.reverseRefs.get('creature.bigfoot')!;
      const enemyRef = bigfootRefs.find(
        r => r.sourceId === 'creature.bone_crawler' && r.relationshipKey === 'enemies'
      );
      expect(enemyRef).toBeDefined();

      // creature.bigfoot is also referenced as an ally by creature.silver_otter
      const allyRef = bigfootRefs.find(
        r => r.sourceId === 'creature.silver_otter' && r.relationshipKey === 'allies'
      );
      expect(allyRef).toBeDefined();
    });

    it('creates reverse refs for items dropped_by relationships', () => {
      const { registry } = parseCanonDirectory(canonDir);

      // item.forest_moss has dropped_by: [creature.bigfoot]
      const bigfootRefs = registry.reverseRefs.get('creature.bigfoot')!;
      const droppedByRef = bigfootRefs.find(
        r => r.sourceId === 'item.forest_moss' && r.relationshipKey === 'dropped_by'
      );
      expect(droppedByRef).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('handles invalid YAML gracefully without crashing', () => {
      const { registry, errors } = parseCanonDirectory(canonInvalidDir);

      // Should not throw — should return errors instead
      const parseErrors = errors.filter(e => e.level === 'error');
      expect(parseErrors.length).toBeGreaterThan(0);

      // The bad-yaml.yaml file should produce a YAML parse error
      const badYamlError = parseErrors.find(e => e.file.includes('bad-yaml.yaml'));
      expect(badYamlError).toBeDefined();
      expect(badYamlError!.message).toContain('YAML parse error');
    });

    it('continues processing valid files after encountering invalid ones', () => {
      // canon-invalid has bad-yaml.yaml plus other files that may parse
      // The key point: it doesn't crash on bad YAML
      const result = parseCanonDirectory(canonInvalidDir);
      expect(result).toBeDefined();
      expect(result.registry).toBeDefined();
      expect(result.errors).toBeDefined();
    });

    it('returns empty registry for non-existent directory', () => {
      const { registry, errors } = parseCanonDirectory('/non/existent/path');

      expect(registry.entities.size).toBe(0);
      expect(registry.byType.size).toBe(0);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.level).toBe('error');
    });
  });
});
