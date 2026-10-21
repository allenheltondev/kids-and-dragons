import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCanonDirectory } from '../canon-parser.ts';
import { generatePage } from '../page-generator.ts';
import { formatHeight, SIZE_COMPARISONS, sizeComparison, sizeLine, STANCE_WORDS } from '../size-line.ts';
import type { AssetResult, CanonEntity } from '../types.ts';

function figure(id: string, metadata: Record<string, unknown>): CanonEntity {
  return { id, type: id.split('.')[0]!, title: 'Test Figure', relationships: {}, metadata };
}

function page(entity: CanonEntity): string {
  const assets: AssetResult = { entityId: entity.id, source: 'none' };
  return generatePage({ entity, assets, reverseRefs: [] }, new Map([[entity.id, entity]])).content;
}

describe('formatHeight', () => {
  it.each([
    [8, '8 cm (3 in)'],
    [25, '25 cm (10 in)'],
    [95, '95 cm (3 ft 1 in)'],
    [100, '1 m (3 ft 3 in)'],
    [165, '1.65 m (5 ft 5 in)'],
    [183, '1.83 m (6 ft)'],
    [260, '2.6 m (8 ft 6 in)'],
    [400, '4 m (13 ft)'],
    [1400, '14 m (46 ft)'],
  ])('%i cm reads %s', (cm, words) => {
    expect(formatHeight(cm)).toBe(words);
  });
});

describe('the comparison table', () => {
  it('runs smallest first and ends without a ceiling', () => {
    const ceilings = SIZE_COMPARISONS.map((row) => row.upToCm);
    expect(ceilings).toEqual([...ceilings].sort((a, b) => a - b));
    expect(ceilings.at(-1)).toBe(Infinity);
    expect(new Set(SIZE_COMPARISONS.map((row) => row.words)).size).toBe(SIZE_COMPARISONS.length);
  });

  it.each([
    [8, 'fits in a teapot'],
    [15, 'fits in a teapot'],
    [16, 'fits in a backpack'],
    [45, 'knee-high to a grown-up'],
    [120, 'about as tall as a kid'],
    [170, 'as tall as a grown-up'],
    [230, 'as tall as a door'],
    [320, 'as tall as an elephant'],
    [900, 'as big as a house'],
    [1100, 'as long as a whale'],
  ])('%i cm is %s', (cm, words) => {
    expect(sizeComparison(cm)).toBe(words);
  });

  it('has words for every stance canon allows, and none for standing', () => {
    expect(Object.keys(STANCE_WORDS).sort()).toEqual(['flying', 'hovering', 'standing', 'swimming']);
    expect(STANCE_WORDS.standing).toBeNull();
  });
});

describe('the size line on a page', () => {
  it('a tiny figure', () => {
    const content = page(figure('item.crimson_shard', { height_cm: 8, stance: 'standing' }));
    expect(content).toContain('height_cm: 8\n');
    expect(content).toContain('  line: "8 cm (3 in), fits in a teapot."');
    expect(content).not.toContain('  stance:');
  });

  it('a person-sized figure', () => {
    const content = page(figure('npc.selkie', { height_cm: 165, stance: 'standing' }));
    expect(content).toContain('  height: "1.65 m (5 ft 5 in)"');
    expect(content).toContain('  compare: "as tall as a grown-up"');
    expect(content).toContain('  line: "1.65 m (5 ft 5 in), as tall as a grown-up."');
  });

  it('a huge figure', () => {
    const content = page(figure('creature.legend_dragon', { height_cm: 1400, stance: 'standing' }));
    expect(content).toContain('  line: "14 m (46 ft), as long as a whale."');
  });

  it('a flying figure', () => {
    const content = page(figure('creature.embermoth', { height_cm: 18, stance: 'flying' }));
    expect(content).toContain('  stance: "usually flies"');
    expect(content).toContain('  line: "18 cm (7 in), fits in a backpack. Usually flies."');
  });

  it('a page with no height gets no line', () => {
    const content = page(figure('location.bone_yard', { stance: 'standing' }));
    expect(content).not.toContain('height_cm:');
    expect(content).not.toContain('size:');
    expect(sizeLine(figure('item.forest_moss', {}))).toBeNull();
  });
});

describe('real canon', () => {
  const { registry } = parseCanonDirectory(path.resolve('canon'));
  const sized = [...registry.entities.values()].filter((e) => typeof e.metadata['height_cm'] === 'number');

  it('reads height_cm off every figure canon sizes', () => {
    expect(sized.length).toBeGreaterThan(30);
    for (const type of ['character', 'creature', 'npc', 'individual', 'item']) {
      expect(sized.some((e) => e.type === type), type).toBe(true);
    }
    for (const entity of sized) {
      expect(sizeLine(entity)?.heightCm, entity.id).toBe(entity.metadata['height_cm']);
    }
  });

  it('says how the flyers, hoverers and swimmers get about', () => {
    expect(sizeLine(registry.entities.get('creature.cloud_whale')!)?.stance).toBe('usually flies');
    expect(sizeLine(registry.entities.get('creature.will_o_wisp')!)?.stance).toBe('hovers');
    expect(sizeLine(registry.entities.get('npc.merfolk')!)?.stance).toBe('swims');
  });
});
