import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../assets/manifest.json';
import { environmentCoverage } from './environment-coverage.ts';

describe('canon environment coverage', () => {
  it('covers all 23 canon places without declaring story backgrounds as tactical kits', () => {
    expect(environmentCoverage(process.cwd(), manifest)).toEqual({ need: 23, missing: [] });
    expect(manifest.backgroundOnlyBiomes.filter(id => manifest.biomes.includes(id))).toEqual([]);
  });

  it('reports a canon place omitted from the manifest even when its art exists', () => {
    const result = environmentCoverage(process.cwd(), {
      ...manifest,
      backgroundOnlyBiomes: manifest.backgroundOnlyBiomes.filter(id => id !== 'bramblewood'),
    });
    expect(result.missing).toEqual(['location.bramblewood (backdrop not declared in manifest)']);
  });

  it('reports a declared background that is absent on disk and accepts shared scene art', () => {
    const root = mkdtempSync(join(tmpdir(), 'kad-environment-coverage-'));
    try {
      mkdirSync(join(root, 'canon'));
      writeFileSync(join(root, 'canon/biomes.yaml'), 'biomes:\n  - id: biome.open_sea\n');
      writeFileSync(join(root, 'canon/locations.yaml'), 'locations:\n  - id: location.hollow_gate\n');
      mkdirSync(join(root, 'assets/scenes/gemfall'), { recursive: true });
      writeFileSync(join(root, 'assets/scenes/gemfall/hollow-gate.webp'), 'fixture');
      expect(environmentCoverage(root, {
        biomes: [], backgroundOnlyBiomes: ['open_sea'],
        sceneIllustrations: ['scenes/gemfall/hollow-gate'],
      })).toEqual({ need: 2, missing: ['biome.open_sea (missing assets/biomes/open_sea/bg.webp)'] });
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});
