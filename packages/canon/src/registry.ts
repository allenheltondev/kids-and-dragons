/**
 * The registry — every entity, plus the edges between them, indexed both ways.
 *
 * Referential integrity lives here rather than in the schemas because it is a
 * cross-file question: `creature.glassback_crab` naming `biome.mount_red_sky`
 * cannot be settled while parsing creatures.yaml alone.
 *
 * The reverse index is the reason this exists at all. "What lives in the
 * Enchanted Woods" is the query encounter generation makes, and canon states it
 * only in the forward direction on some fields and only in the reverse on
 * others (`biome.inhabitants` points down, `creature.relationships` points up).
 * Walking every declared edge once, in both directions, means neither authoring
 * style is privileged and neither has to be kept in sync by hand.
 *
 * Edges are discovered from the **schemas**, not from a list: `canonRef()`
 * stamps `ref:<taxonomies>` into each field's `description`, so an edge is
 * anything whose schema says it is one. Add a field with `edge(...)` and it is
 * indexed, validated and queryable with no further wiring.
 */

import { z } from "zod";
import { SCHEMAS } from "./taxonomies.js";
import type { CanonEntity } from "./taxonomies.js";
import { prefixOf, refTargets } from "./ids.js";
import type { Taxonomy } from "./ids.js";
import type { CanonIssue, ParsedEntity, ParseResult } from "./parse.js";

export interface CanonEdge {
  from: string;
  /** Dotted path, e.g. `inhabitants.ambient_creatures`. */
  field: string;
  to: string;
}

export interface CanonRegistry {
  byId: ReadonlyMap<string, CanonEntity>;
  taxonomyOf: ReadonlyMap<string, Taxonomy>;
  byTaxonomy: ReadonlyMap<Taxonomy, readonly CanonEntity[]>;
  edges: readonly CanonEdge[];
  /** id → edges leaving it. */
  out: ReadonlyMap<string, readonly CanonEdge[]>;
  /** id → edges arriving at it. This is the index nothing else has. */
  in: ReadonlyMap<string, readonly CanonEdge[]>;
  instructions: Partial<Record<Taxonomy, string[]>>;
  issues: readonly CanonIssue[];
}

/**
 * Every edge field a taxonomy declares, as dotted paths, read off the schema.
 *
 * `canonRef()` describes itself; this walks the shape looking for that mark.
 * Cached per taxonomy because the walk is pure and the schemas are frozen.
 */
export interface EdgePath {
  /** Dotted path into the entity, e.g. `inhabitants.ambient_creatures`. */
  path: string;
  /** The taxonomies this field is allowed to point at. */
  to: Taxonomy[];
}

const edgePathCache = new Map<Taxonomy, EdgePath[]>();

function edgePaths(taxonomy: Taxonomy): EdgePath[] {
  const cached = edgePathCache.get(taxonomy);
  if (cached) return cached;

  const paths: EdgePath[] = [];

  const visit = (schema: z.ZodTypeAny, trail: string[]): void => {
    const def = schema as unknown as { def?: { type?: string; shape?: unknown } };
    const targets = refTargets((schema as { description?: string }).description);

    if (targets) {
      paths.push({ path: trail.join("."), to: targets });
      return;
    }

    const unwrapped = schema as unknown as {
      unwrap?: () => z.ZodTypeAny;
      def?: { innerType?: z.ZodTypeAny; element?: z.ZodTypeAny; shape?: Record<string, z.ZodTypeAny>; type?: string };
    };

    // optional / default / nullable wrappers
    if (unwrapped.def?.innerType) {
      visit(unwrapped.def.innerType, trail);
      return;
    }
    // arrays — an edge is a list of refs
    if (unwrapped.def?.element) {
      visit(unwrapped.def.element, trail);
      return;
    }
    // objects — recurse into each key
    if (def?.def?.type === "object" && unwrapped.def?.shape) {
      for (const [key, child] of Object.entries(unwrapped.def.shape)) {
        visit(child, [...trail, key]);
      }
    }
  };

  visit(SCHEMAS[taxonomy] as unknown as z.ZodTypeAny, []);
  edgePathCache.set(taxonomy, paths);
  return paths;
}

function read(value: unknown, path: string[]): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/** Builds the registry and appends every referential-integrity problem found. */
export function buildRegistry(parsed: ParseResult): CanonRegistry {
  const byId = new Map<string, CanonEntity>();
  const taxonomyOf = new Map<string, Taxonomy>();
  const byTaxonomy = new Map<Taxonomy, CanonEntity[]>();
  const issues: CanonIssue[] = [...parsed.issues];
  const fileOf = new Map<string, string>();

  for (const { taxonomy, file, entity } of parsed.entities) {
    if (byId.has(entity.id)) {
      issues.push({
        level: "error",
        file,
        id: entity.id,
        message: `duplicate id (also in ${fileOf.get(entity.id) ?? "?"})`,
      });
      continue;
    }
    byId.set(entity.id, entity);
    taxonomyOf.set(entity.id, taxonomy);
    fileOf.set(entity.id, file);
    const bucket = byTaxonomy.get(taxonomy);
    if (bucket) bucket.push(entity);
    else byTaxonomy.set(taxonomy, [entity]);
  }

  const edges: CanonEdge[] = [];
  const out = new Map<string, CanonEdge[]>();
  const incoming = new Map<string, CanonEdge[]>();

  const push = (map: Map<string, CanonEdge[]>, key: string, edge: CanonEdge): void => {
    const bucket = map.get(key);
    if (bucket) bucket.push(edge);
    else map.set(key, [edge]);
  };

  for (const { taxonomy, file, entity } of parsed.entities) {
    for (const { path: dotted, to } of edgePaths(taxonomy)) {
      const raw = read(entity, dotted.split("."));
      if (raw === undefined) continue;
      for (const target of Array.isArray(raw) ? raw : [raw]) {
        if (typeof target !== "string") continue;
        const edge: CanonEdge = { from: entity.id, field: dotted, to: target };
        edges.push(edge);
        push(out, entity.id, edge);
        push(incoming, target, edge);

        const targetTaxonomy = taxonomyOf.get(target);
        if (targetTaxonomy === undefined) {
          issues.push({
            level: "error",
            file,
            id: entity.id,
            field: dotted,
            message: prefixOf(target)
              ? `references "${target}", which does not exist`
              : `references "${target}", which is not a prefixed canon id`,
          });
        } else if (!to.includes(targetTaxonomy)) {
          // Stronger than a prefix check: the target is real, but it is the
          // wrong *kind* of thing for this field to point at.
          issues.push({
            level: "error",
            file,
            id: entity.id,
            field: dotted,
            message: `references a ${targetTaxonomy} ("${target}"); this field takes ${to.join(" or ")}`,
          });
        }
      }
    }
  }

  return {
    byId,
    taxonomyOf,
    byTaxonomy,
    edges,
    out,
    in: incoming,
    instructions: parsed.instructions,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Queries. The shapes §8's agent tools are built from.
// ---------------------------------------------------------------------------

export function get(registry: CanonRegistry, id: string): CanonEntity | undefined {
  return registry.byId.get(id);
}

export function list(registry: CanonRegistry, taxonomy: Taxonomy): readonly CanonEntity[] {
  return registry.byTaxonomy.get(taxonomy) ?? [];
}

/**
 * Neighbours of an entity. `"in"` answers "what points at this" — the query
 * that makes `biome.enchanted_woods` able to name its creatures even though
 * half of them only declare the relationship from their own side.
 */
export function related(
  registry: CanonRegistry,
  id: string,
  options: { direction?: "out" | "in"; field?: string } = {},
): readonly CanonEdge[] {
  const { direction = "out", field } = options;
  const edges = (direction === "out" ? registry.out : registry.in).get(id) ?? [];
  return field ? edges.filter((edge) => edge.field === field) : edges;
}

/**
 * Every `asset_id` that claims art has a directory to point at.
 *
 * `asset_id` is the one join D3 left standing — to `assets/`, to `content/`, to
 * the bestiary — and nothing checked it. The corpus happens to be exactly 1:1
 * with `assets/entities/` today (27 and 27), which is worth keeping true rather
 * than rediscovering.
 */
export function checkAssets(
  registry: CanonRegistry,
  assetsDir: string,
  exists: (path: string) => boolean,
): CanonIssue[] {
  const DIRS: Partial<Record<Taxonomy, string>> = {
    creature: "entities",
    people: "entities",
    biome: "biomes",
    species: "characters",
  };
  const issues: CanonIssue[] = [];
  for (const [id, entity] of registry.byId) {
    const taxonomy = registry.taxonomyOf.get(id);
    const dir = taxonomy ? DIRS[taxonomy] : undefined;
    const assetId = (entity as { asset_id?: string }).asset_id;
    if (!dir || !assetId) continue;
    if (!exists(`${assetsDir}/${dir}/${assetId}`)) {
      issues.push({
        level: "warning",
        file: `${dir}/${assetId}`,
        id,
        field: "asset_id",
        message: `no art directory at assets/${dir}/${assetId}`,
      });
    }
  }
  return issues;
}

export function errors(registry: CanonRegistry): readonly CanonIssue[] {
  return registry.issues.filter((issue) => issue.level === "error");
}

export function warnings(registry: CanonRegistry): readonly CanonIssue[] {
  return registry.issues.filter((issue) => issue.level === "warning");
}

export { edgePaths };
export type { ParsedEntity };
