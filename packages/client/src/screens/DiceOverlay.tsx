/**
 * DiceOverlay — the d20, and the centrepiece of the screen (roadmap ch.3).
 *
 * Driven by the ROLL *presentation* event, never by polling `state.lastRoll`:
 * the protocol splits state from spectacle precisely so animation timing never
 * blocks game logic (architecture §4.2), and a client that reconnects mid-roll
 * must not replay an animation for a roll that already happened.
 *
 * Timing: ~1.5s total. Slow enough that an 8-year-old watches it land, short
 * enough that three of them do not get bored (spec §4.1 — one roll type, one
 * die, one big animation, learned in five minutes).
 *
 * Three clocks have to stay in step, and they live in three files on purpose:
 *
 *   - `PRESENTATION_MS.ROLL` (world/presentation.ts, 1500ms) — how long the
 *     *patch* is held. The die must land before anyone's HP moves.
 *   - `TUMBLE_MS` + `HOLD_MS` here (1000 + 800) — how long the card is up.
 *     Deliberately outlasts the gate: the world updating behind a card that is
 *     already fading is fine; a card cut off mid-number is not.
 *   - `ROLL_HOLD_MS` (layout/TravelLayout.tsx, 2000ms) — how long a phone
 *     gives the world pane the whole screen for.
 *
 * The face the die *shows* is never the source of the number. The server rolls
 * (architecture §4.2); the scramble below is theatre played toward a result
 * that was decided before this component heard about it, which is also why a
 * client reconnecting mid-roll replays nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { speak } from "@kad/shared";
import type { DiceRoll } from "@kad/shared";
import { useParty, usePresentation } from "../store";
import { ScreenReaderOnly } from "../ui/ScreenReaderOnly";
import { CharacterPortrait } from "./CharacterPortrait";
import { Icon } from "./icons";
import "./shared.css";
import "./DiceOverlay.css";

/** The die tumbles, then the number is readable, then it goes away. */
const TUMBLE_MS = 1000;
const HOLD_MS = 800;
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
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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

export function DiceOverlay(): ReactElement | null {
  const party = useParty();
  const [shown, setShown] = useState<ShownRoll | null>(null);
  const [settled, setSettled] = useState(false);
  const nextId = useRef(0);

  usePresentation(
    "ROLL",
    useCallback((event) => {
      if (event.kind !== "ROLL") return;
      nextId.current += 1;
      setSettled(false);
      setShown({ id: nextId.current, roll: event.roll });
    }, []),
  );

  const shownId = shown?.id ?? null;
  useEffect(() => {
    if (shownId === null) return;
    const land = window.setTimeout(() => setSettled(true), TUMBLE_MS);
    const clear = window.setTimeout(() => setShown(null), TUMBLE_MS + HOLD_MS);
    return () => {
      window.clearTimeout(land);
      window.clearTimeout(clear);
    };
  }, [shownId]);

  /*
   * The faces that go past on the way. A die that is blank until it lands
   * looks like a loading spinner; a die with numbers flicking over it looks
   * like a die. It stops the instant `settled` flips, and the last thing it is
   * asked to draw is the real number, never a scrambled one.
   */
  const [face, setFace] = useState(1);
  useEffect(() => {
    if (shownId === null || prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      setFace((previous) => nextFace(previous, Math.random()));
    }, SCRAMBLE_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [shownId]);

  const roll = shown?.roll ?? null;
  const good = roll === null ? false : GOOD.has(roll.result);
  const roller = roll === null ? null : party.find((m) => m.character.id === roll.characterId) ?? null;

  // Spoken once, when the number is readable — same moment the table reacts.
  const spokenFor = useRef<number | null>(null);
  useEffect(() => {
    if (roll === null || !settled || shownId === null || spokenFor.current === shownId) return;
    spokenFor.current = shownId;
    const who = roller?.character.name ?? "";
    speak(
      `${who} rolled ${String(roll.die)} plus ${String(roll.mod)}, ${String(roll.total)}. ${OUTCOME_WORD[roll.result]}`,
    );
  }, [roll, settled, shownId, roller]);

  if (roll === null) return null;

  const modLabel = `${roll.mod >= 0 ? "+" : "−"}${String(Math.abs(roll.mod))}`;

  return (
    <div className="dice" role="status" aria-live="assertive">
      <div className={`dice__card${settled ? " dice__card--settled" : ""}`}>
        <p className="dice__who">
          {/* Whose roll it is, in the middle of the room, at a glance — the
              name is right there but the picture is what carries across a
              sofa. */}
          {roller === null ? null : (
            <CharacterPortrait
              species={roller.character.species}
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
          <div className={`dice__die${settled ? " dice__die--settled" : ""}`}>
            <Icon name="d20_solid" size="100%" className="dice__die-art" />
            <span
              className={`dice__die-number${settled ? "" : " dice__die-number--rolling"}`}
            >
              {settled ? roll.die : face}
            </span>
          </div>
          <span className="dice__shadow" />
        </div>

        <p className="dice__maths" aria-hidden="true">
          <span className="dice__term">{roll.die}</span>
          <span className="dice__op">{modLabel}</span>
          <span className="dice__op">=</span>
          <span className="dice__total">{roll.total}</span>
        </p>

        <p className="dice__tn" aria-hidden="true">
          <Icon name="guard" />
          <span>Needed {roll.tn}</span>
        </p>

        {/* Outcome is a word plus a shape, never a colour on its own (spec §11). */}
        <p className={`dice__outcome${good ? " dice__outcome--good" : " dice__outcome--bad"}`}>
          <Icon name={good ? "check" : "close"} />
          <span>{OUTCOME_WORD[roll.result]}</span>
        </p>

        <ScreenReaderOnly>
          {`Rolled ${String(roll.die)} plus ${String(roll.mod)} equals ${String(roll.total)}, needed ${String(roll.tn)}. ${OUTCOME_WORD[roll.result]}`}
        </ScreenReaderOnly>
      </div>
    </div>
  );
}
