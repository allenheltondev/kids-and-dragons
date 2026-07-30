import fs from 'node:fs';
import path from 'node:path';
import type { AssetResult, CanonEntity, ValidationMessage } from './types.ts';

/** Supported image extensions for asset discovery (case-insensitive). */
const IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.svg']);

/**
 * Discover assets for a single canon entity.
 *
 * Algorithm:
 * 1. If entity has explicit asset references, use the first as primary.
 * 2. Otherwise search `{assetsDir}/{type}/{entityName}/` for image files.
 * 3. If exactly 1 image → primary; if multiple → gallery (alpha-sorted); if 0 → warn.
 */
export function discoverAssets(
  entity: CanonEntity,
  assetsDir: string,
): { result: AssetResult; warnings: ValidationMessage[] } {
  const warnings: ValidationMessage[] = [];

  // Step 1: Check explicit front matter asset references
  if (entity.assets && entity.assets.length > 0) {
    return {
      result: {
        entityId: entity.id,
        primary: entity.assets[0],
        source: 'explicit',
      },
      warnings,
    };
  }

  // Step 2: Convention-based discovery
  // Use asset_id from entity metadata if present; otherwise derive from Canon_ID
  const assetId = entity.assetId;
  const entityName = assetId ?? entity.id.split('.')[1];
  if (!entityName) {
    warnings.push({
      level: 'warning',
      file: assetsDir,
      entityId: entity.id,
      message: `Cannot derive entity name from id "${entity.id}"`,
    });
    return {
      result: { entityId: entity.id, source: 'none' },
      warnings,
    };
  }

  // Asset directories use plural type names (e.g. "creatures", "biomes")
  const typeDir = entity.type.endsWith('s') ? entity.type : `${entity.type}s`;
  const conventionDir = path.join(assetsDir, typeDir, entityName);

  // Step 3: Check if convention directory exists
  if (!fs.existsSync(conventionDir)) {
    warnings.push({
      level: 'warning',
      file: conventionDir,
      entityId: entity.id,
      message: `Asset directory not found: ${conventionDir}`,
    });
    return {
      result: { entityId: entity.id, source: 'none' },
      warnings,
    };
  }

  // Step 4: Read directory (non-recursive, immediate files only)
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(conventionDir, { withFileTypes: true });
  } catch {
    warnings.push({
      level: 'warning',
      file: conventionDir,
      entityId: entity.id,
      message: `Failed to read asset directory: ${conventionDir}`,
    });
    return {
      result: { entityId: entity.id, source: 'none' },
      warnings,
    };
  }

  // Step 5: Filter to supported image files (exclude .json, directories, etc.)
  const imageFiles = entries
    .filter((entry) => {
      if (!entry.isFile()) return false;
      const ext = path.extname(entry.name).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext);
    })
    .map((entry) => entry.name)
    .sort(); // alpha-sorted

  // Step 6: Determine result based on number of images found
  if (imageFiles.length === 0) {
    warnings.push({
      level: 'warning',
      file: conventionDir,
      entityId: entity.id,
      message: `No image files found in asset directory: ${conventionDir}`,
    });
    return {
      result: { entityId: entity.id, source: 'none' },
      warnings,
    };
  }

  // Build relative paths from repository root
  const relativePaths = imageFiles.map((filename) =>
    path.join(assetsDir, typeDir, entityName, filename).replaceAll('\\', '/'),
  );

  if (relativePaths.length === 1) {
    return {
      result: {
        entityId: entity.id,
        primary: relativePaths[0],
        source: 'convention',
      },
      warnings,
    };
  }

  return {
    result: {
      entityId: entity.id,
      gallery: relativePaths,
      source: 'convention',
    },
    warnings,
  };
}

/**
 * Discover assets for all entities in a registry.
 */
export function discoverAllAssets(
  entities: Map<string, CanonEntity>,
  assetsDir: string,
): { results: Map<string, AssetResult>; warnings: ValidationMessage[] } {
  const results = new Map<string, AssetResult>();
  const allWarnings: ValidationMessage[] = [];

  for (const [id, entity] of entities) {
    const { result, warnings } = discoverAssets(entity, assetsDir);
    results.set(id, result);
    allWarnings.push(...warnings);
  }

  return { results, warnings: allWarnings };
}
