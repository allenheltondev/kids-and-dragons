import { describe, it, expect } from 'vitest';
import { findChapterUses, findAllChapterUses, type ChapterText } from '../chapter-uses.ts';
import { generatePage } from '../page-generator.ts';
import type { AssetResult, CanonEntity } from '../types.ts';

const chapter = (id: string, body: unknown): ChapterText => ({ id, text: JSON.stringify(body).toLowerCase() });

const chapters: ChapterText[] = [
  chapter('c-01', { scenes: { a: { cast: [{ figure: 'entities/cinder_wolf' }], narration: 'The Great River runs wide here.' } } }),
  chapter('c-02', { scenes: { a: { encounter: { creature: 'river_drake' } } } }),
  chapter('c-03', { scenes: { a: { narration: 'Nobody here has heard of the whirlpool.' } } }),
];

const entity = (id: string, title: string, extra: Partial<CanonEntity> = {}): CanonEntity => ({
  id,
  type: id.split('.')[0]!,
  title,
  relationships: {},
  metadata: {},
  ...extra,
});

describe('findChapterUses', () => {
  it('finds an entity named by its id slug', () => {
    expect(findChapterUses(entity('creature.cinder_wolf', 'Cinder Wolf'), chapters)).toEqual(['c-01']);
    expect(findChapterUses(entity('creature.river_drake', 'River Drake'), chapters)).toEqual(['c-02']);
  });

  it('finds an entity named only in the story text, by title', () => {
    expect(findChapterUses(entity('feature.great_river', 'The Great River'), chapters)).toEqual(['c-01']);
    expect(findChapterUses(entity('location.the_whirlpool', 'The Whirlpool'), chapters)).toEqual(['c-03']);
  });

  it('does not match a slug inside a longer one', () => {
    expect(findChapterUses(entity('creature.drake', 'Drak'), chapters)).toEqual([]);
  });

  it('returns nothing for an entity no chapter uses', () => {
    expect(findChapterUses(entity('creature.cloud_whale', 'Cloud Whale'), chapters)).toEqual([]);
  });
});

describe('generatePage — played_in and protected mysteries', () => {
  const assets: AssetResult = { entityId: 'x', source: 'none' };
  const mystery = entity('faction.skywardens', 'The Skywardens', { canonStatus: 'intentionally_undefined' });

  it('keeps an unused mystery as a draft', () => {
    const { content } = generatePage({ entity: mystery, assets, reverseRefs: [], playedIn: [] }, new Map());
    expect(content).toContain('draft: true');
    expect(content).toContain('played_in: []');
  });

  it('publishes a mystery once a chapter uses it', () => {
    const { content } = generatePage({ entity: mystery, assets, reverseRefs: [], playedIn: ['gemfall-04c'] }, new Map());
    expect(content).not.toContain('draft: true');
    expect(content).toContain('played_in: ["gemfall-04c"]');
  });

  it('writes no played_in, and keeps the old draft rule, when no chapters were read', () => {
    const { content } = generatePage({ entity: mystery, assets, reverseRefs: [] }, new Map());
    expect(content).toContain('draft: true');
    expect(content).not.toContain('played_in');
  });
});

describe('findAllChapterUses — geography the story names in its own words', () => {
  const places = [
    entity('location.exchange', 'The Exchange'),
    entity('biome.sunward_fields', 'The Sunward Fields'),
    entity('biome.sky_islands', 'Sky Islands'),
  ];
  const story: ChapterText[] = [
    chapter('g-01', { biome: 'exchange', scenes: { a: { narration: 'Out past the sunward fields.' } } }),
  ];

  it('counts a route as used when one chapter visits every place it connects', () => {
    const road = entity('route.exchange_to_sunward_fields', 'Exchange–Sunward Road', {
      relationships: { connects: ['location.exchange', 'biome.sunward_fields'] },
    });
    expect(findAllChapterUses([...places, road], story).get(road.id)).toEqual(['g-01']);
  });

  it('does not count a route whose far end the story never visits', () => {
    const road = entity('route.exchange_to_sky', 'Sky Ladder', {
      relationships: { connects: ['location.exchange', 'biome.sky_islands'] },
    });
    expect(findAllChapterUses([...places, road], story).get(road.id)).toEqual([]);
  });

  it('counts a river feature as used when a chapter visits a place it reaches', () => {
    const branch = entity('feature.west_branch', 'Western Branch of the Great River', {
      relationships: { reaches: ['biome.sunward_fields', 'biome.sky_islands'] },
    });
    expect(findAllChapterUses([...places, branch], story).get(branch.id)).toEqual(['g-01']);
  });
});
