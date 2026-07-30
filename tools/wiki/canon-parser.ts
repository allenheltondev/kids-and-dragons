/**
 * Canon Parser — reads YAML canon files and builds a typed entity registry.
 *
 * Extracts entities from all .yaml files in the canon directory, computes
 * type indexes and reverse references, and reports parse errors gracefully.
 *
 * Supports v2.0 canon format with schema metadata headers, bare ID references,
 * and structured inhabitant objects.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { CanonEntity, CanonRegistry, ReverseRef, ValidationMessage } from './types.ts';

/** Known fields that map directly into CanonEntity (not metadata). */
const KNOWN_FIELDS = new Set([
  'id', 'title', 'status', 'tags', 'featured', 'relationships', 'assets', 'asset_id', 'canon_status',
  // Geography structured fields handled specially before relationship extraction
  'separated_from', 'crosses', 'spans', 'contained_by', 'connects',
]);

/**
 * Mapping from relationship key names to the entity type prefix they target.
 * Used to resolve bare IDs into full Canon_IDs.
 */
const RELATIONSHIP_KEY_TO_PREFIX: Record<string, string> = {
  primary_locations: 'biome.',
  secondary_locations: 'biome.',
  locations: 'biome.',
  habitat: 'biome.',
  found_in: 'biome.',
  biome: 'biome.',
  biomes: 'biome.',
  creatures: 'creature.',
  ambient_creatures: 'creature.',
  dangerous_creatures: 'creature.',
  legendary_beings: 'creature.',
  supernatural_manifestations: 'creature.',
  dropped_by: 'creature.',
  primary_peoples: 'character.',
  supporting_peoples: 'character.',
  characters: 'character.',
  cultural_orders: 'npc.',
  factions: 'faction.',
  enemies: 'faction.',
  items: 'item.',
  drops: 'item.',
  quests: 'quest.',
  campaigns: 'campaign.',
  // Geography relationships
  borders: 'geography.',
  contains_sites: 'location.',
  contains_features: 'feature.',
  contained_by: 'geography.',
  adjacent_to: 'geography.',
  access_from: 'geography.',
  crosses: 'feature.',
  reaches: 'geography.',
  spans: 'feature.',
  nearby_sites: 'location.',
  coast_near: 'geography.',
  crossings: 'route.',
};

/** Relationship keys whose bare IDs should be skipped (not resolved). */
const SKIP_RELATIONSHIP_KEYS = new Set(['members']);

/**
 * Top-level keys that represent entity arrays (the actual canon data).
 * Other keys at the top level are metadata (schema_version, purpose, etc.).
 */
const ENTITY_ARRAY_KEYS = new Set([
  'creatures', 'characters', 'npcs', 'biomes', 'items',
  'factions', 'locations', 'quests', 'campaigns',
]);

/**
 * Parse all .yaml files in the given canon directory and build a CanonRegistry.
 *
 * Handles YAML parse errors gracefully: skips the file, emits an error message,
 * and continues with remaining files.
 */
export function parseCanonDirectory(canonDir: string): { registry: CanonRegistry; errors: ValidationMessage[] } {
  const errors: ValidationMessage[] = [];
  const entities = new Map<string, CanonEntity>();
  const byType = new Map<string, CanonEntity[]>();

  // Read all .yaml files from the canon directory
  let files: string[];
  try {
    files = fs.readdirSync(canonDir).filter(f => f.endsWith('.yaml'));
  } catch {
    // If the directory doesn't exist or can't be read, return empty
    errors.push({
      level: 'error',
      file: canonDir,
      message: `Cannot read canon directory: ${canonDir}`,
    });
    return {
      registry: { entities, byType, reverseRefs: new Map() },
      errors,
    };
  }

  for (const file of files) {
    const filePath = path.join(canonDir, file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      errors.push({
        level: 'error',
        file: filePath,
        message: `Cannot read file: ${filePath}`,
      });
      continue;
    }

    // Parse the YAML content
    let parsed: unknown;
    try {
      parsed = yaml.load(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({
        level: 'error',
        file: filePath,
        message: `YAML parse error: ${message}`,
      });
      continue;
    }

    // The parsed content should be an object
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push({
        level: 'warning',
        file: filePath,
        message: 'File does not contain an object with entity arrays',
      });
      continue;
    }

    const record = parsed as Record<string, unknown>;

    for (const [typeKey, value] of Object.entries(record)) {
      // Skip non-array values (strings, plain objects, etc.)
      if (!Array.isArray(value)) {
        continue;
      }

      // Skip arrays of strings (like creature_ids, species_ids, map_environment_ids)
      // Only process arrays where at least the first element is an object with an `id` field
      if (value.length === 0) {
        continue;
      }

      const firstElement = value[0];
      if (firstElement === null || typeof firstElement !== 'object' || Array.isArray(firstElement)) {
        // This is an array of primitives (strings, numbers) — skip
        continue;
      }

      // Check if the first element has an 'id' field (entity array signature)
      if (!('id' in (firstElement as Record<string, unknown>))) {
        continue;
      }

      // This is an entity array — process it
      for (const raw of value) {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
          errors.push({
            level: 'warning',
            file: filePath,
            message: 'Entity entry is not an object, skipping',
          });
          continue;
        }

        const rawEntity = raw as Record<string, unknown>;
        const id = rawEntity['id'];
        if (typeof id !== 'string') {
          errors.push({
            level: 'warning',
            file: filePath,
            message: 'Entity missing "id" field, skipping',
          });
          continue;
        }

        // Derive type from the Canon_ID (part before the first dot)
        const dotIndex = id.indexOf('.');
        const entityType = dotIndex > 0 ? id.substring(0, dotIndex) : id;

        // Extract known fields
        const title = typeof rawEntity['title'] === 'string' ? rawEntity['title'] : '';
        const status = typeof rawEntity['status'] === 'string' ? rawEntity['status'] : undefined;
        const tags = Array.isArray(rawEntity['tags']) ? (rawEntity['tags'] as string[]) : undefined;
        const featured = typeof rawEntity['featured'] === 'boolean' ? rawEntity['featured'] : undefined;
        const assetId = typeof rawEntity['asset_id'] === 'string' ? rawEntity['asset_id'] : undefined;
        const canonStatus = typeof rawEntity['canon_status'] === 'string' ? rawEntity['canon_status'] : undefined;

        // Extract relationships — handle both direct relationships and inhabitants sub-object
        let relationships: Record<string, string[]> = {};
        if (isRelationshipsRecord(rawEntity['relationships'])) {
          relationships = { ...rawEntity['relationships'] };
        }

        // Handle geography-specific structured relationship fields

        // separated_from: array of { region, by } objects → extract into two relationship arrays
        const separatedFrom = rawEntity['separated_from'];
        if (Array.isArray(separatedFrom)) {
          const separatedRegions: string[] = [];
          const separatedBy: string[] = [];
          for (const entry of separatedFrom) {
            if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
              const obj = entry as Record<string, unknown>;
              if (typeof obj['region'] === 'string') separatedRegions.push(obj['region']);
              if (typeof obj['by'] === 'string') separatedBy.push(obj['by']);
            }
          }
          if (separatedRegions.length > 0) relationships['separated_from'] = separatedRegions;
          if (separatedBy.length > 0) relationships['separated_by'] = separatedBy;
        }

        // crosses: single string → wrap in array (e.g., route crosses a feature)
        const crosses = rawEntity['crosses'];
        if (typeof crosses === 'string') {
          relationships['crosses'] = [crosses];
        }

        // spans: single string → wrap in array (e.g., site spans a feature)
        const spans = rawEntity['spans'];
        if (typeof spans === 'string') {
          relationships['spans'] = [spans];
        }

        // contained_by: single string → wrap in array
        const containedBy = rawEntity['contained_by'];
        if (typeof containedBy === 'string') {
          relationships['contained_by'] = [containedBy];
        }

        // connects: array of strings that can reference geography.* or location.*
        // Handle specially: don't use prefix map, resolve by checking existing entities
        const connects = rawEntity['connects'];
        if (Array.isArray(connects) && connects.every(item => typeof item === 'string')) {
          relationships['connects'] = connects as string[];
        }

        // Extract top-level relationship arrays (geography-style: borders, contains_sites, etc.)
        for (const relKey of Object.keys(RELATIONSHIP_KEY_TO_PREFIX)) {
          if (relKey in rawEntity && !(relKey in relationships)) {
            const relValue = rawEntity[relKey];
            if (Array.isArray(relValue) && relValue.every(item => typeof item === 'string')) {
              if (relValue.length > 0) {
                relationships[relKey] = relValue as string[];
              }
            }
          }
        }

        // Flatten inhabitants sub-object into relationships
        const inhabitants = rawEntity['inhabitants'];
        if (inhabitants !== null && inhabitants !== undefined && typeof inhabitants === 'object' && !Array.isArray(inhabitants)) {
          const inhabRecord = inhabitants as Record<string, unknown>;
          for (const [inhabKey, inhabValue] of Object.entries(inhabRecord)) {
            if (Array.isArray(inhabValue) && inhabValue.every(item => typeof item === 'string')) {
              // Only add non-empty arrays
              if (inhabValue.length > 0) {
                relationships[inhabKey] = inhabValue as string[];
              }
            }
            // Skip non-array values like population_rule
          }
        }

        const assets = Array.isArray(rawEntity['assets']) ? (rawEntity['assets'] as string[]) : undefined;

        // Build metadata from all other fields
        const metadata: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(rawEntity)) {
          if (!KNOWN_FIELDS.has(key) && !(key in relationships)) {
            metadata[key] = val;
          }
        }

        const entity: CanonEntity = {
          id,
          type: entityType,
          title,
          status,
          tags,
          featured,
          relationships,
          assets,
          metadata,
          canonStatus,
          assetId,
        };

        entities.set(id, entity);

        // Group by type
        const typeList = byType.get(entityType);
        if (typeList) {
          typeList.push(entity);
        } else {
          byType.set(entityType, [entity]);
        }
      }
    }
  }

  // Resolve bare IDs in relationships to full Canon_IDs
  resolveBareIds(entities);

  // Build reverse references
  const reverseRefs = buildReverseRefs(entities);

  return {
    registry: { entities, byType, reverseRefs },
    errors,
  };
}

/**
 * Resolve bare IDs in relationship arrays to full Canon_IDs.
 *
 * For each relationship key, infers the target type from the key name and
 * prepends the appropriate prefix to bare IDs.
 */
function resolveBareIds(entities: Map<string, CanonEntity>): void {
  for (const entity of entities.values()) {
    const resolvedRelationships: Record<string, string[]> = {};

    for (const [relationshipKey, targetIds] of Object.entries(entity.relationships)) {
      // Skip relationship keys that shouldn't be resolved
      if (SKIP_RELATIONSHIP_KEYS.has(relationshipKey)) {
        resolvedRelationships[relationshipKey] = targetIds;
        continue;
      }

      const prefix = RELATIONSHIP_KEY_TO_PREFIX[relationshipKey];
      const resolved: string[] = [];

      for (const bareId of targetIds) {
        // 1. If the ID already exists in the registry as-is, keep it
        if (entities.has(bareId)) {
          resolved.push(bareId);
          continue;
        }

        // 2. Special case: 'connects' can reference geography.* or location.*
        if (relationshipKey === 'connects') {
          const geoId = 'geography.' + bareId;
          const locId = 'location.' + bareId;
          if (entities.has(geoId)) {
            resolved.push(geoId);
          } else if (entities.has(locId)) {
            resolved.push(locId);
          } else {
            // Default to geography. prefix
            resolved.push(geoId);
          }
          continue;
        }

        // 3. If we have a prefix mapping, try prepending it
        if (prefix) {
          const prefixedId = prefix + bareId;
          // Store the resolved (prefixed) version — validator will catch broken refs
          resolved.push(prefixedId);
        } else {
          // No prefix mapping known — keep the bare ID as-is
          resolved.push(bareId);
        }
      }

      resolvedRelationships[relationshipKey] = resolved;
    }

    entity.relationships = resolvedRelationships;
  }
}

/**
 * Build reverse reference map: for each entity referenced in any relationship,
 * record who references it and under which relationship key.
 */
function buildReverseRefs(entities: Map<string, CanonEntity>): Map<string, ReverseRef[]> {
  const reverseRefs = new Map<string, ReverseRef[]>();

  for (const entity of entities.values()) {
    for (const [relationshipKey, targetIds] of Object.entries(entity.relationships)) {
      for (const targetId of targetIds) {
        const ref: ReverseRef = { sourceId: entity.id, relationshipKey };
        const existing = reverseRefs.get(targetId);
        if (existing) {
          existing.push(ref);
        } else {
          reverseRefs.set(targetId, [ref]);
        }
      }
    }
  }

  return reverseRefs;
}

/**
 * Type guard: check if a value is a Record<string, string[]>.
 */
function isRelationshipsRecord(value: unknown): value is Record<string, string[]> {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  for (const val of Object.values(value as Record<string, unknown>)) {
    if (!Array.isArray(val) || !val.every(item => typeof item === 'string')) {
      return false;
    }
  }
  return true;
}
