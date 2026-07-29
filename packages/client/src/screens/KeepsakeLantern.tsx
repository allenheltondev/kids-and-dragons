/**
 * The keepsake lantern — the picture the sign-in flow is built around.
 *
 * The problem this solves is tonal, not technical. "Create an account to
 * persist your data" is the language of a service; what is actually happening
 * is that a family decides whether to keep three characters a child spent an
 * evening with. So the screen needed an object rather than a form, and the
 * object needed to be one that could plausibly hang in the Bramblewood.
 *
 * A lantern, holding **one flame per party member**, each tinted with that
 * player's own colour — the same colour their name is drawn in everywhere else
 * in the game. Two things fall out of that choice for free:
 *
 *   - It says who is being kept without a caption. A child who cannot yet read
 *     "keep your characters" can see three lights and count herself in them.
 *   - It has an obvious empty state. Nothing is being kept yet; the lantern is
 *     lit anyway, and it does not read as an error.
 *
 * Deliberately **not** a padlock, a shield, or a cloud. Those are the icons of
 * an account system, and an account system is the implementation detail here,
 * not the thing being offered.
 *
 * ---------------------------------------------------------------------------
 * Why this is SVG and lives in the client rather than in `assets/`
 * ---------------------------------------------------------------------------
 *
 * The art taxonomy (art-pipeline.md §2) puts UI in `ui/icons/*.svg` and says
 * **never raster** — raster is for characters, which need cutting, registration
 * and a rig, none of which apply to a piece of interface. Vector also buys the
 * two things this particular picture needs: it takes the player colours as
 * *input*, and it stays crisp from a 40%-of-a-phone Travel pane up to a TV.
 *
 * A commissioned illustrated version is specified in asset-brief.md §8 for when
 * the art pass reaches it. This is the shipping one until then, and the
 * component boundary is what makes swapping it a one-file change.
 */

import { useId } from "react";
import type { ReactElement } from "react";
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

/** More than this and the flames stop reading as individuals. */
const MAX_MOTES = 6;

/**
 * Positions inside the glass, on a gentle arc so a party of three reads as a
 * little constellation rather than a row of pips.
 */
export function motePositions(count: number): { x: number; y: number }[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 60, y: 88 }];

  const spread = Math.min(20, 8 + count * 3);
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return {
      x: 60 - spread + t * spread * 2,
      // Sine lifts the middle of the arc; the ends sit lower in the glass.
      y: 94 - Math.sin(t * Math.PI) * 11,
    };
  });
}

export function KeepsakeLantern({
  motes,
  tone = "offer",
  size,
  className = "",
}: KeepsakeLanternProps): ReactElement {
  // Gradients live in a shared id namespace, so two lanterns on one page would
  // otherwise silently share (and fight over) one definition.
  const uid = useId().replace(/:/g, "");
  const glowId = `kad-lantern-glow-${uid}`;
  const glassId = `kad-lantern-glass-${uid}`;

  const shown = motes.slice(0, MAX_MOTES);
  const positions = motePositions(shown.length);

  const named = shown.map((m) => m.name).filter((n): n is string => Boolean(n));
  const label =
    named.length > 0
      ? `A lantern holding a light for ${listOf(named)}`
      : "A lantern waiting to be lit";

  return (
    <svg
      className={`kad-lantern kad-lantern--${tone}${shown.length === 0 ? " kad-lantern--empty" : ""} ${className}`.trim()}
      viewBox="0 0 120 176"
      role="img"
      aria-label={label}
      style={size === undefined ? undefined : { inlineSize: size, blockSize: "auto" }}
    >
      <defs>
        <radialGradient id={glowId} cx="50%" cy="52%" r="50%">
          <stop offset="0%" stopColor="var(--kad-gold)" stopOpacity="0.55" />
          <stop offset="55%" stopColor="var(--kad-gold)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--kad-gold)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={glassId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--kad-bg-sunken)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--kad-bg-raised)" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      {/* The halo sits outside the swaying group so the light stays put while
          the lantern moves — a glow that swings with the body reads as a torch
          being waved rather than a lamp hanging still. */}
      <ellipse className="kad-lantern__halo" cx="60" cy="86" rx="52" ry="58" fill={`url(#${glowId})`} />

      <g className="kad-lantern__body">
        {/* hanger */}
        <g className="kad-lantern__metal">
          <path d="M60 6c-7 0-12 5-12 11 0 4 3 7 6 8" />
          <path d="M60 6c7 0 12 5 12 11 0 4-3 7-6 8" />
          <path d="M60 25v6" />

          {/* cap */}
          <path d="M43 31h34l10 12H33z" />
          {/* base and foot */}
          <path d="M32 127h56l-3 13H35z" />
          <path d="M39 140h42l-3 9H42z" />
        </g>

        {/* glass */}
        <path
          className="kad-lantern__glass"
          d="M36 43c-9 20-9 64 0 84h48c9-20 9-64 0-84z"
          fill={`url(#${glassId})`}
        />

        {/* The lights. One per party member, in that player's own colour. */}
        <g className="kad-lantern__motes">
          {shown.map((mote, i) => {
            const at = positions[i];
            if (!at) return null;
            return (
              /*
               * Two nested groups, not one. The position is an SVG `transform`
               * attribute and the flicker is a CSS `transform`, and CSS wins —
               * animating the same element would throw the placement away and
               * stack every flame at the centre of the glass.
               */
              <g key={mote.id} transform={`translate(${String(at.x)} ${String(at.y)})`}>
                <g
                  className="kad-lantern__mote"
                  // Staggered so the flames breathe independently; without this
                  // three lights pulse in lockstep and read as a spinner.
                  style={{ animationDelay: `${String(i * 0.53)}s` }}
                >
                  <circle className="kad-lantern__mote-glow" r="12" fill={mote.color} />
                  {/*
                   * Literally the `flame` glyph from icons.tsx, filled and
                   * re-centred on the origin. Drawing a second, subtly
                   * different flame here is how an icon set starts to drift —
                   * and this one sits a few centimetres from the real thing on
                   * the same screen.
                   */}
                  <path
                    className="kad-lantern__mote-flame"
                    d="M12 2.6c3.2 4 5.4 5.9 5.4 9.6a5.4 5.4 0 0 1-10.8 0c0-2.2 1-3.4 2.2-4.5.3 1.3 1.1 2.1 2.1 2.1.9 0 1.4-.7 1.4-1.7 0-1.9-1.3-3.3-.3-5.5z"
                    fill={mote.color}
                    transform="translate(-12 -10)"
                  />
                  <circle className="kad-lantern__mote-core" cy="2.6" r="1.8" fill="var(--kad-ink)" />
                </g>
              </g>
            );
          })}
        </g>

        {/*
         * Glass highlight, drawn last so it sits over the flames.
         *
         * There is deliberately nothing drawn for the empty case. An unlit
         * lantern is already the right picture for "nobody is being kept yet" —
         * the wick that used to sit here read as a stray glyph at small sizes,
         * and anything more explicit would make an ordinary state look broken.
         */}
        <path className="kad-lantern__shine" d="M45 52c-4 14-4 44-1 60" fill="none" />
      </g>
    </svg>
  );
}

/** "Ada", "Ada and Sam", "Ada, Sam and Rue" — read aloud by a screen reader. */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}
