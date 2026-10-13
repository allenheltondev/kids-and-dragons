/**
 * The keepsake lantern — the picture the sign-in flow is built around.
 *
 * "Create an account to persist your data" is the language of a service; what
 * is actually happening is that a family decides whether to keep three
 * characters a child spent an evening with. So the screen gets an object rather
 * than a form, and the object is one that could hang in the Bramblewood: the
 * painted lantern from the game's icon set (`assets/painted/lantern.webp`).
 *
 * Deliberately **not** a padlock, a shield, or a cloud. Those are the icons of
 * an account system, and an account system is the implementation detail here,
 * not the thing being offered.
 *
 * The painting has one flame of its own, so the party shows up as the light
 * thrown around it: one soft glow per member, in that player's own colour — the
 * same colour their name is drawn in everywhere else. Nobody being kept yet is
 * just the lantern with its own warm light.
 */

import type { CSSProperties, ReactElement } from "react";
import { PAINTED_ART } from "../assets/artwork";
import "./KeepsakeLantern.css";

export interface LanternMote {
  /** Stable key — the playerId. */
  id: string;
  /** The player's colour, straight from their profile. */
  color: string;
  /** For the accessible description. */
  name?: string;
}

export interface KeepsakeLanternProps {
  motes: readonly LanternMote[];
  /** Lit and glowing (the offer) vs. banked (already kept, quieter). */
  tone?: "offer" | "kept";
  /** Any CSS length. Defaults to sizing from the surrounding type scale. */
  size?: string;
  className?: string;
}

/** More than this and the glows stop reading as individuals. */
const MAX_MOTES = 6;

export function KeepsakeLantern({
  motes,
  tone = "offer",
  size,
  className = "",
}: KeepsakeLanternProps): ReactElement {
  const shown = motes.slice(0, MAX_MOTES);

  const named = shown.map((m) => m.name).filter((n): n is string => Boolean(n));
  const label =
    named.length > 0
      ? `A lantern holding a light for ${listOf(named)}`
      : "A lantern waiting to be lit";

  return (
    <span
      className={`kad-lantern kad-lantern--${tone}${shown.length === 0 ? " kad-lantern--empty" : ""} ${className}`.trim()}
      role="img"
      aria-label={label}
      style={size === undefined ? undefined : ({ inlineSize: size } as CSSProperties)}
    >
      {/* Outside the swaying image so the light stays put while the lantern
          moves — a glow that swings with the body reads as a torch being waved
          rather than a lamp hanging still. */}
      <span className="kad-lantern__halo" aria-hidden="true">
        {shown.map((mote, i) => (
          <span
            key={mote.id}
            className="kad-lantern__glow"
            style={
              {
                "--glow": mote.color,
                // Spread across the glass so a party of three is a little
                // constellation, not three pips in one spot.
                "--glow-x": `${String(shown.length === 1 ? 50 : 30 + (i / (shown.length - 1)) * 40)}%`,
                // Staggered so the lights breathe independently.
                animationDelay: `${String(i * 0.53)}s`,
              } as CSSProperties
            }
          />
        ))}
      </span>
      <img
        className="kad-lantern__image"
        src={PAINTED_ART["lantern"]}
        alt=""
        aria-hidden="true"
        decoding="async"
        draggable={false}
      />
    </span>
  );
}

/** "Ada", "Ada and Sam", "Ada, Sam and Rue" — read aloud by a screen reader. */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}
