/**
 * Graph campaigns — temporary buffs (#200).
 *
 * Rift energy can leave a party stronger for a while: a shield that holds for
 * two fights, a surge that makes the next three turns hit harder, a fury that
 * costs the party its footing. docs/campaigns/graph-campaigns.md, "Temporary
 * buffs", is the contract; `types/buffs.ts` is the shape; this file is the
 * arithmetic — every rule about what a buff adds, how long it lasts, what a
 * second grant does and what ends it, in one place, so the journey
 * (`journey.ts`), the engine (`engine.ts`), the fight (`encounter.ts`), the
 * parser and the screens cannot disagree about it.
 *
 * ---------------------------------------------------------------------------
 * THREE PLACES A BUFF LIVES, AND WHY IT IS COPIED BETWEEN THEM
 *
 * 1. **The journey** (`JourneyState.buffs: ActiveBuff[]`) — between chapters.
 *    Only counters (id, stacks, fights left), read through the declaration.
 *    `grantBuff` effects add to it; taking an exit spends `"travel"` ones.
 * 2. **The chapter run** (`RunState.buffs: RunBuff[]`) — the journey's list
 *    with each declaration resolved, seeded at chapter start exactly as the
 *    journey flags are (`seedRunBuffs`). The engine never sees the graph, so
 *    the run carries what the engine needs to know. Fights spend it; a Rest
 *    scene or a setback may end some of it. When the visit completes it is
 *    read back into the journey (`readBackBuffs`) — the flags' carry rule.
 * 3. **The fight** (`EncounterState.buffs: CombatBuff[]`) — one entry per
 *    hero the buff is on, with its contribution already worked out. The
 *    fight reads it (`buffBonus`) wherever a number it changes is used, and
 *    ticks turn-limited ones as the holder's turns end. It writes nothing
 *    back: when the fight is over the run's buffs are spent by one
 *    deterministic rule (`spendRunBuffs`), whatever happened inside.
 *
 * Each copy is the state of one layer and is persisted with that layer — the
 * fight inside the run, the run per seq, the journey on the attempt — so a
 * session that drops mid-fight resumes the fight's own buffs, and a chapter
 * that is started again from the journey starts from the journey's buffs,
 * never from a half-spent run's. Seeding replaces; it never appends.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CHARACTER NEVER KNOWS
 *
 * Nothing here reads or writes a `Character`, a `ResolvedCharacter`, an item
 * or a trinket. A buff is an overlay on a fight's combatants, so a hero's
 * stored stats after a buffed chapter are exactly what they were before it,
 * and `resolveCharacter` — which every campaign shares — is untouched. An
 * ordered campaign has no graph, so no declaration, no journey and no run
 * buffs: every function below is the identity on "none".
 *
 * ---------------------------------------------------------------------------
 * WHY IMPORT-FREE
 *
 * `campaign-graph.ts` checks declarations with this file, and
 * tools/content/validate.mjs loads that one straight under Node. Type imports
 * only, so the chain stays loadable (world-state.ts's rule).
 */

import type {
  ActiveBuff,
  BuffAppliesTo,
  BuffDef,
  BuffDuration,
  BuffExpiry,
  BuffId,
  BuffKind,
  BuffStacking,
  BuffSpend,
  BuffTarget,
  CheckBuffOffer,
  CombatBuff,
  JourneyBuffView,
  RunBuff,
} from "./types/buffs.js";
import type { NodeId } from "./types/campaign-graph.js";

/** Every `BuffKind`, in the order the screens list them. */
export const BUFF_KINDS: readonly BuffKind[] = ["guard", "damage", "move", "roll"];

/** Every `BuffExpiry`. */
export const BUFF_EXPIRIES: readonly BuffExpiry[] = ["defeat", "rest", "travel", "setback", "chapter"];

/**
 * The most a hero's buffs of one kind can add up to — or take away — at
 * once, however many are stacked. Small on purpose: the game's whole
 * resolution is one d20 and one number (§4.1), a level is worth a point, and
 * a buff that out-weighed a level would be the stat creep #200 forbids by
 * another name. Movement and damage are the tighter two because the board
 * is ten squares wide and a plain hit is 3.
 */
export const BUFF_LIMITS: Readonly<Record<BuffKind, number>> = { guard: 3, damage: 2, move: 2, roll: 3 };

/** The most stacks a `stack: "add"` buff may declare. */
export const MAX_BUFF_STACKS = 5;

/** A `stack: "add"` buff's stacks when it does not say. */
export const DEFAULT_BUFF_STACKS = 3;

/** The longest a buff may last: this many turns, or this many fights. */
export const MAX_BUFF_DURATION = 5;

/** One thing wrong with a buff declaration, at a pointer suffix (`""`, `/amount`). */
export interface BuffProblem {
  path: string;
  problem: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

// ---------------------------------------------------------------------------
// The declaration
// ---------------------------------------------------------------------------

/**
 * What is wrong with one buff's declaration. Total over malformed input, like
 * the parser that calls it: a wrong type is a problem, never a throw.
 */
export function buffDeclarationProblems(raw: unknown): BuffProblem[] {
  const problems: BuffProblem[] = [];
  const fail = (path: string, problem: string) => problems.push({ path, problem });
  if (!isRecord(raw)) {
    fail("", "a buff must be an object");
    return problems;
  }
  if (typeof raw.label !== "string" || raw.label.trim().length === 0) fail("/label", "label must be a non-empty string");
  const kind = raw.kind as BuffKind;
  const known = BUFF_KINDS.includes(kind);
  if (!known) fail("/kind", `kind ${JSON.stringify(raw.kind)} is not one of ${BUFF_KINDS.join(", ")}`);
  const limit = known ? BUFF_LIMITS[kind] : Math.max(...Object.values(BUFF_LIMITS));
  if (!isInteger(raw.amount) || raw.amount === 0 || Math.abs(raw.amount) > limit) {
    fail("/amount", `amount must be a whole number from -${limit} to ${limit}, not 0${known ? ` (the ${kind} limit)` : ""}`);
  }
  if (raw.target !== undefined && raw.target !== "party" && raw.target !== "one") {
    fail("/target", `target ${JSON.stringify(raw.target)} is not "party" or "one"`);
  }
  // Story-check buffs (#222): opt-in per buff, so every field below is
  // checked only when it is there, and a buff without them is what it was.
  const appliesTo = raw.appliesTo as BuffAppliesTo | undefined;
  const onChecks = appliesTo === "check";
  if (appliesTo !== undefined) {
    if (appliesTo !== "attack" && appliesTo !== "check") {
      fail("/appliesTo", `appliesTo ${JSON.stringify(raw.appliesTo)} is not "attack" or "check"`);
    } else if (raw.kind !== "roll") {
      fail("/appliesTo", 'appliesTo means something only on a "roll" buff');
    }
  }
  if (onChecks && raw.target === "one") {
    fail("/target", 'a "check" buff is the party\'s: whoever is about to roll may spend it, so it takes no "one" target');
  }
  const spend = raw.spend as BuffSpend | undefined;
  if (spend !== undefined) {
    if (!onChecks) fail("/spend", 'spend means something only with "appliesTo": "check"');
    else if (spend !== "auto" && spend !== "choose") fail("/spend", `spend ${JSON.stringify(raw.spend)} is not "auto" or "choose"`);
    else if (spend === "choose" && isInteger(raw.amount) && raw.amount < 0) {
      fail("/spend", 'a burden is never chosen: a "check" buff with a negative amount is spent "auto"');
    }
  }
  const duration = raw.duration;
  if (!isRecord(duration)) {
    fail("/duration", 'duration must be { "scope": "turns" | "encounter" | "encounters" | "uses", "count"? }');
  } else if (duration.scope === "encounter") {
    if (duration.count !== undefined) fail("/duration/count", 'an "encounter" buff lasts one fight; it takes no count');
  } else if (duration.scope === "turns" || duration.scope === "encounters" || duration.scope === "uses") {
    if (!isInteger(duration.count) || duration.count < 1 || duration.count > MAX_BUFF_DURATION) {
      fail("/duration/count", `count must be a whole number from 1 to ${MAX_BUFF_DURATION}`);
    }
  } else {
    fail("/duration/scope", `scope ${JSON.stringify(duration.scope)} is not "turns", "encounter", "encounters" or "uses"`);
  }
  // A check buff's clock is counted in checks, an attack buff's in fights:
  // each refuses the other's.
  if (isRecord(duration)) {
    if (onChecks && duration.scope !== "uses") {
      fail("/duration/scope", 'a "check" buff lasts a number of checks: its duration is { "scope": "uses", "count": n }');
    } else if (!onChecks && duration.scope === "uses") {
      fail("/duration/scope", '"uses" counts story checks, so it needs "appliesTo": "check"');
    }
  }
  const stack = raw.stack as BuffStacking | undefined;
  if (stack !== undefined && stack !== "refresh" && stack !== "add" && stack !== "ignore") {
    fail("/stack", `stack ${JSON.stringify(raw.stack)} is not "refresh", "add" or "ignore"`);
  }
  if (raw.maxStacks !== undefined) {
    if (stack !== "add") fail("/maxStacks", 'maxStacks means something only with "stack": "add"');
    else if (!isInteger(raw.maxStacks) || raw.maxStacks < 2 || raw.maxStacks > MAX_BUFF_STACKS) {
      fail("/maxStacks", `maxStacks must be a whole number from 2 to ${MAX_BUFF_STACKS}`);
    }
  }
  if (raw.cap !== undefined) {
    if (!isInteger(raw.cap) || raw.cap < 1 || raw.cap > limit) {
      fail("/cap", `cap must be a whole number from 1 to ${limit}${known ? ` (the ${kind} limit)` : ""}`);
    } else if (isInteger(raw.amount) && raw.cap < Math.abs(raw.amount)) {
      fail("/cap", `cap ${raw.cap} is less than one stack (${Math.abs(raw.amount)}), so the buff could never be what it says`);
    }
  }
  if (raw.expiresOn !== undefined) {
    const list = raw.expiresOn;
    if (!Array.isArray(list) || list.length === 0) fail("/expiresOn", `expiresOn lists at least one of ${BUFF_EXPIRIES.join(", ")}`);
    else {
      list.forEach((on, i) => {
        if (!BUFF_EXPIRIES.includes(on as BuffExpiry)) fail(`/expiresOn/${i}`, `${JSON.stringify(on)} is not one of ${BUFF_EXPIRIES.join(", ")}`);
      });
      if (new Set(list).size !== list.length) fail("/expiresOn", "an expiry is listed twice");
    }
  }
  return problems;
}

/**
 * How many fights a fresh grant lasts: one for a `"turns"` or `"encounter"`
 * buff — and for a `"uses"` one, which no fight spends (#222).
 */
export function buffFights(duration: BuffDuration): number {
  return duration.scope === "encounters" ? duration.count : 1;
}

/** How many checks a fresh grant can be spent on (#222): a `"uses"` buff's count, else none. */
export function buffUses(duration: BuffDuration): number | undefined {
  return duration.scope === "uses" ? duration.count : undefined;
}

/** A story-check buff (#222): one that changes a chapter `Check` and never an attack. */
export function isCheckBuff(buff: { appliesTo?: BuffAppliesTo }): boolean {
  return buff.appliesTo === "check";
}

/** The most stacks this buff can hold: its `maxStacks` when it stacks, else 1. */
export function buffMaxStacks(def: Pick<BuffDef, "stack" | "maxStacks">): number {
  return def.stack === "add" ? (def.maxStacks ?? DEFAULT_BUFF_STACKS) : 1;
}

/**
 * What a buff adds at `stacks` stacks: its amount times its stacks, held to
 * its `cap` and its kind's limit — on the way down too, for a burden.
 */
export function buffContribution(def: Pick<BuffDef, "kind" | "amount" | "cap">, stacks: number): number {
  const ceiling = Math.min(def.cap ?? BUFF_LIMITS[def.kind], BUFF_LIMITS[def.kind]);
  return clamp(def.amount * Math.max(1, stacks), -ceiling, ceiling);
}

// ---------------------------------------------------------------------------
// The journey's buffs (between chapters)
// ---------------------------------------------------------------------------

/**
 * The buffs a stored journey holds, as this build reads them. A record that
 * is not a buff — no id, a stack or fight count that is not a whole number
 * of at least 1 — is dropped rather than guessed at: the one thing a misread
 * buff must never do is grow. Ids the declaration no longer has are kept (a
 * later build may know them); they do nothing.
 */
export function storedBuffs(raw: unknown): ActiveBuff[] {
  if (!Array.isArray(raw)) return [];
  const out: ActiveBuff[] = [];
  const seen = new Set<BuffId>();
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== "string" || seen.has(entry.id)) continue;
    if (!isInteger(entry.stacks) || entry.stacks < 1 || !isInteger(entry.encountersLeft) || entry.encountersLeft < 1) continue;
    // A spent use is never read back as an unspent one (#222).
    if (entry.usesLeft !== undefined && (!isInteger(entry.usesLeft) || entry.usesLeft < 1)) continue;
    seen.add(entry.id);
    const at = entry.grantedAt;
    out.push({
      id: entry.id,
      stacks: entry.stacks,
      encountersLeft: entry.encountersLeft,
      ...(entry.usesLeft !== undefined ? { usesLeft: entry.usesLeft } : {}),
      ...(isRecord(at) && typeof at.node === "string" && isInteger(at.visit) ? { grantedAt: { node: at.node, visit: at.visit } } : {}),
    });
  }
  return out;
}

/**
 * A `grantBuff` effect, applied to the buffs a journey holds. A buff not held
 * is added at the end, one stack, its full duration. One already held does
 * what its `stack` says:
 *
 * - `"refresh"` — full duration again, same stacks;
 * - `"add"` — one more stack (never past `maxStacks`), full duration again;
 * - `"ignore"` — nothing.
 *
 * A held buff keeps its place in the list, so the screens' order is the order
 * the party first got them. `at` is the visit doing the granting.
 */
export function grantBuff(
  held: readonly ActiveBuff[],
  id: BuffId,
  def: BuffDef,
  at?: { node: NodeId; visit: number },
): ActiveBuff[] {
  const fights = buffFights(def.duration);
  const uses = buffUses(def.duration);
  const clock = uses === undefined ? { encountersLeft: fights } : { encountersLeft: fights, usesLeft: uses };
  const stamp = at ? { grantedAt: { node: at.node, visit: at.visit } } : {};
  const index = held.findIndex((buff) => buff.id === id);
  if (index === -1) return [...held, { id, stacks: 1, ...clock, ...stamp }];
  const stack = def.stack ?? "refresh";
  if (stack === "ignore") return [...held];
  const current = held[index]!;
  const stacks = stack === "add" ? Math.min(buffMaxStacks(def), current.stacks + 1) : current.stacks;
  const next = [...held];
  next[index] = { ...current, stacks, ...clock, ...stamp };
  return next;
}

/**
 * The journey's buffs without those `on` ends — what taking an exit does
 * with `"travel"`. Ids the declaration no longer has are kept, untouched.
 */
export function expireBuffs(
  defs: Readonly<Record<BuffId, BuffDef>>,
  held: readonly ActiveBuff[],
  on: BuffExpiry,
): ActiveBuff[] {
  return held.filter((buff) => !(defs[buff.id]?.expiresOn ?? []).includes(on));
}

/**
 * What a chapter run is handed (`EngineContext.campaignBuffs` →
 * `RunState.buffs`): every held buff the declaration still has, resolved.
 * A stored stack count above what the declaration now allows is held to it.
 */
export function seedRunBuffs(defs: Readonly<Record<BuffId, BuffDef>>, held: unknown): RunBuff[] {
  const out: RunBuff[] = [];
  for (const buff of storedBuffs(held)) {
    const def = defs[buff.id];
    if (!def) continue;
    const { usesLeft, ...counters } = buff;
    const uses = buffUses(def.duration);
    out.push({
      ...counters,
      stacks: Math.min(buff.stacks, buffMaxStacks(def)),
      encountersLeft: Math.min(buff.encountersLeft, buffFights(def.duration)),
      // A `"uses"` buff's checks left, held to its declaration; any other
      // buff carries none, whatever a stored record says (#222).
      ...(uses !== undefined ? { usesLeft: Math.min(usesLeft ?? uses, uses) } : {}),
      label: def.label,
      kind: def.kind,
      amount: def.amount,
      target: def.target ?? "party",
      ...(def.duration.scope === "turns" ? { turns: def.duration.count } : {}),
      ...(def.cap !== undefined ? { cap: def.cap } : {}),
      ...(def.expiresOn !== undefined ? { expiresOn: [...def.expiresOn] } : {}),
      ...(isCheckBuff(def) ? { appliesTo: "check" as const, spend: def.spend ?? "auto" } : {}),
    });
  }
  return out;
}

/**
 * The journey's buffs after a visit's chapter run completed (§5's carry
 * rule, applied to buffs): what the run still holds **becomes** what the
 * journey holds — it was seeded from the journey, so a chapter with no fight
 * hands back exactly what it was given. Ids the declaration no longer has
 * were never seeded and are carried over from `before` untouched.
 *
 * A run with no `buffs` at all (started by a build before #200) hands back
 * nothing to read, and the journey's buffs are left as they were.
 */
export function readBackBuffs(
  defs: Readonly<Record<BuffId, BuffDef>>,
  before: unknown,
  run: readonly RunBuff[] | undefined,
): ActiveBuff[] {
  const kept = storedBuffs(before);
  if (run === undefined) return kept;
  const back = storedBuffs(run).filter((buff) => defs[buff.id] !== undefined);
  return [...back, ...kept.filter((buff) => defs[buff.id] === undefined)];
}

/** The held buffs as the screens show them (`JourneyView.buffs`), in held order. */
export function buffViews(defs: Readonly<Record<BuffId, BuffDef>>, held: unknown): JourneyBuffView[] {
  return seedRunBuffs(defs, held).map((buff) => ({
    id: buff.id,
    label: buff.label,
    kind: buff.kind,
    amount: buffContribution(buff, buff.stacks),
    stacks: buff.stacks,
    target: buff.target,
    remaining: {
      encounters: buff.encountersLeft,
      ...(buff.turns !== undefined ? { turns: buff.turns } : {}),
      ...(buff.usesLeft !== undefined ? { uses: buff.usesLeft } : {}),
    },
    ...(buff.expiresOn ? { expiresOn: [...buff.expiresOn] } : {}),
    ...(buff.appliesTo !== undefined ? { appliesTo: buff.appliesTo, spend: buff.spend ?? "auto" } : {}),
  }));
}

// ---------------------------------------------------------------------------
// The run's buffs (inside a chapter)
// ---------------------------------------------------------------------------

/**
 * The run's buffs without those `on` ends — a Rest scene's `"rest"`, a
 * setback's `"setback"`, the end of any chapter's `"chapter"` (#222).
 */
export function expireRunBuffs(held: readonly RunBuff[], on: BuffExpiry): RunBuff[] {
  return held.filter((buff) => !(buff.expiresOn ?? []).includes(on));
}

/**
 * A fight is over: every buff the run holds took part in it, so every one is
 * one fight nearer spent — a `"turns"` or `"encounter"` buff is gone, an
 * `"encounters"` one has one fewer to go. A lost fight (`"defeat"`) also ends
 * every buff that says so. Deterministic in the fight's result alone: what
 * happened inside it (who hit what, whose turns ran out) does not matter.
 */
export function spendRunBuffs(held: readonly RunBuff[], result: "victory" | "defeat" | "ongoing"): RunBuff[] {
  const out: RunBuff[] = [];
  for (const buff of held) {
    if (result === "defeat" && (buff.expiresOn ?? []).includes("defeat")) continue;
    // A story-check buff (#222) took no part in the fight: it is spent by
    // checks, and a fight leaves it as it was.
    if (isCheckBuff(buff)) {
      out.push(buff);
      continue;
    }
    if (buff.encountersLeft <= 1) continue;
    out.push({ ...buff, encountersLeft: buff.encountersLeft - 1 });
  }
  return out;
}

/**
 * The hero a `target: "one"` buff lands on when a fight begins: whoever holds
 * the story turn (`RunState.storyTurn`'s seat, wrapped to the party). Not the
 * connected-seat search `storyTurnHolder` does — a buff is not a turn anybody
 * has to take, and who has a phone in hand must not change a fight's numbers.
 */
export function oneHeroSeat(storyTurn: number | undefined, partySize: number): number {
  if (partySize < 1) return 0;
  return (((storyTurn ?? 0) % partySize) + partySize) % partySize;
}

/**
 * The fight's buffs, from the run's, for the heroes in seat order: one entry
 * per hero each buff is on, with what it adds. A buff that adds nothing is
 * left out (there is no such declaration, but a hand-built run could ask),
 * and so is a story-check buff (#222): it never changes an attack.
 */
export function combatBuffsFor(
  held: readonly RunBuff[],
  heroIds: readonly string[],
  oneHeroId: string | null,
): CombatBuff[] {
  const out: CombatBuff[] = [];
  for (const buff of held) {
    if (isCheckBuff(buff)) continue;
    const amount = buffContribution(buff, buff.stacks);
    if (amount === 0) continue;
    const on: readonly string[] =
      (buff.target as BuffTarget) === "one" ? (oneHeroId !== null && heroIds.includes(oneHeroId) ? [oneHeroId] : []) : heroIds;
    for (const heroId of on) {
      out.push({
        id: buff.id,
        label: buff.label,
        kind: buff.kind,
        heroId,
        amount,
        ...(buff.turns !== undefined ? { turnsLeft: buff.turns } : {}),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Story checks (#222)
// ---------------------------------------------------------------------------

/**
 * The story-check buff a roll would spend (`Prompt.buff`), or null: at most
 * one per roll — "+2 on one check". An `"auto"` one comes first, so a buff
 * the party has to spend is never kept waiting behind one it may save; among
 * equals, the one held longest. A buff that adds nothing is never offered.
 */
export function checkBuffOffer(held: readonly RunBuff[] | undefined): CheckBuffOffer | null {
  if (!held || held.length === 0) return null;
  const usable = held.filter(
    (buff) => isCheckBuff(buff) && (buff.usesLeft ?? 0) >= 1 && buffContribution(buff, buff.stacks) !== 0,
  );
  const buff = usable.find((b) => (b.spend ?? "auto") === "auto") ?? usable[0];
  if (!buff) return null;
  return { id: buff.id, label: buff.label, amount: buffContribution(buff, buff.stacks), spend: buff.spend ?? "auto" };
}

/**
 * A story-check buff spent on a roll: one use fewer, and gone once it has
 * none left. Every other buff is left as it was.
 */
export function spendCheckBuff(held: readonly RunBuff[], id: BuffId): RunBuff[] {
  const out: RunBuff[] = [];
  for (const buff of held) {
    if (buff.id !== id || !isCheckBuff(buff)) out.push(buff);
    else if ((buff.usesLeft ?? 0) > 1) out.push({ ...buff, usesLeft: buff.usesLeft! - 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The fight's buffs
// ---------------------------------------------------------------------------

/**
 * What a hero's buffs of one kind add right now, held to the kind's limit.
 * Zero for a fight with no buffs — every ordered campaign's, every fight a
 * monster stands in, and every number not changed by one.
 */
export function buffBonus(buffs: readonly CombatBuff[] | undefined, heroId: string, kind: BuffKind): number {
  if (!buffs || buffs.length === 0) return 0;
  let total = 0;
  for (const buff of buffs) if (buff.heroId === heroId && buff.kind === kind) total += buff.amount;
  return clamp(total, -BUFF_LIMITS[kind], BUFF_LIMITS[kind]);
}

/**
 * A number a buff changes: `base` itself when nothing changes it (so a fight
 * without buffs computes exactly what it always did), otherwise `base +
 * bonus`, never below `floor` — a burden can make a hero slower, softer or
 * clumsier, never stuck, made of paper, or hitting for nothing.
 */
export function buffed(base: number, bonus: number, floor: number): number {
  return bonus === 0 ? base : Math.max(floor, base + bonus);
}

/**
 * `heroId`'s turn has ended: each of their turn-limited buffs covers one turn
 * fewer, and one that has covered all its turns comes off. Returns the same
 * array when nothing changed.
 */
export function tickCombatBuffs(buffs: readonly CombatBuff[], heroId: string): readonly CombatBuff[] {
  if (!buffs.some((buff) => buff.heroId === heroId && buff.turnsLeft !== undefined)) return buffs;
  const out: CombatBuff[] = [];
  for (const buff of buffs) {
    if (buff.heroId !== heroId || buff.turnsLeft === undefined) out.push(buff);
    else if (buff.turnsLeft > 1) out.push({ ...buff, turnsLeft: buff.turnsLeft - 1 });
  }
  return out;
}
