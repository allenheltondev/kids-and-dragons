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
 * tab that lights while there is Riftlight to read, so they know to look.
 *
 * Art: until the effect sheets land (brief Part A1) every layer is a CSS
 * placeholder carrying its sheet's id in `data-effect`, so swapping the art in
 * changes no logic.
 */

import type { ReactElement } from "react";
import { lobbyCampaign } from "@kad/shared";
import type { JourneyRiftView } from "@kad/shared";
import { useMe, useRunState, useSession } from "../store";
import {
  NEUTRAL_RIFT_LINE,
  RIFT_BASE_EFFECT,
  RIFT_NEUTRAL_EFFECT,
  RIFTLIGHT_INDICATOR_LABEL,
  riftEffect,
  riftlightOf,
  riftlightWords,
  seesRiftlight,
  visibleRifts,
  type LitRiftExit,
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
 * The lit rifts the world view is showing right now: only in the lobby, where
 * the party chooses its way on, and only for the adventure the lobby shows
 * (not while the vote between adventures is still open).
 */
export function useVisibleRifts(): LitRiftExit[] {
  const state = useRunState();
  if (!state || (state.phase !== "lobby" && state.phase !== "creation")) return [];
  const choice = lobbyCampaign(state);
  return choice.contested ? [] : visibleRifts(choice.leader?.journey);
}

/** One rift, drawn. Decorative: the words beside it are what a screen reader hears. */
export function RiftGlyph({ rift, riftlight }: { rift: JourneyRiftView; riftlight: boolean }): ReactElement {
  const light = riftlight ? riftlightOf(rift) : null;
  if (light === null) {
    return (
      <span className="rift-glyph" aria-hidden="true">
        <span className="rift-glyph__layer rift-glyph__layer--neutral" data-effect={RIFT_NEUTRAL_EFFECT} />
      </span>
    );
  }
  const motion = light.motions.map((name) => ` rift-glyph--${name}`).join("");
  return (
    <span className={`rift-glyph${motion}`} aria-hidden="true">
      <span className="rift-glyph__layer rift-glyph__layer--base" data-effect={RIFT_BASE_EFFECT} />
      {light.colors.map((color) => (
        <span key={color} className={`rift-glyph__layer rift-glyph__layer--${color}`} data-effect={riftEffect(color)} />
      ))}
      {light.motions.map((name) => (
        <span key={name} className="rift-glyph__motion" data-effect={riftEffect(name)} />
      ))}
    </span>
  );
}

/** The rifts at the party's place, for the world view. Nothing when there are none. */
export function RiftSightings(): ReactElement | null {
  const rifts = useVisibleRifts();
  const sees = useSeesRiftlight();
  if (rifts.length === 0) return null;
  return (
    <ul className={`rift-sight${sees ? " rift-sight--riftlight" : ""}`} aria-label="Rifts here">
      {rifts.map((exit) => {
        const light = sees ? riftlightOf(exit.rift) : null;
        return (
          <li className="rift-sight__rift" key={exit.edge}>
            <RiftGlyph rift={exit.rift} riftlight={sees} />
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
    </ul>
  );
}

/**
 * The Starweaver's menu indicator: lit on their World tab while a rift with
 * Riftlight is in view, and absent everywhere else. Its words say there is
 * light to read, never what it shows; its glyph uses no palette colour.
 */
export function RiftlightIndicator(): ReactElement | null {
  const sees = useSeesRiftlight();
  const lit = useVisibleRifts().length > 0;
  if (!sees || !lit) return null;
  return (
    <span className="kad-tray__badge kad-tray__badge--riftlight" data-riftlight-indicator="">
      <Icon name="riftlight_indicator" label={RIFTLIGHT_INDICATOR_LABEL} />
    </span>
  );
}
