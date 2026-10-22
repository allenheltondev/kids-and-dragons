/**
 * Reading an `IntentPreview` off the wire (protocol.ts).
 *
 * Both ends read with this: the server before it relays a preview to the
 * room, and the TV before it draws one. A preview is never applied to
 * anything, so this checks *shape* only, never legality. A malformed one is
 * dropped rather than half-drawn, and the bounds keep one phone from putting
 * an arbitrarily large message on everyone else's channel.
 */

import type { ClientIntent, IntentPreview } from "./types/protocol.js";
import type { RunState } from "./types/state.js";
import { currentActorId } from "./encounter.js";

const MAX_ID = 64;
/** Generous next to any real ability: Storm of Blades aims at two. */
const MAX_PICKS = 8;

type Position = { x: number; y: number };

function id(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID;
}

function position(value: unknown): Position | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if ((x as number) < 0 || (y as number) < 0 || (x as number) > 99 || (y as number) > 99) return null;
  return { x: x as number, y: y as number };
}

function list<T>(value: unknown, read: (item: unknown) => T | null): T[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PICKS) return null;
  const out: T[] = [];
  for (const item of value) {
    const read1 = read(item);
    if (read1 === null) return null;
    out.push(read1);
  }
  return out;
}

/**
 * The preview `raw` describes, `null` for an explicit "nothing picked", or
 * `undefined` when it is not a preview at all.
 */
export function readIntentPreview(raw: unknown): IntentPreview | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  switch (value.kind) {
    case "choice":
      return id(value.choiceId) ? { kind: "choice", choiceId: value.choiceId } : undefined;
    case "move": {
      const to = position(value.to);
      return to ? { kind: "move", to } : undefined;
    }
    case "action": {
      if (!id(value.abilityId)) return undefined;
      const targetIds = list(value.targetIds, (item) => (id(item) ? item : null));
      const tiles = list(value.tiles, position);
      if (targetIds === null || tiles === null) return undefined;
      return {
        kind: "action",
        abilityId: value.abilityId,
        ...(targetIds.length > 0 ? { targetIds } : {}),
        ...(tiles.length > 0 ? { tiles } : {}),
      };
    }
    case "item":
      if (!id(value.itemId)) return undefined;
      if (value.targetId !== undefined && !id(value.targetId)) return undefined;
      return {
        kind: "item",
        itemId: value.itemId,
        ...(value.targetId !== undefined ? { targetId: value.targetId as string } : {}),
      };
    case "end_turn":
      return { kind: "end_turn" };
    default:
      return undefined;
  }
}

/**
 * Which decision a preview belongs to: one combat turn *as it stands* (a step
 * or the action moves it on), or one story question. Null when nothing on the
 * table can be previewed.
 *
 * Previews bypass the ordered state stream, so a late one — or one whose
 * clearing `null` was lost with a dropped phone — can outlive its moment. The
 * phone stamps every preview with the context it was made in, the server
 * refuses one that no longer matches its state, and the TV draws one only
 * while it matches the state on screen. Nothing else has to be cleaned up.
 *
 * - A fight: which fight (`startedAt`, since two fights can repeat every turn
 *   field), then the turn key the phone's own selection resets on (whose turn,
 *   round, slot, steps left, action spent), so a preview from before a
 *   confirmed move or action is already stale.
 * - A story question: the chapter, how many scenes it has entered (which
 *   moves on a revisit of the same scene, where option ids repeat), the
 *   scene, and the story turn marker (which moves on every resolved choice).
 */
export function previewContext(state: RunState | null): string | null {
  if (!state) return null;
  const encounter = state.encounter ?? null;
  if (encounter) {
    return [
      "fight",
      encounter.startedAt ?? "-",
      currentActorId(encounter) ?? "nobody",
      encounter.round,
      encounter.turnIndex,
      encounter.stepsLeft,
      encounter.actionTaken,
    ].join(":");
  }
  const prompt = state.prompt;
  if (prompt === null || prompt.kind !== "choice") return null;
  return [
    "choice",
    state.chapterId ?? "-",
    state.visited?.length ?? 0,
    prompt.sceneId,
    state.storyTurn ?? 0,
  ].join(":");
}

/**
 * The intents that answer the question on the table (#413): a story choice
 * or vote, a roll, help on a roll, going on from a scene, and a fight turn's
 * moves. A tap like that means something only against the question it was
 * made on. The phone stamps it with `decisionContext`, and the server refuses
 * it once that question is gone, so a tap made on a stale screen (a phone
 * that was away) can never land on the next question that happens to share
 * a choice id like "onward".
 *
 * Not the lobby, creation or journey intents: those name what they are about
 * (`visit`, `classId`) or are the same answer whenever they land.
 */
export const DECISION_INTENTS: ReadonlySet<ClientIntent["type"]> = new Set<ClientIntent["type"]>([
  "CHOOSE",
  "ROLL",
  "HELP",
  "ADVANCE",
  "MOVE",
  "COMBAT_ACTION",
  "END_TURN",
]);

/**
 * Which question a decision intent answers, read off the state it was made on.
 *
 * - A fight: which fight, whose turn, which round and slot. Coarser than
 *   `previewContext` on purpose: within one turn only its own hero acts, and
 *   a step it just took must not make its next step look stale.
 * - Anything else: the phase, the chapter, how many scenes it has entered (a
 *   revisit of the same scene is a new question), the scene, what kind of
 *   question is open, and the story turn marker (which moves on every
 *   resolved choice but not on a friend's vote).
 *
 * A friend's vote, help or step leaves it as it was, so the ordinary "a
 * friend tapped first" retry still goes through.
 */
export function decisionContext(state: RunState): string {
  const encounter = state.encounter ?? null;
  if (encounter) {
    return [
      "fight",
      encounter.startedAt ?? "-",
      currentActorId(encounter) ?? "nobody",
      encounter.round,
      encounter.turnIndex,
    ].join(":");
  }
  return [
    "story",
    state.phase,
    state.chapterId ?? "-",
    state.visited?.length ?? 0,
    state.sceneId ?? "-",
    state.prompt?.kind ?? "-",
    state.storyTurn ?? 0,
  ].join(":");
}
