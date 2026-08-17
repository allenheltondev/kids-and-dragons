/**
 * Encounter balance — how long a fight will take, and who it will hurt.
 *
 * Roadmap chapter 6 asks for "estimated rounds, expected damage", and the
 * arithmetic already exists: it is written down in `content/rules.json`'s
 * `encounterBands.$comment`, which derives every band's stat block from spec
 * §7.1's four-round target. That note is the closest thing this project has to
 * a combat model — and nobody can run it. A number in prose goes stale the
 * first time `ATTACK_DAMAGE` or `baseGuard` moves, and nothing says so.
 *
 * So this is that note as code, reading the constants rather than restating
 * them. It **reports and never gates**, the same way `art:inventory` does:
 * whether a fight is the right size is a judgement about an evening at a table,
 * and the checker's job is to tell an author what they have built, not to
 * refuse it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT MODELS, AND WHAT IT DOES NOT
 *
 * It plays the fight out round by round with fractional hit points, because the
 * things worth knowing are all *sequencing* effects that a closed-form estimate
 * erases:
 *
 *   - Enemies stop swinging as they die, so `enemies × damage × rounds`
 *     overstates a three-skirmisher fight badly — exactly the fight the
 *     reference chapter ships.
 *   - `enemy-ai.ts` walks at the *nearest* standing hero and skips the ones on
 *     the floor, so damage concentrates rather than spreading. Whether anybody
 *     goes down is a question about one hero's hit points, not the party's.
 *   - Going down costs the party two actions (§7.3): the hero on the floor, and
 *     the friend who spends their action helping them up. And a revive gives
 *     back 1 HP, so the second knockdown arrives almost immediately.
 *
 * What it ignores is stated in every estimate's `notes` rather than buried
 * here, because an estimate whose assumptions are invisible is worse than no
 * estimate — it gets quoted. In short: no positioning (round one is usually
 * spent walking, so real fights run about a round longer), no abilities beyond
 * the plain Attack, no items, and one averaged enemy where a fight has several
 * kinds.
 */

import { ATTACK_DAMAGE } from "./encounter.js";
import type { EnemySpec } from "./types/chapter.js";
import type { RulesContent } from "./types/domain.js";

/** spec §7.1 — "3 players vs. 2–4 enemies. Never more." */
export const ASSUMED_PARTY_SIZE = 3;

/**
 * spec §7.1 — "Target: 4 rounds." A band rather than a number, because four is
 * the target and three or five is still a good fight.
 */
export const TARGET_ROUNDS = { min: 3, max: 5 } as const;

/** What `Help Up` restores (§7.3, the `revive` effect in encounter.ts). */
const REVIVE_HP = 1;

/**
 * Far past anything §7.1 tunes for, and finite. A fight that reaches it has its
 * answer either way, and the loop must terminate on content nobody has played.
 */
const ROUND_CAP = 50;

/** The party as the checker assumes it, since a chapter never says who turns up. */
export interface PartyProfile {
  size: number;
  /** Hit points each. */
  hp: number;
  /** Guard each — `baseGuard + quick`, so the whole party is one number here. */
  guard: number;
  /** The modifier on an attack roll: a class stat, in practice 2–4 at level 1. */
  attackMod: number;
}

export interface EncounterEstimate {
  /** Rounds until the last enemy falls, or `ROUND_CAP` if it never does. */
  rounds: number;
  /**
   * The same fight if the party drags a revived hero out of reach for a round.
   *
   * §7.3 has two readings and the model cannot pick between them, because the
   * difference is *movement* and the model does not move anybody. Strict rules
   * re-target the hero who was just helped up — standing, at 1 HP, next to the
   * thing that floored them. A real table walks them clear.
   *
   * Reported rather than chosen, because the gap between the two is the honest
   * width of the answer. On a fight with no knockdowns they are the same number
   * and nothing is said; on one with a spiral they can differ by a lot, and an
   * author quoting only the first would be quoting the pessimistic end of a
   * bracket as though it were a measurement.
   */
  roundsIfRetreating: number;
  /** Total damage the party absorbs across the fight. */
  damageTaken: number;
  /** How the round count sits against spec §7.1's target. */
  verdict: "short" | "on_target" | "long";
  /**
   * How many *distinct* heroes hit zero at least once.
   *
   * The interesting number, and the reason the sim tracks heroes separately
   * instead of pooling their hit points. Zero means nobody was ever in danger;
   * one is the beat §7.3 wants ("someone goes down, someone else picks them
   * up"); three means the fight ran the party over.
   */
  heroesDown: number;
  /**
   * How many times *anybody* goes down, which is a different question.
   *
   * Help Up gives back 1 HP (§7.3), and the AI keeps walking at the nearest
   * standing hero — who, just after a revive, is the hero who was already on
   * the floor. So one hero can absorb every knockdown in the fight, and a
   * `heroesDown` of 1 beside a `knockdowns` of 5 is a spiral rather than a
   * beat: two heroes fighting, one on the floor, one endlessly picking them up.
   */
  knockdowns: number;
  /**
   * Every hero on the floor at once, with nobody left to help anybody up. The
   * fight is unwinnable from there, and for a game whose first promise is
   * "nobody dies" that is worth saying out loud.
   */
  partyWiped: boolean;
  /** Totals, for scale. */
  partyHp: number;
  enemyHp: number;
  enemyCount: number;
  /** Every assumption this estimate rests on, in the author's words. */
  notes: string[];
}

/**
 * A party of three at level 1, read from the rules rather than from memory.
 *
 * Two numbers cannot come out of content, and both are *character* choices
 * rather than properties of a chapter:
 *
 *   - `attackMod` is a class stat. Three is the middle of the 2–4 range that
 *     `encounterBands.$comment` derives its stat blocks against — one base
 *     point plus two of the three a level-1 character spreads at creation.
 *   - Guard is `baseGuard + quick`, and a character who put those points into
 *     the stat they swing with left Quick where it started. So `baseStats.quick`
 *     it is, which is the low end and therefore the cautious one: it overstates
 *     what the party takes rather than understating it.
 *
 * Both are stated in the notes of every estimate, because they are the two
 * places an author could reasonably disagree.
 */
export function defaultParty(rules: RulesContent, attackMod = 3): PartyProfile {
  return {
    size: ASSUMED_PARTY_SIZE,
    hp: rules.baseMaxHp,
    guard: rules.baseGuard + rules.baseStats.quick,
    attackMod,
  };
}

/**
 * P(d20 + mod ≥ target).
 *
 * No criticals and no automatic miss: `resolveAttack` is a plain `total >= tn`
 * comparison (dice.ts), so a natural 20 is only special when it clears the
 * number anyway, and a natural 1 lands if the modifier is large enough.
 */
export function hitChance(mod: number, target: number): number {
  const needed = target - mod;
  // Faces `needed`..20 succeed, out of 20. A `needed` of 1 or less always hits;
  // 21 or more never does.
  return Math.max(0, Math.min(1, (21 - needed) / 20));
}

/** What one playthrough of the model produced. */
interface Run {
  rounds: number;
  damageTaken: number;
  heroesDown: number;
  knockdowns: number;
  partyWiped: boolean;
}

/** One authored spec expanded into individuals, and averaged where it must be. */
interface EnemyPool {
  hp: number[];
  meanGuard: number;
  meanAttack: number;
}

function expand(enemies: readonly EnemySpec[]): EnemyPool {
  const hp: number[] = [];
  let guardSum = 0;
  let attackSum = 0;
  for (const spec of enemies) {
    // A count of zero would be an authoring mistake rather than an empty fight;
    // `content:validate` has no opinion on it, so treat it as one creature.
    const count = Math.max(1, Math.floor(spec.count));
    for (let i = 0; i < count; i += 1) {
      hp.push(spec.hp);
      guardSum += spec.guard;
      attackSum += spec.attack;
    }
  }
  const size = hp.length;
  return {
    hp,
    meanGuard: size === 0 ? 0 : guardSum / size,
    meanAttack: size === 0 ? 0 : attackSum / size,
  };
}

/** Damage into a front-focused pool of hit points, in place. */
function focusDamage(pool: number[], amount: number): number[] {
  let left = amount;
  let remaining = pool;
  while (left > 0 && remaining.length > 0) {
    const front = remaining[0] ?? 0;
    if (front > left) {
      remaining = [front - left, ...remaining.slice(1)];
      left = 0;
    } else {
      left -= front;
      remaining = remaining.slice(1);
    }
  }
  return remaining;
}

/**
 * Plays the fight out and reports what it cost.
 *
 * `attackDamage` is a parameter rather than a read of `ATTACK_DAMAGE` so that
 * the model can be exercised against a different number without a deploy — the
 * constant's own doc comment calls itself "a default, not a constant", since an
 * ability catalog that redefines `attack` overrides it.
 */
export function estimateEncounter(
  enemies: readonly EnemySpec[],
  party: PartyProfile,
  attackDamage: number = ATTACK_DAMAGE,
): EncounterEstimate {
  const { hp: startingHp, meanGuard, meanAttack } = expand(enemies);
  const enemyCount = startingHp.length;
  const enemyHp = startingHp.reduce((sum, each) => sum + each, 0);
  const partyHp = party.hp * party.size;

  const notes: string[] = [
    `A party of ${String(party.size)} at ${String(party.hp)} HP and Guard ${String(party.guard)}, ` +
      `swinging at +${String(party.attackMod)} for ${String(attackDamage)} a hit.`,
  ];

  if (enemyCount === 0) {
    return {
      rounds: 0,
      roundsIfRetreating: 0,
      damageTaken: 0,
      verdict: "short",
      heroesDown: 0,
      knockdowns: 0,
      partyWiped: false,
      partyHp,
      enemyHp: 0,
      enemyCount: 0,
      notes: ["No enemies — nothing to estimate."],
    };
  }

  if (enemies.length > 1) {
    notes.push(
      `Mixed enemies, averaged into one: Guard ${meanGuard.toFixed(1)}, attack +${meanAttack.toFixed(1)}.`,
    );
  }

  const damagePerAttacker =
    hitChance(party.attackMod, meanGuard) * attackDamage;
  const damagePerEnemy = hitChance(meanAttack, party.guard) * attackDamage;

  if (damagePerAttacker <= 0) {
    notes.push(
      `The party cannot hit this at all: Guard ${meanGuard.toFixed(1)} is out of reach of ` +
        `d20+${String(party.attackMod)}.`,
    );
    return {
      rounds: ROUND_CAP,
      roundsIfRetreating: ROUND_CAP,
      damageTaken: partyHp,
      verdict: "long",
      heroesDown: party.size,
      knockdowns: party.size,
      partyWiped: true,
      partyHp,
      enemyHp,
      enemyCount,
      notes,
    };
  }

  /**
   * One playthrough. `retreat` is the only difference between the two readings
   * of §7.3 the model cannot choose between — see `Run` above.
   */
  function simulate(retreat: boolean): Run {
    let enemyPool = startingHp;
    // Heroes are tracked one at a time because the AI focuses one at a time.
    let heroes = Array.from({ length: party.size }, () => party.hp);
    const everDown = new Set<number>();
    let knockdowns = 0;
    let rounds = 0;
    let damageTaken = 0;
    let partyWiped = false;

    while (enemyPool.length > 0 && rounds < ROUND_CAP) {
      let standing = heroes.filter((each) => each > 0).length;
      if (standing === 0) {
        // Nobody left to pick anybody up, and nobody left to swing. The fight is
        // over without a round in it.
        partyWiped = true;
        break;
      }

      rounds += 1;
      const enemiesAtStart = enemyPool.length;

      /*
       * §7.3 — one friend spends their action on Help Up, and the hero comes back
       * at 1 HP. One per round, because everybody has exactly one action; a party
       * with two heroes on the floor takes two rounds to get them both back, and
       * that is the shape of the spiral rather than a shortcut around it.
       */
      const floored = heroes.findIndex((each) => each <= 0);
      let sheltered = -1;
      if (floored !== -1) {
        heroes = heroes.map((each, index) =>
          index === floored ? REVIVE_HP : each,
        );
        standing -= 1;
        // Under the retreating reading, the friend who spent their action getting
        // them up also gets them out of reach for the round.
        if (retreat) sheltered = floored;
      }

      enemyPool = focusDamage(enemyPool, standing * damagePerAttacker);

      /*
       * Turn order is rerolled every round (§7.2), so each enemy has its own
       * chance of swinging before the party's damage lands. Averaging the count
       * across the round is that expectation, and it is the difference between
       * "dead things still hit you" and "dying is instant" — both wrong, in
       * opposite directions.
       */
      const swinging = (enemiesAtStart + enemyPool.length) / 2;
      const swung = swinging * damagePerEnemy;
      let incoming = swung;

      while (incoming > 0) {
        const front = heroes.findIndex(
          (each, index) => each > 0 && index !== sheltered,
        );
        if (front === -1) break;
        const hp = heroes[front] ?? 0;
        if (hp > incoming) {
          heroes = heroes.map((each, index) =>
            index === front ? hp - incoming : each,
          );
          incoming = 0;
        } else {
          // Down, and the AI moves on to the next standing hero (`enemy-ai.ts`
          // filters them out rather than finishing them off — §7.3).
          incoming -= hp;
          heroes = heroes.map((each, index) => (index === front ? 0 : each));
          everDown.add(front);
          knockdowns += 1;
        }
      }

      // Whatever is left over had nobody standing to land on, which only happens
      // on the round the party goes over. Overkill is not damage taken.
      damageTaken += swung - incoming;
    }

    return {
      rounds,
      damageTaken,
      heroesDown: everDown.size,
      knockdowns,
      partyWiped,
    };
  }

  /*
   * Both readings, because the difference between them is the honest width of
   * the answer rather than a detail. Strict rules re-target the hero who was
   * just helped up — they are standing, at 1 HP, next to the thing that floored
   * them, and `enemy-ai.ts` walks at the nearest standing hero. A real table
   * drags them clear. The model cannot move anybody, so it reports both.
   */
  const strict = simulate(false);
  const retreating = simulate(true);
  const { rounds, damageTaken, heroesDown, knockdowns, partyWiped } = strict;

  if (rounds >= ROUND_CAP) {
    notes.push(
      `Stopped at ${String(ROUND_CAP)} rounds — the party never finished it.`,
    );
  }
  if (partyWiped) {
    notes.push(
      "Everybody ends up on the floor with nobody left to help them up.",
    );
  }

  notes.push(
    "Positioning is ignored: round one is usually spent walking, so a real fight runs about a round longer.",
  );
  notes.push("Plain attacks only — no abilities, no items, no terrain.");
  if (retreating.rounds !== rounds) {
    notes.push(
      `Nobody moves in this model. A party that walks a revived hero out of reach ` +
        `finishes in ${String(retreating.rounds)} rounds instead of ${String(rounds)} — ` +
        `treat the pair as the range.`,
    );
  }

  /*
   * A wipe is "long" rather than anything else, and that is not a fudge: the
   * fight the party lost does not end, so however many rounds it took to get
   * there is a floor and not a length. Calling a five-round wipe "on target"
   * would be the checker's worst possible sentence.
   */
  const verdict = partyWiped
    ? "long"
    : rounds < TARGET_ROUNDS.min
      ? "short"
      : rounds > TARGET_ROUNDS.max
        ? "long"
        : "on_target";

  return {
    rounds,
    roundsIfRetreating: retreating.rounds,
    damageTaken: Math.round(damageTaken * 10) / 10,
    verdict,
    heroesDown,
    knockdowns,
    partyWiped,
    partyHp,
    enemyHp,
    enemyCount,
    notes,
  };
}
