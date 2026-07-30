/**
 * Canon Validator — validates integrity constraints across all canon data.
 *
 * Checks Canon_ID format, required fields, uniqueness, relationship references,
 * canon status values, and asset file references. Returns a structured ValidationResult.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CanonRegistry, ValidationMessage } from './types.ts';

/** Result of running all validation checks on the canon registry. */
export interface ValidationResult {
  valid: boolean;
  messages: ValidationMessage[];
}

/**
 * Canon_ID format regex:
 * - type: one or more lowercase letters (a-z)
 * - dot separator (exactly one)
 * - name: one or more lowercase letters, digits, or underscores (a-z, 0-9, _)
 * - total max 64 chars
 */
const CANON_ID_PATTERN = /^[a-z]+\.[a-z0-9_]+$/;

/** Known valid canon_status values. */
const VALID_CANON_STATUSES = new Set(['confirmed', 'newly_defined', 'intentionally_undefined']);

/**
 * Check whether a Canon_ID string is valid.
 *
 * Rules:
 * - Pattern: {type}.{snake_case_name}
 * - type: lowercase letters only (a-z)
 * - snake_case_name: lowercase letters, digits, underscores (a-z, 0-9, _)
 * - Exactly one dot separating type from name
 * - Total length max 64 chars
 */
export function isValidCanonId(id: string): boolean {
  if (id.length === 0 || id.length > 64) {
    return false;
  }
  return CANON_ID_PATTERN.test(id);
}

/**
 * Validate canon data integrity across the entire registry.
 *
 * Checks (in order):
 * 1. Canon_ID format validation
 * 2. Required fields (id, title) present on every entity
 * 3. Canon_ID uniqueness (note: the parser's Map already deduplicates,
 *    so true duplicate detection requires tracking during parse; this
 *    validator flags entities with invalid IDs which could indicate duplicates)
 * 4. Relationship references resolve to existing Canon_IDs
 * 5. Canon status validation
 * 6. Asset references resolve to existing files
 */
export function validateCanon(registry: CanonRegistry, assetsDir: string): ValidationResult {
  const messages: ValidationMessage[] = [];

  // 1. Canon_ID format validation
  for (const entity of registry.entities.values()) {
    if (!isValidCanonId(entity.id)) {
      messages.push({
        level: 'error',
        file: '',
        entityId: entity.id,
        field: 'id',
        message: `Invalid Canon_ID format: "${entity.id}". Must match {type}.{snake_case_name} with max 64 chars.`,
      });
    }
  }

  // 2. Required fields — check that title is non-empty
  // (id is already guaranteed to be a string by the parser, but title may be empty)
  for (const entity of registry.entities.values()) {
    if (!entity.id || typeof entity.id !== 'string' || entity.id.trim() === '') {
      messages.push({
        level: 'error',
        file: '',
        entityId: entity.id,
        field: 'id',
        message: `Missing required field "id": must be a non-empty string.`,
      });
    }

    if (!entity.title || typeof entity.title !== 'string' || entity.title.trim() === '') {
      messages.push({
        level: 'error',
        file: '',
        entityId: entity.id,
        field: 'title',
        message: `Missing required field "title": must be a non-empty string.`,
      });
    }
  }

  // 3. Canon_ID uniqueness
  // The parser uses a Map keyed by id, so later duplicates overwrite earlier ones.
  // To detect duplicates, we need to check byType lists for entities sharing the same id.
  // However, the registry as-is deduplicates. We check if the byType arrays contain
  // entities with the same id (which the parser would store as the last occurrence).
  // For robust duplicate checking we scan all type arrays.
  const idOccurrences = new Map<string, number>();
  for (const entities of registry.byType.values()) {
    for (const entity of entities) {
      idOccurrences.set(entity.id, (idOccurrences.get(entity.id) ?? 0) + 1);
    }
  }
  for (const [id, count] of idOccurrences) {
    if (count > 1) {
      messages.push({
        level: 'error',
        file: '',
        entityId: id,
        field: 'id',
        message: `Duplicate Canon_ID: "${id}" appears ${count} times.`,
      });
    }
  }

  // 4. Relationship references — check each ref resolves to an existing entity
  for (const entity of registry.entities.values()) {
    for (const [relationshipKey, targetIds] of Object.entries(entity.relationships)) {
      for (const targetId of targetIds) {
        if (!registry.entities.has(targetId)) {
          messages.push({
            level: 'warning',
            file: '',
            entityId: entity.id,
            field: relationshipKey,
            message: `Broken relationship reference: "${targetId}" does not exist in the registry.`,
          });
        }
      }
    }
  }

  // 5. Canon status validation — warn if canon_status has an unknown value
  for (const entity of registry.entities.values()) {
    if (entity.canonStatus && !VALID_CANON_STATUSES.has(entity.canonStatus)) {
      messages.push({
        level: 'warning',
        file: '',
        entityId: entity.id,
        field: 'canon_status',
        message: `Unknown canon_status value: "${entity.canonStatus}". Expected one of: ${[...VALID_CANON_STATUSES].join(', ')}.`,
      });
    }
  }

  // 6. Asset references — check each path exists on filesystem
  for (const entity of registry.entities.values()) {
    if (entity.assets && entity.assets.length > 0) {
      for (const assetPath of entity.assets) {
        const fullPath = path.resolve(assetsDir, assetPath);
        if (!fs.existsSync(fullPath)) {
          messages.push({
            level: 'warning',
            file: '',
            entityId: entity.id,
            field: 'assets',
            message: `Asset reference not found: "${assetPath}" does not exist at "${fullPath}".`,
          });
        }
      }
    }
  }

  // valid = true if no errors were emitted (warnings are acceptable)
  const hasErrors = messages.some(m => m.level === 'error');

  return {
    valid: !hasErrors,
    messages,
  };
}
