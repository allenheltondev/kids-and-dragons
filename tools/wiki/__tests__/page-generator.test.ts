import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { parseCanonDirectory } from '../canon-parser.ts';
import { generatePage, getEntityPagePath, handleOrphanedPage, getConventionAssetPath, getAssetName, resolveConventionAssets } from '../page-generator.ts';
import type { AssetResult, CanonEntity, CanonRegistry, ReverseRef } from '../types.ts';
import fs from 'node:fs';

const fixturesDir = path.resolve(import.meta.dirname, 'fixtures');
const canonDir = path.join(fixturesDir, 'canon');
const existingPagesDir = path.join(fixturesDir, 'existing-pages');

let registry: CanonRegistry;

beforeAll(() => {
  const result = parseCanonDirectory(canonDir);
  registry = result.registry;
});

describe('getEntityPagePath', () => {
  it('derives the correct path for a creature entity', () => {
    const entity = registry.entities.get('creature.bigfoot')!;
    const result = getEntityPagePath(entity, 'wiki/content');
    expect(result).toBe('wiki/content/creatures/bigfoot.md');
  });

  it('derives the correct path for a biome entity', () => {
    const entity = registry.entities.get('biome.enchanted_woods')!;
    const result = getEntityPagePath(entity, 'wiki/content');
    expect(result).toBe('wiki/content/biomes/enchanted_woods.md');
  });

  it('derives the correct path for an item entity', () => {
    const entity = registry.entities.get('item.forest_moss')!;
    const result = getEntityPagePath(entity, 'wiki/content');
    expect(result).toBe('wiki/content/items/forest_moss.md');
  });

  it('does not double-pluralize types already ending in s', () => {
    // Simulate an entity type that already ends in s (e.g., "npcs")
    const fakeEntity: CanonEntity = {
      id: 'npcs.town_guard',
      type: 'npcs',
      title: 'Town Guard',
      relationships: {},
      metadata: {},
    };
    const result = getEntityPagePath(fakeEntity, '/content');
    // "npcs" already ends in "s" so it stays "npcs"
    expect(result).toBe('/content/npcs/town_guard.md');
  });
});

describe('generatePage — new page creation', () => {
  it('generates a complete new page with front matter, relationships, and AI context', () => {
    const entity = registry.entities.get('creature.bigfoot')!;
    const reverseRefs = registry.reverseRefs.get('creature.bigfoot') ?? [];
    const assets: AssetResult = {
      entityId: 'creature.bigfoot',
      primary: { src: '/assets/creatures/bigfoot/idle.png', full: '/assets/creatures/bigfoot/idle.png' },
      source: 'convention',
    };

    const { content, warnings } = generatePage(
      { entity, assets, reverseRefs },
      registry,
    );

    // Should have front matter
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('title: Bigfoot');
    expect(content).toContain('id: creature.bigfoot');
    expect(content).toContain('type: creature');
    expect(content).toContain('status: reviewed');
    expect(content).toMatch(/lastReviewed: "\d{4}-\d{2}-\d{2}"/);
    expect(content).toContain('layout: creatures');
    expect(content).toContain('infobox: creature');

    // Should have relationship section with markers
    expect(content).toContain('<!-- BEGIN GENERATED: relationships -->');
    expect(content).toContain('<!-- END GENERATED: relationships -->');
    expect(content).toContain('## Related Entities');

    // AI context should be in front matter (not body block)
    expect(content).toContain('ai_context:');
    expect(content).toContain('mood:');
    expect(content).toContain('themes:');
    expect(content).toContain('visual_style:');
    expect(content).toContain('common_encounters:');
    expect(content).toContain('lore_highlights:');
    expect(content).toContain('related_entities:');
    expect(content).toContain('writing_guidance:');
    expect(content).toContain('generation_hints:');

    expect(warnings).toHaveLength(0);
  });

  it('includes asset in front matter when primary is set', () => {
    const entity = registry.entities.get('creature.bigfoot')!;
    const reverseRefs = registry.reverseRefs.get('creature.bigfoot') ?? [];
    const assets: AssetResult = {
      entityId: 'creature.bigfoot',
      primary: { src: '/assets/creatures/bigfoot/idle.png', full: '/assets/creatures/bigfoot/idle.png' },
      source: 'convention',
    };

    const { content } = generatePage({ entity, assets, reverseRefs }, registry);
    expect(content).toContain('primary: /assets/creatures/bigfoot/idle.png');
  });

  it('includes gallery in front matter when multiple assets found', () => {
    const entity = registry.entities.get('creature.bigfoot')!;
    const reverseRefs = registry.reverseRefs.get('creature.bigfoot') ?? [];
    const assets: AssetResult = {
      entityId: 'creature.bigfoot',
      gallery: [
        { src: '/assets/creatures/bigfoot/a.webp', full: '/assets/creatures/bigfoot/a.png' },
        { src: '/assets/creatures/bigfoot/b.png', full: '/assets/creatures/bigfoot/b.png' },
      ],
      source: 'convention',
    };

    const { content } = generatePage({ entity, assets, reverseRefs }, registry);
    expect(content).toContain('gallery:');
    // Each entry carries both sizes: the page renders `src`, the lightbox
    // opens `full`. They differ only where a portrait has been derived.
    expect(content).toContain('- src: /assets/creatures/bigfoot/a.webp');
    expect(content).toContain('  full: /assets/creatures/bigfoot/a.png');
    expect(content).toContain('- src: /assets/creatures/bigfoot/b.png');
  });

  it('omits assets from front matter when none found', () => {
    const entity = registry.entities.get('creature.bigfoot')!;
    const reverseRefs = registry.reverseRefs.get('creature.bigfoot') ?? [];
    const assets: AssetResult = {
      entityId: 'creature.bigfoot',
      source: 'none',
    };

    const { content } = generatePage({ entity, assets, reverseRefs }, registry);
    expect(content).not.toMatch(/^assets:/m);
  });

  it('generates relationships grouped by type and sorted alphabetically', () => {
    const entity = registry.entities.get('creature.bigfoot')!;
    const reverseRefs = registry.reverseRefs.get('creature.bigfoot') ?? [];
    const assets: AssetResult = { entityId: 'creature.bigfoot', source: 'none' };

    const { content } = generatePage({ entity, assets, reverseRefs }, registry);

    // Should have biomes group (from habitat relationship)
    expect(content).toContain('### Biomes');
    expect(content).toContain('[Enchanted Woods](/biomes/enchanted_woods/) `Habitat`');

    // Should have creatures group (from allies/enemies + reverse refs)
    expect(content).toContain('### Creatures');
    expect(content).toContain('[Silver Otter](/creatures/silver_otter/)');
    expect(content).toContain('[Bone Crawler](/creatures/bone_crawler/)');
  });

  it('populates AI context fields from canon metadata in front matter', () => {
    const entity = registry.entities.get('creature.bigfoot')!;
    const reverseRefs = registry.reverseRefs.get('creature.bigfoot') ?? [];
    const assets: AssetResult = { entityId: 'creature.bigfoot', source: 'none' };

    const { content } = generatePage({ entity, assets, reverseRefs }, registry);

    // AI context is now in front matter as YAML
    expect(content).toContain('mood: "A towering forest guardian covered in moss and ancient bark"');
    expect(content).toContain('visual_style: "Massive, moss-covered creature with glowing amber eyes"');
    expect(content).toContain('common_encounters: "Forest encounters, nature quests, guardian trials"');
    expect(content).toContain('writing_guidance: "Never aggressive unprovoked. Protects ancient groves."');
    expect(content).toContain('generation_hints: "Patrols ancient groves at dawn and dusk"');
  });

  it('includes all AI context sub-fields even when metadata is empty', () => {
    const entity: CanonEntity = {
      id: 'creature.mystery',
      type: 'creature',
      title: 'Mystery',
      relationships: {},
      metadata: {},
    };
    const assets: AssetResult = { entityId: 'creature.mystery', source: 'none' };

    const { content } = generatePage(
      { entity, assets, reverseRefs: [] },
      registry,
    );

    // All sub-fields must be present in front matter, even with empty values
    expect(content).toContain('mood: ""');
    expect(content).toContain('themes: ""');
    expect(content).toContain('visual_style: ""');
    expect(content).toContain('common_encounters: ""');
    expect(content).toContain('lore_highlights: ""');
    expect(content).toContain('related_entities: ""');
    expect(content).toContain('writing_guidance: ""');
    expect(content).toContain('generation_hints: ""');
  });

  it('omits relationships section when entity has no relationships', () => {
    const entity: CanonEntity = {
      id: 'creature.loner',
      type: 'creature',
      title: 'Loner',
      relationships: {},
      metadata: {},
    };
    const assets: AssetResult = { entityId: 'creature.loner', source: 'none' };

    const { content } = generatePage(
      { entity, assets, reverseRefs: [] },
      registry,
    );

    expect(content).not.toContain('<!-- BEGIN GENERATED: relationships -->');
    expect(content).not.toContain('## Related Entities');
  });

  it('defaults status to "draft" when entity has no status', () => {
    const entity: CanonEntity = {
      id: 'creature.unknown',
      type: 'creature',
      title: 'Unknown',
      relationships: {},
      metadata: {},
    };
    const assets: AssetResult = { entityId: 'creature.unknown', source: 'none' };

    const { content } = generatePage(
      { entity, assets, reverseRefs: [] },
      registry,
    );

    expect(content).toContain('status: draft');
  });
});

describe('generatePage — updating existing pages with markers', () => {
  it('preserves handwritten content between markers', () => {
    const existingContent = fs.readFileSync(
      path.join(existingPagesDir, 'creature-with-handwritten.md'),
      'utf-8',
    );

    const entity = registry.entities.get('creature.bigfoot')!;
    const reverseRefs = registry.reverseRefs.get('creature.bigfoot') ?? [];
    const assets: AssetResult = {
      entityId: 'creature.bigfoot',
      primary: { src: '/assets/creatures/bigfoot/idle.png', full: '/assets/creatures/bigfoot/idle.png' },
      source: 'convention',
    };

    const { content, warnings } = generatePage(
      { entity, assets, reverseRefs, existingContent },
      registry,
    );

    // Handwritten content must be preserved
    expect(content).toContain(
      '_This is handwritten lore content that the generator must never overwrite._',
    );
    expect(content).toContain('The Bigfoot is an ancient guardian of the Enchanted Woods');
    expect(content).toContain('### Origins');
    expect(content).toContain('## Combat Notes');
    expect(content).toContain('Despite its gentle nature, a provoked Bigfoot is a fearsome opponent.');

    // Generated sections should be updated (relationships still as body block)
    expect(content).toContain('<!-- BEGIN GENERATED: relationships -->');
    expect(content).toContain('<!-- END GENERATED: relationships -->');

    // ai_context is now in front matter, old body block should be removed
    expect(content).not.toContain('<!-- BEGIN GENERATED: ai_context -->');
    expect(content).toContain('ai_context:');

    // Front matter should be regenerated
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('title: Bigfoot');

    expect(warnings).toHaveLength(0);
  });

  it('updates generated sections with fresh data', () => {
    const existingContent = fs.readFileSync(
      path.join(existingPagesDir, 'creature-with-handwritten.md'),
      'utf-8',
    );

    const entity = registry.entities.get('creature.bigfoot')!;
    const reverseRefs = registry.reverseRefs.get('creature.bigfoot') ?? [];
    const assets: AssetResult = {
      entityId: 'creature.bigfoot',
      primary: { src: '/assets/creatures/bigfoot/idle.png', full: '/assets/creatures/bigfoot/idle.png' },
      source: 'convention',
    };

    const { content } = generatePage(
      { entity, assets, reverseRefs, existingContent },
      registry,
    );

    // AI context should have fresh values in front matter
    expect(content).toContain('mood: "A towering forest guardian covered in moss and ancient bark"');
    expect(content).toContain('generation_hints: "Patrols ancient groves at dawn and dusk"');
  });
});

describe('generatePage — pages without markers', () => {
  it('appends generated sections at end and emits warning', () => {
    const existingContent = fs.readFileSync(
      path.join(existingPagesDir, 'page-without-markers.md'),
      'utf-8',
    );

    const entity = registry.entities.get('creature.silver_otter')!;
    const reverseRefs = registry.reverseRefs.get('creature.silver_otter') ?? [];
    const assets: AssetResult = { entityId: 'creature.silver_otter', source: 'none' };

    const { content, warnings } = generatePage(
      { entity, assets, reverseRefs, existingContent },
      registry,
    );

    // Original content should be preserved
    expect(content).toContain('The Silver Otter is one of the most beloved creatures');
    expect(content).toContain('## Behavior');
    expect(content).toContain('## Cultural Significance');
    expect(content).toContain('## Notes for Writers');

    // Relationships section should be appended at end with markers
    expect(content).toContain('<!-- BEGIN GENERATED: relationships -->');
    expect(content).toContain('<!-- END GENERATED: relationships -->');

    // AI context is now in front matter, not a body block
    expect(content).toContain('ai_context:');
    expect(content).toContain('mood:');

    // Warning should be emitted
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.level).toBe('warning');
    expect(warnings[0]!.message).toContain('no generated section markers');
  });

  it('preserves all handwritten content byte-for-byte in page without markers', () => {
    const existingContent = fs.readFileSync(
      path.join(existingPagesDir, 'page-without-markers.md'),
      'utf-8',
    );

    const entity = registry.entities.get('creature.silver_otter')!;
    const reverseRefs = registry.reverseRefs.get('creature.silver_otter') ?? [];
    const assets: AssetResult = { entityId: 'creature.silver_otter', source: 'none' };

    const { content } = generatePage(
      { entity, assets, reverseRefs, existingContent },
      registry,
    );

    // The original body content (after front matter) should be in the output
    // Front matter gets regenerated, but body text preserved
    expect(content).toContain(
      'Silver Otters are social creatures that travel in small family groups of three to five.',
    );
  });
});

describe('handleOrphanedPage', () => {
  it('returns content unchanged and emits warning', () => {
    const existingContent = '---\ntitle: Ghost\n---\n\nSome content\n';
    const { content, warnings } = handleOrphanedPage(existingContent, 'wiki/content/creatures/ghost.md');

    expect(content).toBe(existingContent);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.level).toBe('warning');
    expect(warnings[0]!.message).toContain('Orphaned page');
  });
});

describe('generatePage — front matter related field', () => {
  it('includes both forward and reverse relationships in related array', () => {
    const entity = registry.entities.get('creature.bigfoot')!;
    const reverseRefs = registry.reverseRefs.get('creature.bigfoot') ?? [];
    const assets: AssetResult = { entityId: 'creature.bigfoot', source: 'none' };

    const { content } = generatePage({ entity, assets, reverseRefs }, registry);

    // Forward: habitat -> biome.enchanted_woods
    expect(content).toContain('id: biome.enchanted_woods');
    // The related field should be present
    expect(content).toContain('related:');
  });
});

describe('getConventionAssetPath', () => {
  it('maps character type to assets/characters/{name}/fledgling/assembled.png', () => {
    expect(getConventionAssetPath('character', 'bigfoot'))
      .toBe('assets/characters/bigfoot/fledgling/assembled.png');
  });

  it('maps creature type to assets/entities/{name}/assembled.png', () => {
    expect(getConventionAssetPath('creature', 'bone_crawler'))
      .toBe('assets/entities/bone_crawler/assembled.png');
  });

  it('maps npc type to assets/entities/{name}/assembled.png', () => {
    expect(getConventionAssetPath('npc', 'merchant'))
      .toBe('assets/entities/merchant/assembled.png');
  });

  it('maps biome type to assets/biomes/{name}/bg.webp', () => {
    expect(getConventionAssetPath('biome', 'enchanted_woods'))
      .toBe('assets/biomes/enchanted_woods/bg.webp');
  });

  it('returns null for unsupported entity types', () => {
    expect(getConventionAssetPath('item', 'forest_moss')).toBeNull();
    expect(getConventionAssetPath('quest', 'main_quest')).toBeNull();
    expect(getConventionAssetPath('faction', 'druids')).toBeNull();
  });
});

describe('getAssetName', () => {
  it('uses assetId when present on the entity', () => {
    const entity: CanonEntity = {
      id: 'creature.bone_crawler',
      type: 'creature',
      title: 'Bone Crawler',
      assetId: 'custom_bone_crawler',
      relationships: {},
      metadata: {},
    };
    expect(getAssetName(entity)).toBe('custom_bone_crawler');
  });

  it('uses asset_id from metadata when assetId is not set', () => {
    const entity: CanonEntity = {
      id: 'creature.bone_crawler',
      type: 'creature',
      title: 'Bone Crawler',
      relationships: {},
      metadata: { asset_id: 'meta_bone_crawler' },
    };
    expect(getAssetName(entity)).toBe('meta_bone_crawler');
  });

  it('derives name from Canon_ID when no assetId or asset_id is present', () => {
    const entity: CanonEntity = {
      id: 'creature.bone_crawler',
      type: 'creature',
      title: 'Bone Crawler',
      relationships: {},
      metadata: {},
    };
    expect(getAssetName(entity)).toBe('bone_crawler');
  });

  it('prefers assetId over metadata asset_id', () => {
    const entity: CanonEntity = {
      id: 'creature.bone_crawler',
      type: 'creature',
      title: 'Bone Crawler',
      assetId: 'from_asset_id_field',
      relationships: {},
      metadata: { asset_id: 'from_metadata' },
    };
    expect(getAssetName(entity)).toBe('from_asset_id_field');
  });
});

describe('resolveConventionAssets', () => {
  const assetsDir = path.resolve('assets');

  it('resolves primary for a character entity when file exists', () => {
    const entity: CanonEntity = {
      id: 'character.bigfoot',
      type: 'character',
      title: 'Bigfoot',
      relationships: {},
      metadata: {},
    };
    const result = resolveConventionAssets(entity, assetsDir);
    expect(result.primary?.full).toBe('assets/characters/bigfoot/fledgling/assembled.png');
    expect(result.source).toBe('convention');
  });

  it('resolves primary for a creature entity when file exists', () => {
    const entity: CanonEntity = {
      id: 'creature.bone_crawler',
      type: 'creature',
      title: 'Bone Crawler',
      relationships: {},
      metadata: {},
    };
    const result = resolveConventionAssets(entity, assetsDir);
    expect(result.primary?.full).toBe('assets/entities/bone_crawler/assembled.png');
    expect(result.source).toBe('convention');
  });

  it('resolves primary for a biome entity when file exists', () => {
    const entity: CanonEntity = {
      id: 'biome.enchanted_woods',
      type: 'biome',
      title: 'Enchanted Woods',
      relationships: {},
      metadata: {},
    };
    const result = resolveConventionAssets(entity, assetsDir);
    expect(result.primary?.full).toBe('assets/biomes/enchanted_woods/bg.webp');
    expect(result.source).toBe('convention');
  });

  it('omits primary when convention file does not exist', () => {
    const entity: CanonEntity = {
      id: 'creature.nonexistent_beast',
      type: 'creature',
      title: 'Nonexistent Beast',
      relationships: {},
      metadata: {},
    };
    const result = resolveConventionAssets(entity, assetsDir);
    expect(result.primary).toBeUndefined();
    expect(result.source).toBe('none');
  });

  it('uses assetId for path resolution when present', () => {
    const entity: CanonEntity = {
      id: 'creature.some_creature',
      type: 'creature',
      title: 'Some Creature',
      assetId: 'bone_crawler',
      relationships: {},
      metadata: {},
    };
    const result = resolveConventionAssets(entity, assetsDir);
    // Should resolve using 'bone_crawler' (from assetId) not 'some_creature' (from id)
    expect(result.primary?.full).toBe('assets/entities/bone_crawler/assembled.png');
    expect(result.source).toBe('convention');
  });

  it('returns gallery for characters with multiple tiers', () => {
    const entity: CanonEntity = {
      id: 'character.bigfoot',
      type: 'character',
      title: 'Bigfoot',
      relationships: {},
      metadata: {},
    };
    const result = resolveConventionAssets(entity, assetsDir);
    // bigfoot has fledgling, mythic, radiant, sworn tiers
    expect(result.gallery).toBeDefined();
    expect(result.gallery!.length).toBeGreaterThan(0);
    // primary (fledgling) should not be in gallery
    expect(result.gallery!.map((image) => image.full)).not.toContain('assets/characters/bigfoot/fledgling/assembled.png');
  });

  it('returns no assets for unsupported types', () => {
    const entity: CanonEntity = {
      id: 'item.forest_moss',
      type: 'item',
      title: 'Forest Moss',
      relationships: {},
      metadata: {},
    };
    const result = resolveConventionAssets(entity, assetsDir);
    expect(result.primary).toBeUndefined();
    expect(result.gallery).toBeUndefined();
    expect(result.source).toBe('none');
  });
});

describe('generatePage — lore section', () => {
  const liked: CanonEntity = {
    id: 'creature.mosshorn',
    type: 'creature',
    title: 'Mosshorn',
    relationships: {},
    metadata: {},
  };
  const entity: CanonEntity = {
    id: 'creature.testling',
    type: 'creature',
    title: 'Testling',
    relationships: { creatures: ['creature.mosshorn'] },
    metadata: {
      lore: {
        hook: 'A hook line.',
        story: 'A story paragraph.',
        pastimes: ['Doing the thing.'],
        social: 'Gets along fine.',
        likes: [{ of: 'creature.mosshorn', because: 'They weed.' }],
        dislikes: [{ of: 'npc.unknown_folk', because: 'Long story.' }],
      },
    },
  };
  const entities = new Map<string, CanonEntity>([
    [entity.id, entity],
    [liked.id, liked],
  ]);
  const assets: AssetResult = { entityId: entity.id, source: 'none' };

  it('renders the lore section with linked opinions on a new page', () => {
    const { content } = generatePage({ entity, assets, reverseRefs: [] }, entities);

    expect(content).toContain('<!-- BEGIN GENERATED: lore -->');
    expect(content).toContain('## Lore');
    expect(content).toContain('> *A hook line.*');
    expect(content).toContain('A story paragraph.');
    expect(content).toContain('### For Fun');
    expect(content).toContain('- Doing the thing.');
    expect(content).toContain('### Getting Along');
    expect(content).toContain('**[Mosshorn](/creatures/mosshorn/)** — They weed.');
    // An opinion of an entity outside the registry falls back to a derived title.
    expect(content).toContain('**[Unknown Folk](/npcs/unknown_folk/)** — Long story.');

    // Lore leads the body: before relationships.
    const loreIdx = content.indexOf('<!-- BEGIN GENERATED: lore -->');
    const relIdx = content.indexOf('<!-- BEGIN GENERATED: relationships -->');
    expect(loreIdx).toBeGreaterThan(-1);
    expect(loreIdx).toBeLessThan(relIdx);
  });

  it('writes the hook and resolved opinion chips into front matter', () => {
    const { content } = generatePage({ entity, assets, reverseRefs: [] }, entities);

    expect(content).toContain('lore_hook: "A hook line."');
    expect(content).toContain('likes:');
    expect(content).toContain('  - id: creature.mosshorn');
    expect(content).toContain('    title: "Mosshorn"');
    expect(content).toContain('    url: "/creatures/mosshorn/"');
    expect(content).toContain('    because: "They weed."');
    expect(content).toContain('dislikes:');
    expect(content).toContain('lore_highlights: "A hook line."');
  });

  it('inserts a lore section before existing generated markers on legacy pages', () => {
    const existing = [
      '---',
      'title: Testling',
      '---',
      '',
      'Handwritten intro that must survive.',
      '',
      '<!-- BEGIN GENERATED: relationships -->',
      'old relationships',
      '<!-- END GENERATED: relationships -->',
      '',
    ].join('\n');

    const { content } = generatePage(
      { entity, assets, reverseRefs: [], existingContent: existing },
      entities,
    );

    expect(content).toContain('Handwritten intro that must survive.');
    const introIdx = content.indexOf('Handwritten intro');
    const loreIdx = content.indexOf('<!-- BEGIN GENERATED: lore -->');
    const relIdx = content.indexOf('<!-- BEGIN GENERATED: relationships -->');
    expect(loreIdx).toBeGreaterThan(introIdx);
    expect(relIdx).toBeGreaterThan(loreIdx);
  });

  it('emits no lore section, hook, or chips for an entity without lore', () => {
    const { content } = generatePage(
      { entity: liked, assets: { entityId: liked.id, source: 'none' }, reverseRefs: [] },
      entities,
    );
    expect(content).not.toContain('<!-- BEGIN GENERATED: lore -->');
    expect(content).not.toContain('lore_hook:');
    expect(content).toContain('lore_highlights: ""');
  });
});
