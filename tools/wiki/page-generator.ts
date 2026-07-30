/**
 * Page Generator — creates and updates Markdown entity pages with generated sections.
 *
 * Generates front matter, relationship sections, and AI context sections from
 * canon data while preserving handwritten content byte-for-byte outside of
 * generated section markers.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CanonEntity, AiContext, AssetResult, CanonRegistry, ReverseRef, PageGeneratorOptions, ValidationMessage } from './types.ts';

/** Marker format for generated sections. */
const BEGIN_MARKER = (section: string) => `<!-- BEGIN GENERATED: ${section} -->`;
const END_MARKER = (section: string) => `<!-- END GENERATED: ${section} -->`;

/** Generated section names managed by this module. */
const GENERATED_SECTIONS = ['relationships', 'ai_context'] as const;

/**
 * Represents a single related entity entry for front matter and section rendering.
 */
interface RelatedEntry {
  id: string;
  type: string;
  relationship: string;
  title: string;
}

/**
 * Type names that don't follow simple "add s" pluralization.
 */
const PLURAL_OVERRIDES: Record<string, string> = {
  geography: 'geography',
};

/**
 * Pluralize an entity type name for use as a content directory path.
 *
 * Uses overrides for irregular types, otherwise appends "s" if not already present.
 */
function pluralizeType(type: string): string {
  if (PLURAL_OVERRIDES[type]) return PLURAL_OVERRIDES[type];
  return type.endsWith('s') ? type : `${type}s`;
}

/**
 * Extract the entity name from a Canon_ID (part after the first dot).
 */
function extractEntityName(id: string): string {
  const dotIndex = id.indexOf('.');
  return dotIndex > 0 ? id.substring(dotIndex + 1) : id;
}

/**
 * Extract the type from a Canon_ID (part before the first dot).
 */
function extractType(id: string): string {
  const dotIndex = id.indexOf('.');
  return dotIndex > 0 ? id.substring(0, dotIndex) : id;
}

/**
 * Convention-based asset path mapping per entity type.
 *
 * Characters  → assets/characters/{name}/fledgling/assembled.png
 * Creatures   → assets/entities/{name}/assembled.png
 * NPCs        → assets/entities/{name}/assembled.png
 * Biomes      → assets/biomes/{name}/bg.webp
 */
export function getConventionAssetPath(entityType: string, name: string): string | null {
  switch (entityType) {
    case 'character':
      return `assets/characters/${name}/fledgling/assembled.png`;
    case 'creature':
    case 'npc':
      return `assets/entities/${name}/assembled.png`;
    case 'biome':
      return `assets/biomes/${name}/bg.webp`;
    default:
      return null;
  }
}

/**
 * Derive the asset name for an entity.
 *
 * Uses `asset_id` from metadata if present, otherwise the portion of Canon_ID after the dot.
 */
export function getAssetName(entity: CanonEntity): string {
  if (entity.assetId) {
    return entity.assetId;
  }
  // Also check metadata for asset_id
  const metaAssetId = entity.metadata['asset_id'];
  if (typeof metaAssetId === 'string' && metaAssetId.length > 0) {
    return metaAssetId;
  }
  return extractEntityName(entity.id);
}

/**
 * Discover gallery assets for an entity by scanning the convention directory.
 *
 * For characters: scans assets/characters/{name}/ for all assembled.png across tiers.
 * For creatures/NPCs: scans assets/entities/{name}/ for all image files.
 * For biomes: scans assets/biomes/{name}/ for all image files (excluding bg.webp which is primary).
 *
 * Returns only paths to files that actually exist on disk.
 */
export function discoverGalleryAssets(
  entity: CanonEntity,
  assetsDir: string,
  primaryPath: string | undefined,
): string[] {
  const name = getAssetName(entity);
  const gallery: string[] = [];

  let scanDir: string;
  switch (entity.type) {
    case 'character':
      scanDir = path.join(assetsDir, 'characters', name);
      break;
    case 'creature':
    case 'npc':
      scanDir = path.join(assetsDir, 'entities', name);
      break;
    case 'biome':
      scanDir = path.join(assetsDir, 'biomes', name);
      break;
    default:
      return gallery;
  }

  if (!fs.existsSync(scanDir)) {
    return gallery;
  }

  // For characters, look for assembled.png in each tier subdirectory
  if (entity.type === 'character') {
    try {
      const entries = fs.readdirSync(scanDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const assembledPath = path.join(scanDir, entry.name, 'assembled.png');
          if (fs.existsSync(assembledPath)) {
            const relativePath = path.posix.join('assets', 'characters', name, entry.name, 'assembled.png');
            gallery.push(relativePath);
          }
        }
      }
    } catch {
      // Silently skip on read errors
    }
  } else {
    // For creatures/NPCs/biomes, scan directory for all image files
    const IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.svg']);
    try {
      const entries = fs.readdirSync(scanDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (IMAGE_EXTENSIONS.has(ext)) {
            const baseDir = entity.type === 'biome' ? 'biomes' : 'entities';
            const relativePath = path.posix.join('assets', baseDir, name, entry.name);
            gallery.push(relativePath);
          }
        }
      }
    } catch {
      // Silently skip on read errors
    }
  }

  // Sort gallery alphabetically and remove the primary image from gallery
  gallery.sort();
  if (primaryPath) {
    const normalizedPrimary = primaryPath.replaceAll('\\', '/');
    return gallery.filter(p => p !== normalizedPrimary);
  }
  return gallery;
}

/**
 * Resolve convention-based assets for an entity, checking file existence.
 *
 * Returns an AssetResult with the primary path set only if the file exists on disk,
 * and gallery populated from discovered assets.
 */
export function resolveConventionAssets(
  entity: CanonEntity,
  assetsDir: string,
): AssetResult {
  const name = getAssetName(entity);
  const conventionPath = getConventionAssetPath(entity.type, name);

  let primary: string | undefined;

  if (conventionPath) {
    // Check if the file actually exists on disk
    const fullPath = path.join(assetsDir, '..', conventionPath);
    const normalizedFullPath = path.resolve(fullPath);
    if (fs.existsSync(normalizedFullPath)) {
      primary = conventionPath;
    }
  }

  // Discover gallery assets
  const gallery = discoverGalleryAssets(entity, assetsDir, primary);

  return {
    entityId: entity.id,
    primary,
    gallery: gallery.length > 0 ? gallery : undefined,
    source: primary ? 'convention' : 'none',
  };
}

/**
 * Derive the file path for an entity page.
 *
 * Path format: `{contentDir}/{plural_type}/{entity_name}.md`
 */
export function getEntityPagePath(entity: CanonEntity, contentDir: string): string {
  const pluralType = pluralizeType(entity.type);
  const entityName = extractEntityName(entity.id);
  return path.posix.join(contentDir, pluralType, `${entityName}.md`);
}

/**
 * Alias for getEntityPagePath (design doc naming).
 */
export const getPagePath = getEntityPagePath;

/**
 * Handle an orphaned page (page with no corresponding canon entry).
 *
 * Returns the content unchanged and emits a warning.
 */
export function handleOrphanedPage(
  existingContent: string,
  filePath: string,
): { content: string; warnings: ValidationMessage[] } {
  return {
    content: existingContent,
    warnings: [
      {
        level: 'warning',
        file: filePath,
        message: 'Orphaned page: no canon entry found. Page left unchanged.',
      },
    ],
  };
}

/**
 * Get the display title for an entity by looking it up in the registry.
 * Falls back to deriving a title from the Canon_ID.
 */
function getTitleForEntity(id: string, allEntities: Map<string, CanonEntity>): string {
  const entity = allEntities.get(id);
  if (entity) {
    return entity.title;
  }
  // Fallback: derive from Canon_ID
  const name = extractEntityName(id);
  return name
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Build the complete list of related entries from forward relationships and reverse refs.
 */
function buildRelatedEntries(
  entity: CanonEntity,
  reverseRefs: ReverseRef[],
  allEntities: Map<string, CanonEntity>,
): RelatedEntry[] {
  const entries: RelatedEntry[] = [];
  const seen = new Set<string>();

  // Forward relationships from the entity itself
  for (const [relationshipKey, targetIds] of Object.entries(entity.relationships)) {
    for (const targetId of targetIds) {
      const key = `${targetId}:${relationshipKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        id: targetId,
        type: extractType(targetId),
        relationship: relationshipKey,
        title: getTitleForEntity(targetId, allEntities),
      });
    }
  }

  // Reverse references (other entities that reference this one)
  for (const ref of reverseRefs) {
    const key = `${ref.sourceId}:${ref.relationshipKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      id: ref.sourceId,
      type: extractType(ref.sourceId),
      relationship: ref.relationshipKey,
      title: getTitleForEntity(ref.sourceId, allEntities),
    });
  }

  return entries;
}

/**
 * Escape a string for use inside a double-quoted YAML value.
 * Escapes backslashes and double quotes.
 */
function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build the ai_context front matter object from canon metadata fields.
 *
 * Mapping:
 *   short_description → mood
 *   visual_identity → visual_style
 *   common_story_uses → common_encounters
 *   canon_constraints → writing_guidance
 *   standard_behavior → generation_hints
 *
 * Derived:
 *   themes → from entity tags
 *   lore_highlights → empty string
 *   related_entities → comma-separated list of related entity IDs
 *
 * Missing source fields produce empty strings rather than omitting the target key.
 */
export function buildAiContextFrontMatter(
  entity: CanonEntity,
  relatedEntries: RelatedEntry[],
): AiContext {
  const meta = entity.metadata;

  const mood = typeof meta['short_description'] === 'string' ? meta['short_description'] : '';
  const themes = entity.tags && entity.tags.length > 0
    ? entity.tags.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')
    : '';
  const visual_style = typeof meta['visual_identity'] === 'string' ? meta['visual_identity'] : '';
  const common_encounters = typeof meta['common_story_uses'] === 'string' ? meta['common_story_uses'] : '';
  const lore_highlights = '';
  const related_entities = relatedEntries.map(e => e.id).join(', ');
  const writing_guidance = typeof meta['canon_constraints'] === 'string' ? meta['canon_constraints'] : '';
  const generation_hints = typeof meta['standard_behavior'] === 'string' ? meta['standard_behavior'] : '';

  return {
    mood,
    themes,
    visual_style,
    common_encounters,
    lore_highlights,
    related_entities,
    writing_guidance,
    generation_hints,
  };
}

/**
 * Generate YAML front matter block for an entity page.
 *
 * Uses unquoted values where safe, matching Hugo conventions.
 */
function generateFrontMatter(
  entity: CanonEntity,
  assets: AssetResult,
  relatedEntries: RelatedEntry[],
): string {
  const lines: string[] = ['---'];

  lines.push(`title: ${entity.title}`);
  lines.push(`id: ${entity.id}`);
  lines.push(`type: ${entity.type}`);
  lines.push(`status: ${entity.status ?? 'draft'}`);
  lines.push(`lastReviewed: "${formatDate(new Date())}"`);

  // Canon status
  if (entity.canonStatus) {
    lines.push(`canon_status: ${entity.canonStatus}`);
    if (entity.canonStatus === 'intentionally_undefined') {
      lines.push(`draft: true`);
    }
  }

  // Tags
  if (entity.tags && entity.tags.length > 0) {
    const tagList = entity.tags.map(t => `"${t}"`).join(', ');
    lines.push(`tags: [${tagList}]`);
  } else {
    lines.push(`tags: []`);
  }

  // Richer metadata from controlled-value enums (classification, danger_level, scale, sapience)
  const meta = entity.metadata;
  if (typeof meta['classification'] === 'string') {
    lines.push(`classification: ${meta['classification']}`);
  }
  if (typeof meta['danger_level'] === 'string') {
    lines.push(`danger_level: ${meta['danger_level']}`);
  }
  if (typeof meta['scale'] === 'string') {
    lines.push(`scale: ${meta['scale']}`);
  }
  if (typeof meta['sapience'] === 'string') {
    lines.push(`sapience: ${meta['sapience']}`);
  }

  // Related entities
  if (relatedEntries.length > 0) {
    lines.push('related:');
    for (const entry of relatedEntries) {
      lines.push(`  - id: ${entry.id}`);
      lines.push(`    type: ${entry.type}`);
      lines.push(`    relationship: ${entry.relationship}`);
    }
  } else {
    lines.push('related: []');
  }

  // Assets — only include if entity has assets
  if (assets.primary || (assets.gallery && assets.gallery.length > 0)) {
    lines.push('assets:');
    if (assets.primary) {
      lines.push(`  primary: ${assets.primary}`);
    }
    if (assets.gallery && assets.gallery.length > 0) {
      lines.push('  gallery:');
      for (const img of assets.gallery) {
        lines.push(`    - ${img}`);
      }
    }
  }
  // When source is 'none', omit assets field entirely

  // AI context — emitted as front matter object
  const aiContext = buildAiContextFrontMatter(entity, relatedEntries);
  lines.push('ai_context:');
  lines.push(`  mood: "${escapeYamlString(aiContext.mood ?? '')}"`);
  lines.push(`  themes: "${escapeYamlString(aiContext.themes ?? '')}"`);
  lines.push(`  visual_style: "${escapeYamlString(aiContext.visual_style ?? '')}"`);
  lines.push(`  common_encounters: "${escapeYamlString(aiContext.common_encounters ?? '')}"`);
  lines.push(`  lore_highlights: "${escapeYamlString(aiContext.lore_highlights ?? '')}"`);
  lines.push(`  related_entities: "${escapeYamlString(aiContext.related_entities ?? '')}"`);
  lines.push(`  writing_guidance: "${escapeYamlString(aiContext.writing_guidance ?? '')}"`);
  lines.push(`  generation_hints: "${escapeYamlString(aiContext.generation_hints ?? '')}"`);

  // Layout and infobox
  lines.push(`layout: ${pluralizeType(entity.type)}`);
  lines.push(`infobox: ${entity.type}`);

  lines.push('---');
  return lines.join('\n');
}

/**
 * Convert a snake_case string to Title Case.
 * e.g. "primary_locations" → "Primary Locations"
 */
function toTitleCase(snakeStr: string): string {
  return snakeStr
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Generate the relationships section content (without markers).
 *
 * Deduplicates entries by entity ID, grouping multiple relationships as chips.
 * Relationship names are rendered in Title Case.
 */
function generateRelationshipsSection(
  relatedEntries: RelatedEntry[],
): string {
  if (relatedEntries.length === 0) {
    return '';
  }

  const lines: string[] = ['## Related Entities', ''];

  // Group by entity type
  const groups = new Map<string, RelatedEntry[]>();
  for (const entry of relatedEntries) {
    const typeGroup = groups.get(entry.type) ?? [];
    typeGroup.push(entry);
    groups.set(entry.type, typeGroup);
  }

  // Sort group keys alphabetically (by plural type name for display)
  const sortedTypes = [...groups.keys()].sort();

  for (const type of sortedTypes) {
    const group = groups.get(type)!;

    // Deduplicate: group relationships by entity ID
    const entityMap = new Map<string, { entry: RelatedEntry; relationships: string[] }>();
    for (const entry of group) {
      const existing = entityMap.get(entry.id);
      if (existing) {
        if (!existing.relationships.includes(entry.relationship)) {
          existing.relationships.push(entry.relationship);
        }
      } else {
        entityMap.set(entry.id, { entry, relationships: [entry.relationship] });
      }
    }

    // Sort entities alphabetically by title
    const sortedEntities = [...entityMap.values()].sort((a, b) =>
      a.entry.title.localeCompare(b.entry.title),
    );

    const pluralType = pluralizeType(type);
    // Capitalize first letter for heading
    const heading = pluralType.charAt(0).toUpperCase() + pluralType.slice(1);
    lines.push(`### ${heading}`);

    for (const { entry, relationships } of sortedEntities) {
      const entityName = extractEntityName(entry.id);
      const chips = relationships.map(r => `\`${toTitleCase(r)}\``).join(' ');
      lines.push(`- [${entry.title}](/${pluralType}/${entityName}/) ${chips}`);
    }
    lines.push('');
  }

  // Remove trailing empty line
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

/**
 * Generate the AI context section content (without markers).
 */
function generateAiContextSection(
  entity: CanonEntity,
  relatedEntries: RelatedEntry[],
): string {
  const meta = entity.metadata;
  const lines: string[] = ['## AI Context', ''];

  // Mood: short_description
  const mood = typeof meta['short_description'] === 'string' ? meta['short_description'] : '';
  lines.push(`**Mood:** ${mood}`);

  // Themes: derived from tags
  const themes = entity.tags && entity.tags.length > 0
    ? entity.tags.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')
    : '';
  lines.push(`**Themes:** ${themes}`);

  // Visual Style: visual_identity
  const visualStyle = typeof meta['visual_identity'] === 'string' ? meta['visual_identity'] : '';
  lines.push(`**Visual Style:** ${visualStyle}`);

  // Common Encounters: common_story_uses
  const commonEncounters = typeof meta['common_story_uses'] === 'string' ? meta['common_story_uses'] : '';
  lines.push(`**Common Encounters:** ${commonEncounters}`);

  // Lore Highlights: empty by default
  lines.push(`**Lore Highlights:** `);

  // Related Entities: list all related entity IDs
  const relatedIds = relatedEntries.map(e => e.id).join(', ');
  lines.push(`**Related Entities:** ${relatedIds}`);

  // Writing Guidance: canon_constraints
  const writingGuidance = typeof meta['canon_constraints'] === 'string' ? meta['canon_constraints'] : '';
  lines.push(`**Writing Guidance:** ${writingGuidance}`);

  // Generation Hints: standard_behavior
  const generationHints = typeof meta['standard_behavior'] === 'string' ? meta['standard_behavior'] : '';
  lines.push(`**Generation Hints:** ${generationHints}`);

  return lines.join('\n');
}

/**
 * Wrap content with generated section markers.
 */
function wrapWithMarkers(sectionName: string, content: string): string {
  return `${BEGIN_MARKER(sectionName)}\n${content}\n${END_MARKER(sectionName)}`;
}

/**
 * Parse existing page content and extract sections relative to markers.
 *
 * Returns an object with:
 * - `frontMatter`: the original front matter (between --- delimiters)
 * - `body`: the page body after front matter
 * - `sections`: map of section name → { start, end } positions in body
 */
function parseExistingPage(content: string): {
  frontMatter: string | null;
  body: string;
  sections: Map<string, { startIndex: number; endIndex: number }>;
} {
  let frontMatter: string | null = null;
  let body = content;

  // Extract front matter
  if (content.startsWith('---')) {
    const endIndex = content.indexOf('\n---', 3);
    if (endIndex !== -1) {
      const fmEnd = endIndex + 4; // includes the closing ---
      frontMatter = content.substring(0, fmEnd);
      body = content.substring(fmEnd);
      // Remove leading newline if present
      if (body.startsWith('\n')) {
        body = body.substring(1);
      }
    }
  }

  // Find generated section markers in the body
  const sections = new Map<string, { startIndex: number; endIndex: number }>();
  for (const sectionName of GENERATED_SECTIONS) {
    const beginMarker = BEGIN_MARKER(sectionName);
    const endMarkerStr = END_MARKER(sectionName);
    const startIdx = body.indexOf(beginMarker);
    if (startIdx === -1) continue;
    const endIdx = body.indexOf(endMarkerStr, startIdx);
    if (endIdx === -1) continue;
    sections.set(sectionName, {
      startIndex: startIdx,
      endIndex: endIdx + endMarkerStr.length,
    });
  }

  return { frontMatter, body, sections };
}

/**
 * Replace generated sections in existing content while preserving handwritten content.
 *
 * Strategy:
 * - Replace content within each marker pair with fresh generated content
 * - Preserve everything outside markers byte-for-byte
 */
function replaceGeneratedSections(
  body: string,
  generatedSections: Map<string, string>,
  sections: Map<string, { startIndex: number; endIndex: number }>,
): string {
  // Process sections in reverse order of their start position to maintain indices
  const sortedEntries = [...sections.entries()].sort(
    (a, b) => b[1].startIndex - a[1].startIndex,
  );

  let result = body;
  for (const [sectionName, { startIndex, endIndex }] of sortedEntries) {
    const newContent = generatedSections.get(sectionName);
    if (newContent !== undefined) {
      result = result.substring(0, startIndex) + newContent + result.substring(endIndex);
    }
  }

  return result;
}

/**
 * Generate the full page content for a canon entity.
 *
 * Handles both new page creation and updates to existing pages with
 * handwritten content preservation.
 */
export function generatePage(
  options: PageGeneratorOptions,
  allEntities: CanonRegistry | Map<string, CanonEntity>,
): { content: string; warnings: ValidationMessage[] } {
  const { entity, assets, reverseRefs, existingContent } = options;
  const warnings: ValidationMessage[] = [];

  // Resolve the entities map from either a CanonRegistry or a plain Map
  const entitiesMap: Map<string, CanonEntity> =
    'entities' in allEntities ? allEntities.entities : allEntities;

  // Build the complete related entries list
  const relatedEntries = buildRelatedEntries(entity, reverseRefs, entitiesMap);

  // Generate front matter
  const frontMatter = generateFrontMatter(entity, assets, relatedEntries);

  // Generate section contents
  const relationshipsContent = generateRelationshipsSection(relatedEntries);

  // Build generated sections (only include relationships if there are any)
  const hasRelationships = relatedEntries.length > 0;
  const relationshipsSection = hasRelationships
    ? wrapWithMarkers('relationships', relationshipsContent)
    : '';

  // If no existing content, create a brand new page
  // Note: ai_context is now in front matter, so we don't emit body blocks for it
  if (!existingContent) {
    const parts = [frontMatter];
    if (hasRelationships) {
      parts.push('', relationshipsSection);
    }
    parts.push('');
    return { content: parts.join('\n'), warnings };
  }

  // Parse existing page
  const parsed = parseExistingPage(existingContent);

  // Check if the page has any generated section markers
  if (parsed.sections.size === 0) {
    // No markers found — append generated sections at end, emit warning
    warnings.push({
      level: 'warning',
      file: '',
      entityId: entity.id,
      message: `Page has no generated section markers. Appending generated sections at end.`,
    });

    // Replace front matter, preserve body, append generated sections
    // Note: ai_context is now in front matter, so only relationship section is appended
    let result = frontMatter + '\n';
    result += parsed.body;
    // Ensure there's a newline before appending
    if (!result.endsWith('\n')) {
      result += '\n';
    }
    if (hasRelationships) {
      result += '\n' + relationshipsSection + '\n';
    }
    return { content: result, warnings };
  }

  // Page has markers — replace content within markers, preserve everything else
  // For ai_context: since it's now in front matter, remove the body block entirely
  const generatedSections = new Map<string, string>();
  if (parsed.sections.has('relationships')) {
    generatedSections.set('relationships', relationshipsSection || '');
  }
  if (parsed.sections.has('ai_context')) {
    // Replace ai_context body block with empty string to remove it
    generatedSections.set('ai_context', '');
  }

  const updatedBody = replaceGeneratedSections(parsed.body, generatedSections, parsed.sections);

  // Rebuild the page: new front matter + preserved body with updated sections
  const result = frontMatter + '\n' + updatedBody;

  // Ensure trailing newline
  if (!result.endsWith('\n')) {
    return { content: result + '\n', warnings };
  }
  return { content: result, warnings };
}

/**
 * Format a Date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
