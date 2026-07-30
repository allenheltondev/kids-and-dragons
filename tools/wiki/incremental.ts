/**
 * Incremental Generation — manifest-based change detection.
 *
 * Compares canon file modification timestamps against a stored manifest
 * to determine which entities need regeneration. Identifies changed files
 * and their direct dependents (entities in other files that reference
 * entities from changed files).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CanonRegistry, GeneratorConfig } from './types.ts';

/** Current manifest format version. */
const MANIFEST_VERSION = 1;

/** Stored manifest tracking last-processed file timestamps. */
export interface ManifestData {
  version: number;
  lastRun: string;
  files: Record<string, number>; // relative path -> mtime in epoch ms
}

/** Alias matching the design doc naming convention. */
export type Manifest = ManifestData;

/** Result of an incremental change check. */
export interface IncrementalCheckResult {
  /** Whether changes were detected. */
  hasChanges: boolean;
  /** Canon file paths that changed (relative to repo root). */
  changedFiles: string[];
  /** Canon_IDs of entities that need regeneration (from changed files + dependents). */
  entitiesToProcess: Set<string>;
  /** Human-readable status message describing what was detected. */
  message: string;
}

/**
 * Read the manifest file from disk. Returns null if the file doesn't exist
 * or has an incompatible version.
 */
export function readManifest(manifestPath: string): ManifestData | null {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const data: unknown = JSON.parse(raw);

    if (
      data === null ||
      typeof data !== 'object' ||
      Array.isArray(data)
    ) {
      return null;
    }

    const manifest = data as Record<string, unknown>;

    if (manifest['version'] !== MANIFEST_VERSION) {
      return null;
    }

    if (typeof manifest['lastRun'] !== 'string') {
      return null;
    }

    if (
      manifest['files'] === null ||
      typeof manifest['files'] !== 'object' ||
      Array.isArray(manifest['files'])
    ) {
      return null;
    }

    return {
      version: MANIFEST_VERSION,
      lastRun: manifest['lastRun'] as string,
      files: manifest['files'] as Record<string, number>,
    };
  } catch {
    // File doesn't exist or is unreadable — treat as first run
    return null;
  }
}

/**
 * Write the manifest file after a successful generation run.
 *
 * Records the current mtime (epoch ms) for each canon file that was processed.
 */
export function updateManifest(
  manifestPath: string,
  canonFiles: Map<string, number>,
): void {
  const manifest: ManifestData = {
    version: MANIFEST_VERSION,
    lastRun: new Date().toISOString(),
    files: Object.fromEntries(canonFiles),
  };

  writeManifest(manifestPath, manifest);
}

/**
 * Write a manifest object directly to disk.
 *
 * Creates parent directories if they don't exist.
 */
export function writeManifest(manifestPath: string, manifest: ManifestData): void {
  // Ensure the directory exists
  const dir = path.dirname(manifestPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

/**
 * Check which canon files have changed since the last run and identify
 * which entities need to be processed.
 *
 * Returns an IncrementalCheckResult indicating whether work is needed.
 * If `config.forceAll` is true, all entities are marked for processing.
 *
 * The registry is used to:
 * 1. Map canon files to the entities they contain
 * 2. Find dependents — entities in other files that reference entities
 *    from the changed files via relationships
 */
export function checkIncremental(
  config: GeneratorConfig,
  registry: CanonRegistry,
): IncrementalCheckResult {
  // If force flag is set, process everything
  if (config.forceAll) {
    const allFiles = getCanonFiles(config.canonDir);
    return {
      hasChanges: true,
      changedFiles: allFiles,
      entitiesToProcess: new Set(registry.entities.keys()),
      message: `Force mode: regenerating all ${registry.entities.size} entities from ${allFiles.length} files`,
    };
  }

  const manifest = readManifest(config.manifestPath);
  const canonFiles = getCanonFiles(config.canonDir);

  // If no manifest exists (first run or incompatible version), process everything
  if (manifest === null) {
    return {
      hasChanges: true,
      changedFiles: canonFiles,
      entitiesToProcess: new Set(registry.entities.keys()),
      message: `No manifest found: regenerating all ${registry.entities.size} entities`,
    };
  }

  // Compare each canon file's current mtime against the manifest
  const changedFiles: string[] = [];

  for (const relPath of canonFiles) {
    const absPath = path.resolve(config.canonDir, '..', relPath);
    let currentMtime: number;
    try {
      currentMtime = fs.statSync(absPath).mtimeMs;
    } catch {
      // If we can't stat the file, treat it as changed
      changedFiles.push(relPath);
      continue;
    }

    const storedMtime = manifest.files[relPath];
    if (storedMtime === undefined || currentMtime > storedMtime) {
      changedFiles.push(relPath);
    }
  }

  // Check for files that were in the manifest but no longer exist
  for (const storedPath of Object.keys(manifest.files)) {
    if (!canonFiles.includes(storedPath)) {
      changedFiles.push(storedPath);
    }
  }

  // If no changes detected, exit early
  if (changedFiles.length === 0) {
    return {
      hasChanges: false,
      changedFiles: [],
      entitiesToProcess: new Set(),
      message: 'No updates needed — all canon files unchanged since last run',
    };
  }

  // Identify entities in the changed files and their dependents
  const entitiesToProcess = findAffectedEntities(config, registry, changedFiles);

  return {
    hasChanges: true,
    changedFiles,
    entitiesToProcess,
    message: `${changedFiles.length} file(s) changed, ${entitiesToProcess.size} entity/entities to regenerate`,
  };
}

/**
 * Get the current mtime (epoch ms) for all canon files.
 * Used to write the manifest after a successful run.
 */
export function getCanonFileMtimes(canonDir: string): Map<string, number> {
  const mtimes = new Map<string, number>();
  const files = getCanonFiles(canonDir);

  for (const relPath of files) {
    const absPath = path.resolve(canonDir, '..', relPath);
    try {
      const stat = fs.statSync(absPath);
      mtimes.set(relPath, stat.mtimeMs);
    } catch {
      // Skip files we can't stat
    }
  }

  return mtimes;
}

/**
 * Get all canon file paths relative to the repository root.
 * Returns paths like "canon/creatures.yaml".
 */
function getCanonFiles(canonDir: string): string[] {
  try {
    const dirName = path.basename(canonDir);
    const files = fs.readdirSync(canonDir).filter(f => f.endsWith('.yaml'));
    return files.map(f => `${dirName}/${f}`);
  } catch {
    return [];
  }
}

/**
 * Given a list of changed canon files, identify all entities that need
 * processing: entities within the changed files PLUS entities in other
 * files that directly reference them (dependents).
 */
function findAffectedEntities(
  config: GeneratorConfig,
  registry: CanonRegistry,
  changedFiles: string[],
): Set<string> {
  const affected = new Set<string>();

  // Step 1: Find all entities in the changed files
  const changedEntityIds = new Set<string>();
  const dirName = path.basename(config.canonDir);

  for (const entity of registry.entities.values()) {
    // Determine which file this entity belongs to based on its type
    const expectedFile = `${dirName}/${entity.type}s.yaml`;
    if (changedFiles.includes(expectedFile)) {
      changedEntityIds.add(entity.id);
      affected.add(entity.id);
    }
  }

  // Also try matching against the actual file names more broadly
  // (handles cases where type pluralization doesn't follow simple "s" suffix)
  for (const changedFile of changedFiles) {
    const fileName = path.basename(changedFile, '.yaml');
    for (const entity of registry.entities.values()) {
      // Match if the file name starts with or contains the entity type
      const expectedFileNames = [
        `${entity.type}s`,   // creatures, biomes, items
        entity.type,          // exact match (e.g. mechanics)
      ];
      if (expectedFileNames.includes(fileName)) {
        changedEntityIds.add(entity.id);
        affected.add(entity.id);
      }
    }
  }

  // Step 2: Find dependents — entities that reference any changed entity
  for (const changedId of changedEntityIds) {
    const refs = registry.reverseRefs.get(changedId);
    if (refs) {
      for (const ref of refs) {
        affected.add(ref.sourceId);
      }
    }

    // Also find entities that the changed entity references
    // (they need their reverse-ref sections regenerated)
    const changedEntity = registry.entities.get(changedId);
    if (changedEntity) {
      for (const targetIds of Object.values(changedEntity.relationships)) {
        for (const targetId of targetIds) {
          affected.add(targetId);
        }
      }
    }
  }

  return affected;
}
