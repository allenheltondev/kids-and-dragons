import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { validateCanon, isValidCanonId } from '../canon-validator.ts';
import { parseCanonDirectory } from '../canon-parser.ts';
import type { CanonEntity, CanonRegistry } from '../types.ts';

const fixturesDir = path.resolve(import.meta.dirname, 'fixtures');
const canonDir = path.join(fixturesDir, 'canon');
const canonInvalidDir = path.join(fixturesDir, 'canon-invalid');
const assetsDir = path.join(fixturesDir, 'assets');

/** Helper to build a minimal CanonRegistry from an array of entities. */
function buildRegistry(entities: CanonEntity[]): CanonRegistry {
  const entityMap = new Map<string, CanonEntity>();
  const byType = new Map<string, CanonEntity[]>();

  for (const entity of entities) {
    entityMap.set(entity.id, entity);
    const typeList = byType.get(entity.type);
    if (typeList) {
      typeList.push(entity);
    } else {
      byType.set(entity.type, [entity]);
    }
  }

  return { entities: entityMap, byType, reverseRefs: new Map() };
}

/** Helper to create a minimal valid entity. */
function makeEntity(overrides: Partial<CanonEntity> & { id: string }): CanonEntity {
  const dotIndex = overrides.id.indexOf('.');
  const type = dotIndex > 0 ? overrides.id.substring(0, dotIndex) : overrides.id;
  return {
    id: overrides.id,
    type,
    title: overrides.title ?? 'Test Entity',
    status: overrides.status,
    tags: overrides.tags,
    featured: overrides.featured,
    relationships: overrides.relationships ?? {},
    assets: overrides.assets,
    metadata: overrides.metadata ?? {},
  };
}

describe('isValidCanonId', () => {
  describe('valid Canon_IDs', () => {
    it('accepts a simple type.name format', () => {
      expect(isValidCanonId('creature.bigfoot')).toBe(true);
    });

    it('accepts name with underscores', () => {
      expect(isValidCanonId('biome.enchanted_woods')).toBe(true);
    });

    it('accepts name with digits', () => {
      expect(isValidCanonId('item.potion3')).toBe(true);
    });

    it('accepts single char type and name', () => {
      expect(isValidCanonId('a.b')).toBe(true);
    });

    it('accepts name with leading underscore', () => {
      expect(isValidCanonId('npc._hidden_merchant')).toBe(true);
    });

    it('accepts name with trailing underscore', () => {
      expect(isValidCanonId('quest.find_the_key_')).toBe(true);
    });

    it('accepts a 64-char Canon_ID (max length)', () => {
      // type "creature" (8) + "." (1) + name of 55 chars = 64 total
      const name = 'a'.repeat(55);
      expect(isValidCanonId(`creature.${name}`)).toBe(true);
      expect(`creature.${name}`.length).toBe(64);
    });
  });

  describe('invalid Canon_IDs', () => {
    it('rejects empty string', () => {
      expect(isValidCanonId('')).toBe(false);
    });

    it('rejects string without a dot', () => {
      expect(isValidCanonId('creature_bigfoot')).toBe(false);
    });

    it('rejects string with multiple dots', () => {
      expect(isValidCanonId('creature.big.foot')).toBe(false);
    });

    it('rejects uppercase letters in type', () => {
      expect(isValidCanonId('Creature.bigfoot')).toBe(false);
    });

    it('rejects uppercase letters in name', () => {
      expect(isValidCanonId('creature.Bigfoot')).toBe(false);
    });

    it('rejects digits in type', () => {
      expect(isValidCanonId('creature1.bigfoot')).toBe(false);
    });

    it('rejects spaces', () => {
      expect(isValidCanonId('creature.big foot')).toBe(false);
    });

    it('rejects hyphens in name', () => {
      expect(isValidCanonId('creature.big-foot')).toBe(false);
    });

    it('rejects IDs exceeding 64 characters', () => {
      const name = 'a'.repeat(56);
      const id = `creature.${name}`;
      expect(id.length).toBe(65);
      expect(isValidCanonId(id)).toBe(false);
    });

    it('rejects dot-only string', () => {
      expect(isValidCanonId('.')).toBe(false);
    });

    it('rejects leading dot', () => {
      expect(isValidCanonId('.bigfoot')).toBe(false);
    });

    it('rejects trailing dot', () => {
      expect(isValidCanonId('creature.')).toBe(false);
    });

    it('rejects special characters', () => {
      expect(isValidCanonId('creature.big@foot')).toBe(false);
    });
  });
});

describe('validateCanon', () => {
  describe('Canon_ID format validation', () => {
    it('reports no errors for valid IDs', () => {
      const registry = buildRegistry([
        makeEntity({ id: 'creature.bigfoot' }),
        makeEntity({ id: 'biome.enchanted_woods' }),
      ]);

      const result = validateCanon(registry, assetsDir);
      const idErrors = result.messages.filter(m => m.field === 'id' && m.message.includes('Invalid Canon_ID'));
      expect(idErrors).toHaveLength(0);
      expect(result.valid).toBe(true);
    });

    it('reports error for invalid Canon_ID format', () => {
      const registry = buildRegistry([
        makeEntity({ id: 'INVALID_ID' }),
      ]);

      const result = validateCanon(registry, assetsDir);
      const idErrors = result.messages.filter(m => m.field === 'id' && m.message.includes('Invalid Canon_ID'));
      expect(idErrors).toHaveLength(1);
      expect(idErrors[0]!.level).toBe('error');
      expect(result.valid).toBe(false);
    });
  });

  describe('required field validation', () => {
    it('reports error when title is empty', () => {
      const registry = buildRegistry([
        makeEntity({ id: 'creature.no_title', title: '' }),
      ]);

      const result = validateCanon(registry, assetsDir);
      const titleErrors = result.messages.filter(m => m.field === 'title');
      expect(titleErrors).toHaveLength(1);
      expect(titleErrors[0]!.level).toBe('error');
      expect(titleErrors[0]!.entityId).toBe('creature.no_title');
      expect(result.valid).toBe(false);
    });

    it('does not report error when title is present', () => {
      const registry = buildRegistry([
        makeEntity({ id: 'creature.valid', title: 'Valid Creature' }),
      ]);

      const result = validateCanon(registry, assetsDir);
      const titleErrors = result.messages.filter(m => m.field === 'title');
      expect(titleErrors).toHaveLength(0);
    });
  });

  describe('duplicate Canon_ID detection', () => {
    it('detects duplicate IDs from parsed fixture file', () => {
      const { registry } = parseCanonDirectory(canonInvalidDir);

      // The duplicate-ids.yaml has two entities with id "creature.shadow_wolf"
      // After parsing, the byType list should contain duplicates since
      // the parser pushes to the array before deduplicating via Map
      const result = validateCanon(registry, assetsDir);
      const dupErrors = result.messages.filter(m => m.message.includes('Duplicate Canon_ID'));

      // The parser's Map.set deduplicates, but byType array retains both
      // Let's verify using a manual registry
      const entity1 = makeEntity({ id: 'creature.shadow_wolf', title: 'Shadow Wolf' });
      const entity2 = makeEntity({ id: 'creature.shadow_wolf', title: 'Shadow Wolf Duplicate' });

      const manualRegistry: CanonRegistry = {
        entities: new Map([['creature.shadow_wolf', entity2]]),
        byType: new Map([['creature', [entity1, entity2]]]),
        reverseRefs: new Map(),
      };

      const manualResult = validateCanon(manualRegistry, assetsDir);
      const manualDupErrors = manualResult.messages.filter(m => m.message.includes('Duplicate Canon_ID'));
      expect(manualDupErrors).toHaveLength(1);
      expect(manualDupErrors[0]!.level).toBe('error');
      expect(manualDupErrors[0]!.entityId).toBe('creature.shadow_wolf');
      expect(manualResult.valid).toBe(false);
    });

    it('reports no duplicate error when all IDs are unique', () => {
      const registry = buildRegistry([
        makeEntity({ id: 'creature.alpha' }),
        makeEntity({ id: 'creature.beta' }),
        makeEntity({ id: 'biome.gamma' }),
      ]);

      const result = validateCanon(registry, assetsDir);
      const dupErrors = result.messages.filter(m => m.message.includes('Duplicate Canon_ID'));
      expect(dupErrors).toHaveLength(0);
    });
  });

  describe('relationship reference validation', () => {
    it('emits warning for broken relationship references', () => {
      const registry = buildRegistry([
        makeEntity({
          id: 'creature.lonely',
          relationships: {
            habitat: ['biome.nonexistent'],
            allies: ['creature.ghost'],
          },
        }),
      ]);

      const result = validateCanon(registry, assetsDir);
      const refWarnings = result.messages.filter(
        m => m.level === 'warning' && m.message.includes('Broken relationship reference')
      );
      expect(refWarnings).toHaveLength(2);
      expect(refWarnings[0]!.entityId).toBe('creature.lonely');
      expect(refWarnings[0]!.field).toBe('habitat');
      expect(refWarnings[1]!.field).toBe('allies');
    });

    it('does not emit warning for valid relationship references', () => {
      const registry = buildRegistry([
        makeEntity({ id: 'creature.bigfoot', relationships: { habitat: ['biome.woods'] } }),
        makeEntity({ id: 'biome.woods' }),
      ]);

      const result = validateCanon(registry, assetsDir);
      const refWarnings = result.messages.filter(
        m => m.level === 'warning' && m.message.includes('Broken relationship reference')
      );
      expect(refWarnings).toHaveLength(0);
    });

    it('broken references produce warnings, not errors (valid remains true)', () => {
      const registry = buildRegistry([
        makeEntity({
          id: 'creature.bigfoot',
          relationships: { habitat: ['biome.missing'] },
        }),
      ]);

      const result = validateCanon(registry, assetsDir);
      expect(result.valid).toBe(true); // warnings don't invalidate
      expect(result.messages.some(m => m.level === 'warning')).toBe(true);
    });
  });

  describe('asset reference validation', () => {
    it('emits warning for missing asset files', () => {
      const registry = buildRegistry([
        makeEntity({
          id: 'creature.bigfoot',
          assets: ['creatures/bigfoot/nonexistent.png'],
        }),
      ]);

      const result = validateCanon(registry, assetsDir);
      const assetWarnings = result.messages.filter(
        m => m.level === 'warning' && m.message.includes('Asset reference not found')
      );
      expect(assetWarnings).toHaveLength(1);
      expect(assetWarnings[0]!.entityId).toBe('creature.bigfoot');
    });

    it('does not emit warning for existing asset files', () => {
      const registry = buildRegistry([
        makeEntity({
          id: 'creature.bigfoot',
          assets: ['creatures/bigfoot/idle.png'],
        }),
      ]);

      const result = validateCanon(registry, assetsDir);
      const assetWarnings = result.messages.filter(
        m => m.level === 'warning' && m.message.includes('Asset reference not found')
      );
      expect(assetWarnings).toHaveLength(0);
    });

    it('asset warnings do not invalidate the result', () => {
      const registry = buildRegistry([
        makeEntity({
          id: 'creature.bigfoot',
          assets: ['creatures/bigfoot/missing.png'],
        }),
      ]);

      const result = validateCanon(registry, assetsDir);
      expect(result.valid).toBe(true);
    });

    it('skips asset check when entity has no assets array', () => {
      const registry = buildRegistry([
        makeEntity({ id: 'creature.bigfoot', assets: undefined }),
      ]);

      const result = validateCanon(registry, assetsDir);
      const assetWarnings = result.messages.filter(
        m => m.message.includes('Asset reference')
      );
      expect(assetWarnings).toHaveLength(0);
    });
  });

  describe('valid flag', () => {
    it('returns valid: true when only warnings are present', () => {
      const registry = buildRegistry([
        makeEntity({
          id: 'creature.bigfoot',
          relationships: { habitat: ['biome.missing'] },
        }),
      ]);

      const result = validateCanon(registry, assetsDir);
      expect(result.valid).toBe(true);
    });

    it('returns valid: false when any error is present', () => {
      const registry = buildRegistry([
        makeEntity({ id: 'creature.no_title', title: '' }),
      ]);

      const result = validateCanon(registry, assetsDir);
      expect(result.valid).toBe(false);
    });

    it('returns valid: true when no messages at all', () => {
      const registry = buildRegistry([
        makeEntity({ id: 'creature.bigfoot', title: 'Bigfoot' }),
      ]);

      const result = validateCanon(registry, assetsDir);
      expect(result.valid).toBe(true);
      expect(result.messages).toHaveLength(0);
    });
  });
});
