/**
 * Reading an `IntentPreview` off the wire (protocol.ts).
 *
 * Both ends read with this: the server before it relays a preview to the
 * room, and the TV before it draws one. A preview is never applied to
 * anything, so this checks *shape* only, never legality. A malformed one is
 * dropped rather than half-drawn, and the bounds keep one phone from putting
 * an arbitrarily large message on everyone else's channel.
 */

import type { IntentPreview } from "./types/protocol.js";

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
