/**
 * Deeds — what earns a distinction (#310, docs/class-mastery.md §6).
 *
 * A hero earns Apprentice, Expert and Master in a class by doing that class's
 * deeds, and only while wearing it. Which deeds a rank asks for, and how many,
 * is content (`ClassDef.deeds` in rules.json); how each one is *counted* is
 * here, read off what the game already produces:
 *
 *   - a hero's fight action: who acted, with which ability, the fight as it
 *     stood before, and the events it produced (`actionCredits`);
 *   - every other stretch of a fight — the monsters' turns, the place
 *     fighting back — by its events alone (`eventCredits`);
 *   - where a hero stands as their turn ends (`turnEndCredits`);
 *   - a class-only choice or a class way at a rift (`storyCredits`).
 *
 * Never a judgment call, and never anything that rewards bad play: healing a
 * hero at full health restores nothing and counts nothing, and no deed counts
 * being hurt or knocked down.
 *
 * Counting is a pure read. It never rolls, moves or changes a fight, so a
 * fight plays out exactly as it would with nobody counting (Gemfall's pinned
 * digests hold that true).
 *
 * A credit names a hero and a deed. It only counts if the deed is one the
 * hero's worn class asks for at its next rank (`addDeed`), which is what
 * "only the worn class counts" comes to: a Thornguard landing a fight's first
 * hit earns nothing, a Duskrunner doing it earns a step toward Apprentice.
 */

import type { CombatAbility, EncounterEvent, EncounterState } from "./encounter.js";
import { combatantById, positionOf } from "./encounter.js";
import { CLASS_RANKS } from "./types/domain.js";
import type { ClassDef, ClassId, ClassRank, DeedId, RankDeeds, ResolvedCharacter } from "./types/domain.js";
import type { FightDeeds, HeroDeeds, RankUp, RunDeeds } from "./types/state.js";

/** The Songkeeper's songs: the only healing its deed counts. */
export const SONGS: readonly string[] = ["rally", "soothe", "chorus"];

/** Lifting a knocked-down friend with Rally counts as this many hearts. */
export const LIFT_HEARTS = 3;

/** One deed, done by one hero, `count` times (hearts for `song_hearts`). */
export interface DeedCredit {
  heroId: string;
  deed: DeedId;
  count: number;
}

/** What a deed is, in words a kid at the table can follow. */
export const DEED_LABELS: Record<DeedId, string> = {
  brace_friend: "Brace takes a hit for a friend",
  hold_ground: "End your turn on your feet next to a monster",
  shove_off_friend: "Shove a monster off a hurt friend",
  shove: "Shove a monster",
  bramble_wall_fight: "Grow a Bramble Wall in a fight",
  new_target: "Hit a monster you have not hit yet this fight",
  vanish_miss: "A monster misses you because you Vanished",
  twin_step_finish: "Finish a monster with Twin Step",
  burst_two: "Catch 2 monsters in one Burst",
  burst_three: "Catch 3 monsters in one Burst",
  glimmer_made: "A friend you Glimmered hits",
  tangle_guard: "Tanglelight a monster about to reach a friend",
  tanglelight: "Tanglelight a monster",
  song_hearts: "Hearts your songs give back",
  class_story: "Do something only your class can",
};

// ---------------------------------------------------------------------------
// Ranks
// ---------------------------------------------------------------------------

/** The rank after `rank`, or null at Master. */
export function nextRank(rank: ClassRank): Exclude<ClassRank, "none"> | null {
  const next = CLASS_RANKS[CLASS_RANKS.indexOf(rank) + 1];
  return next && next !== "none" ? next : null;
}

/** What the class asks for its next rank above `rank`; null at Master or with none authored. */
export function nextRankDeeds(classDef: ClassDef | undefined, rank: ClassRank): RankDeeds | null {
  const next = nextRank(rank);
  if (!classDef || !next) return null;
  return classDef.deeds?.[next] ?? null;
}

/** Every deed a rank asks for, at the most any of its tracks asks. Progress is capped there. */
export function deedTargets(req: RankDeeds): Map<DeedId, number> {
  const targets = new Map<DeedId, number>();
  for (const track of [req.withFriends, req.alone ?? {}]) {
    for (const [deed, n] of Object.entries(track) as [DeedId, number][]) {
      targets.set(deed, Math.max(targets.get(deed) ?? 0, n));
    }
  }
  return targets;
}

/** Has `deeds` earned the rank `req` describes? Either track will do. */
export function rankEarned(req: RankDeeds, deeds: Readonly<Record<string, number>>): boolean {
  const done = (track: RankDeeds["withFriends"]) => {
    const entries = Object.entries(track) as [DeedId, number][];
    return entries.length > 0 && entries.every(([deed, n]) => (deeds[deed] ?? 0) >= n);
  };
  return done(req.withFriends) || (req.alone !== undefined && done(req.alone));
}

/** A hero's worn class as their resolved snapshot has it. */
export function heroDeedsOf(character: ResolvedCharacter): HeroDeeds {
  return { class: character.class, rank: character.rank ?? "none", deeds: { ...(character.deeds ?? {}) } };
}

/** What the run has counted for a hero in one class, if anything. */
export function runCounted(run: RunDeeds | undefined, heroId: string, classId: ClassId): HeroDeeds | undefined {
  const entry = run?.heroes[heroId]?.[classId];
  return entry ? { class: classId, rank: entry.rank, deeds: { ...entry.deeds } } : undefined;
}

/** Records a hero's class as counted on the run, every other class she has left as it was. */
export function setRunCounted(run: RunDeeds, heroId: string, hero: HeroDeeds): void {
  (run.heroes[heroId] ??= {})[hero.class] = { rank: hero.rank, deeds: { ...hero.deeds } };
}

/**
 * Counts `count` of `deed` toward the hero's next rank, if that rank asks for
 * it, capped at the most it asks. Anything else — a deed of another class, a
 * deed this rank does not want, anything at Master — leaves the hero as they
 * were, and says so by returning the same object.
 */
export function addDeed(hero: HeroDeeds, classDef: ClassDef | undefined, deed: DeedId, count: number): HeroDeeds {
  if (count <= 0) return hero;
  const req = nextRankDeeds(classDef, hero.rank);
  const target = req ? deedTargets(req).get(deed) : undefined;
  if (target === undefined) return hero;
  const had = hero.deeds[deed] ?? 0;
  const now = Math.min(target, had + count);
  if (now === had) return hero;
  return { ...hero, deeds: { ...hero.deeds, [deed]: now } };
}

/**
 * Lands the next rank if its deeds are done: the rank goes up one and the
 * count starts again for the rank after. One rank at a time, never two, so
 * every move is taught by being used. Null when nothing lands.
 */
export function rankUp(hero: HeroDeeds, classDef: ClassDef | undefined): HeroDeeds | null {
  const req = nextRankDeeds(classDef, hero.rank);
  const next = nextRank(hero.rank);
  if (!req || !next || !rankEarned(req, hero.deeds)) return null;
  return { class: hero.class, rank: next, deeds: {} };
}

/**
 * The line the table hears when a rank lands (#314 builds the moment around
 * it): who, what they are now, and the move it gives. A Duskrunner also gets
 * a crow, because the crows always want it known (docs/class-mastery.md §2).
 */
export function rankUpLine(name: string, classDef: ClassDef, rank: Exclude<ClassRank, "none">, characterId: string): RankUp {
  const title = `${classDef.name} ${rank[0]!.toUpperCase()}${rank.slice(1)}`;
  const ladder = Object.entries(classDef.unlocks)
    .map(([at, move]) => ({ at: Number(at), move }))
    .filter((u) => Number.isFinite(u.at))
    .sort((a, b) => a.at - b.at);
  const move = ladder[CLASS_RANKS.indexOf(rank) - 1]?.move;
  return {
    characterId,
    class: classDef.id,
    rank,
    line: move ? `${name} is a ${title} now! New move: ${move.name}.` : `${name} is a ${title} now!`,
    ...(classDef.id === "duskrunner" ? { crow: crowLine(characterId, rank) } : {}),
  };
}

const CROWS = [
  "A crow lands on a fence nearby. \"Saw that. Nice. Don't mess with us.\" It flies off.",
  "A crow drops onto a branch, looks right at you, and says, \"Don't mess with us.\" Then it is gone.",
  "A crow hops past, very busy. \"Good work. Remember who taught you. Don't mess with us.\"",
];

function crowLine(characterId: string, rank: ClassRank): string {
  let seed = CLASS_RANKS.indexOf(rank);
  for (const ch of characterId) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return CROWS[seed % CROWS.length]!;
}

// ---------------------------------------------------------------------------
// Counting in a fight
// ---------------------------------------------------------------------------

export function freshFightDeeds(): FightDeeds {
  return { walled: [], glimmers: {} };
}

/** A hero's fight action, as the deeds that read it need to see it. */
export interface DeedAction {
  actorId: string;
  abilityId: string;
  /** The catalog entry, for the shape of a Burst. */
  ability: CombatAbility | null;
  targetIds: readonly string[];
  targetTiles: readonly { x: number; y: number }[];
  /** The fight as it stood before the action. */
  before: EncounterState;
}

function isHero(state: EncounterState, id: string): boolean {
  return combatantById(state, id)?.side === "party";
}

function isEnemy(state: EncounterState, id: string): boolean {
  return combatantById(state, id)?.side === "enemy";
}

const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * Credits from events with nobody's action behind them: the monsters' turns
 * and the place fighting back. A hero's action runs its events through here
 * as well (`actionCredits`), so nothing is missed between the two.
 *
 * - `evaded` on a hero: a monster missed them because they Vanished (Vanish
 *   is the only thing that sets `evade`).
 * - `protected` outside a hero's action: a Brace taking a hit meant for a
 *   friend. The same event inside the Thornguard's own Brace action is only
 *   the promise being made, and counts nothing.
 */
export function eventCredits(
  memo: FightDeeds,
  state: EncounterState,
  events: readonly EncounterEvent[],
  credits: DeedCredit[] = [],
  inAction = false,
): { memo: FightDeeds; credits: DeedCredit[] } {
  for (const event of events) {
    switch (event.type) {
      case "evaded":
        if (isHero(state, event.actorId)) credits.push({ heroId: event.actorId, deed: "vanish_miss", count: 1 });
        break;
      case "protected":
        if (!inAction && event.byId !== event.actorId && isHero(state, event.byId) && isHero(state, event.actorId)) {
          credits.push({ heroId: event.byId, deed: "brace_friend", count: 1 });
        }
        break;
      default:
        break;
    }
  }
  return { memo, credits };
}

/**
 * Credits from one hero's fight action. `events` is exactly what the action
 * produced; whatever happened after it (the turn ending, the monsters'
 * answer) goes through `eventCredits`.
 */
export function actionCredits(
  memo: FightDeeds,
  action: DeedAction,
  after: EncounterState,
  events: readonly EncounterEvent[],
): { memo: FightDeeds; credits: DeedCredit[] } {
  const { actorId, abilityId, before } = action;
  const credits: DeedCredit[] = [];
  const credit = (deed: DeedId, count = 1, heroId = actorId) => {
    if (count > 0) credits.push({ heroId, deed, count });
  };

  // Everywhere at once: a hit on a monster this hero has not hit yet in this
  // fight. Each monster counts once per hero, so nobody else's hits (a
  // Starweaver's Burst across the board) can take the chance away.
  const struckBefore = memo.struck?.[actorId] ?? [];
  const newlyStruck = [
    ...new Set(events.flatMap((e) => (e.type === "damage" && isEnemy(before, e.actorId) ? [e.actorId] : []))),
  ].filter((id) => !struckBefore.includes(id));
  credit("new_target", newlyStruck.length);
  const struck = newlyStruck.length > 0 ? { ...memo.struck, [actorId]: [...struckBefore, ...newlyStruck] } : memo.struck;
  const actor = combatantById(before, actorId);

  // A Glimmered hero's next roll settles the Glimmer, made or missed.
  let glimmers = memo.glimmers;
  const glimmeredBy = glimmers[actorId];
  const rolls = events.filter((e) => e.type === "roll" && e.roll.characterId === actorId);
  if (glimmeredBy !== undefined && rolls.length > 0) {
    if (rolls.some((e) => e.type === "roll" && e.roll.result === "hit")) credit("glimmer_made", 1, glimmeredBy);
    const { [actorId]: _settled, ...rest } = glimmers;
    glimmers = rest;
  }

  let walled = memo.walled;
  const friends = before.combatants.filter((c) => c.side === "party" && c.id !== actorId && !c.escaped);

  switch (abilityId) {
    case "shove": {
      credit("shove");
      const target = action.targetIds[0];
      const at = target ? positionOf(before, target) : null;
      const offAFriend =
        at !== null &&
        friends.some((f) => {
          const there = positionOf(before, f.id);
          return there !== null && (f.down || f.hp < f.maxHp) && Math.max(Math.abs(there.x - at.x), Math.abs(there.y - at.y)) <= 1;
        });
      if (offAFriend) credit("shove_off_friend");
      break;
    }
    case "bramble_wall":
      if (!walled.includes(actorId) && events.some((e) => e.type === "walled")) {
        walled = [...walled, actorId];
        credit("bramble_wall_fight");
      }
      break;
    case "twin_step":
      if (events.some((e) => e.type === "down" && isEnemy(before, e.actorId))) credit("twin_step_finish");
      break;
    case "burst": {
      // Caught: standing in the square when it went off, hit or not.
      const point = action.targetTiles[0];
      const size = Math.max(1, Math.floor(action.ability?.target.area ?? 1));
      const caught = point
        ? before.combatants.filter((c) => {
            if (c.side !== "enemy" || c.down) return false;
            const at = positionOf(before, c.id);
            return at !== null && at.x >= point.x && at.x < point.x + size && at.y >= point.y && at.y < point.y + size;
          }).length
        : 0;
      if (caught >= 2) credit("burst_two");
      if (caught >= 3) credit("burst_three");
      break;
    }
    case "glimmer": {
      const target = action.targetIds[0];
      if (target && events.some((e) => e.type === "bonus" && e.actorId === target)) glimmers = { ...glimmers, [target]: actorId };
      break;
    }
    case "tanglelight": {
      if (!events.some((e) => e.type === "rooted")) break;
      credit("tanglelight");
      const target = action.targetIds[0];
      const enemy = target ? combatantById(before, target) : null;
      const at = target ? positionOf(before, target) : null;
      // About to reach a friend: close enough to walk up to one next turn.
      const threatens =
        enemy !== null &&
        at !== null &&
        friends.some((f) => {
          const there = positionOf(before, f.id);
          return !f.down && there !== null && manhattan(at, there) <= enemy.steps + 1;
        });
      if (threatens) credit("tangle_guard");
      break;
    }
    default:
      break;
  }

  // A song's hearts: what it actually gave back, never what it could have.
  if (SONGS.includes(abilityId) && actor) {
    const hearts = events.reduce(
      (n, e) => n + (e.type === "heal" ? e.amount : e.type === "revived" ? LIFT_HEARTS : 0),
      0,
    );
    credit("song_hearts", hearts);
  }

  const kept = eventCredits({ ...memo, walled, glimmers, ...(struck ? { struck } : {}) }, after, events, credits, true);
  return kept;
}

/**
 * Credits for where a hero stands as their own turn ends: on their feet, in
 * the fight, beside a monster still standing — holding the line, which is a
 * Thornguard's whole job, and the one a Thornguard alone can do from the
 * first fight (Brace needs a friend). Being hurt is not part of it, and being
 * knocked down ends it.
 */
export function turnEndCredits(state: EncounterState, heroId: string): DeedCredit[] {
  const hero = combatantById(state, heroId);
  const at = positionOf(state, heroId);
  if (!hero || hero.side !== "party" || hero.down || hero.escaped || !at) return [];
  const beside = state.combatants.some((c) => {
    if (c.side !== "enemy" || c.down) return false;
    const there = positionOf(state, c.id);
    return there !== null && Math.max(Math.abs(there.x - at.x), Math.abs(there.y - at.y)) <= 1;
  });
  return beside ? [{ heroId, deed: "hold_ground", count: 1 }] : [];
}

/**
 * Credits for a class-only choice the party took, or a class way at a rift:
 * every seated hero wearing one of the classes it asks for.
 */
export function storyCredits(
  heroes: readonly Pick<ResolvedCharacter, "id" | "class">[],
  classes: ClassId | readonly ClassId[] | undefined,
): DeedCredit[] {
  if (classes === undefined) return [];
  const wanted = Array.isArray(classes) ? classes : [classes];
  return heroes.filter((h) => wanted.includes(h.class)).map((h) => ({ heroId: h.id, deed: "class_story" as const, count: 1 }));
}
