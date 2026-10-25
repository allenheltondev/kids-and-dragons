/**
 * `content/bestiary.json` — canon's creatures, and how a chapter borrows them.
 *
 * ---------------------------------------------------------------------------
 * WHY A CHAPTER NO LONGER WRITES OUT ITS MONSTERS' STATS
 *
 * It used to. `EnemySpec.creature` was added as a *check*: the chapter kept its
 * own copy of hp / guard / quick / steps / attack, and `content:validate`
 * failed the build if the copy disagreed with canon. The argument was that a
 * chapter should read on its own.
 *
 * That argument loses to the one against duplication. Canon is the source of
 * truth (docs/canon-contract.md), and a second copy that a build has to police
 * is not a source — it is a liability with a guard on it. Retuning the
 * `skirmisher` band now means editing `content/rules.json` and nothing else,
 * where before it meant editing every chapter that ever fielded one and
 * discovering which those were from a failing check.
 *
 * So a chapter names the creature and, at most, overrides. `resolveEnemy` is
 * where the borrow happens, and it is deliberately the *only* place: the
 * server loader calls it, so everything downstream — the engine, the state the
 * client is served — sees a complete `EnemySpec` and never has to know a field
 * was inherited.
 *
 * An override is still allowed and still checked. A chapter that wants a
 * weakened wisp says `"hp": 4` and means it; what it cannot do is restate 6 and
 * silently mean something else once the band moves.
 */

import type { CastMember, EnemySpec } from "./types/chapter.js";
import type { SpeciesId } from "./types/domain.js";
import type { CheckCreature } from "./matchups.js";

/** One entry of `content/bestiary.json`, as `tools/canon/bestiary.ts` writes it. */
export interface BestiaryEntry {
  canon_id: string;
  name: string;
  art: string;
  band: string;
  hp: number;
  guard: number;
  quick: number;
  steps: number;
  attack: number;
  xp: number;
  usualCount: number;
  footprint?: number;
  behavior?: string;
  resolutions?: unknown[];
  /** Keys of `rules.matchups.traits` (docs/matchups.md). Absent: none. */
  traits?: string[];
  /** Playable species it likes and dislikes, from canon's lore. Absent: none. */
  likes?: SpeciesId[];
  dislikes?: SpeciesId[];
}

/** The file, keyed by `asset_id` — the same name `EnemySpec.creature` holds. */
export interface Bestiary {
  version?: number;
  creatures: Record<string, BestiaryEntry>;
}

/**
 * An enemy as a chapter *authors* it: everything canon can supply is optional.
 *
 * `EnemySpec` stays fully required, because that is the engine's contract and
 * `setup()` should never wonder whether a monster has HP. The two shapes are
 * the same object at different moments, and `resolveEnemy` is the moment.
 */
export type AuthoredEnemySpec = Omit<
  EnemySpec,
  "count" | "hp" | "guard" | "quick" | "steps" | "attack"
> &
  Partial<Pick<EnemySpec, "count" | "hp" | "guard" | "quick" | "steps" | "attack">>;

const STATS = ["hp", "guard", "quick", "steps", "attack"] as const;

export interface ResolvedEnemy {
  spec?: EnemySpec;
  /** Human-facing, and phrased for whoever has to fix the chapter. */
  problems: string[];
}

/**
 * Fills an authored enemy from the bestiary. Authored values always win.
 *
 * A spec with no `creature` is passed through unchanged if it is already
 * complete, and reported if it is not — a chapter may still hand-roll a
 * one-off, it just has to say every number itself.
 */
export function resolveEnemy(
  authored: AuthoredEnemySpec,
  bestiary: Bestiary | null,
): ResolvedEnemy {
  const problems: string[] = [];
  const entry = authored.creature ? bestiary?.creatures?.[authored.creature] : undefined;

  if (authored.creature && !entry) {
    problems.push(
      `enemy "${authored.id}": creature "${authored.creature}" is not in content/bestiary.json` +
        (bestiary
          ? " — give it an `encounter` block in canon/creatures.yaml, then `npm run canon:bestiary`"
          : " — content/bestiary.json is missing; run `npm run canon:bestiary`"),
    );
    return { problems };
  }

  const filled: Record<string, unknown> = { ...authored };
  for (const stat of STATS) {
    if (authored[stat] === undefined) {
      if (entry) filled[stat] = entry[stat];
      else {
        problems.push(
          `enemy "${authored.id}": no ${stat}, and no \`creature\` to inherit it from`,
        );
      }
    }
  }
  if (filled["count"] === undefined) filled["count"] = entry?.usualCount ?? 1;
  if (filled["name"] === undefined && entry) filled["name"] = entry.name;
  if (filled["art"] === undefined && entry) filled["art"] = entry.art;
  // Matchups (docs/matchups.md): canon's, unless the chapter authored its own.
  // Copied only when the entry has a non-empty list, so an enemy whose
  // creature has none resolves to exactly the spec it always did.
  for (const key of ["traits", "likes", "dislikes"] as const) {
    const fromCanon = entry ? stringList(entry[key]) : [];
    if (filled[key] === undefined && fromCanon.length > 0) filled[key] = fromCanon;
  }

  return problems.length > 0
    ? { problems }
    : { spec: filled as unknown as EnemySpec, problems };
}

/** A list of strings from a field that may be missing or malformed: never throws. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * The creatures a scene shows the party, with their opinions, for a check's
 * matchups (docs/matchups.md): every `discovers` canon id that names a
 * bestiary creature (by its `canon_id`), and every `cast` figure
 * `entities/<key>` whose key is a bestiary creature. Each creature once.
 * Anyone not in the bestiary has no opinion that moves dice. Missing
 * `likes` / `dislikes` read as none.
 */
export function sceneCreatures(
  scene: { discovers?: readonly string[]; cast?: readonly Pick<CastMember, "figure">[] },
  bestiary: Bestiary | null | undefined,
): CheckCreature[] {
  const creatures = bestiary?.creatures;
  if (!creatures) return [];
  const keys: string[] = [];
  const add = (key: string | undefined) => {
    if (key !== undefined && creatures[key] && !keys.includes(key)) keys.push(key);
  };
  for (const canonId of scene.discovers ?? []) {
    add(Object.keys(creatures).find((key) => creatures[key]?.canon_id === canonId));
  }
  for (const member of scene.cast ?? []) {
    const figure = member.figure;
    if (typeof figure === "string" && figure.startsWith("entities/")) add(figure.slice("entities/".length));
  }
  return keys.map((key) => {
    const entry = creatures[key]!;
    return {
      name: entry.name,
      likes: stringList(entry.likes) as SpeciesId[],
      dislikes: stringList(entry.dislikes) as SpeciesId[],
    };
  });
}

/**
 * The art id for an enemy read straight off an unresolved chapter file.
 *
 * The client fetches `content/chapters/<id>.json` as a static asset, so it sees
 * the authored form rather than the loader's. `content/bestiary.json` writes
 * `enemies/<asset_id>`, and this is the same convention applied without the
 * fetch — one string is not worth a second request during a battle.
 */
export function enemyArtId(spec: Pick<EnemySpec, "art" | "creature">): string | undefined {
  return spec.art ?? (spec.creature ? `enemies/${spec.creature}` : undefined);
}
