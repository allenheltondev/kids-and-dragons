/**
 * What the combat panel says about the place fighting back (#201), for an
 * 8-year-old.
 *
 * Pure strings and glyph names, kept apart from the component so the words
 * can be tested without a DOM (buff-copy.ts's rule). Every line says the rule
 * in words — "end your turn on it to escape", "stopping here costs 2 hearts"
 * — and every board mark has a glyph of its own shape, so nothing is told
 * apart by colour alone (spec §11). All of it reads `environmentView`, the one
 * shared reading of `EncounterState.environment`; a fight without one shows
 * none of it.
 *
 * Two surfaces read it: the phone's combat panel, and the shared screen's rift
 * status (RiftStatus.tsx) beside the TV board's overlay
 * (world/environment-overlay.ts). One set of words, so the room and the phone
 * in a child's hand never say the same thing two ways.
 */

import type {
  EncounterEvent,
  EnvironmentClockView,
  EnvironmentExitView,
  EnvironmentHazardView,
  EnvironmentObjectiveView,
  EnvironmentRescueView,
} from "@kad/shared";

const s = (n: number) => (n === 1 ? "" : "s");

/** The glyphs (icons.tsx names): a flame, a thorn, a spark — shapes, not colours. */
const HAZARD_ICON: Record<EnvironmentHazardView["kind"], string> = {
  fire: "flame",
  thorns: "thorn",
  rift: "spark",
};

export function hazardIcon(kind: EnvironmentHazardView["kind"]): string {
  return HAZARD_ICON[kind] ?? "spark";
}

export const CLOCK_ICON = "waiting";
export const EXIT_ICON = "forward";
export const CAPTIVE_ICON = "heart";

/** An objective's glyph (#220): a shield for ground to hold, a key for a tear to close. */
export function objectiveIcon(kind: EnvironmentObjectiveView["kind"]): string {
  return kind === "hold" ? "shield" : "key";
}

/** What an objective asks, how far along it is, and what doing it means (#220). */
export function objectiveLine(objective: EnvironmentObjectiveView): string {
  if (objective.done) return `${objective.label}: done!`;
  const how =
    objective.kind === "hold"
      ? "end a round with one of you on it and no monster there"
      : "end your turn on it or next to it";
  const ends = objective.endsFight ? " Do it and the fight is won." : "";
  return `${objective.label}: ${how}. ${objective.progress} of ${objective.target}.${ends}`;
}

/** "The rift closes in 3 rounds." — the visible timer. */
export function clockLine(clock: EnvironmentClockView): string {
  if (clock.expired) {
    if (clock.onExpire === "collapse") return `${clock.label} — now!`;
    const surge = clock.surge ?? 1;
    return `${clock.label} — now! Every round you stay, everyone loses ${surge} heart${s(surge)}.`;
  }
  if (clock.roundsLeft <= 1) return `${clock.label} at the end of this round!`;
  return `${clock.label} in ${clock.roundsLeft} rounds.`;
}

/** "a, b and c" — the way a person lists things aloud. */
function spoken(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Everything stopping on a hazard does, in the order it happens: "costs 2
 * hearts and holds you still next turn". Ground that slows, holds or throws
 * (#220) says so in words, beside or instead of the hearts.
 */
export function hazardCost(hazard: Pick<EnvironmentHazardView, "damage" | "slow" | "root" | "push">): string {
  const parts: string[] = [];
  if (hazard.damage > 0) parts.push(`costs ${hazard.damage} heart${s(hazard.damage)}`);
  if (hazard.slow) {
    const { steps, turns } = hazard.slow;
    parts.push(`slows you ${steps} step${s(steps)} for ${turns === 1 ? "a turn" : `${turns} turns`}`);
  }
  if (hazard.root) parts.push("holds you still next turn");
  if (hazard.push) {
    const n = hazard.push.tiles;
    parts.push(`throws you ${n === 1 ? "" : `${n} squares `}${hazard.push.direction}`);
  }
  return spoken(parts);
}

/** What one hazard costs, and whether it is burning yet. */
export function hazardLine(hazard: EnvironmentHazardView): string {
  if (hazard.gone) return `${hazard.label} has died down.`;
  const cost = `stopping on it ${hazardCost(hazard)}.`;
  return hazard.active ? `${hazard.label}: ${cost}` : `${hazard.label} (not yet): soon ${cost}`;
}

/** Where the way out is, and for how long. */
export function exitLine(exit: EnvironmentExitView): string {
  if (exit.gone) return `${exit.label} has closed.`;
  if (!exit.open) {
    const n = exit.opensIn ?? 1;
    return `${exit.label} opens ${n === 1 ? "next round" : `in ${n} rounds`}.`;
  }
  const base = `${exit.label} is open: end your turn on it to escape.`;
  if (exit.closesIn === undefined) return base;
  return `${base} ${exit.closesIn <= 1 ? "It closes after this round!" : `It closes in ${exit.closesIn} rounds.`}`;
}

/** Who needs saving, and how. */
export function rescueLine(rescue: EnvironmentRescueView): string {
  switch (rescue.status) {
    case "freed":
      return `${rescue.name} is free!`;
    case "lost":
      return `${rescue.name} is lost to the rift.`;
    default: {
      const free = `Free ${rescue.name}: end your turn next to them.`;
      // A captive the monsters can get at (#220) says how many tugs are left.
      const how = rescue.hp === undefined ? free : `${free} A monster next to them drags them away: ${rescue.hp} more and they are gone.`;
      if (rescue.roundsLeft === undefined) return how;
      return rescue.roundsLeft <= 1 ? `${how} This round is the last chance!` : `${how} ${rescue.roundsLeft} rounds left.`;
    }
  }
}

/** A board square's mark, as words: what the cell's button and the legend say. */
export function tileWords(feature: { kind: "hazard" | "exit" | "captive" | "objective"; label: string; active: boolean }): string {
  switch (feature.kind) {
    case "objective":
      return feature.active ? `${feature.label}, stop here` : `${feature.label}, done`;
    case "hazard":
      return feature.active ? `${feature.label}, don't stop here` : `${feature.label} (not yet)`;
    case "exit":
      return feature.active ? `${feature.label}, open: stop here to escape` : `${feature.label}, closed`;
    default:
      return feature.label;
  }
}

/**
 * The clock as the shared screen shows it: one big figure a room can read
 * from the sofa, the sentence beside it, and how loudly to say it. The figure
 * is the rounds left; in the last round it becomes "!" and once the rift has
 * acted, "0" — so "hurry" and "too late" differ in shape as well as in the
 * style the banner gives them (spec §11: never colour alone).
 */
export interface ClockReadout {
  readonly figure: string;
  readonly text: string;
  readonly mood: "calm" | "urgent" | "expired";
}

export function clockReadout(clock: EnvironmentClockView): ClockReadout {
  const text = clockLine(clock);
  if (clock.expired) return { figure: "0", text, mood: "expired" };
  if (clock.roundsLeft <= 1) return { figure: "!", text, mood: "urgent" };
  return { figure: String(clock.roundsLeft), text, mood: "calm" };
}

/** How a beat is told: whose name to use, and whose side they are on. */
export interface BeatWords {
  /** "You" for the reader's own figure on a phone; a name everywhere else. */
  name(id: string): string;
  isParty(id: string): boolean;
  /**
   * The captive an event names, by its `captive` index (#220; absent for the
   * one captive): their `name`, or "the captive" for a fight without one.
   */
  captive(index?: number): string;
  /** An objective's label, by id (#220). */
  objective(id: string): string;
}

/**
 * One environmental beat (`hazard`, `escaped`, `freed`, `captiveLost`,
 * `relocated`, `riftClock`, `surge`) as a sentence and a tone, or null for
 * any other beat. The phone's beat log and the TV's rift caption both say
 * these, so the words live here once.
 */
export function environmentBeatLine(
  event: EncounterEvent,
  words: BeatWords,
): { text: string; tone: "good" | "bad" | "plain" } | null {
  switch (event.type) {
    case "hazard": {
      const who = words.name(event.actorId);
      return {
        text: `${event.label} ${who === "You" ? "gets you" : `gets ${who}`}!`,
        tone: words.isParty(event.actorId) ? "bad" : "good",
      };
    }
    case "slowed": {
      const who = words.name(event.actorId);
      return {
        text: `${who} ${who === "You" ? "are" : "is"} stuck: ${event.steps} fewer step${s(event.steps)} for ${event.turns === 1 ? "a turn" : `${event.turns} turns`}.`,
        tone: words.isParty(event.actorId) ? "bad" : "good",
      };
    }
    case "escaped": {
      const who = words.name(event.actorId);
      return { text: `${who} ${who === "You" ? "step" : "steps"} through the rift!`, tone: "good" };
    }
    case "freed":
      return { text: `${words.name(event.byId)} freed ${words.captive(event.captive)}!`, tone: "good" };
    case "captiveLost":
      return { text: `${words.captive(event.captive)} is lost to the rift.`, tone: "bad" };
    case "captiveDragged":
      return {
        text: `${words.name(event.byId)} drags at ${words.captive(event.captive)}! ${event.hp === 0 ? "Gone!" : `${event.hp} more and they are gone.`}`,
        tone: "bad",
      };
    case "relocated":
      return { text: `The rift throws ${words.name(event.actorId)} somewhere new!`, tone: "plain" };
    case "objective":
      return {
        text:
          event.progress >= event.target
            ? `Done: ${words.objective(event.objectiveId)}!`
            : `${words.objective(event.objectiveId)}: ${event.progress} of ${event.target}.`,
        tone: "good",
      };
    case "riftClock":
      return { text: event.onExpire === "collapse" ? "The rift is closing!" : "The rift is surging!", tone: "bad" };
    case "surge":
      return { text: `The rift surges: everyone still here loses ${event.amount}.`, tone: "bad" };
    default:
      return null;
  }
}
