/**
 * DiceOverlay — the d20, and the centrepiece of the screen (roadmap ch.3).
 *
 * Driven by the ROLL *presentation* event, never by polling `state.lastRoll`:
 * the protocol splits state from spectacle precisely so animation timing never
 * blocks game logic (architecture §4.2), and a client that reconnects mid-roll
 * must not replay an animation for a roll that already happened.
 *
 * Timing: the d20 tumbles for a second, a helper's die (if a friend helped)
 * tumbles for another beat after it, and then the sum and the outcome stay up
 * for ~2.6s: long enough to read "14 + 3 + 2 = 19" out loud, not just glimpse
 * it. One roll type, one big animation (spec §4.1).
 *
 * The clock lives in world/presentation.ts (`ROLL_TUMBLE_MS`,
 * `ROLL_HELP_TUMBLE_MS`, `ROLL_READ_MS`) because three readers need it: this
 * card, the presentation gate that holds the patch until every die has landed
 * (`presentationDuration`), and the phone that hands the world pane the whole
 * screen for as long as the card is up (layout/TravelLayout.tsx).
 *
 * The face the die *shows* is never the source of the number. The server rolls
 * (architecture §4.2); the scramble below is theatre played toward a result
 * that was decided before this component heard about it, which is also why a
 * client reconnecting mid-roll replays nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { difficultyFor, speak } from "@kad/shared";
import type { DiceRoll, Difficulty } from "@kad/shared";
import { reducedMotion } from "../a11y/prefs";
import { useParty, usePresentation } from "../store";
import { ROLL_TUMBLE_MS, rollCardMs, rollRevealMs } from "../world/presentation";
import { ScreenReaderOnly } from "../ui/ScreenReaderOnly";
import { CharacterPortrait } from "./CharacterPortrait";
import { DiceCelebration } from "./DiceCelebration";
import { cue } from "../audio/cue";
import type { Celebration } from "./DiceCelebration";
import { Icon } from "./icons";
import "./shared.css";
import "./DiceOverlay.css";

/** How fast the face changes while it is in the air. ~12 faces per tumble. */
const SCRAMBLE_MS = 80;
/** spec §4.1 — one die. */
const SIDES = 20;

/**
 * The next face of a scramble: uniform over every face *except* the one
 * showing, so the die never appears to stick for two frames in a row. Pure, so
 * the one interesting property ("never repeats, always legal") is testable
 * without a timer.
 */
export function nextFace(previous: number, random: number, sides: number = SIDES): number {
  const face = Math.floor(random * (sides - 1)) + 1; // 1…sides-1
  return face >= previous ? face + 1 : face;
}

/**
 * A tumbling number is exactly the kind of motion `prefers-reduced-motion`
 * exists to switch off, and CSS cannot switch off a `setInterval` — so this is
 * asked in JS as well. theme.css flattens the tumble itself.
 */
function prefersReducedMotion(): boolean {
  return reducedMotion();
}

interface ShownRoll {
  /** Monotonic so two identical rolls in a row still replay. */
  id: number;
  roll: DiceRoll;
}

const GOOD: ReadonlySet<DiceRoll["result"]> = new Set(["success", "hit"]);

const OUTCOME_WORD: Record<DiceRoll["result"], string> = {
  success: "Success!",
  hit: "A hit!",
  failure: "Not this time",
  miss: "A miss",
};

/** "Normal" undersells a check most kids pass about half the time. */
const DIFFICULTY_WORD: Record<Difficulty, string> = {
  easy: "Easy",
  normal: "Tricky",
  hard: "Hard",
};

/**
 * What the outcome line says. A natural 20 or 1 decides the roll on its own
 * (dice.ts `clears`), so it gets named: that is the moment the table shouts.
 */
export function outcomeWord(roll: Pick<DiceRoll, "die" | "result">): string {
  if (roll.die === 20) return "Natural 20!";
  if (roll.die === 1) return "Natural 1";
  return OUTCOME_WORD[roll.result];
}

/** A check's target, with the word for how hard it is: "Tricky: needed 12". */
export function checkTarget(tn: number): string {
  return `${DIFFICULTY_WORD[difficultyFor(tn)]}: needed ${String(tn)}`;
}

/** Stat ids as a kid reads them off the sheet. */
const STAT_WORD: Record<string, string> = { might: "Might", quick: "Quick", clever: "Clever", heart: "Heart" };

/** What the shared screen needs to know about a check that is waiting on its roll. */
export interface CheckPlanPrompt {
  stat: string;
  tn: number;
  characterId: string;
  helper?: { characterId: string; sides: number } | undefined;
  group?: unknown;
}

/**
 * A waiting check, said for the whole table before the die is thrown: who
 * rolls, what gets added, and the number to reach. The roller's phone always
 * said "Tricky: needed 12"; a playtest found the TV said only the question,
 * so the table could not tell what counted until the die had landed.
 *
 *   { roll: "Sparklehoof rolls d20 + 3 Might", target: "Tricky: 12 or more makes it." }
 */
export function checkPlan(
  prompt: CheckPlanPrompt,
  party: readonly { character: { id: string; name: string; stats: Record<string, number> } }[],
): { roll: string; target: string } {
  const stat = STAT_WORD[prompt.stat] ?? prompt.stat;
  const word = DIFFICULTY_WORD[difficultyFor(prompt.tn)];
  if (prompt.group !== undefined) {
    return {
      roll: `Everyone rolls d20 + their ${stat}`,
      target: `${word}: ${String(prompt.tn)} or more makes it. Half of you or more need to.`,
    };
  }
  const roller = party.find((m) => m.character.id === prompt.characterId)?.character;
  const mod = roller?.stats[prompt.stat] ?? 0;
  // "+ 0 Quick" rather than nothing: the stat is what the roller adds, even at nothing.
  const sum = ` ${mod < 0 ? "−" : "+"} ${String(Math.abs(mod))}`;
  const helper = prompt.helper ? party.find((m) => m.character.id === prompt.helper?.characterId)?.character.name : undefined;
  const help = prompt.helper ? `, plus ${helper ?? "a friend"}'s d${String(prompt.helper.sides)}` : "";
  return {
    roll: `${roller?.name ?? "Someone"} rolls d20${sum} ${stat}${help}`,
    target: `${word}: ${String(prompt.tn)} or more makes it.`,
  };
}

/** A check has a difficulty; an attack's number is the target's Guard. */
export function neededLabel(roll: Pick<DiceRoll, "tn" | "result">): string {
  const isCheck = roll.result === "success" || roll.result === "failure";
  return isCheck ? checkTarget(roll.tn) : `Needed ${String(roll.tn)}`;
}

/** Which celebration the die throws when it lands. */
export function celebrationFor(roll: Pick<DiceRoll, "die" | "result">): Celebration {
  if (roll.die === 20) return "crit";
  if (roll.die === 1) return "fumble";
  return GOOD.has(roll.result) ? "success" : "miss";
}

/** "The party: 2 of 3 made it. Success!" */
export function groupLine(group: NonNullable<DiceRoll["group"]>): string {
  const verdict = group.result === "success" ? "The party makes it!" : "Not this time for the party.";
  return `${String(group.made)} of ${String(group.of)} made it. ${verdict}`;
}

/** The roll as a sentence, for speech and screen readers. */
export function spokenRoll(roll: DiceRoll, who: string, helperName: string | null): string {
  const help =
    roll.help === undefined ? "" : ` plus ${String(roll.help.value)} from ${helperName ?? "a friend"}`;
  const group = roll.group === undefined ? "" : ` ${groupLine(roll.group)}`;
  const buff =
    roll.buff === undefined
      ? ""
      : ` ${roll.buff.amount < 0 ? "minus" : "plus"} ${String(Math.abs(roll.buff.amount))} from ${roll.buff.label}`;
  return `${who} rolled ${String(roll.die)} plus ${String(roll.mod)}${help}${buff}, ${String(roll.total)}. ${outcomeWord(roll)}${group}`;
}

export function DiceOverlay(): ReactElement | null {
  const party = useParty();
  const [shown, setShown] = useState<ShownRoll | null>(null);
  /** The d20 is down (the helper's die may still be in the air). */
  const [landed, setLanded] = useState(false);
  /** Every die is down: the maths and the outcome can show. */
  const [settled, setSettled] = useState(false);
  const nextId = useRef(0);

  usePresentation(
    "ROLL",
    useCallback((event) => {
      if (event.kind !== "ROLL") return;
      nextId.current += 1;
      setLanded(false);
      setSettled(false);
      setShown({ id: nextId.current, roll: event.roll });
    }, []),
  );

  const shownId = shown?.id ?? null;
  const shownRoll = shown?.roll ?? null;
  useEffect(() => {
    if (shownId === null || shownRoll === null) return;
    const land = window.setTimeout(() => setLanded(true), ROLL_TUMBLE_MS);
    const settle = window.setTimeout(() => setSettled(true), rollRevealMs(shownRoll));
    const clear = window.setTimeout(() => setShown(null), rollCardMs(shownRoll));
    return () => {
      window.clearTimeout(land);
      window.clearTimeout(settle);
      window.clearTimeout(clear);
    };
  }, [shownId, shownRoll]);

  /*
   * The faces that go past on the way. A die that is blank until it lands
   * looks like a loading spinner; a die with numbers flicking over it looks
   * like a die. It stops the instant `settled` flips, and the last thing it is
   * asked to draw is the real number, never a scrambled one.
   */
  const [face, setFace] = useState(1);
  const [helpFace, setHelpFace] = useState(1);
  const helpSides = shownRoll?.help?.sides ?? null;
  useEffect(() => {
    // Keyed on `settled` too: without it the interval re-rendered the card,
    // portrait and all, every 80ms for as long as it stayed up.
    if (shownId === null || settled || prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      setFace((previous) => nextFace(previous, Math.random()));
      if (helpSides !== null) setHelpFace((previous) => nextFace(previous, Math.random(), helpSides));
    }, SCRAMBLE_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [shownId, helpSides, settled]);

  const roll = shown?.roll ?? null;
  const good = roll === null ? false : GOOD.has(roll.result);
  const roller = roll === null ? null : party.find((m) => m.character.id === roll.characterId) ?? null;
  const helper =
    roll?.help === undefined ? null : party.find((m) => m.character.id === roll.help?.characterId) ?? null;

  // Spoken once, when the number is readable — same moment the table reacts.
  const spokenFor = useRef<number | null>(null);
  useEffect(() => {
    if (roll === null || !settled || shownId === null || spokenFor.current === shownId) return;
    spokenFor.current = shownId;
    speak(spokenRoll(roll, roller?.character.name ?? "", helper?.character.name ?? null));
    // A natural 1 gets its bonk, on the beat the die topples over.
    if (roll.die === 1) cue("bonk");
  }, [roll, settled, shownId, roller, helper]);

  if (roll === null) return null;

  const modLabel = `${roll.mod >= 0 ? "+" : "−"}${String(Math.abs(roll.mod))}`;
  const celebration = celebrationFor(roll);

  return (
    <div className={`dice${settled ? " dice--settled" : ""}`} role="status" aria-live="assertive">
      <div className={`dice__card${settled ? " dice__card--settled" : ""}`}>
        <p className="dice__who">
          {/* Whose roll it is, in the middle of the room, at a glance — the
              name is right there but the picture is what carries across a
              sofa. */}
          {roller === null ? null : (
            <CharacterPortrait
              backdrop
              species={roller.character.species}
              accent={roller.character.appearance.accent}
              tier={roller.character.tier}
              characterClass={roller.character.class}
              className="dice__roller"
            />
          )}
          <span>
            {roller?.character.name ?? "Someone"}
            {roll.stat === undefined ? "" : " rolls"}
          </span>
          {roll.stat === undefined ? null : (
            <span className="dice__stat">
              <Icon name={roll.stat} />
              <span>{roll.stat}</span>
            </span>
          )}
        </p>

        {/*
         * The stage does not rotate; the die inside it does. A shadow parented
         * to the die would tumble with it, which is the one thing a shadow may
         * never do.
         */}
        <div
          className={`dice__stage${settled ? " dice__stage--settled" : ""}${settled && good ? " dice__stage--good" : ""}`}
          aria-hidden="true"
        >
          <div
            className={`dice__die${settled ? ` dice__die--settled dice__die--${celebration}` : ""}`}
          >
            <Icon name="d20_solid" size="100%" className="dice__die-art" />
            <span
              className={`dice__die-number${settled ? "" : " dice__die-number--rolling"}`}
            >
              {landed ? roll.die : face}
            </span>
          </div>
          <span className="dice__shadow" />
          {settled && !prefersReducedMotion() ? (
            <DiceCelebration key={shownId} kind={celebration} seed={shownId ?? 0} />
          ) : null}
        </div>

        {/* A friend's die, thrown once the d20 is down so each lands on its own beat. */}
        {roll.help === undefined ? null : (
          <div className={`dice__help${landed ? " dice__help--thrown" : ""}`} aria-hidden="true">
            <span className="dice__help-who">
              {helper?.character.name ?? "A friend"} helps: d{roll.help.sides}
            </span>
            <span className={`dice__help-die${settled ? " dice__help-die--settled" : ""}`}>
              <span className={settled ? undefined : "dice__die-number--rolling"}>
                {settled ? roll.help.value : helpFace}
              </span>
            </span>
          </div>
        )}

        <p className="dice__maths" aria-hidden="true">
          <span className="dice__term">{roll.die}</span>
          <span className="dice__op">{modLabel}</span>
          {roll.help === undefined ? null : (
            <span className="dice__op">+{roll.help.value}</span>
          )}
          {/* A story-check buff (#222): a flat amount, so the sum still adds up. */}
          {roll.buff === undefined ? null : (
            <span className="dice__op">
              {roll.buff.amount < 0 ? "−" : "+"}
              {Math.abs(roll.buff.amount)}
            </span>
          )}
          <span className="dice__op">=</span>
          <span className="dice__total">{roll.total}</span>
        </p>

        <p className="dice__tn" aria-hidden="true">
          <Icon name="guard" />
          <span>{neededLabel(roll)}</span>
        </p>

        {/* The last roll of a whole-party check also says how the party did. */}
        {roll.group === undefined ? null : (
          <p className="dice__group" aria-hidden="true">
            <Icon name="players" />
            <span>{groupLine(roll.group)}</span>
          </p>
        )}

        {/* Outcome is a word plus a shape, never a colour on its own (spec §11). */}
        <div className={`dice__verdict dice__verdict--${celebration}`}>
          <p className="dice__headline">
            <Icon name={good ? "check" : "close"} className="dice__headline-icon" />
            <span>{outcomeWord(roll)}</span>
          </p>
        </div>

        <ScreenReaderOnly>
          {`${spokenRoll(roll, roller?.character.name ?? "Someone", helper?.character.name ?? null)} ${neededLabel(roll)}.`}
        </ScreenReaderOnly>
      </div>
    </div>
  );
}
