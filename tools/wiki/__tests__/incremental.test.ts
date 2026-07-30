import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readManifest,
  updateManifest,
  checkIncremental,
  getCanonFileMtimes,
} from '../incremental.ts';
import type { ManifestData } from '../incremental.ts';
import type { CanonRegistry, GeneratorConfig } from '../types.ts';
import { parseCanonDirectory } from '../canon-parser.ts';

const fixturesDir = path.resolve(import.meta.dirname, 'fixtures');
const canonDir = path.join(fixturesDir, 'canon');

/** Create a temporary directory for test manifests. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-incr-test-'));
}

/** Remove a temporary directory recursively. */
function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Build a minimal registry for testing. */
function buildTestRegistry(): CanonRegistry {
  const { registry } = parseCanonDirectory(canonDir);
  return registry;
}

/** Build a GeneratorConfig pointing at the fixtures. */
function buildConfig(manifestPath: string, forceAll = false): GeneratorConfig {
  return {
    canonDir,
    assetsDir: path.join(fixturesDir, 'assets'),
    contentDir: path.join(fixturesDir, 'content'),
    manifestPath,
    forceAll,
  };
}

describe('readManifest', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('returns null when manifest file does not exist', () => {
    const result = readManifest(path.join(tempDir, 'nonexistent.json'));
    expect(result).toBeNull();
  });

  it('returns null when manifest has wrong version', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: 999,
      lastRun: '2025-01-15T10:30:00Z',
      files: {},
    }));

    const result = readManifest(manifestPath);
    expect(result).toBeNull();
  });

  it('returns null when manifest is invalid JSON', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    fs.writeFileSync(manifestPath, 'not valid json {{{');

    const result = readManifest(manifestPath);
    expect(result).toBeNull();
  });

  it('returns null when manifest is not an object', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify([1, 2, 3]));

    const result = readManifest(manifestPath);
    expect(result).toBeNull();
  });

  it('returns null when manifest is missing lastRun', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      files: {},
    }));

    const result = readManifest(manifestPath);
    expect(result).toBeNull();
  });

  it('returns null when manifest files field is not an object', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      lastRun: '2025-01-15T10:30:00Z',
      files: 'not-an-object',
    }));

    const result = readManifest(manifestPath);
    expect(result).toBeNull();
  });

  it('parses a valid manifest correctly', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    const data: ManifestData = {
      version: 1,
      lastRun: '2025-01-15T10:30:00Z',
      files: {
        'canon/creatures.yaml': 1736934600000,
        'canon/biomes.yaml': 1736920200000,
      },
    };
    fs.writeFileSync(manifestPath, JSON.stringify(data));

    const result = readManifest(manifestPath);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.lastRun).toBe('2025-01-15T10:30:00Z');
    expect(result!.files['canon/creatures.yaml']).toBe(1736934600000);
    expect(result!.files['canon/biomes.yaml']).toBe(1736920200000);
  });
});

describe('updateManifest', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('writes a valid manifest file', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    const files = new Map([
      ['canon/creatures.yaml', 1736934600000],
      ['canon/biomes.yaml', 1736920200000],
    ]);

    updateManifest(manifestPath, files);

    const written = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(written.version).toBe(1);
    expect(written.lastRun).toBeDefined();
    expect(written.files['canon/creatures.yaml']).toBe(1736934600000);
    expect(written.files['canon/biomes.yaml']).toBe(1736920200000);
  });

  it('creates parent directories if they do not exist', () => {
    const manifestPath = path.join(tempDir, 'nested', 'dir', 'manifest.json');
    const files = new Map([['canon/creatures.yaml', 1000]]);

    updateManifest(manifestPath, files);

    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  it('produces a manifest that can be read back', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    const files = new Map([
      ['canon/creatures.yaml', 1736934600000],
    ]);

    updateManifest(manifestPath, files);
    const result = readManifest(manifestPath);

    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.files['canon/creatures.yaml']).toBe(1736934600000);
  });
});

describe('checkIncremental', () => {
  let tempDir: string;
  let registry: CanonRegistry;

  beforeEach(() => {
    tempDir = makeTempDir();
    registry = buildTestRegistry();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('returns all entities when no manifest exists (first run)', () => {
    const config = buildConfig(path.join(tempDir, 'manifest.json'));
    const result = checkIncremental(config, registry);

    expect(result.hasChanges).toBe(true);
    expect(result.changedFiles.length).toBeGreaterThan(0);
    expect(result.entitiesToProcess.size).toBe(registry.entities.size);
  });

  it('returns all entities when forceAll is true', () => {
    // Write a manifest with current mtimes (no changes)
    const manifestPath = path.join(tempDir, 'manifest.json');
    const mtimes = getCanonFileMtimes(canonDir);
    updateManifest(manifestPath, mtimes);

    const config = buildConfig(manifestPath, true);
    const result = checkIncremental(config, registry);

    expect(result.hasChanges).toBe(true);
    expect(result.entitiesToProcess.size).toBe(registry.entities.size);
  });

  it('returns no changes when all files match the manifest', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    const mtimes = getCanonFileMtimes(canonDir);
    updateManifest(manifestPath, mtimes);

    const config = buildConfig(manifestPath);
    const result = checkIncremental(config, registry);

    expect(result.hasChanges).toBe(false);
    expect(result.changedFiles).toHaveLength(0);
    expect(result.entitiesToProcess.size).toBe(0);
  });

  it('detects changes when a file mtime is newer than manifest', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    // Write a manifest with old timestamps
    const oldFiles = new Map([
      ['canon/creatures.yaml', 1000],
      ['canon/biomes.yaml', 1000],
      ['canon/items.yaml', 1000],
    ]);
    updateManifest(manifestPath, oldFiles);

    const config = buildConfig(manifestPath);
    const result = checkIncremental(config, registry);

    // All files should be detected as changed since real mtimes > 1000
    expect(result.hasChanges).toBe(true);
    expect(result.changedFiles.length).toBeGreaterThan(0);
    expect(result.entitiesToProcess.size).toBeGreaterThan(0);
  });

  it('identifies dependents when only one file changed', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    const mtimes = getCanonFileMtimes(canonDir);

    // Set all files to current mtimes except creatures.yaml (set to old)
    const modifiedMtimes = new Map(mtimes);
    for (const [key, value] of modifiedMtimes) {
      if (key.includes('creatures.yaml')) {
        modifiedMtimes.set(key, 0); // force detection as changed
      }
    }
    updateManifest(manifestPath, modifiedMtimes);

    const config = buildConfig(manifestPath);
    const result = checkIncremental(config, registry);

    expect(result.hasChanges).toBe(true);
    // Should include creatures from the changed file
    expect(result.entitiesToProcess.has('creature.bigfoot')).toBe(true);
    expect(result.entitiesToProcess.has('creature.silver_otter')).toBe(true);
    expect(result.entitiesToProcess.has('creature.bone_crawler')).toBe(true);

    // Should also include dependents:
    // biome.enchanted_woods is referenced by creature.bigfoot (habitat),
    // so it should be in the affected set
    expect(result.entitiesToProcess.has('biome.enchanted_woods')).toBe(true);
  });

  it('returns all entities when manifest version is incompatible', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: 999,
      lastRun: '2025-01-15T10:30:00Z',
      files: {},
    }));

    const config = buildConfig(manifestPath);
    const result = checkIncremental(config, registry);

    expect(result.hasChanges).toBe(true);
    expect(result.entitiesToProcess.size).toBe(registry.entities.size);
  });

  it('detects removed files as changes', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    const mtimes = getCanonFileMtimes(canonDir);
    // Add a file that no longer exists
    mtimes.set('canon/deleted.yaml', 9999999999999);
    updateManifest(manifestPath, mtimes);

    const config = buildConfig(manifestPath);
    const result = checkIncremental(config, registry);

    expect(result.hasChanges).toBe(true);
    expect(result.changedFiles).toContain('canon/deleted.yaml');
  });
});

describe('getCanonFileMtimes', () => {
  it('returns mtime entries for all .yaml files in the canon directory', () => {
    const mtimes = getCanonFileMtimes(canonDir);

    expect(mtimes.size).toBe(3); // creatures.yaml, biomes.yaml, items.yaml
    expect(mtimes.has('canon/creatures.yaml')).toBe(true);
    expect(mtimes.has('canon/biomes.yaml')).toBe(true);
    expect(mtimes.has('canon/items.yaml')).toBe(true);

    // All mtimes should be positive numbers
    for (const mtime of mtimes.values()) {
      expect(mtime).toBeGreaterThan(0);
    }
  });

  it('returns empty map for non-existent directory', () => {
    const mtimes = getCanonFileMtimes('/nonexistent/path');
    expect(mtimes.size).toBe(0);
  });
});
