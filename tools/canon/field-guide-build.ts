/**
 * The projection behind `content/field-guide.json`, kept apart from the script
 * so a test can run it against any registry without touching the disk.
 *
 * Everything that reaches the output goes through a named copy below. There is
 * no spread of an entity or a lore block anywhere in this file, and that is the
 * point: the allow-list is the code, so reading it tells you exactly what a
 * player can see.
 */

import type { CanonRegistry, Taxonomy } from "@kad/canon";
import type {
  FieldGuide,
  FieldGuideCategory,
  FieldGuideClass,
  FieldGuideEntry,
  FieldGuideKind,
  FieldGuideLore,
  FieldGuideOpinion,
  FieldGuidePlaceLore,
  FieldGuideReverseOpinion,
  FieldGuideTip,
} from "@kad/shared";

/** Which taxonomies a player can meet, and the shelf each goes on. */
const SCOPE: Partial<Record<Taxonomy, { category: FieldGuideCategory; kind: FieldGuideKind }>> = {
  creature: { category: "creatures", kind: "creature" },
  species: { category: "peoples", kind: "species" },
  people: { category: "peoples", kind: "people" },
  individual: { category: "folk", kind: "individual" },
  biome: { category: "places", kind: "biome" },
  location: { category: "places", kind: "location" },
  faction: { category: "factions", kind: "faction" },
  class: { category: "classes", kind: "class" },
};

const CATEGORY_ORDER: FieldGuideCategory[] = ["creatures", "peoples", "classes", "folk", "places", "factions"];

/** The entity as the allow-list sees it: every field optional, nothing trusted. */
interface Loose {
  id: string;
  title: string;
  short_description?: string;
  danger_level?: string;
  scale?: string;
  classification?: string;
  asset_id?: string;
  lore?: Record<string, unknown>;
  role?: string;
  gear?: string;
  home?: string;
  distinctions?: { rank: FieldGuideClass["distinctions"][number]["rank"]; move: string }[];
  encounter?: { resolutions?: { kind: string; text?: string }[]; traits?: string[] };
}

interface LooseOpinion {
  of: string;
  because: string;
}

interface LooseRelationship {
  place: string;
  relationship: string;
}

export interface FieldGuideReport {
  /** In-scope entities with no `lore` block, as canon ids. */
  withoutLore: string[];
  /** likes / dislikes / likedBy / dislikedBy / regional targets with no entry. */
  unresolved: { from: string; field: string; to: string }[];
}

export type FileExists = (relativeToAssets: string) => boolean;

/** A faction is only in the guide for its lore; everything else is in by right. */
function isIncluded(entity: Loose, taxonomy: Taxonomy): boolean {
  return taxonomy === "faction" ? entity.lore !== undefined : true;
}

/** Where the picture is, if there is one. Mirrors the client's art-paths.ts. */
function artFor(taxonomy: Taxonomy, entity: Loose, exists: FileExists): string | undefined {
  // Lore-only canon entries can still have delivered art under their canon slug.
  const id = entity.asset_id ?? entity.id.split(".").at(-1);
  if (!id) return undefined;
  const candidates: string[] =
    taxonomy === "species"
      ? [`characters/${id}/fledgling/assembled.png`]
      : taxonomy === "biome" || taxonomy === "location"
        ? [`biomes/${id}/portrait.webp`, `biomes/${id}/bg.webp`]
        : taxonomy === "creature" || taxonomy === "people"
          ? [`entities/${id}/portrait.webp`, `entities/${id}/assembled.png`]
          : taxonomy === "individual"
            ? [`cast/${id}/portrait.webp`, `cast/${id}/assembled.png`, `entities/${id}/portrait.webp`, `entities/${id}/assembled.png`]
            : taxonomy === "faction"
              ? [`entities/${id}/portrait.webp`, `entities/${id}/assembled.png`]
              : [];
  // These places/groups have scene or cast art rather than a same-name portrait.
  const illustrations: Record<string, string> = {
    "location.hollow_gate": "scenes/gemfall/hollow-gate.webp",
    // A class place's painting (assets/scenes/classes). Its class gets none on
    // purpose: the class entry shows the class's own painted badge in the
    // client, and the room's painting would give the room away before the
    // party has been there.
    "location.dojo": "scenes/classes/dojo.webp",
    "location.academy": "scenes/classes/academy.webp",
    "location.rookery": "scenes/classes/rookery.webp",
    "location.conservatory": "scenes/classes/conservatory.webp",
    "faction.deep_hollow_cult": "cast/cult_bigfoot/assembled.png",
  };
  if (illustrations[entity.id]) candidates.push(illustrations[entity.id]!);
  const found = candidates.find((candidate) => exists(candidate));
  return found === undefined ? undefined : `/assets/${found}`;
}

export function buildFieldGuide(
  registry: CanonRegistry,
  exists: FileExists,
): { guide: FieldGuide; report: FieldGuideReport } {
  const titleOf = (id: string): string => (registry.byId.get(id) as Loose | undefined)?.title ?? id;
  const unresolved: FieldGuideReport["unresolved"] = [];
  const withoutLore: string[] = [];

  /** First pass: who is in. Needed up front so every edge can be checked. */
  const inScope: { taxonomy: Taxonomy; entity: Loose }[] = [];
  for (const taxonomy of Object.keys(SCOPE) as Taxonomy[]) {
    for (const raw of registry.byTaxonomy.get(taxonomy) ?? []) {
      const entity = raw as unknown as Loose;
      if (isIncluded(entity, taxonomy)) inScope.push({ taxonomy, entity });
    }
  }
  const included = new Set(inScope.map(({ entity }) => entity.id));
  const check = (from: string, field: string, to: string): void => {
    if (!included.has(to)) unresolved.push({ from, field, to });
  };

  const opinions = (from: string, field: string, list: unknown): FieldGuideOpinion[] =>
    ((list ?? []) as LooseOpinion[]).map((o) => {
      check(from, field, o.of);
      return { of: o.of, title: titleOf(o.of), because: o.because };
    });

  const reverse = (id: string, field: "likes" | "dislikes"): FieldGuideReverseOpinion[] => {
    const out: FieldGuideReverseOpinion[] = [];
    for (const edge of registry.in.get(id) ?? []) {
      if (edge.field !== `lore.${field}.of`) continue;
      const source = registry.byId.get(edge.from) as unknown as Loose | undefined;
      const mine = (source?.lore?.[field] as LooseOpinion[] | undefined) ?? [];
      for (const o of mine.filter((o) => o.of === id)) {
        check(id, field === "likes" ? "likedBy" : "dislikedBy", edge.from);
        out.push({ of: edge.from, title: titleOf(edge.from), because: o.because });
      }
    }
    return out.sort((a, b) => a.of.localeCompare(b.of));
  };

  const entries: FieldGuideEntry[] = [];
  for (const { taxonomy, entity } of inScope) {
    const scope = SCOPE[taxonomy]!;
    const isPlace = taxonomy === "biome" || taxonomy === "location";
    const entry: FieldGuideEntry = {
      id: entity.id,
      category: scope.category,
      kind: scope.kind,
      title: entity.title,
    };
    if (entity.short_description !== undefined) entry.short_description = entity.short_description;
    if (entity.danger_level !== undefined) entry.danger_level = entity.danger_level;
    if (entity.scale !== undefined) entry.scale = entity.scale;
    if (entity.classification !== undefined) entry.classification = entity.classification;
    if (entity.asset_id !== undefined) entry.asset_id = entity.asset_id;
    const art = artFor(taxonomy, entity, exists);
    if (art !== undefined) entry.art = art;

    const lore = entity.lore;
    if (!lore) {
      withoutLore.push(entity.id);
    } else if (isPlace) {
      const place: FieldGuidePlaceLore = {
        origin: lore.origin as string,
        common_beliefs: [...((lore.common_beliefs ?? []) as string[])],
        disputed_beliefs: [...((lore.disputed_beliefs ?? []) as string[])],
        regional_relationships: ((lore.regional_relationships ?? []) as LooseRelationship[]).map(
          (r) => {
            check(entity.id, "regional_relationships", r.place);
            return { place: r.place, title: titleOf(r.place), relationship: r.relationship };
          },
        ),
      };
      if (lore.recorded_history !== undefined) place.recorded_history = lore.recorded_history as string;
      if (lore.cultural_significance !== undefined) {
        place.cultural_significance = lore.cultural_significance as string;
      }
      entry.place = place;
    } else {
      const guideLore: FieldGuideLore = {
        story: lore.story as string,
        pastimes: [...((lore.pastimes ?? []) as string[])],
        likes: opinions(entity.id, "likes", lore.likes),
        dislikes: opinions(entity.id, "dislikes", lore.dislikes),
      };
      if (lore.hook !== undefined) guideLore.hook = lore.hook as string;
      if (lore.social !== undefined) guideLore.social = lore.social as string;
      entry.lore = guideLore;
    }

    if (taxonomy === "class") {
      const home = entity.home as string;
      check(entity.id, "home", home);
      const info: FieldGuideClass = {
        role: entity.role as string,
        gear: entity.gear as string,
        home,
        homeTitle: titleOf(home),
        distinctions: (entity.distinctions ?? []).map((d) => ({ rank: d.rank, move: d.move })),
      };
      entry.class = info;
    }

    // Opinions can name any kind of entity (a faction, an individual), so every
    // entry gets its reverse edges, not just creatures and peoples.
    const likedBy = reverse(entity.id, "likes");
    const dislikedBy = reverse(entity.id, "dislikes");
    if (likedBy.length > 0) entry.likedBy = likedBy;
    if (dislikedBy.length > 0) entry.dislikedBy = dislikedBy;

    // Every way past that is not a fight. A resolution with no prose has
    // nothing to tell a player, so it is dropped rather than shown as a bare kind.
    const tips: FieldGuideTip[] = (entity.encounter?.resolutions ?? [])
      .filter((r) => r.text !== undefined)
      .map((r) => ({ kind: r.kind, text: r.text as string }));
    if (tips.length > 0) entry.tips = tips;

    // Trait ids only; names and sentences come from rules at render time.
    const traits = entity.encounter?.traits ?? [];
    if (traits.length > 0) entry.traits = [...traits];

    entries.push(entry);
  }

  entries.sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.id.localeCompare(b.id),
  );
  const keyed: Record<string, FieldGuideEntry> = {};
  for (const entry of entries) keyed[entry.id] = entry;

  return {
    guide: { version: 1, entries: keyed },
    report: {
      withoutLore: withoutLore.sort(),
      unresolved: unresolved.sort(
        (a, b) =>
          a.from.localeCompare(b.from) || a.field.localeCompare(b.field) || a.to.localeCompare(b.to),
      ),
    },
  };
}
