/**
 * Shared type definitions for the World Encyclopedia Generator CLI.
 */

/** Configuration for a Generator run. */
export interface GeneratorConfig {
  /** Path to the canon/ directory containing YAML entity files. */
  canonDir: string;
  /** Path to the assets/ directory containing entity artwork. */
  assetsDir: string;
  /** Path to wiki/content/ directory where Markdown pages are written. */
  contentDir: string;
  /** Path to wiki/.gen-manifest.json for incremental generation tracking. */
  manifestPath: string;
  /** When true, skip incremental check and regenerate everything. */
  forceAll?: boolean;
}

/** Summary result of a Generator run. */
export interface GeneratorResult {
  totalEntities: number;
  pagesCreated: number;
  pagesUpdated: number;
  warnings: ValidationMessage[];
  errors: ValidationMessage[];
}

/** A validation message emitted during canon processing. */
export interface ValidationMessage {
  level: 'error' | 'warning';
  file: string;
  entityId?: string;
  field?: string;
  message: string;
}

/** A parsed canon entity extracted from a YAML file. */
export interface CanonEntity {
  /** Canon_ID e.g. "creature.bigfoot" */
  id: string;
  /** Entity type e.g. "creature" */
  type: string;
  /** Display title */
  title: string;
  /** Entity status e.g. "draft", "reviewed", "final" */
  status?: string;
  /** Searchable tags */
  tags?: string[];
  /** Whether this entity is featured on the homepage */
  featured?: boolean;
  /** Relationships keyed by relationship name, values are arrays of Canon_IDs */
  relationships: Record<string, string[]>;
  /** Explicit asset paths referenced in the canon file */
  assets?: string[];
  /** All other fields from the YAML definition */
  metadata: Record<string, unknown>;
  /** Canon status: confirmed, newly_defined, or intentionally_undefined */
  canonStatus?: string;
  /** Asset directory name (may differ from id name) */
  assetId?: string;
}

/** The full registry of parsed canon entities with lookup indexes. */
export interface CanonRegistry {
  /** Canon_ID → entity */
  entities: Map<string, CanonEntity>;
  /** Entity type → entities of that type */
  byType: Map<string, CanonEntity[]>;
  /** Canon_ID → list of entities that reference it */
  reverseRefs: Map<string, ReverseRef[]>;
}

/** A reverse reference indicating who references a given entity. */
export interface ReverseRef {
  /** Canon_ID of the entity that contains the reference */
  sourceId: string;
  /** The relationship field name in the source entity */
  relationshipKey: string;
}

/** Result of asset discovery for a single entity. */
export interface AssetResult {
  entityId: string;
  /** Single image path when exactly one image is found */
  primary?: string;
  /** Multiple image paths when more than one is found (alpha-sorted) */
  gallery?: string[];
  /** How the asset was resolved */
  source: 'explicit' | 'convention' | 'none';
}

/** AI context metadata for entity pages, intended for AI tools, not end-user display. */
export interface AiContext {
  mood?: string;
  themes?: string;
  visual_style?: string;
  common_encounters?: string;
  lore_highlights?: string;
  related_entities?: string;
  writing_guidance?: string;
  generation_hints?: string;
}

/** Asset references for an entity page's front matter. */
export interface EntityAssets {
  primary?: string;
  gallery?: string[];
}

/** Front matter structure produced by the Generator for entity pages. */
export interface EntityFrontMatter {
  title: string;
  id: string;
  type: string;
  status: string;
  lastReviewed: string;
  canon_status?: string;
  draft?: boolean;
  tags: string[];
  classification?: string;
  danger_level?: string;
  scale?: string;
  sapience?: string;
  related: Array<{ id: string; type: string; relationship: string }>;
  assets?: EntityAssets;
  ai_context?: AiContext;
  layout: string;
  infobox: string;
}

/** Options passed to the page generator for a single entity. */
export interface PageGeneratorOptions {
  entity: CanonEntity;
  assets: AssetResult;
  reverseRefs: ReverseRef[];
  /** Current file content if the page already exists */
  existingContent?: string;
  /**
   * `content/bestiary.json` creatures — canon's encounter blocks joined with
   * the band table in `content/rules.json`. Absent for non-creature pages and
   * whenever the projection has not been generated.
   */
  bestiary?: Record<string, import('./page-generator.ts').BestiaryEntry>;
  /** `content/rules.json` `encounterBands`, for the band's plain-language line. */
  bands?: Record<string, import('./page-generator.ts').BandInfo>;
}
