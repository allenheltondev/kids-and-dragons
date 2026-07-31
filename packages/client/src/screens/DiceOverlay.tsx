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

        <div className={`dice__die${settled ? " dice__die--settled" : ""}`} aria-hidden="true">
          <Icon name="d20" size="100%" className="dice__die-art" />
          <span className="dice__die-number">{settled ? roll.die : ""}</span>
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
