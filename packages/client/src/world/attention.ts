/**
 * Who the camera should be looking at — roadmap chapter 8's "camera work",
 * the third of that line after the shake and the scene steps.
 *
 * ---------------------------------------------------------------------------
 * THE GAP THIS CLOSES
 *
 * The combat camera frames the *active actor* and nothing else (scene.ts,
 * `boardFocus`). That is right for a turn: it is her turn, the reachable tiles
 * are hers, the question on her phone is about where she stands. It is wrong
 * for a *beat*. A round is a sequence of events the board plays out over the
 * hold — a wisp crosses the board and hits somebody, a hero is knocked down,
 * a shove throws a figure two tiles — and the subject of a beat is very often
 * not the actor whose turn it is.
 *
 * `FOCUS_MARGIN_TILES` is 3 (camera.ts), so the auto-frame is a 7 × 7 window
 * on a 10 × 8 board. On a TV the clamp opens that to the whole board and none
 * of this matters. On a phone pane it genuinely does not: a hit landing five
 * tiles from the active actor pops its damage number outside the frame, and
 * the one thing the table needed to see is the one thing that happened off
 * screen.
 *
 * So: for as long as a beat is playing, whoever that beat is *about* is held
 * on screen alongside the actor whose turn it is. `setFocus` already takes a
 * list and the frame grows to hold all of it, so this is a matter of saying
 * who — not of moving a camera.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LETS GO
 *
 * Every hold expires. A camera that accumulated everyone a round touched would
 * end up framing the whole board, which is the unreadable thing `camera.ts`
 * exists to avoid — and the *next* round would start with the frame still
 * pulled wide for figures nothing is happening to. So a hold covers its own
 * beat plus a short tail, and the frame closes back onto the active actor.
 *
 * It also never overrides a pinch or a pan. This produces focus *tiles*, and
 * `resolveCamera` ignores focus entirely while a manual override is live
 * (camera.ts's rules on what releases one apply verbatim) — somebody looking
 * at a corner of the board keeps looking at it.
 */

import type { EncounterEvent } from "@kad/shared";
import { beatOffsetsMs } from "./board-math";

/**
 * How long past its beat a hold lasts.
 *
 * Long enough that the damage number it was framing is still on screen (the
 * board spaces beats up to 400ms apart), short enough that a round does not
 * end with the camera parked on the last thing that was hit.
 */
export const FOCUS_HOLD_MS = 700;

/** Who a beat is about — everybody it names, in the order it names them. */
export function beatSubjects(event: EncounterEvent): string[] {
  switch (event.type) {
    // A miss and a Brace name two figures: the one acted upon and the one
    // acting. Both belong on screen — a Vanish that framed only the dodger
    // would show a figure stepping aside from nothing.
    case "evaded":
    case "protected":
      return [event.actorId, event.byId];
    case "damage":
    case "heal":
    case "down":
    case "revived":
    case "moved":
    case "shoved":
    case "bonus":
    case "dazed":
    case "warded":
    case "rooted":
    case "encore":
      return [event.actorId];
    /*
     * A roll names its roller through the die rather than an `actorId`, and
     * the *swing* is already framed by the damage or evade beat beside it —
     * so this adds nothing and stays out of the way. `walled` names a tile
     * and no figure at all.
     */
    default:
      return [];
  }
}

export interface FocusHold {
  /** Milliseconds from the sequence's start. */
  atMs: number;
  /** When the hold lapses, same clock. */
  untilMs: number;
  actorIds: string[];
}

/**
 * The holds a round asks for, on the same `beatOffsetsMs` clock the board
 * paces its damage numbers with and the shake schedules its jolts on. Three
 * things reading one table is what keeps the flinch, the number and the frame
 * describing the same moment.
 */
export function focusHolds(events: readonly EncounterEvent[], totalMs: number): FocusHold[] {
  const offsets = beatOffsetsMs(events.length, totalMs);
  const holds: FocusHold[] = [];
  events.forEach((event, index) => {
    const actorIds = beatSubjects(event);
    if (actorIds.length === 0) return;
    const atMs = offsets[index] ?? 0;
    holds.push({ atMs, untilMs: atMs + FOCUS_HOLD_MS, actorIds });
  });
  return holds;
}
