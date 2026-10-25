/**
 * A fight's beats, in words — the one place they are put into words, for both
 * screens that say them: the TV's running fight log (FightLog) and the line
 * on a phone's combat panel (CombatPanel).
 *
 * A swing is one line, not three. The engine sends a `roll`, then the `damage`
 * it did, then a `down` if that was the last of somebody's hearts; read as
 * three lines, the roll scrolled off a phone before the hit it decided landed,
 * and on the TV the number that mattered ("how much?") sat a line away from
 * the roll that explained it. So a roll gathers the hurt that follows it, and
 * says, in order: who swung, the sum, the Guard it had to reach and whose
 * Guard that is, how hard it landed (the tier rides the roll: `damageTier` in
 * shared's encounter.ts), and what it left.
 *
 * Pure, so the wording can be asserted. "You" for the phone's own hero when a
 * `myId` is given; the TV passes none, because the shared screen is nobody's
 * own.
 */

import type { DamageTier, DiceRoll, EncounterEvent, EncounterState } from "@kad/shared";
import { captiveName, combatantById } from "@kad/shared";
import { combatantLabel } from "./combat-grid";
import { numbedLine, puffedLine } from "./buff-copy";
import { environmentBeatLine } from "./environment-copy";
import { calloutsOf, calloutsOfRoll, type Callout } from "./matchup-copy";

/** How hard a hit landed, as the table would shout it. */
export const TIER_WORD: Readonly<Record<DamageTier, string>> = {
  graze: "Graze!",
  solid: "Solid hit!",
  critical: "Critical!",
};

/** Stat ids as a kid reads them off the sheet. */
const STAT_NAMES: Record<string, string> = {
  might: "Might",
  quick: "Quick",
  clever: "Clever",
  heart: "Heart",
};

/** A swing: the roll, whose Guard it had to reach, and what it did. */
export interface Swing {
  /** Who swung, already in words ("You" on their own phone). */
  readonly who: string;
  readonly roll: DiceRoll;
  /** Who it was aimed at, in words; null on a roll persisted before rolls named it. */
  readonly target: string | null;
  /** How hard a hit landed; null on a miss. */
  readonly tier: DamageTier | null;
  /** The hearts it took, from whoever it landed on (Brace can step in), once that beat arrives. */
  readonly hurt: { readonly who: string; readonly amount: number; readonly left: number; readonly down: boolean } | null;
  /**
   * What matchups moved this swing (docs/matchups.md), plus or minus from the
   * hero's side. Absent, not empty, when none did, so a swing in a campaign
   * without matchups is the object it always was.
   */
  readonly matchups?: readonly Callout[];
}

/**
 * One line of "what just happened", already in words. Built from the events
 * against the encounter as the screen holds it, because names are stable for
 * the whole fight.
 */
export interface Beat {
  readonly key: string;
  /** A swing keeps its numbers, so it can be drawn as a die rather than a sentence. */
  readonly swing?: Swing;
  readonly text: string;
  readonly tone: "good" | "bad" | "plain";
  /** The place's own beat (#201): the TV says these in RiftStatus, not in its fight log. */
  readonly environment?: true;
}

/** "14 + 3 Might = 17 vs Guard 11", the way the table would read it out. */
export function rollWords(roll: DiceRoll): string {
  const stat = roll.stat ? ` ${STAT_NAMES[roll.stat] ?? roll.stat}` : "";
  const mod = roll.mod === 0 ? "" : ` ${roll.mod < 0 ? "-" : "+"} ${Math.abs(roll.mod)}${stat}`;
  const m = roll.matchup?.amount ?? 0;
  const matchup = m === 0 ? "" : ` ${m < 0 ? "-" : "+"} ${Math.abs(m)} matchup`;
  return `${roll.die}${mod}${matchup} = ${roll.total} vs Guard ${roll.tn}`;
}

/** The stat a roll used, as a word, or null. */
export function statName(roll: DiceRoll): string | null {
  return roll.stat ? (STAT_NAMES[roll.stat] ?? roll.stat) : null;
}

/** "Hit!" in its strength, or "Miss!". A natural 20 or 1 decided it on its own, and says so. */
export function verdictWord(swing: Pick<Swing, "roll" | "tier">): string {
  if (swing.tier) return TIER_WORD[swing.tier];
  if (swing.roll.result === "hit") return "Hit!";
  return swing.roll.die === 1 ? "Natural 1. Miss!" : "Miss!";
}

/**
 * What the roll had to reach, and why, in a kid's words: "Needs 13:
 * Bramblewisp 1's Guard". Guard is the one number an attack is ever rolled
 * against, and saying whose it is answers "why 13?" before anybody asks.
 */
export function needsLine(swing: Pick<Swing, "roll" | "target">): string {
  const whose = swing.target === null ? "the Guard" : swing.target === "You" ? "your Guard" : `${swing.target}'s Guard`;
  return `Needs ${swing.roll.tn}: ${whose}`;
}

/** What the swing did, after the verdict: "Bramblewisp 1 takes 3. 3 left." */
export function hurtWords(hurt: NonNullable<Swing["hurt"]>): string {
  const you = hurt.who === "You";
  if (hurt.down) return `${hurt.who} ${you ? "take" : "takes"} ${hurt.amount} and ${you ? "are" : "is"} knocked down!`;
  return `${hurt.who} ${you ? "take" : "takes"} ${hurt.amount}. ${hurt.left} left.`;
}

/** The swing as one sentence: the phone's line, and the screen reader's. */
export function swingText(swing: Swing): string {
  const hit = swing.roll.result === "hit" || swing.roll.result === "success";
  const after = hit && swing.hurt ? ` ${hurtWords(swing.hurt)}` : "";
  const matchups = swing.matchups?.length ? ` ${swing.matchups.map((callout) => callout.line).join(" ")}` : "";
  return `${swing.who} rolled ${rollWords(swing.roll)}.${matchups} ${verdictWord(swing)}${after}`;
}

/**
 * Beats → lines. Walking is left out: it is the board's to show, and in words
 * it buries the hit under it.
 */
export function describeBeats(
  events: readonly EncounterEvent[],
  encounter: EncounterState,
  myId: string | null,
  seq: number | string,
): Beat[] {
  const name = (id: string): string => {
    if (id === myId) return "You";
    const c = combatantById(encounter, id);
    return c ? combatantLabel(c) : id;
  };
  const isParty = (id: string): boolean => combatantById(encounter, id)?.side === "party";
  const out: Beat[] = [];
  /*
   * The swing still waiting on its hurt: the index of its line in `out`, and
   * the swing so far. A hit's `damage` follows its roll, perhaps after a
   * Brace or a ward between them; anything else that hurts (a hazard, a
   * thrown jar, a surge) has no roll open, and gets a line of its own.
   */
  let open: { index: number; swing: Swing } | null = null;
  // `matchup` beats come just before the roll they moved; the roll itself
  // carries the same notes, which win when it does.
  let pending: Callout[] = [];
  const setOpen = (swing: Swing): void => {
    if (!open) return;
    open.swing = swing;
    out[open.index] = { ...(out[open.index] as Beat), swing, text: swingText(swing) };
  };

  events.forEach((event, i) => {
    const key = `${seq}:${i}`;
    switch (event.type) {
      case "roll": {
        const hit = event.roll.result === "hit" || event.roll.result === "success";
        const matchups = event.roll.matchup ? calloutsOfRoll(event.roll) : pending;
        pending = [];
        const swing: Swing = {
          who: name(event.roll.characterId),
          roll: event.roll,
          target: event.targetId === undefined ? null : name(event.targetId),
          tier: hit ? (event.tier ?? null) : null,
          hurt: null,
          ...(matchups.length > 0 ? { matchups } : {}),
        };
        out.push({
          key,
          swing,
          text: swingText(swing),
          tone: hit ? (event.roll.characterId === myId || isParty(event.roll.characterId) ? "good" : "bad") : "plain",
        });
        open = hit ? { index: out.length - 1, swing } : null;
        return;
      }
      case "damage": {
        const who = name(event.actorId);
        if (open && open.swing.hurt === null) {
          setOpen({ ...open.swing, hurt: { who, amount: event.amount, left: event.hp, down: false } });
          return;
        }
        open = null;
        out.push({
          key,
          text: `${who} ${who === "You" ? "take" : "takes"} ${event.amount}. ${event.hp} left.`,
          tone: isParty(event.actorId) ? "bad" : "good",
        });
        return;
      }
      case "down": {
        const who = name(event.actorId);
        if (open && open.swing.hurt && open.swing.hurt.who === who && !open.swing.hurt.down) {
          setOpen({ ...open.swing, hurt: { ...open.swing.hurt, down: true } });
          open = null;
          return;
        }
        out.push({
          key,
          text: `${who} ${who === "You" ? "are" : "is"} knocked down!`,
          tone: isParty(event.actorId) ? "bad" : "good",
        });
        return;
      }
      case "heal": {
        const who = name(event.actorId);
        out.push({ key, text: `${who} ${who === "You" ? "get" : "gets"} ${event.amount} back. ${event.hp} now.`, tone: "good" });
        return;
      }
      case "revived": {
        const who = name(event.actorId);
        out.push({ key, text: `${who} ${who === "You" ? "are" : "is"} back up!`, tone: "good" });
        return;
      }
      case "shoved":
        out.push({ key, text: `${name(event.actorId)} ${name(event.actorId) === "You" ? "get" : "gets"} shoved.`, tone: "plain" });
        return;
      case "protected":
        out.push({ key, text: `${name(event.byId)} ${name(event.byId) === "You" ? "brace" : "braces"} for ${name(event.actorId)}.`, tone: "good" });
        return;
      case "bonus":
        out.push({ key, text: `${name(event.actorId)}: +${event.amount} on the next roll.`, tone: "good" });
        return;
      case "dazed":
        out.push({ key, text: `${name(event.actorId)} ${name(event.actorId) === "You" ? "are" : "is"} dazed.`, tone: "plain" });
        return;
      case "warded":
        out.push({ key, text: `${name(event.actorId)}: warded for ${event.amount}.`, tone: "good" });
        return;
      case "evaded":
        out.push({ key, text: `${name(event.actorId)} vanished from ${name(event.byId)}'s swing!`, tone: "plain" });
        return;
      case "rooted":
        out.push({ key, text: `${name(event.actorId)} ${name(event.actorId) === "You" ? "are" : "is"} rooted.`, tone: "plain" });
        return;
      case "numbed":
        out.push({ key, text: numbedLine(name(event.actorId), event.steps, event.turns), tone: "plain" });
        return;
      case "puffed":
        out.push({ key, text: puffedLine(name(event.actorId)), tone: "plain" });
        return;
      case "encore":
        out.push({ key, text: `${name(event.actorId)} ${name(event.actorId) === "You" ? "get" : "gets"} another action!`, tone: "good" });
        return;
      // The place fighting back (#201): words shared with the TV's rift
      // caption (environment-copy.ts), so the two never drift.
      case "hazard":
      case "slowed":
      case "escaped":
      case "freed":
      case "captiveLost":
      case "captiveDragged":
      case "objective":
      case "relocated":
      case "riftClock":
      case "surge": {
        open = null;
        const line = environmentBeatLine(event, {
          name,
          isParty,
          captive: (index) => captiveName(encounter.environment?.spec, index),
          objective: (id) => encounter.environment?.spec.objectives?.find((o) => o.id === id)?.label ?? id,
        });
        if (line) out.push({ key, ...line, environment: true });
        return;
      }
      case "matchup":
        pending = [...pending, ...calloutsOf([event])];
        return;
      case "moved":
      case "walled":
        return;
    }
  });
  return out;
}
