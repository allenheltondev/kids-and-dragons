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

import type { EnemySpec } from "./types/chapter.js";

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

  return problems.length > 0
    ? { problems }
    : { spec: filled as unknown as EnemySpec, problems };
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
