/**
 * RiftSight - the rifts at the party's place, in the world view (#229).
 *
 * The world view draws every lit rift the party can see from where it is
 * choosing. What it draws depends on whose screen it is, and on nothing else
 * (not the room mode - WorldView's first rule):
 *
 *   - **A Starweaver's phone** draws the rift's Riftlight: the colourless tear
 *     (`rift_base`) with one layer per colour and motion, and beside it the
 *     same reading in words - each colour with its pattern (spec §11, never
 *     colour alone).
 *   - **Every other screen** - the TV in any mode, and every other phone -
 *     draws the neutral shimmer (`rift_neutral`) and says only that it is
 *     there. No colour, no rule, in pixels, words or screen-reader text.
 *
 * The rule lives in riftlight.ts (`seesRiftlight`); this only reads who is
 * holding the screen. A display client has no seat, so the TV can never get
 * here with a Starweaver's eyes.
 *
 * `RiftlightIndicator` is the other half: the badge on a Starweaver's World
 * tab that lights while there is Riftlight to read and they are not already
 * looking at it, so they know to look.
 *
 * Art: every layer is one of the painted effect sheets (brief Part A1), a
 * row of frames played by CSS steps. All of them run on one clock, so the two
 * mouths of a linked pair beat together, as `rift_sync` asks.
 *
 * `rift_open` and `rift_collapse` play once, with their cues, when a rift at
 * the party's place wakes or goes dark (`riftMoments`). Cues reach only the
 * TV: a joined phone installs no sink (audio/cue.ts).
 */

import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { lobbyCampaign } from "@kad/shared";
import type { JourneyRiftView, JourneyView } from "@kad/shared";
import { cue } from "../audio/cue";
import { useMe, useRunState, useSession } from "../store";
import {
  NEUTRAL_RIFT_LINE,
  RIFT_COLLAPSE_EFFECT,
  RIFT_NEUTRAL_EFFECT,
  RIFT_OPEN_EFFECT,
  RIFT_SHEET_MS,
  RIFT_SHEET,
  RIFTLIGHT_INDICATOR_LABEL,
  riftLayers,
  riftMoments,
  riftSheetUrl,
  riftlightOf,
  riftlightWords,
  seesRiftlight,
  visibleRifts,
  type LitRiftExit,
  type RiftMoments,
  type RiftSighting,
} from "./riftlight";
import { Icon } from "./icons";
import "./shared.css";
import "./RiftSight.css";

/**
 * True on a phone whose seated character is a Starweaver. Always false on a
 * display client (no player id), whatever the store holds.
 */
export function useSeesRiftlight(): boolean {
  const me = useMe();
  const display = (useSession()?.playerId ?? "") === "";
  return !display && seesRiftlight(me?.character);
}

/**
 * The journey the lobby shows right now: only in the lobby, where the party
 * chooses its way on, and only for the adventure the lobby shows (not while
 * the vote between adventures is still open).
 */
function useLobbyJourney(): { campaignId: string | null; journey: JourneyView | null } {
  const state = useRunState();
  if (!state || (state.phase !== "lobby" && state.phase !== "creation")) return { campaignId: null, journey: null };
  const choice = lobbyCampaign(state);
  if (choice.contested || !choice.leader?.journey) return { campaignId: null, journey: null };
  return { campaignId: choice.leader.id, journey: choice.leader.journey };
}

/** The lit rifts the world view is showing right now. */
export function useVisibleRifts(): LitRiftExit[] {
  return visibleRifts(useLobbyJourney().journey);
}

/**
 * The last rifts this screen saw at the party's place. Module-level, not
 * component state: the lobby unmounts while a chapter plays, and a rift that
 * woke during that chapter is exactly the change worth showing on the return.
 */
let lastSighting: RiftSighting | null = null;

/** Tests: start the next render from a screen that has seen no rift. */
export function forgetRiftSightings(): void {
  lastSighting = null;
}

const NO_MOMENTS: RiftMoments = { opened: [], collapsed: [] };

/** The rifts opening and collapsing right now, each for one pass of its sheet. */
function useRiftMoments(): RiftMoments {
  const { campaignId, journey } = useLobbyJourney();
  const [moments, setMoments] = useState<RiftMoments>(NO_MOMENTS);
  useEffect(() => {
    const next = riftMoments(lastSighting, campaignId, journey);
    lastSighting = next.sighting;
    const { opened, collapsed } = next.moments;
    if (opened.length === 0 && collapsed.length === 0) return;
    if (opened.length > 0) cue("rift-open");
    if (collapsed.length > 0) cue("rift-collapse");
    setMoments(next.moments);
  }, [campaignId, journey]);
  useEffect(() => {
    if (moments === NO_MOMENTS) return;
    const done = setTimeout(() => setMoments(NO_MOMENTS), RIFT_SHEET_MS);
    return () => clearTimeout(done);
  }, [moments]);
  return moments;
}

/**
 * One sheet, played from its first frame. Every loop shares the page's clock
 * (a negative delay into the current period), so layers registered to each
 * other, and the two mouths of a linked pair, stay in phase however late each
 * mounts. A one-shot starts where it is drawn.
 */
function SheetLayer({ effect, once = false }: { effect: string; once?: boolean }): ReactElement {
  // Taken once, when the animation starts: recomputed on a re-render it would
  // shift a running loop off the shared clock.
  const [phase] = useState(() => Math.round(performance.now() % RIFT_SHEET_MS));
  const style: CSSProperties = {
    backgroundImage: `url("${riftSheetUrl(effect)}")`,
    animationDuration: `${RIFT_SHEET_MS}ms`,
    ...(once ? {} : { animationDelay: `-${phase}ms` }),
    "--rift-frames": RIFT_SHEET.frames,
    "--rift-steps": RIFT_SHEET.frames - 1,
    "--rift-loop-end": `${(RIFT_SHEET.frames / (RIFT_SHEET.frames - 1)) * 100}%`,
    "--rift-still": `${(Math.floor(RIFT_SHEET.frames / 2) / (RIFT_SHEET.frames - 1)) * 100}%`,
  } as CSSProperties;
  return (
    <span
      className={`rift-glyph__layer${once ? " rift-glyph__layer--once" : ""}`}
      data-effect={effect}
      style={style}
    />
  );
}

/** One rift, drawn. Decorative: the words beside it are what a screen reader hears. */
export function RiftGlyph({
  rift,
  riftlight,
  opening = false,
}: {
  rift: JourneyRiftView;
  riftlight: boolean;
  /** It has just woken: `rift_open` plays over it once, then its loops show. */
  opening?: boolean;
}): ReactElement {
  const light = riftlight ? riftlightOf(rift) : null;
  const layers = light === null ? [RIFT_NEUTRAL_EFFECT] : riftLayers(light);
  const motion = light?.motions.includes("stutter")
    ? " rift-glyph--unstable"
    : light?.motions.includes("shrink") ? " rift-glyph--shrinking" : "";
  const [phase] = useState(() => Math.round(performance.now() % RIFT_SHEET_MS));
  return (
    <span
      className={`rift-glyph${opening ? " rift-glyph--opening" : motion}`}
      style={{ "--rift-duration": `${RIFT_SHEET_MS}ms`, "--rift-delay": `-${phase}ms` } as CSSProperties}
      aria-hidden="true"
    >
      {layers.map((effect) => (
        <SheetLayer key={effect} effect={effect} />
      ))}
      {opening && <SheetLayer effect={RIFT_OPEN_EFFECT} once />}
    </span>
  );
}

/** The rifts at the party's place, for the world view. Nothing when there are none. */
export function RiftSightings(): ReactElement | null {
  const rifts = useVisibleRifts();
  const sees = useSeesRiftlight();
  const { opened, collapsed } = useRiftMoments();
  if (rifts.length === 0 && collapsed.length === 0) return null;
  return (
    <ul className={`rift-sight${sees ? " rift-sight--riftlight" : ""}`} aria-label="Rifts here">
      {rifts.map((exit) => {
        const light = sees ? riftlightOf(exit.rift) : null;
        return (
          <li className="rift-sight__rift" key={exit.edge}>
            <RiftGlyph rift={exit.rift} riftlight={sees} opening={opened.includes(exit.edge)} />
            <span className="rift-sight__text">
              <b className="rift-sight__label">{exit.label}</b>
              {light === null ? (
                <span className="rift-sight__reading">{NEUTRAL_RIFT_LINE}</span>
              ) : (
                <span className="rift-sight__reading">
                  {/* Icon + words, like every reading: the indicator's own
                      glyph marks this as the Starweaver's sight. */}
                  <Icon name="riftlight_indicator" />
                  <span>{riftlightWords(light).join(" · ")}</span>
                </span>
              )}
            </span>
          </li>
        );
      })}
      {/* A rift folding shut: colourless for everyone, and gone after one
          pass. Hidden from screen readers, which never heard of it changing. */}
      {collapsed.map((exit) => (
        <li className="rift-sight__rift rift-sight__rift--collapsing" key={`collapse:${exit.edge}`} aria-hidden="true">
          <span className="rift-glyph">
            <SheetLayer effect={RIFT_COLLAPSE_EFFECT} once />
          </span>
          <span className="rift-sight__text">
            <b className="rift-sight__label">{exit.label}</b>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Starweaver's menu indicator: lit on their World tab while a rift with
 * Riftlight is in view and they are looking somewhere else, and absent
 * everywhere else. Its words say there is light to read, never what it shows;
 * its glyph uses no palette colour.
 *
 * The rule is "in view, and not on World", with no memory of what was seen:
 * looking at the world clears it, and it lights again the moment they leave
 * while a lit rift is still there, or when one appears while they are away.
 * `onWorld` comes from the shell, the only thing that knows what is showing.
 */
export function RiftlightIndicator({ onWorld }: { onWorld: boolean }): ReactElement | null {
  const sees = useSeesRiftlight();
  const lit = useVisibleRifts().length > 0;
  if (!sees || !lit || onWorld) return null;
  return (
    <span className="kad-tray__badge kad-tray__badge--riftlight" data-riftlight-indicator="">
      <Icon name="riftlight_indicator" label={RIFTLIGHT_INDICATOR_LABEL} />
    </span>
  );
}
