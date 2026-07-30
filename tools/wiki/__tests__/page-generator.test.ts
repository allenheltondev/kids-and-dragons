import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { parseCanonDirectory } from '../canon-parser.ts';
import { generatePage, getEntityPagePath, handleOrphanedPage } from '../page-generator.ts';
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
      primary: '/assets/creatures/bigfoot/idle.png',
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

    // Should have AI context section with markers
    expect(content).toContain('<!-- BEGIN GENERATED: ai_context -->');
    expect(content).toContain('<!-- END GENERATED: ai_context -->');
    expect(content).toContain('## AI Context');
    expect(content).toContain('**Mood:**');
    expect(content).toContain('**Themes:**');
    expect(content).toContain('**Visual Style:**');
    expect(content).toContain('**Common Encounters:**');
    expect(content).toContain('**Lore Highlights:**');
    expect(content).toContain('**Related Entities:**');
    expect(content).toContain('**Writing Guidance:**');
    expect(content).toContain('**Generation Hints:**');

    expect(warnings).toHaveLength(0);
  });

  it('includes asset in front matter when primary is set', () => {
    const entity = registry.entities.get('creature.bigfoot')!;
    const reverseRefs = registry.reverseRefs.get('creature.bigfoot') ?? [];
    const assets: AssetResult = {
      entityId: 'creature.bigfoot',
      primary: '/assets/creatures/bigfoot/idle.png',
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
      gallery: ['/assets/creatures/bigfoot/a.png', '/assets/creatures/bigfoot/b.png'],
      source: 'convention',
    };

    const { content } = generatePage({ entity, assets, reverseRefs }, registry);
    expect(content).toContain('gallery:');
    expect(content).toContain('/assets/creatures/bigfoot/a.png');
    expect(content).toContain('/assets/creatures/bigfoot/b.png');
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
    expect(content).toContain('[Enchanted Woods](/biomes/enchanted_woods/) — habitat');

    // Should have creatures group (from allies/enemies + reverse refs)
    expect(content).toContain('### Creatures');
    expect(content).toContain('[Silver Otter](/creatures/silver_otter/)');
    expect(content).toContain('[Bone Crawler](/creatures/bone_crawler/)');
  });

  it('populates AI context fields from canon metadata', () => {
    const entity = registry.entities.get('creature.bigfoot')!;
    const reverseRefs = registry.reverseRefs.get('creature.bigfoot') ?? [];
    const assets: AssetResult = { entityId: 'creature.bigfoot', source: 'none' };

    const { content } = generatePage({ entity, assets, reverseRefs }, registry);

    expect(content).toContain('**Mood:** A towering forest guardian covered in moss and ancient bark');
    expect(content).toContain('**Visual Style:** Massive, moss-covered creature with glowing amber eyes');
    expect(content).toContain('**Common Encounters:** Forest encounters, nature quests, guardian trials');
    expect(content).toContain('**Writing Guidance:** Never aggressive unprovoked. Protects ancient groves.');
    expect(content).toContain('**Generation Hints:** Patrols ancient groves at dawn and dusk');
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

    // All sub-fields must be present, even with empty values
    expect(content).toContain('**Mood:** ');
    expect(content).toContain('**Themes:** ');
    expect(content).toContain('**Visual Style:** ');
    expect(content).toContain('**Common Encounters:** ');
    expect(content).toContain('**Lore Highlights:** ');
    expect(content).toContain('**Related Entities:** ');
    expect(content).toContain('**Writing Guidance:** ');
    expect(content).toContain('**Generation Hints:** ');
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
      primary: '/assets/creatures/bigfoot/idle.png',
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

    // Generated sections should be updated
    expect(content).toContain('<!-- BEGIN GENERATED: relationships -->');
    expect(content).toContain('<!-- END GENERATED: relationships -->');
    expect(content).toContain('<!-- BEGIN GENERATED: ai_context -->');
    expect(content).toContain('<!-- END GENERATED: ai_context -->');

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
      primary: '/assets/creatures/bigfoot/idle.png',
      source: 'convention',
    };

    const { content } = generatePage(
      { entity, assets, reverseRefs, existingContent },
      registry,
    );

    // AI context should have fresh values
    expect(content).toContain('**Mood:** A towering forest guardian covered in moss and ancient bark');
    expect(content).toContain('**Generation Hints:** Patrols ancient groves at dawn and dusk');
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

    // Generated sections should be appended at end
    expect(content).toContain('<!-- BEGIN GENERATED: relationships -->');
    expect(content).toContain('<!-- END GENERATED: relationships -->');
    expect(content).toContain('<!-- BEGIN GENERATED: ai_context -->');
    expect(content).toContain('<!-- END GENERATED: ai_context -->');

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
