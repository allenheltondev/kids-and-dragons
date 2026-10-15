import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Bigfoot class recut anatomy', () => {
  it.each([
    ['starweaver', 'radiant'], ['starweaver', 'mythic'],
    ['songkeeper', 'sworn'], ['songkeeper', 'radiant'], ['songkeeper', 'mythic'],
  ])('preserves the corrected %s/%s base parts and pivots', (characterClass, tier) => {
    const base = `assets/characters/bigfoot/${tier}`;
    const variant = `assets/character-rigs/${characterClass}/${tier}/bigfoot`;
    for (const filename of readdirSync(`${base}/parts`)) {
      expect(readFileSync(`${variant}/parts/${filename}`).equals(readFileSync(`${base}/parts/${filename}`)), filename)
        .toBe(true);
    }
    const originalJoints = JSON.parse(readFileSync(`${base}/joints.json`, 'utf8'));
    const joints = JSON.parse(readFileSync(`${variant}/joints.json`, 'utf8'));
    for (const [part, pivot] of Object.entries(originalJoints)) {
      if (!part.startsWith('$')) expect(joints[part], part).toEqual(pivot);
    }
    expect(JSON.parse(readFileSync(`art/rig/${characterClass}-${tier}-bigfoot.rig.json`, 'utf8')).underpaint).toBe(0);
  });
});
