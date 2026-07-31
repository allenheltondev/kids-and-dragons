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
 *     icon, which is what these screens showed before the art existed.
 *   - **It is decorative.** Every use sits beside the character's name, so the
 *     image carries no information a screen reader needs (`alt=""`), and the
 *     icon fallback is unlabelled for the same reason.
 *   - **It is the whole figure, not a crop.** The art is a 1024×1024 canvas
 *     with the feet at y=900 (assets/manifest.json), so `object-fit: contain`
 *     with the box aligned to the bottom stands every species on the same line
 *     regardless of how tall it is.
 */

import { useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { SpeciesId, TierId } from "@kad/shared";
import { STARTING_TIER, characterArtUrl } from "../world/art-paths";
import { Icon } from "./icons";
import "./CharacterPortrait.css";

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
   * The player's chosen accent colour, if there is one. It tints the light —
   * the one place appearance choices show up before the rigs can recolour the
   * art itself (creationContent.ts header).
   */
  accent?: string;
  /** A slow float, for the places where the hero is the subject of the screen. */
  float?: boolean;
  className?: string;
}

export function CharacterPortrait({
  species,
  tier = STARTING_TIER,
  size,
  lit = false,
  accent,
  float = false,
  className = "",
}: CharacterPortraitProps): ReactElement {
  const [broken, setBroken] = useState(false);

  const style: CSSProperties & Record<string, string | undefined> = {};
  if (size !== undefined) {
    style.inlineSize = size;
    style.blockSize = size;
  }
  if (accent !== undefined && accent !== "") style["--portrait-accent"] = accent;

  return (
    <span
      className={`portrait${float ? " portrait--float" : ""}${lit ? " portrait--lit" : ""} ${className}`.trim()}
      style={style}
      data-species={species}
    >
      {broken ? (
        <Icon name={species} className="portrait__fallback" size="72%" />
      ) : (
        <img
          className="portrait__img"
          src={characterArtUrl(species, tier)}
          alt=""
          // The art is a megabyte of 1024² PNG per species and the species grid
          // asks for six of them; below-the-fold cards on a phone should not be
          // on the critical path of the card you are already looking at.
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => {
            setBroken(true);
          }}
        />
      )}
    </span>
  );
}
