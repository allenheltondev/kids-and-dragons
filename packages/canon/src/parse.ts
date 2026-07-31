/**
 * canon/*.yaml → validated entities.
 *
 * Two things this deliberately does *not* do, both because D2 moved the work
 * into the files themselves:
 *
 *   - **No id resolution.** Every reference in the corpus is already
 *     `<prefix>.<slug>`, so a ref is a regex and a registry lookup. The old
 *     `resolveBareIds()` + `RELATIONSHIP_KEY_TO_PREFIX` machinery in
 *     `tools/wiki/canon-parser.ts` has nothing left to do.
 *   - **No metadata bag.** That parser put every unrecognised field into
 *     `metadata: Record<string, unknown>`; here the schemas are strict, so an
 *     unrecognised field is an error with a filename and a line of context. A
 *     typo'd `visual_identtiy` used to silently vanish from the art brief.
 *
 * Referential integrity is *not* checked here — it is a cross-file question and
 * belongs to the registry. Keeping them apart is why a malformed id and a
 * dangling id read differently: one is a typo, the other is a missing entity.
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { SCHEMAS } from "./taxonomies.js";
import type { CanonEntity } from "./taxonomies.js";
import { TAXONOMY_PREFIX } from "./ids.js";
import type { Taxonomy } from "./ids.js";

/** The schema version these files declare, and this package understands (D13). */
export const SCHEMA_VERSION = "2.0";

/**
 * file → { top-level array key: taxonomy }. Data, not code: a new taxonomy is a
 * schema plus a row here (canon-contract §3).
 */
export const FILES: Record<string, Record<string, Taxonomy>> = {
  "biomes.yaml": { biomes: "biome" },
  "characters.yaml": { characters: "species" },
  "creatures.yaml": { creatures: "creature" },
  "npcs.yaml": { npcs: "people" },
  "individuals.yaml": { individuals: "individual" },
  "factions.yaml": { factions: "faction" },
  "items.yaml": { items: "item" },
  "locations.yaml": { locations: "location" },
  "quests.yaml": { quests: "quest" },
  "campaigns.yaml": { campaigns: "campaign" },
  "geography.yaml": { features: "feature", routes: "route" },
};

export interface CanonIssue {
  level: "error" | "warning";
  file: string;
  id?: string;
  field?: string;
  message: string;
}

export interface ParsedEntity {
  taxonomy: Taxonomy;
  file: string;
  entity: CanonEntity;
}

export interface ParseResult {
  entities: ParsedEntity[];
  issues: CanonIssue[];
  /** Per-file `agent_instructions`, keyed by taxonomy — §8 returns these. */
  instructions: Partial<Record<Taxonomy, string[]>>;
}

/**
 * Open vocabularies are validated against the file's own `controlled_values`
 * rather than a `z.enum` (taxonomies.ts header). This is the list of fields
 * that participate — a field named here must have a matching
 * `controlled_values` block, and every value used must be defined in it.
 *
 * The effect is that `controlled_values` stops being decoration: adding a new
 * `kind` means defining it, in the file, where the next author will read it.
 */
const CONTROLLED = [
  "role",
  "kind",
  "canon_status",
  "map_provenance",
  "environment_type",
  "danger_level",
  "classification",
  "sapience",
  "scale",
  "category",
  "rarity",
  "faction_type",
  "alignment",
  "quest_type",
  "difficulty",
  "campaign_type",
  "location_type",
  "travel_modes",
] as const;

function checkControlled(
  file: string,
  doc: Record<string, unknown>,
  entity: Record<string, unknown>,
  issues: CanonIssue[],
): void {
  const vocab = (doc["controlled_values"] ?? {}) as Record<string, unknown>;
  for (const field of CONTROLLED) {
    const raw = entity[field];
    if (raw === undefined) continue;
    const defined = vocab[field];
    if (defined === undefined || typeof defined !== "object" || defined === null) {
      issues.push({
        level: "warning",
        file,
        id: String(entity["id"]),
        field,
        message: `used but not defined in controlled_values`,
      });
      continue;
    }
    const allowed = new Set(Object.keys(defined as Record<string, unknown>));
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (typeof value === "string" && !allowed.has(value)) {
        issues.push({
          level: "error",
          file,
          id: String(entity["id"]),
          field,
          message: `"${value}" is not in controlled_values.${field} (${[...allowed].join(", ")})`,
        });
      }
    }
  }
}

/** Parse one canon directory. Never throws — every problem is an issue. */
export function parseCanon(canonDir: string): ParseResult {
  const entities: ParsedEntity[] = [];
  const issues: CanonIssue[] = [];
  const instructions: Partial<Record<Taxonomy, string[]>> = {};

  for (const [filename, keys] of Object.entries(FILES)) {
    const full = path.join(canonDir, filename);
    if (!fs.existsSync(full)) {
      issues.push({ level: "error", file: filename, message: "missing" });
      continue;
    }

    let doc: Record<string, unknown>;
    try {
      doc = yaml.load(fs.readFileSync(full, "utf8")) as Record<string, unknown>;
    } catch (err) {
      issues.push({
        level: "error",
        file: filename,
        message: `YAML: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    if (doc?.["schema_version"] !== SCHEMA_VERSION) {
      issues.push({
        level: "error",
        file: filename,
        field: "schema_version",
        message: `expected "${SCHEMA_VERSION}", found ${JSON.stringify(doc?.["schema_version"])}`,
      });
    }

    const agentInstructions = doc?.["agent_instructions"];

    for (const [key, taxonomy] of Object.entries(keys)) {
      if (Array.isArray(agentInstructions)) {
        instructions[taxonomy] = agentInstructions.map((line) =>
          typeof line === "string" ? line : JSON.stringify(line),
        );
      }

      const rows = doc?.[key];
      if (!Array.isArray(rows)) {
        issues.push({ level: "error", file: filename, field: key, message: "missing or not a list" });
        continue;
      }

      for (const row of rows) {
        const record = row as Record<string, unknown>;
        const id = typeof record?.["id"] === "string" ? record["id"] : "<no id>";
        const parsed = SCHEMAS[taxonomy].safeParse(row);

        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            issues.push({
              level: "error",
              file: filename,
              id,
              field: issue.path.join(".") || undefined,
              message: issue.message,
            });
          }
          continue;
        }

        const expected = TAXONOMY_PREFIX[taxonomy];
        if (!parsed.data.id.startsWith(`${expected}.`)) {
          issues.push({
            level: "error",
            file: filename,
            id,
            field: "id",
            message: `a ${taxonomy} in ${filename} must be "${expected}.*"`,
          });
        }

        checkControlled(filename, doc, record, issues);
        entities.push({ taxonomy, file: filename, entity: parsed.data as CanonEntity });
      }
    }
  }

  return { entities, issues, instructions };
}

/** Formats a zod error the way `canon:check` prints it. */
export function formatIssue(issue: CanonIssue): string {
  const where = [issue.file, issue.id, issue.field].filter(Boolean).join(" · ");
  return `${issue.level === "error" ? "ERROR" : "warn "}  ${where}: ${issue.message}`;
}

export { z };
