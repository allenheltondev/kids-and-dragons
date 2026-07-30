/**
 * Page Generator — creates and updates Markdown entity pages with generated sections.
 *
 * Generates front matter, relationship sections, and AI context sections from
 * canon data while preserving handwritten content byte-for-byte outside of
 * generated section markers.
 */

import path from 'node:path';
import type { CanonEntity, AssetResult, CanonRegistry, ReverseRef, PageGeneratorOptions, ValidationMessage } from './types.ts';

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
  if (assets.primary) {
    lines.push('assets:');
    lines.push(`  primary: ${assets.primary}`);
  } else if (assets.gallery && assets.gallery.length > 0) {
    lines.push('assets:');
    lines.push('  gallery:');
    for (const img of assets.gallery) {
      lines.push(`    - ${img}`);
    }
  }
  // When source is 'none', omit assets field entirely

  // Layout and infobox
  lines.push(`layout: ${pluralizeType(entity.type)}`);
  lines.push(`infobox: ${entity.type}`);

  lines.push('---');
  return lines.join('\n');
}

/**
 * Generate the relationships section content (without markers).
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
    // Sort entries alphabetically by title within each group
    group.sort((a, b) => a.title.localeCompare(b.title));

    const pluralType = pluralizeType(type);
    // Capitalize first letter for heading
    const heading = pluralType.charAt(0).toUpperCase() + pluralType.slice(1);
    lines.push(`### ${heading}`);

    for (const entry of group) {
      const entityName = extractEntityName(entry.id);
      lines.push(`- [${entry.title}](/${pluralType}/${entityName}/) — ${entry.relationship}`);
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
  const aiContextContent = generateAiContextSection(entity, relatedEntries);

  // Build generated sections (only include relationships if there are any)
  const hasRelationships = relatedEntries.length > 0;
  const relationshipsSection = hasRelationships
    ? wrapWithMarkers('relationships', relationshipsContent)
    : '';
  const aiContextSection = wrapWithMarkers('ai_context', aiContextContent);

  // If no existing content, create a brand new page
  if (!existingContent) {
    const parts = [frontMatter];
    if (hasRelationships) {
      parts.push('', relationshipsSection);
    }
    parts.push('', aiContextSection, '');
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
    let result = frontMatter + '\n';
    result += parsed.body;
    // Ensure there's a newline before appending
    if (!result.endsWith('\n')) {
      result += '\n';
    }
    if (hasRelationships) {
      result += '\n' + relationshipsSection + '\n';
    }
    result += '\n' + aiContextSection + '\n';
    return { content: result, warnings };
  }

  // Page has markers — replace content within markers, preserve everything else
  const generatedSections = new Map<string, string>();
  if (parsed.sections.has('relationships')) {
    generatedSections.set('relationships', relationshipsSection || '');
  }
  if (parsed.sections.has('ai_context')) {
    generatedSections.set('ai_context', aiContextSection);
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
