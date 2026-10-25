/**
 * The fight so far, on the shared screen: the last few beats, big enough to
 * read from the sofa, every roll with the number it needed and why.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TV, AND NOT THE PHONE
 *
 * A playtest asked for it in as many words: the fight's story belongs where
 * the whole table is looking, and a phone is for the turn in your hand. The
 * board's floating numbers say *that* something happened, for a second, over
 * whoever it happened to; nobody could see *why* a 12 missed. So each swing
 * here is one line with its working: who swung, the d20 and what was added,
 * the total against the Guard it had to reach, and how hard it landed
 * ("Graze! 2", "Solid hit! 3", "Critical! 5" — the tier rides the roll,
 * `damageTier` in shared's encounter.ts). Under it, the why in a kid's words:
 * "Needs 13: Bramblewisp 1's Guard". The phone keeps one line of its own
 * (CombatPanel `LastBeat`) and gives its rows back to the board.
 *
 * ---------------------------------------------------------------------------
 * A RUNNING LOG, NOT A CAPTION
 *
 * A round's beats arrive on a COMBAT_SEQUENCE (or the opening ENCOUNTER_BEGAN)
 * while the board plays them. Unlike the rift caption, which replaces itself,
 * these accumulate across sequences for the fight, newest at the bottom, and
 * only the last `FIGHT_LOG_LINES` are drawn: a kid who looked away for a turn
 * can still see what the monsters did to them. A new fight starts it empty.
 * The words are fight-log.ts's, the same the phone says, with names only:
 * the shared screen is nobody's own, so nobody is "You".
 *
 * The place's own beats (a hazard, the clock) are left to RiftStatus, which
 * already says them up in its corner.
 *
 * ---------------------------------------------------------------------------
 * BESIDE THE BOARD, NOT OVER IT
 *
 * On a wide pane the log is a column down the right, and it says how wide
 * (world/stage-inset.ts `setBoardInsetEnd`) so the fight camera frames the
 * board to its left: drawn over the board, it hid the last columns, where
 * monsters start. Whether it is a column is the stylesheet's call, read off
 * `--fight-log-beside` rather than a width guessed here; a phone's world pane
 * makes it a small corner and it reports nothing.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import type { EncounterEvent } from "@kad/shared";
import { speak } from "@kad/shared";
import { useCampaign, usePresentation, useRules, useRunState } from "../store";
import { Icon } from "./icons";
import { setBoardInsetEnd } from "../world/stage-inset";
import { describeBeats, hurtWords, needsLine, statName, verdictWord, type Beat, type Swing } from "./fight-log";
import { calloutsOf, fightChips, spokenCallouts } from "./matchup-copy";
import "./FightLog.css";

/** How many lines the TV shows: the last few beats, never a wall of text. */
export const FIGHT_LOG_LINES = 4;



/** How long the opening chips stay up, in ms. Short: they are a reminder, the field guide teaches. */
export const FIGHT_CHIPS_MS = 20000;

/** What a kid needs to know about Guard, said once under the log. */
export const GUARD_WORDS = "Guard is how hard someone is to hit. Roll that much or more to hit them.";

/** The last `limit` lines of the fight's beats, oldest first. Pure, so the TV's wording can be asserted. */
export function fightLogLines(
  batches: readonly { readonly seq: number; readonly events: readonly EncounterEvent[] }[],
  encounter: Parameters<typeof describeBeats>[1],
  limit: number = FIGHT_LOG_LINES,
): Beat[] {
  const lines = batches.flatMap((batch) => describeBeats(batch.events, encounter, null, batch.seq));
  return lines.filter((line) => !line.environment).slice(-limit);
}

/**
 * The batches the log still needs: the newest ones that between them hold the
 * last `limit` lines, and none that draw no line. Counted in lines, not
 * batches, because a batch can say nothing at all (a step, a wall going up, a
 * place's own beat the log leaves out): a cap of four batches let four steps
 * push every swing out and put "The fight is on!" back mid-fight, and keeping
 * the silent ones let a long walk grow the log's state for nothing.
 */
export function batchesForLines<B extends { readonly seq: number; readonly events: readonly EncounterEvent[] }>(
  batches: readonly B[],
  encounter: Parameters<typeof describeBeats>[1],
  limit: number = FIGHT_LOG_LINES,
): B[] {
  const kept: B[] = [];
  let lines = 0;
  for (let at = batches.length - 1; at >= 0 && lines < limit; at -= 1) {
    const batch = batches[at]!;
    const said = describeBeats(batch.events, encounter, null, batch.seq).filter((line) => !line.environment).length;
    if (said === 0) continue;
    kept.unshift(batch);
    lines += said;
  }
  return kept;
}

export function FightLog(): ReactElement | null {
  const encounter = useRunState()?.encounter ?? null;
  const [batches, setBatches] = useState<{ seq: number; events: readonly EncounterEvent[] }[]>([]);

  const take = (events: readonly EncounterEvent[] | undefined, seq: number): void => {
    if (!events || events.length === 0) return;
    // A matchup said out loud for read-aloud, once per batch; silent when read-aloud is off.
    const said = spokenCallouts(
      calloutsOf(events.flatMap((event) => (event.type === "matchup" ? [event] : []))),
    );
    if (said) speak(said, { source: "narration" });
    setBatches((kept) => [...kept, { seq, events }]);
  };
  usePresentation("COMBAT_SEQUENCE", (presentation, event) => take(presentation.events, event.seq));
  usePresentation("ENCOUNTER_BEGAN", (presentation, event) => take(presentation.events, event.seq));

  /*
   * A fight that ends takes its log with it, and so does one replaced by
   * another. A fight *arriving* clears nothing: its opening monster round
   * rides ENCOUNTER_BEGAN, which lands before the patch that puts the fight
   * in state (the phone's log has the same rule, CombatPanel `useBeats`).
   */
  const fightId = encounter?.startedAt ?? null;
  const previousFight = useRef(fightId);
  useEffect(() => {
    if (previousFight.current !== null && previousFight.current !== fightId) setBatches([]);
    previousFight.current = fightId;
  }, [fightId]);

  // Let go of the batches no line on screen comes from. Counted against the fight in state,
  // so not before it arrives: the opening round can land first (see above).
  useEffect(() => {
    if (encounter === null) return;
    const needed = batchesForLines(batches, encounter);
    if (needed.length < batches.length) setBatches(needed);
  }, [batches, encounter]);

  const box = useRef<HTMLElement | null>(null);
  const shown = encounter !== null;
  useLayoutEffect(() => {
    const element = box.current;
    if (!shown || element === null) {
      setBoardInsetEnd(0);
      return;
    }
    const report = (): void => {
      const pane = element.offsetParent ?? element.parentElement;
      const beside = getComputedStyle(element).getPropertyValue("--fight-log-beside").trim() === "1";
      if (!beside || !pane) {
        setBoardInsetEnd(0);
        return;
      }
      const gap = parseFloat(getComputedStyle(element).fontSize) * 0.5 || 0;
      setBoardInsetEnd(pane.getBoundingClientRect().right - element.getBoundingClientRect().left + gap);
    };
    report();
    if (typeof ResizeObserver === "undefined") return () => setBoardInsetEnd(0);
    const observer = new ResizeObserver(report);
    observer.observe(element);
    const pane = element.parentElement;
    if (pane) observer.observe(pane);
    return () => {
      observer.disconnect();
      setBoardInsetEnd(0);
    };
  }, [shown]);

  const chips = useFightChips(encounter);
  if (!encounter) return null;
  const lines = fightLogLines(batches, encounter);

  return (
    <aside className="fight-log" aria-label="The fight so far" ref={box}>
      {chips.length > 0 ? (
        <ul className="fight-log__chips" aria-label="Worth knowing in this fight">
          {chips.map((chip) => (
            <li key={chip.id} className="fight-log__chip">
              <Icon name={chip.icon ?? "star"} />
              <span>{chip.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ol className="fight-log__lines" aria-live="polite">
        {lines.length === 0 ? <li className="fight-log__line fight-log__line--quiet">The fight is on!</li> : null}
        {lines.map((line) => (
          <li key={line.key} className={`fight-log__line fight-log__line--${line.tone}`}>
            {line.swing ? <SwingLine swing={line.swing} /> : <span>{line.text}</span>}
          </li>
        ))}
      </ol>
      <p className="fight-log__guard">
        <Icon name="guard" />
        <span>{GUARD_WORDS}</span>
      </p>
    </aside>
  );
}

/**
 * The fight's opening hints (up to three), for a while after it starts, in
 * the log's own column so they sit beside the board and never over it, and
 * nothing to tap (docs/tv-read-only-audit.md). They fold away on their own and
 * never come back mid-fight; no chips at all when matchups are off.
 */
function useFightChips(encounter: Parameters<typeof fightChips>[2] | null): ReturnType<typeof fightChips> {
  const rules = useRules();
  const campaign = useCampaign();
  const fightId = encounter?.startedAt ?? null;
  const [goneFor, setGoneFor] = useState<number | null>(null);
  useEffect(() => {
    if (fightId === null) return;
    const timer = setTimeout(() => setGoneFor(fightId), FIGHT_CHIPS_MS);
    return () => clearTimeout(timer);
  }, [fightId]);
  const [held, setHeld] = useState<{ fight: number; chips: ReturnType<typeof fightChips> } | null>(null);
  // Worked out once, when the fight arrives: the hints are about the fight's start.
  useEffect(() => {
    if (!encounter || fightId === null || held?.fight === fightId) return;
    setHeld({ fight: fightId, chips: fightChips(rules, campaign?.id, encounter) });
  }, [encounter, fightId, held, rules, campaign]);
  if (fightId === null || held?.fight !== fightId || goneFor === fightId) return [];
  return held.chips;
}

/**
 * One swing, drawn as its working: "Skyclaw [14] + 2 Might = 16 vs Guard 13
 * → Solid hit! 3", and under it what it needed and what it left.
 */
function SwingLine({ swing }: { swing: Swing }): ReactElement {
  const { roll } = swing;
  const hit = roll.result === "hit" || roll.result === "success";
  const stat = statName(roll);
  // The hearts it took ride the verdict ("Graze! 2"); a ward that shaved it
  // to nothing leaves the word alone.
  const amount = hit && swing.hurt ? ` ${swing.hurt.amount}` : "";
  const after = hit && swing.hurt ? ` ${hurtWords(swing.hurt)}` : "";
  return (
    <>
      <span className="fight-log__swing">
        <b className="fight-log__who">{swing.who}</b>
        <span className="fight-log__die" aria-label={`rolled ${roll.die}`}>
          <Icon name="d20" />
          {roll.die}
        </span>
        {roll.mod !== 0 ? (
          <span>
            {roll.mod < 0 ? "-" : "+"} {Math.abs(roll.mod)}
            {stat ? <span className="fight-log__stat"> {stat}</span> : null}
          </span>
        ) : null}
        {roll.matchup && roll.matchup.amount !== 0 ? (
          <span>
            {roll.matchup.amount < 0 ? "-" : "+"} {Math.abs(roll.matchup.amount)}
            <span className="fight-log__stat"> matchup</span>
          </span>
        ) : null}
        <span className="fight-log__total">= {roll.total}</span>
        <span className="fight-log__vs">vs Guard {roll.tn}</span>
        <span className="fight-log__arrow" aria-hidden="true">→</span>
        <span className={`fight-log__verdict fight-log__verdict--${swing.tier ?? (hit ? "solid" : "miss")}`}>
          {verdictWord(swing)}
          {amount}
        </span>
      </span>
      <span className="fight-log__why">
        {needsLine(swing)}.{after}
      </span>
      {swing.matchups?.map((callout) => (
        <span key={callout.id} className={`fight-log__matchup fight-log__matchup--${callout.sign}`}>
          <Icon name={callout.icon} />
          <span>{callout.line}</span>
        </span>
      ))}
    </>
  );
}
