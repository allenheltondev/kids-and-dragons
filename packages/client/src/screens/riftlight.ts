/**
 * Riftlight (#229) - what a rift looks like, and to whom. Pure, without a DOM,
 * so the rule that decides who sees colour can be tested on its own.
 *
 * ---------------------------------------------------------------------------
 * THE ONE PRIVATE THING ON ANY SCREEN
 *
 * spec.md "No private information channel" has one owner-approved exception:
 * a Starweaver's phone alone shows a rift's Riftlight colours
 * (docs/campaigns/continental-rift/mechanics.md, "Who sees the colors").
 * Everyone else - the TV in every mode, and every other phone - sees the
 * neutral shimmer (`rift_neutral`) and words that say only "a rift is here".
 *
 * The journey view that carries a rift's properties goes to every screen in
 * the room alike (one room channel; the server has no per-phone view), so
 * this is where the line is drawn: `seesRiftlight` is the only way to the
 * colours, and it is false for a display client by construction.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE LIGHT SAYS, AND WHAT THE WORDS NEVER SAY
 *
 * A rift's rules read as colour and its conditions as motion (the palette in
 * mechanics.md and docs/briefs/riftlight-art-and-audio.md Part A):
 *
 *   green  - dormant (`opensWhen` unmet)   slow breathing pulse
 *   amber  - one crossing left (`uses: 1`) a single candle-like flicker
 *   blue   - `persistent`                  steady ripple
 *   violet - `oneWay`                      light spirals inward
 *   shrink - timed, while its clock runs   stutter - unstable   sync - linked
 *
 * Every colour has its pattern, so no reading is colour alone (spec §11).
 * The Starweaver's words name what they *see* - "Green, breathing slowly" -
 * and never what it *means*: learning the meanings is their part to play, and
 * telling the table is up to them. The shared words name neither.
 */

import type { ClassId, JourneyExitView, JourneyRiftView, JourneyView } from "@kad/shared";

/** A colour layer: one rule of the rift (the palette). */
export type RiftColor = "green" | "amber" | "blue" | "violet";
/** A motion layer: one condition of the rift. */
export type RiftMotion = "shrink" | "stutter" | "sync";

/** What a Starweaver sees in one rift: its colour and motion layers, in palette order. */
export interface Riftlight {
  colors: RiftColor[];
  motions: RiftMotion[];
}

/** The effect sheet each layer draws (brief Part A1). */
export const RIFT_NEUTRAL_EFFECT = "rift_neutral";
export const RIFT_BASE_EFFECT = "rift_base";
export const RIFT_OPEN_EFFECT = "rift_open";
export const RIFT_COLLAPSE_EFFECT = "rift_collapse";
export const riftEffect = (layer: RiftColor | RiftMotion): string => `rift_${layer}`;

/**
 * Every rift sheet's shape (assets/manifest.json `effects[]`, pinned by
 * riftlight.test.ts): a row-major grid of square frames, played at `fps`.
 */
export const RIFT_SHEET = { frames: 24, fps: 12, size: 320, columns: 12 } as const;
/** One pass of a sheet: a loop's period, and how long a one-shot plays. */
export const RIFT_SHEET_MS = (RIFT_SHEET.frames / RIFT_SHEET.fps) * 1000;

export const riftSheetUrl = (effect: string): string => `/assets/effects/${effect}.sheet.png`;

/**
 * The sheets one lit rift stacks, bottom to top.
 *
 * The doorway comes first. The condition sheets carry the same registered
 * paint as `rift_base`; RiftGlyph moves the complete assembled stack for
 * stuttering/shrinking so the colours stay on the doorway. A rift both
 * unstable and timed stutters; its words still say both.
 * The colours stack over the tear, and `rift_sync` (a linked pair's beat) is
 * a small mark over everything.
 */
export function riftLayers(light: Riftlight): string[] {
  const tear = light.motions.includes("stutter")
    ? riftEffect("stutter")
    : light.motions.includes("shrink")
      ? riftEffect("shrink")
      : RIFT_BASE_EFFECT;
  return [
    tear,
    ...light.colors.map(riftEffect),
    ...(light.motions.includes("sync") ? [riftEffect("sync")] : []),
  ];
}

/** The class whose perception Riftlight is. */
const RIFTLIGHT_CLASS: ClassId = "starweaver";

/**
 * Whether this screen may draw Riftlight: only a phone whose seated character
 * is a Starweaver. A display client (the TV) has no seat, so `character` is
 * absent there and the answer is always no. Several Starweavers each see it on
 * their own phone; a party without one sees it nowhere.
 */
export function seesRiftlight(character: { class: ClassId } | null | undefined): boolean {
  return character?.class === RIFTLIGHT_CLASS;
}

/** A rift still giving off light: waiting to open, or open. A spent or shut one is dark. */
function isLit(rift: JourneyRiftView): boolean {
  return rift.status === "dormant" || rift.status === "open";
}

/**
 * The rift's layers, or null when it gives off no light (used up, shut, gone).
 *
 * Read from the journey view's own summary (`JourneyRiftView`), which the
 * engine already settles: a steadied rift (#197) has lost `unstable` and its
 * clock, so it no longer stutters or shrinks, and a timed rift shows its
 * clock only once open. Amber is "one crossing left", which for the
 * palette's `uses: 1` rift is every moment it is lit.
 */
export function riftlightOf(rift: JourneyRiftView): Riftlight | null {
  if (!isLit(rift)) return null;
  const colors: RiftColor[] = [];
  if (rift.status === "dormant") colors.push("green");
  if (rift.usesLeft === 1) colors.push("amber");
  if (rift.persistent === true) colors.push("blue");
  if (rift.oneWay === true) colors.push("violet");
  const motions: RiftMotion[] = [];
  if (rift.expiresIn !== undefined) motions.push("shrink");
  if (rift.unstable === true) motions.push("stutter");
  if (rift.linked === true) motions.push("sync");
  return { colors, motions };
}

/** A drawn exit that is a lit rift. */
export type LitRiftExit = JourneyExitView & { rift: JourneyRiftView };

/**
 * The rifts the world view draws: drawn exits that are lit rifts, while the
 * party is choosing. A journey without rifts - and every ordered campaign,
 * which has no journey at all - has none, so nothing changes for them.
 */
export function visibleRifts(journey: JourneyView | null | undefined): LitRiftExit[] {
  if (!journey || journey.status !== "choosing") return [];
  return journey.exits.filter(
    (exit): exit is LitRiftExit => exit.rift !== undefined && isLit(exit.rift),
  );
}

// ---------------------------------------------------------------------------
// Opening and collapsing
// ---------------------------------------------------------------------------

/** The lit rifts last seen at one place, for telling what changed there. */
export interface RiftSighting {
  /** `<campaign>/<node>`: a rift is only compared with itself at the same place. */
  readonly place: string;
  readonly rifts: readonly LitRiftExit[];
}

export interface RiftMoments {
  /** Edges that were dormant at this place and are open now. */
  readonly opened: readonly string[];
  /** Rifts that were lit at this place and are not any more, as last seen. */
  readonly collapsed: readonly LitRiftExit[];
}

const NO_MOMENTS: RiftMoments = { opened: [], collapsed: [] };

/**
 * What changed about the rifts at the party's place since it last chose a way
 * on: `rift_open` plays for a rift that has woken, `rift_collapse` for one
 * that has gone dark (used up, expired, collapsed or shut).
 *
 * Only a change at the **same place** is a moment. Arriving somewhere new
 * shows its rifts as they are: one that was open all along did not just open,
 * and the one the party came through is behind it, not in front. While the
 * party is playing a chapter (no exits drawn) the last sighting is kept, so
 * returning to the same choice after a replay compares across the chapter.
 */
export function riftMoments(
  before: RiftSighting | null,
  campaignId: string | null | undefined,
  journey: JourneyView | null | undefined,
): { sighting: RiftSighting | null; moments: RiftMoments } {
  if (!campaignId || !journey || journey.status !== "choosing") return { sighting: before, moments: NO_MOMENTS };
  const sighting: RiftSighting = { place: `${campaignId}/${journey.node}`, rifts: visibleRifts(journey) };
  if (!before || before.place !== sighting.place) return { sighting, moments: NO_MOMENTS };
  const now = new Map(sighting.rifts.map((exit) => [exit.edge, exit]));
  const opened = before.rifts
    .filter((was) => was.rift.status === "dormant" && now.get(was.edge)?.rift.status === "open")
    .map((was) => was.edge);
  const collapsed = before.rifts.filter((was) => !now.has(was.edge));
  return { sighting, moments: { opened, collapsed } };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * What every screen but a Starweaver's says about a rift. No colour, no rule,
 * no motion: only that something is there.
 */
export const NEUTRAL_RIFT_LINE = "A faint shimmer";

const COLOR_WORDS: Record<RiftColor, string> = {
  green: "Green, breathing slowly",
  amber: "Amber, one flicker",
  blue: "Blue, rippling steadily",
  violet: "Violet, spiraling inward",
};

const MOTION_WORDS: Record<RiftMotion, string> = {
  shrink: "It is shrinking",
  stutter: "It stutters",
  sync: "It pulses to a steady beat",
};

/**
 * The Starweaver's own reading of one rift, one entry per layer: each colour
 * with its pattern, then each motion. What they see, never what it means.
 * A lit rift with no layer at all (content the palette cannot describe) is
 * still a shimmer, and says so.
 */
export function riftlightWords(light: Riftlight): string[] {
  const words = [...light.colors.map((color) => COLOR_WORDS[color]), ...light.motions.map((motion) => MOTION_WORDS[motion])];
  return words.length === 0 ? [NEUTRAL_RIFT_LINE] : words;
}

/** The indicator's words: there is light to read, never what it shows. */
export const RIFTLIGHT_INDICATOR_LABEL = "Riftlight to look at";
