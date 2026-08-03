/**
 * A character, drawn with the commissioned art (spec §5.1 — "large portraits").
 *
 * Every screen that used to show a species *icon* where a face belongs shows
 * one of these instead: the six cards you choose from, the hero you are
 * building, the lineup in the lobby, the head of your own sheet. One component
 * so a unicorn looks like the same unicorn everywhere — the same rule scene.ts
 * follows for the two Pixi stages.
 *
 * Three things it has to get right:
 *
 *   - **It never breaks a screen.** Art is a separate deploy from the bundle
 *     (`/assets` is synced to the same bucket, not built into it), so a portrait
 *     can 404 on a perfectly good build. `onError` falls back to the species
 *     icon, which is what these screens showed before the art existed — and the
 *     failure belongs to the *URL*, not to this component (see `isMissingArt`).
 *   - **It is decorative.** Every use sits beside the character's name, so the
 *     image carries no information a screen reader needs (`alt=""`), and the
 *     icon fallback is unlabelled for the same reason.
 *   - **It stands on the same line Pixi stands it on.** The art is a 1024×1024
 *     canvas whose ground contact is at y=900, not at the bottom edge
 *     (assets/manifest.json), so the figure is pushed down by the transparent
 *     remainder — `ANCHOR_Y`, the very constant the Pixi sprites anchor to. One
 *     contract, two renderers.
 */

import { useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { SpeciesId, TierId } from "@kad/shared";
import { ANCHOR_Y, STARTING_TIER, characterArtUrl } from "../world/art-paths";
import { Icon } from "./icons";
import "./CharacterPortrait.css";

/**
 * How far below the figure's feet the canvas keeps going, as a share of the
 * canvas. `ANCHOR_Y` is the Pixi sprite anchor; this is the same number said
 * the other way round, which is why neither renderer owns it.
 */
export const PORTRAIT_FLOOR = 1 - ANCHOR_Y;

/**
 * Is the art for `src` known to be missing?
 *
 * Keyed on the URL rather than kept as a `broken` boolean, because one mounted
 * portrait outlives the picture it is showing: a character levels into a new
 * tier, a lobby row is reused for a different species, and — since `/assets` is
 * deployed separately from the bundle — a file that 404s at 12:00 can exist at
 * 12:05. A boolean would latch the fallback on for the life of the component
 * and never ask for the new URL. This asks again for every URL except the one
 * that actually failed.
 */
export function isMissingArt(failedSrc: string | null, src: string): boolean {
  return failedSrc !== null && failedSrc === src;
}

export interface CharacterPortraitProps {
  species: SpeciesId;
  /** Defaults to the tier every character starts at. */
  tier?: TierId;
  /** Any CSS length. The art scales to fit; the box is what you size. */
  size?: string;
  /**
   * Pool a light under the figure. On by default wherever a portrait is the
   * subject of the screen; off for the ones that are just avatars in a row.
   */
  lit?: boolean;
  /**
   * The player's chosen accent colour, if there is one. It tints the light the
   * figure stands in — never the figure, which is drawn as painted
   * (creationContent.ts header on what the choice does colour).
   */
  accent?: string;
  /** A slow float, for the places where the hero is the subject of the screen. */
  float?: boolean;
  /**
   * Where the figure sits in its box.
   *
   *   - `"floor"` (the default) stands it on the bottom edge, on its
   *     ground-contact line. Right wherever the box is a *place*: the creation
   *     preview's lit stage, the wells in the lobby lineup and on your sheet.
   *   - `"centre"` centres the drawn figure instead. Right wherever the box is
   *     a *picture* — a portrait beside a paragraph, like the species cards.
   *     There is no floor in a card, so standing on one just reads as sitting
   *     too low.
   */
  stand?: "floor" | "centre";
  className?: string;
}

export function CharacterPortrait({
  species,
  tier = STARTING_TIER,
  size,
  lit = false,
  accent,
  float = false,
  stand = "floor",
  className = "",
}: CharacterPortraitProps): ReactElement {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = characterArtUrl(species, tier);
  const missing = isMissingArt(failedSrc, src);

  const style: CSSProperties & Record<string, string | undefined> = {
    // The ground-contact contract, handed to CSS so the stylesheet never has
    // to restate a number that lives in assets/manifest.json.
    "--portrait-floor": `${String(PORTRAIT_FLOOR * 100)}%`,
  };
  if (size !== undefined) {
    style.inlineSize = size;
    style.blockSize = size;
  }
  if (accent !== undefined && accent !== "") style["--portrait-accent"] = accent;

  return (
    <span
      className={`portrait portrait--${stand}${float ? " portrait--float" : ""}${lit ? " portrait--lit" : ""} ${className}`.trim()}
      style={style}
      data-species={species}
    >
      {missing ? (
        <Icon name={species} className="portrait__fallback" size="72%" />
      ) : (
        <img
          className="portrait__img"
          src={src}
          alt=""
          // The art is a megabyte of 1024² PNG per species and the species grid
          // asks for six of them; below-the-fold cards on a phone should not be
          // on the critical path of the card you are already looking at.
          loading="lazy"
          decoding="async"
          draggable={false}
          // The URL that failed, not "this portrait failed" — a later species,
          // a later tier, or a later deploy of the same file all get another go.
          onError={() => {
            setFailedSrc(src);
          }}
        />
      )}
    </span>
  );
}
