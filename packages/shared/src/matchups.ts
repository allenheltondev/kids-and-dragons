/**
 * Matchups — docs/matchups.md. Who is good and bad against what, as small
 * roll and damage changes the table can read out loud.
 *
 * Everything here is pure, and this is the only module that reads
 * `rules.matchups`: the combat engine, the check resolution and the screens
 * call these and never look in the table themselves.
 *
 * Two promises hold for every caller:
 *  - A note is a worse or better roll, never a lock. Nothing here hides an
 *    action or refuses one.
 *  - However many notes land on one roll, the roll moves at most
 *    `MATCHUP_ROLL_CAP` and the damage at most `MATCHUP_DAMAGE_CAP`
 *    (`matchupTotal`), so edges can never run away with a fight.
 */

import type { ClassId, RulesContent, SpeciesId } from "./types/domain.js";
import type {
  CheckTagId,
  MatchupEdge,
  MatchupNote,
  MatchupRules,
  TraitId,
} from "./types/matchups.js";

/** The most all the matchups on one roll can move it, either way. */
export const MATCHUP_ROLL_CAP = 3;
/** The most all the matchups on one hit can move its damage, either way. */
export const MATCHUP_DAMAGE_CAP = 2;

/** A hero, as far as matchups care. */
export interface HeroKind {
  species: SpeciesId;
  class: ClassId;
  /**
   * The ability ids the hero has (a combatant's `actions`). Read only by a
   * `defend` edge that names an `ability`: it holds for a hero who has one
   * of them ("Unbreakable stands firm against fiery things"). Absent: such an
   * edge does not hold.
   */
  abilities?: readonly string[];
}

/** A foe, as far as matchups care. Missing lists are empty. */
export interface FoeKind {
  traits?: readonly TraitId[];
  likes?: readonly SpeciesId[];
  dislikes?: readonly SpeciesId[];
  /** For the opinion notes' sentence ("The Cinder Wolf holds back."). */
  name?: string;
}

/** A creature a check scene shows the party: its name and its opinions. */
export interface CheckCreature {
  name?: string;
  likes?: readonly SpeciesId[];
  dislikes?: readonly SpeciesId[];
}

/** The parts of a check scene a matchup reads. */
export interface CheckSceneKind {
  tags?: readonly CheckTagId[];
  creatures?: readonly CheckCreature[];
}

/**
 * One chip for the TV at the start of a fight (docs/matchups.md
 * "Presentation"): a trait in the fight and who it is good or bad for, or a
 * creature's opinion of someone at the table.
 */
export interface FightHint {
  /** `trait:<id>`, or `opinion:liked:<foe>` / `opinion:disliked:<foe>`. Stable, for keys. */
  id: string;
  kind: "trait" | "opinion";
  /** The trait's icon; absent on opinion chips. */
  icon?: string;
  /** A trait's own `hint` ("Thorny: Burst works well"), or an opinion line. */
  text: string;
  /** Heroes (combatant ids) an edge in this hint helps. */
  good: string[];
  /** Heroes (combatant ids) an edge in this hint hurts. */
  bad: string[];
  /** How much it can move a roll, for ordering: strongest first. */
  weight: number;
}

/** Matchups are on when the rules have them and the campaign is not exempt. */
export function matchupsOn(rules: RulesContent, campaignId: string | null | undefined): boolean {
  const m = rules.matchups;
  if (!m) return false;
  return !(campaignId != null && m.exemptCampaigns.includes(campaignId));
}

function list<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? (value as readonly T[]) : [value as T];
}

/** The edge is true of this hero: every key it gives holds. */
function heroMatches(edge: MatchupEdge, hero: HeroKind): boolean {
  const species = list(edge.hero.species);
  const classes = list(edge.hero.class);
  if (species.length > 0 && !species.includes(hero.species)) return false;
  if (classes.length > 0 && !classes.includes(hero.class)) return false;
  return true;
}

function anyOf<T>(wanted: readonly T[], have: readonly T[] | undefined): boolean {
  return wanted.some((w) => (have ?? []).includes(w));
}

function edgeNote(edge: MatchupEdge, roll: number, damage: number): MatchupNote {
  return { id: edge.id, text: edge.text, roll, damage };
}

function tableOf(rules: RulesContent | MatchupRules | undefined): MatchupRules | undefined {
  if (!rules) return undefined;
  return "edges" in rules && "opinion" in rules ? (rules as MatchupRules) : (rules as RulesContent).matchups;
}

/**
 * Every note moving the hero's swing at this foe with this ability: edges
 * only. `roll` and `damage` are as applied to the hero's own roll and damage,
 * so positive helps. Opinions move the foe's swings and checks, not this.
 */
export function attackNotes(
  rules: RulesContent | MatchupRules,
  hero: HeroKind,
  foe: FoeKind,
  abilityId: string,
): MatchupNote[] {
  const table = tableOf(rules);
  if (!table) return [];
  const notes: MatchupNote[] = [];
  for (const edge of table.edges) {
    if (edge.on !== "attack" || !heroMatches(edge, hero)) continue;
    const foes = list(edge.foe);
    if (foes.length > 0 && !anyOf(foes, foe.traits)) continue;
    const abilities = list(edge.ability);
    if (abilities.length > 0 && !abilities.includes(abilityId)) continue;
    const roll = edge.roll ?? 0;
    const damage = edge.damage ?? 0;
    if (roll === 0 && damage === 0) continue;
    notes.push(edgeNote(edge, roll, damage));
  }
  return notes;
}

/**
 * Every note moving this foe's swing at the hero: edges, then opinions.
 * A defend edge naming an `ability` holds for a hero who has that ability
 * (`HeroKind.abilities`).
 *
 * Sign: as in every `MatchupNote`, positive helps the hero. The foe's roll
 * changes by `-note.roll`. An edge's `roll` is authored as the change to the
 * foe's roll ("a negative number protects"), so it is flipped here, and an
 * opinion's `likedFoeRoll` likewise.
 */
export function defendNotes(rules: RulesContent | MatchupRules, hero: HeroKind, foe: FoeKind): MatchupNote[] {
  const table = tableOf(rules);
  if (!table) return [];
  const notes: MatchupNote[] = [];
  for (const edge of table.edges) {
    if (edge.on !== "defend" || !heroMatches(edge, hero)) continue;
    const foes = list(edge.foe);
    if (foes.length > 0 && !anyOf(foes, foe.traits)) continue;
    const abilities = list(edge.ability);
    if (abilities.length > 0 && !anyOf(abilities, hero.abilities)) continue;
    const roll = -(edge.roll ?? 0);
    if (roll === 0) continue;
    notes.push(edgeNote(edge, roll, 0));
  }
  const who = foe.name ? `The ${foe.name}` : "It";
  if (foe.likes?.includes(hero.species) && table.opinion.likedFoeRoll !== 0) {
    notes.push({ id: "opinion:liked", text: `${who} likes you and holds back.`, roll: -table.opinion.likedFoeRoll, damage: 0 });
  }
  if (foe.dislikes?.includes(hero.species) && table.opinion.dislikedFoeRoll !== 0) {
    notes.push({ id: "opinion:disliked", text: `${who} does not like you and singles you out.`, roll: -table.opinion.dislikedFoeRoll, damage: 0 });
  }
  return notes;
}

/**
 * Every note moving the hero's check roll: edges on the scene's tags, then
 * the opinions of the creatures the scene shows. One liked note and one
 * disliked note at most, however many creatures share the opinion: a crowd
 * of wolves that trusts unicorns is one reason, not five.
 */
export function checkNotes(
  rules: RulesContent | MatchupRules,
  hero: HeroKind,
  scene: CheckSceneKind,
): MatchupNote[] {
  const table = tableOf(rules);
  if (!table) return [];
  const notes: MatchupNote[] = [];
  const tags = scene.tags ?? [];
  if (tags.length > 0) {
    for (const edge of table.edges) {
      if (edge.on !== "check" || !heroMatches(edge, hero)) continue;
      if (!anyOf(list(edge.tag), tags)) continue;
      const roll = edge.roll ?? 0;
      if (roll === 0) continue;
      notes.push(edgeNote(edge, roll, 0));
    }
  }
  const creatures = scene.creatures ?? [];
  const liker = creatures.find((c) => c.likes?.includes(hero.species));
  if (liker && table.opinion.likedCheckRoll !== 0) {
    const who = liker.name ? `The ${liker.name}` : "They";
    notes.push({ id: "opinion:liked", text: `${who} likes you.`, roll: table.opinion.likedCheckRoll, damage: 0 });
  }
  const disliker = creatures.find((c) => c.dislikes?.includes(hero.species));
  if (disliker && table.opinion.dislikedCheckRoll !== 0) {
    const who = disliker.name ? `The ${disliker.name}` : "They";
    notes.push({ id: "opinion:disliked", text: `${who} does not trust you.`, roll: table.opinion.dislikedCheckRoll, damage: 0 });
  }
  return notes;
}

function clamp(n: number, cap: number): number {
  return Math.max(-cap, Math.min(cap, n));
}

/** What a set of notes adds up to, held to the caps. Positive helps the hero. */
export function matchupTotal(notes: readonly MatchupNote[]): { roll: number; damage: number } {
  let roll = 0;
  let damage = 0;
  for (const note of notes) {
    roll += note.roll;
    damage += note.damage;
  }
  return { roll: clamp(roll, MATCHUP_ROLL_CAP), damage: clamp(damage, MATCHUP_DAMAGE_CAP) };
}

/**
 * The edges that belong to this species and class, for the field guide and
 * the creation sheet: species edges, class edges and pairings. Edges with an
 * empty `hero` (true of anyone) are left out: they say nothing about who to
 * pick.
 */
export function edgesForHero(rules: RulesContent | MatchupRules, hero: HeroKind): MatchupEdge[] {
  const table = tableOf(rules);
  if (!table) return [];
  return table.edges.filter(
    (edge) =>
      (list(edge.hero.species).length > 0 || list(edge.hero.class).length > 0) && heroMatches(edge, hero),
  );
}

/** The fight edges (`attack` and `defend`) that name any of these traits. */
export function edgesAgainst(rules: RulesContent | MatchupRules, traits: readonly TraitId[]): MatchupEdge[] {
  const table = tableOf(rules);
  if (!table) return [];
  return table.edges.filter((edge) => edge.on !== "check" && anyOf(list(edge.foe), traits));
}

/** How hard an edge pushes, from the hero's side: positive helps. */
function edgeLean(edge: MatchupEdge): number {
  const roll = edge.on === "defend" ? -(edge.roll ?? 0) : (edge.roll ?? 0);
  return roll + (edge.damage ?? 0);
}

/** The few hints that matter in the state's fight, strongest first, at most `limit`. */
export function fightHints(
  rules: RulesContent | MatchupRules,
  state: {
    readonly combatants: readonly {
      readonly id: string;
      readonly side: string;
      readonly name: string;
      readonly down: boolean;
      readonly escaped?: true;
      readonly species?: SpeciesId;
      readonly class?: ClassId;
      readonly actions?: readonly string[];
      readonly traits?: readonly TraitId[];
      readonly likes?: readonly SpeciesId[];
      readonly dislikes?: readonly SpeciesId[];
    }[];
  },
  limit = 3,
): FightHint[] {
  const table = tableOf(rules);
  if (!table) return [];
  const heroes = state.combatants.filter(
    (c) => c.side === "party" && !c.escaped && c.species !== undefined && c.class !== undefined,
  );
  const foes = state.combatants.filter((c) => c.side === "enemy" && !c.down);
  const hints: FightHint[] = [];

  const traits: TraitId[] = [];
  for (const foe of foes) for (const t of foe.traits ?? []) if (!traits.includes(t)) traits.push(t);
  for (const trait of traits) {
    const def = table.traits[trait];
    if (!def) continue;
    const good = new Set<string>();
    const bad = new Set<string>();
    let weight = 0;
    for (const edge of edgesAgainst(table, [trait])) {
      for (const hero of heroes) {
        if (!heroMatches(edge, { species: hero.species!, class: hero.class! })) continue;
        // An edge on an ability is a hint only for a hero who has it.
        const abilities = list(edge.ability);
        if (abilities.length > 0 && hero.actions && !anyOf(abilities, hero.actions)) continue;
        const lean = edgeLean(edge);
        if (lean > 0) good.add(hero.id);
        if (lean < 0) bad.add(hero.id);
        weight = Math.max(weight, Math.abs(lean));
      }
    }
    hints.push({
      id: `trait:${trait}`,
      kind: "trait",
      icon: def.icon,
      text: def.hint,
      good: [...good],
      bad: [...bad],
      weight,
    });
  }

  const seen = new Set<string>();
  for (const foe of foes) {
    for (const [opinion, species, amount] of [
      ["liked", foe.likes, table.opinion.likedFoeRoll],
      ["disliked", foe.dislikes, table.opinion.dislikedFoeRoll],
    ] as const) {
      const at = heroes.filter((h) => species?.includes(h.species!));
      if (at.length === 0 || amount === 0) continue;
      const key = `opinion:${opinion}:${foe.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const names = at.map((h) => h.name).join(" and ");
      hints.push({
        id: key,
        kind: "opinion",
        text: opinion === "liked" ? `The ${foe.name} likes ${names}.` : `The ${foe.name} dislikes ${names}.`,
        good: opinion === "liked" ? at.map((h) => h.id) : [],
        bad: opinion === "disliked" ? at.map((h) => h.id) : [],
        weight: Math.abs(amount),
      });
    }
  }

  // Stable sort: equal weights keep the order they were found in.
  return hints
    .map((hint, i) => ({ hint, i }))
    .sort((a, b) => b.hint.weight - a.hint.weight || a.i - b.i)
    .slice(0, limit)
    .map(({ hint }) => hint);
}
