/**
 * The board renderer's pure arithmetic, apart from board.ts so it can be
 * tested without importing pixi.js (vitest runs in node; a WebGL renderer
 * does not). board.ts re-exports these — callers never notice the split.
 */

/** asset-brief §4.5 — the tile sheets are authored at this size. */
export const BOARD_TILE_PX = 128;

/**
 * Which of the sheet's four variants dresses tile (x, y). Deterministic on
 * purpose: this renders on every phone and the TV at once, and a floor that
 * shuffles per device (or per render) reads as a glitch, not texture.
 */
export function tileVariant(x: number, y: number): number {
  return Math.abs(x * 7 + y * 13 + x * y * 3) % 4;
}

/**
 * How far apart to space a sequence's beats so they fill — and never outrun —
 * the presentation hold the gate is enforcing (world/presentation.ts). A beat
 * scheduled past the hold would play after its own patch, which is the exact
 * bug the shared timing table exists to prevent; the `+ 1` keeps the last
 * beat strictly inside the hold.
 */
export function beatOffsetsMs(eventCount: number, totalMs: number): number[] {
  if (eventCount <= 0) return [];
  const step = Math.min(400, totalMs / (eventCount + 1));
  return Array.from({ length: eventCount }, (_, i) => step * (i + 1));
}

/**
 * Which rig clip a combat beat plays, and on whom.
 *
 * The rig contract (assets/manifest.json → rigContract) names nine triggers;
 * a `COMBAT_SEQUENCE` carries beats. This is the whole mapping between them,
 * pure and here rather than inside the renderer so the table can be asserted
 * instead of watched.
 *
 * The rule it follows: **fire a clip only on a figure the beat actually
 * names.** Every mapping below reads a subject straight off its event, which
 * is why there is no case that has to guess. The beats with no clip are as
 * deliberate as the ones with one, and the reasons differ:
 *
 *   - `moved` / `shoved` are motion, and motion is driven from the slide
 *     itself (board.ts) — a `walk` is one 4-tick cycle and a move can cross
 *     six tiles, so the clip is re-triggered while the figure travels rather
 *     than fired once and left to end early.
 *   - `heal`, `bonus`, `down`, `revived` change state the patch already
 *     carries; `knockedDown` drives the fall and the get-up as a boolean, not
 *     as a trigger.
 *   - `dazed`, `rooted`, `encore`, `walled` are conditions and terrain, not
 *     motions. No clip in the contract means any of them, and inventing one
 *     would make the rig and the board disagree about what a clip is.
 *   - `warded` is the interesting one: Unbreakable covers the caster *and*
 *     every ally beside them, and `guard` is a **hold** — it stays on its last
 *     pose until the next trigger. Firing it at four figures would freeze the
 *     party mid-brace until each of them happened to act. Brace (`protected`)
 *     is one figure choosing to plant themselves, which is exactly what the
 *     hold is for, so that one does fire.
 */
export function clipForBeat(
  event: { readonly type: string } & Record<string, unknown>,
): { readonly actorId: string; readonly trigger: string } | null {
  switch (event.type) {
    case "damage":
      // The victim flinches.
      return { actorId: event["actorId"] as string, trigger: "hurt" };
    case "roll":
      /*
       * The swing. A `roll` is emitted by exactly one effect verb — `attack`
       * (encounter.ts: nothing else calls `resolveAttack`) — so a roll beat
       * *is* somebody taking a swing, and the roller is named on the roll.
       */
      return {
        actorId: (event["roll"] as { characterId: string }).characterId,
        trigger: "attack",
      };
    case "evaded":
      // A miss is still an attack. Vanish resolves before any die is thrown,
      // so this is the only beat that names the attacker.
      return { actorId: event["byId"] as string, trigger: "attack" };
    case "protected":
      // Brace — the event names the protector, the figure that acts.
      return { actorId: event["byId"] as string, trigger: "guard" };
    default:
      return null;
  }
}
