import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
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
    const mtimes = getCanonFileMtimes(canonDir, undefined, path.join(fixturesDir, 'assets'));
    updateManifest(manifestPath, mtimes);

    const config = buildConfig(manifestPath, true);
    const result = checkIncremental(config, registry);

    expect(result.hasChanges).toBe(true);
    expect(result.entitiesToProcess.size).toBe(registry.entities.size);
  });

  it('returns no changes when all files match the manifest', () => {
    const manifestPath = path.join(tempDir, 'manifest.json');
    const mtimes = getCanonFileMtimes(canonDir, undefined, path.join(fixturesDir, 'assets'));
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
    const mtimes = getCanonFileMtimes(canonDir, undefined, path.join(fixturesDir, 'assets'));

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
    const mtimes = getCanonFileMtimes(canonDir, undefined, path.join(fixturesDir, 'assets'));
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

describe('checkIncremental — chapters', () => {
  // Every page records `played_in`, so a chapter edit, addition or removal
  // with no canon change at all must still regenerate every page.
  let tempDir: string;
  let chaptersDir: string;
  let manifestPath: string;
  let registry: CanonRegistry;

  const config = (): GeneratorConfig => ({ ...buildConfig(manifestPath), chaptersDir });
  const writeChapter = (name: string, body: unknown) =>
    fs.writeFileSync(path.join(chaptersDir, name), JSON.stringify(body));
  const age = (name: string) => {
    // Push a file's mtime into the past, so a later touch reads as newer.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(chaptersDir, name), past, past);
  };

  beforeEach(() => {
    tempDir = makeTempDir();
    chaptersDir = path.join(tempDir, 'chapters');
    fs.mkdirSync(chaptersDir);
    manifestPath = path.join(tempDir, 'manifest.json');
    registry = buildTestRegistry();
    writeChapter('ch-01.json', { id: 'ch-01', scenes: {} });
    age('ch-01.json');
    updateManifest(manifestPath, getCanonFileMtimes(canonDir, chaptersDir, config().assetsDir));
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('records chapter files in the manifest', () => {
    const tracked = Object.keys(readManifest(manifestPath)!.files);
    expect(tracked.some((f) => f.endsWith('/ch-01.json'))).toBe(true);
    expect(tracked.some((f) => f.startsWith('canon/'))).toBe(true);
  });

  it('reports no changes when neither canon nor chapters changed', () => {
    expect(checkIncremental(config(), registry).hasChanges).toBe(false);
  });

  it('regenerates every entity when only a chapter was edited', () => {
    writeChapter('ch-01.json', { id: 'ch-01', scenes: { a: { cast: [{ figure: 'entities/cinder_wolf' }] } } });
    const result = checkIncremental(config(), registry);
    expect(result.hasChanges).toBe(true);
    expect(result.changedFiles.every((f) => f.endsWith('.json'))).toBe(true);
    expect(result.entitiesToProcess.size).toBe(registry.entities.size);
  });

  it('regenerates every entity when a chapter is added', () => {
    writeChapter('ch-02.json', { id: 'ch-02', scenes: {} });
    const result = checkIncremental(config(), registry);
    expect(result.hasChanges).toBe(true);
    expect(result.entitiesToProcess.size).toBe(registry.entities.size);
  });

  it('regenerates every entity when a chapter is removed', () => {
    fs.rmSync(path.join(chaptersDir, 'ch-01.json'));
    const result = checkIncremental(config(), registry);
    expect(result.hasChanges).toBe(true);
    expect(result.entitiesToProcess.size).toBe(registry.entities.size);
  });

  it('regenerates once from a manifest written before chapters were tracked', () => {
    updateManifest(manifestPath, getCanonFileMtimes(canonDir, undefined, config().assetsDir));
    const result = checkIncremental(config(), registry);
    expect(result.hasChanges).toBe(true);
    expect(result.entitiesToProcess.size).toBe(registry.entities.size);
  });
});


describe('incremental artwork delivery', () => {
  let root: string;
  let config: GeneratorConfig;
  let registry: CanonRegistry;
  const saveInputs = () => updateManifest(config.manifestPath,
    getCanonFileMtimes(config.canonDir, config.chaptersDir, config.assetsDir));

  beforeEach(() => {
    root = makeTempDir();
    fs.cpSync(canonDir, path.join(root, 'canon'), { recursive: true });
    config = {
      canonDir: path.join(root, 'canon'), assetsDir: path.join(root, 'assets'),
      contentDir: path.join(root, 'wiki/content'), manifestPath: path.join(root, 'wiki/.gen-manifest.json'),
    };
    fs.mkdirSync(path.join(config.assetsDir, 'biomes/enchanted_woods'), { recursive: true });
    registry = parseCanonDirectory(config.canonDir).registry;
    saveInputs();
  });
  afterEach(() => removeTempDir(root));

  it('does not rebuild unchanged inputs', () => {
    expect(checkIncremental(config, registry).hasChanges).toBe(false);
  });

  it.each(['bg.webp', 'portrait.webp', 'tiles.png'])(
    'regenerates shared pages when %s is added', filename => {
      fs.writeFileSync(path.join(config.assetsDir, 'biomes/enchanted_woods', filename), 'image');
      const result = checkIncremental(config, registry);
      expect(result.hasChanges).toBe(true);
      expect(result.entitiesToProcess).toEqual(new Set(registry.entities.keys()));
      expect(result.changedFiles).toContain(`assets/biomes/enchanted_woods/${filename}`);
    },
  );

  it('detects backdated replacements and deletions', () => {
    const image = path.join(config.assetsDir, 'biomes/enchanted_woods/bg.webp');
    fs.writeFileSync(image, 'first');
    saveInputs();
    fs.writeFileSync(image, 'replacement');
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(image, past, past);
    expect(checkIncremental(config, registry).entitiesToProcess.size).toBe(registry.entities.size);
    saveInputs();
    expect(checkIncremental(config, registry).hasChanges).toBe(false);
    fs.unlinkSync(image);
    expect(checkIncremental(config, registry).entitiesToProcess.size).toBe(registry.entities.size);
  });

  it('tracks the asset manifest but ignores non-image build artifacts', () => {
    fs.writeFileSync(path.join(config.assetsDir, 'notes.txt'), 'not artwork');
    expect(checkIncremental(config, registry).hasChanges).toBe(false);
    fs.writeFileSync(path.join(config.assetsDir, 'manifest.json'), '{}');
    expect(checkIncremental(config, registry).entitiesToProcess.size).toBe(registry.entities.size);
  });

  it('updates page links after art-only delivery without --force', () => {
    const generate = () => execFileSync(process.execPath,
      [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('tools/wiki/generate.ts')],
      { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    const page = () => fs.readFileSync(path.join(config.contentDir, 'biomes/enchanted_woods.md'), 'utf8');
    fs.unlinkSync(config.manifestPath);
    generate();
    expect(page()).not.toContain('  primary:');
    const image = path.join(config.assetsDir, 'biomes/enchanted_woods/bg.webp');
    fs.writeFileSync(image, 'image');
    generate();
    expect(page()).toContain('  primary: assets/biomes/enchanted_woods/bg.webp');
    const preview = path.join(config.assetsDir, 'biomes/enchanted_woods/portrait.webp');
    fs.writeFileSync(preview, 'preview');
    generate();
    expect(page()).toContain('  primary: assets/biomes/enchanted_woods/portrait.webp');
    expect(page()).toContain('  primaryFull: assets/biomes/enchanted_woods/bg.webp');
    fs.unlinkSync(preview);
    generate();
    expect(page()).toContain('  primary: assets/biomes/enchanted_woods/bg.webp');
    fs.unlinkSync(image);
    generate();
    expect(page()).not.toContain('  primary:');
    expect(generate()).toContain('No updates needed');
  }, 20000);
});
