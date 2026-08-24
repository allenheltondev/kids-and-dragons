/**
 * Inline SVG icons.
 *
 * spec §1.5 ("iconography carries the text") and the roadmap's "icons before
 * text" rule mean no interactive element ships without an icon — so the icon
 * lookup can never be the thing that breaks a scene. Every unknown name falls
 * back to a neutral glyph instead of throwing or rendering nothing.
 *
 * No icon library: an 8-year-old's TV is 3 metres away, the glyphs have to be
 * heavy and few, and we own the whole set anyway (roadmap ch.1, Allen
 * commissions the finished art). These are deliberately geometric placeholders
 * that stay legible at 24px on a phone and at 120px on a TV.
 *
 * spec §11: status is never carried by colour alone, so every status glyph is
 * distinguishable by *shape* — check vs. cross vs. hourglass, not green vs. red.
 */

import type { ReactElement } from "react";
import type { ClassId, ItemKind, SpeciesId, StatId } from "@kad/shared";

export interface IconProps {
  /** Icon id. Unknown ids render the neutral fallback glyph. */
  name: string;
  /**
   * Accessible label. Omit when the icon sits next to a visible text label —
   * then it is decorative and hidden from the screen reader.
   */
  label?: string;
  /**
   * Any CSS length, including a token (`var(--kad-icon-md)`). Defaults to `1em`
   * so an icon tracks the size of the text beside it — which is what makes one
   * icon set work on a phone pane and on a TV (theme.css scales each surface's
   * font-size from its own width).
   */
  size?: number | string;
  className?: string;
}

/* eslint-disable react/jsx-key -- static glyph table, never mapped */

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The neutral glyph. Used for any name we do not know. */
const UNKNOWN: ReactElement = (
  <g {...S}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
  </g>
);

const GLYPHS: Record<string, ReactElement> = {
  // --- Stats (spec §4.1) ------------------------------------------------
  might: (
    <g {...S}>
      <path d="M4.5 12.5a2 2 0 0 1 2-2H15a4 4 0 0 1 4 4v1.5a4 4 0 0 1-4 4H9a4.5 4.5 0 0 1-4.5-4.5z" />
      <path d="M8.5 10.5V7.8a1.8 1.8 0 1 1 3.6 0v2.7" />
      <path d="M12.1 10.5V6.6a1.8 1.8 0 1 1 3.6 0v3.9" />
    </g>
  ),
  quick: (
    <g {...S}>
      <path d="M3 17.5c4.5-.8 7.6-2.8 9.8-5.9C15 8.5 16.8 5.4 21 4c-.4 6.4-2.4 10.6-5.6 12.8-3.2 2.2-7.3 2.6-12.4.7z" />
      <path d="M7.5 15.4c2.6-.6 4.7-2 6.4-4.2" />
    </g>
  ),
  clever: (
    <g {...S}>
      <path d="M12 2.8l2 5.7 5.7 2-5.7 2-2 5.7-2-5.7-5.7-2 5.7-2z" />
      <path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </g>
  ),
  heart: (
    <g {...S}>
      <path d="M12 20.4S4.4 15.9 4.4 10.6A4.1 4.1 0 0 1 12 8.3a4.1 4.1 0 0 1 7.6 2.3c0 5.3-7.6 9.8-7.6 9.8z" fill="currentColor" stroke="currentColor" />
    </g>
  ),

  // --- Choice icons used by chapter content -----------------------------
  eye: (
    <g {...S}>
      <path d="M2.5 12S6 6.2 12 6.2 21.5 12 21.5 12 18 17.8 12 17.8 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </g>
  ),
  ear: (
    <g {...S}>
      <path d="M7.6 20.8c0-2.8-2.1-4-2.1-8a6.9 6.9 0 0 1 13.8 0c0 3.2-2.2 4.3-4.2 4.9-1.3.4-2 1-2 2.1a2.2 2.2 0 0 1-4.4 0" />
      <path d="M10 10.2a2.6 2.6 0 0 1 4.6 1.6" />
    </g>
  ),
  arrow: (
    <g {...S}>
      <path d="M3.8 20.2L19 5" />
      <path d="M12.6 5H19v6.4" />
      <path d="M3.8 20.2l3.6-1 -2.6-2.6z" fill="currentColor" />
    </g>
  ),
  hand: (
    <g {...S}>
      <path d="M9 12V5.6a1.6 1.6 0 0 1 3.2 0V11" />
      <path d="M12.2 11V4.8a1.6 1.6 0 0 1 3.2 0V12" />
      <path d="M15.4 12V7.4a1.6 1.6 0 0 1 3.2 0V14a7 7 0 0 1-7 7h-.8A5.8 5.8 0 0 1 5 15.2v-3.1a1.6 1.6 0 0 1 3.2 0v1.4" />
    </g>
  ),
  flame: (
    <g {...S}>
      <path d="M12 2.6c3.2 4 5.4 5.9 5.4 9.6a5.4 5.4 0 0 1-10.8 0c0-2.2 1-3.4 2.2-4.5.3 1.3 1.1 2.1 2.1 2.1.9 0 1.4-.7 1.4-1.7 0-1.9-1.3-3.3-.3-5.5z" />
    </g>
  ),

  // --- Species (spec §4.2) — distinct silhouettes, not portraits --------
  unicorn: (
    <g {...S}>
      <path d="M13.6 2.6l2.6 6.2" />
      <path d="M14.2 4.4l1.9 1M13.1 6.1l2 1M12.1 7.8l2.1 1" />
      <path d="M5 20.5a6.4 6.4 0 0 1 6.4-6.4h1a4.5 4.5 0 0 0 4.5-4.5" />
      <path d="M8.4 12.4c-1.6-.6-3-.2-4.2 1.3" />
    </g>
  ),
  dragonling: (
    <g {...S}>
      <path d="M3.2 6.4c4.4.4 7.6 2.2 9.6 5.4l3.4-2 .4 3.2 3.6-1.4c-1 4.6-4.4 7.4-9.2 7.4-4.6 0-7.8-3.4-7.8-8.2z" />
      <path d="M7.2 12.2l2.4 3.4M11.6 11.8l1 4" />
    </g>
  ),
  griffin: (
    <g {...S}>
      <path d="M20.6 5.2c-5.4.4-9 2.6-11 6.2S6.4 18 3.6 19.4c1-5.6 2.4-9.6 4.6-12s6-2.6 12.4-2.2z" />
      <path d="M9.4 12.6c2.2-1.6 4.4-2.6 6.6-3M12 16.2c1.8-1.2 3.6-2 5.4-2.4" />
    </g>
  ),
  bigfoot: (
    <g {...S}>
      <path d="M8.6 21.4c-2.4 0-3.8-1.6-3.8-3.6 0-2.4 1.4-3.4 1.4-6.2 0-3.6 1.8-6.6 5.4-6.6s5.4 3 5.4 6.6c0 2.8 1.4 3.8 1.4 6.2 0 2-1.4 3.6-3.8 3.6z" />
      <circle cx="8" cy="4.2" r="1.2" fill="currentColor" />
      <circle cx="12" cy="3.2" r="1.2" fill="currentColor" />
      <circle cx="16" cy="4.2" r="1.2" fill="currentColor" />
    </g>
  ),
  kitsune: (
    <g {...S}>
      <path d="M4.4 20.4c0-4.4 2.6-7.4 6.6-7.4" />
      <path d="M8.4 20.4c0-5.4 3-9 7.4-9" />
      <path d="M12.4 20.4c0-6.4 3.4-10.6 8-10.6" />
      <path d="M5.6 6.2l1.4 4.4M11 4.4l-1.4 5" />
    </g>
  ),
  manticore: (
    <g {...S}>
      <path d="M3.6 19.6c5.6 0 9.4-1.6 11.4-4.8s2-6.6-.4-9.6" />
      <path d="M14.6 5.2l3.8-2-.6 4.2 3.6 1.2-3.8 2z" fill="currentColor" />
      <path d="M6 16.6c1.6-.4 3-1 4.2-1.8" />
    </g>
  ),

  // --- Classes (spec §4.3) ---------------------------------------------
  thornguard: (
    <g {...S}>
      <path d="M12 2.8l7.2 2.6v6c0 4.6-3 8.2-7.2 9.8-4.2-1.6-7.2-5.2-7.2-9.8v-6z" />
      <path d="M12 7.6v7M9.4 10.2L12 12l2.6-1.8" />
    </g>
  ),
  duskrunner: (
    <g {...S}>
      <path d="M4 20l9.6-9.6" />
      <path d="M13.6 10.4L18.4 3l2.4 2.4-7.4 4.8z" fill="currentColor" />
      <path d="M3 12h5M3.4 16h3.4" />
    </g>
  ),
  starweaver: (
    <g {...S}>
      <path d="M4 20.2L14 10" />
      <path d="M16.4 3.2l1.2 3.2 3.2 1.2-3.2 1.2-1.2 3.2-1.2-3.2-3.2-1.2 3.2-1.2z" fill="currentColor" />
      <path d="M5.4 7.6l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
    </g>
  ),
  songkeeper: (
    <g {...S}>
      <path d="M9.4 18.4V6.2l9.2-2.4v12.2" />
      <circle cx="6.6" cy="18.4" r="2.8" />
      <circle cx="15.8" cy="16" r="2.8" />
    </g>
  ),

  // --- Appearance (spec §5.4) -------------------------------------------
  // The cosmetic options used to borrow interface glyphs — "Plain" was a
  // check, which sat next to the selected-check and read as a bug. These say
  // what they are instead. Markings are one swatch of coat with the pattern on
  // it, so the four read as a set; the horn and wing styles are one silhouette
  // detailed three ways, because that is exactly what they are.
  marking_plain: (
    <g {...S}>
      <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="4.6" />
    </g>
  ),
  marking_dapple: (
    <g {...S}>
      <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="4.6" />
      <circle cx="9.4" cy="9.6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9.8" cy="15.4" r="1.3" fill="currentColor" stroke="none" />
    </g>
  ),
  marking_stripe: (
    <g {...S}>
      <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="4.6" />
      <path d="M6.6 12.8l6.2-6.2M10 16.4l6.4-6.4M14.6 18.2l3.4-3.4" />
    </g>
  ),
  marking_starfall: (
    <g {...S}>
      <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="4.6" />
      <path d="M14 10.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor" />
      <path d="M9.2 7.8l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" />
    </g>
  ),

  // Horns and wings are drawn *wide*. A 1.8-unit stroke on a shape only four
  // units across closes up into a solid blob at the size these render at —
  // which is how the first pass at these came out: three yellow smudges.
  horn_spiral: (
    <g {...S}>
      <path d="M6.4 20.4L17 3.6l-2 16.8z" />
      <path d="M8.4 16.6l6.2-.8M10.2 12.6l4.9-.7M12 8.6l3.2-.5" />
    </g>
  ),
  horn_curved: (
    <g {...S}>
      <path d="M5.8 20.4c.4-9 4.8-15.2 13.2-18.4-3.4 8.4-5.8 14.6-7.2 18.4z" />
      <path d="M9 17.6c1.4-4.6 3.4-8.4 6-11.6" />
    </g>
  ),
  horn_crystal: (
    <g {...S}>
      <path d="M12 3.2l5 6-5 11.6-5-11.6z" />
      <path d="M7 9.2h10M12 3.2v17.6" />
    </g>
  ),

  wing_feathered: (
    <g {...S}>
      <path d="M4.6 19.4c0-8.6 4.9-14.2 14.8-15.4-1 10.4-6 15.4-14.8 15.4z" />
      <path d="M7.6 16.8c1.7-4.4 4.5-7.6 8.4-9.6M10.4 18.4c1.3-3.4 3.3-6.1 6-8.2" />
    </g>
  ),
  wing_leathery: (
    <g {...S}>
      <path d="M19.4 4c-9.9 1.2-14.8 6.8-14.8 15.4 1.8-2.6 3.3-3 4.5-1.4.7-2.4 2-3.1 4-2.1.6-2.6 1.9-3.6 4-3-.4-3.4.4-6.3 2.3-8.9z" />
      <path d="M19.4 4l-10.3 14M19.4 4l-6.3 11.9" />
    </g>
  ),
  wing_starlit: (
    <g {...S}>
      <path d="M4.6 19.4c0-8.6 4.9-14.2 14.8-15.4-1 10.4-6 15.4-14.8 15.4z" />
      <path d="M12.4 8.6l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="currentColor" />
    </g>
  ),

  // --- Items (spec §9.2) ------------------------------------------------
  consumable: (
    <g {...S}>
      <path d="M9.6 2.8h4.8M11 2.8v5.4l-4.2 8A3.4 3.4 0 0 0 9.8 21.2h4.4a3.4 3.4 0 0 0 3-5l-4.2-8V2.8" />
      <path d="M7.8 14.6h8.4" />
    </g>
  ),
  trinket: (
    <g {...S}>
      <path d="M7.6 3.4h8.8l4 5.6-8.4 11.6L3.6 9z" />
      <path d="M3.6 9h16.8M7.6 3.4L12 20.6l4.4-17.2" />
    </g>
  ),
  quest: (
    <g {...S}>
      <circle cx="8" cy="8" r="4.4" />
      <path d="M11.2 11.2L20 20M17 17l-2.2 2.2M14.4 14.4l-2 2" />
    </g>
  ),
  bag: (
    <g {...S}>
      <path d="M4.6 8h14.8l-1.2 12H5.8z" />
      <path d="M8.6 8V6.4a3.4 3.4 0 0 1 6.8 0V8" />
    </g>
  ),

  // --- Dice (spec §4.1 — one die, one animation) ------------------------
  d20: (
    <g {...S}>
      <path d="M12 2.4l8.4 4.8v9.6L12 21.6 3.6 16.8V7.2z" />
      <path d="M12 2.4l4.6 8.2h-9.2z" />
      <path d="M7.4 10.6L12 21.6l4.6-11z" />
      <path d="M3.6 7.2l3.8 3.4M20.4 7.2l-3.8 3.4" />
    </g>
  ),
  /*
   * The rolled die (DiceOverlay), as opposed to `d20` the 1em label glyph
   * beside the word "check". It is the only icon in the set drawn to be seen
   * at 9em, and the only one with a *face*: the number lands inside the centre
   * facet, so that facet is filled and centred on the box (its centroid is
   * exactly 12,12) and everything else is structure around it.
   */
  d20_solid: (
    <g {...S}>
      <path d="M12 1.8L21 7v10l-9 5.2L3 17V7z" fill="currentColor" opacity="0.18" />
      <path d="M5.6 8.2h12.8L12 19.6z" fill="currentColor" opacity="0.3" />
      <path d="M12 1.8L21 7v10l-9 5.2L3 17V7z" strokeWidth="1.4" />
      <path d="M5.6 8.2h12.8L12 19.6z" strokeWidth="1.4" />
      <path
        d="M12 1.8L5.6 8.2M12 1.8l6.4 6.4M3 7l2.6 1.2M21 7l-2.6 1.2M3 17l2.6-8.8M21 17l-2.6-8.8M12 19.6v2.6"
        opacity="0.8"
      />
    </g>
  ),
  dice: (
    <g {...S}>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4" />
      <circle cx="8.4" cy="8.4" r="1.3" fill="currentColor" />
      <circle cx="15.6" cy="15.6" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </g>
  ),

  // --- Interface --------------------------------------------------------
  back: (
    <g {...S}>
      <path d="M15 4.5L7.5 12l7.5 7.5" />
    </g>
  ),
  forward: (
    <g {...S}>
      <path d="M9 4.5L16.5 12 9 19.5" />
    </g>
  ),
  check: (
    <g {...S}>
      <path d="M4.5 12.8l4.8 4.8L19.5 6.6" strokeWidth="2.4" />
    </g>
  ),
  close: (
    <g {...S}>
      <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />
    </g>
  ),
  // The two sound states are distinguished by *shape* (spec §11): waves out
  // of the horn versus a cross over where the waves would be.
  sound: (
    <g {...S}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9.5a3.5 3.5 0 010 5M18 7.5a6.5 6.5 0 010 9" />
    </g>
  ),
  muted: (
    <g {...S}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
    </g>
  ),
  plus: (
    <g {...S}>
      <path d="M12 5v14M5 12h14" strokeWidth="2.4" />
    </g>
  ),
  minus: (
    <g {...S}>
      <path d="M5 12h14" strokeWidth="2.4" />
    </g>
  ),
  shuffle: (
    <g {...S}>
      <path d="M3.6 6.4h3.6c3.6 0 5.6 11.2 9.2 11.2h4" />
      <path d="M3.6 17.6h3.6c1.8 0 3.1-2.8 4.3-5.6" />
      <path d="M17.2 3.6l3.2 2.8-3.2 2.8M17.2 14.8l3.2 2.8-3.2 2.8" />
    </g>
  ),
  qr: (
    <g {...S}>
      <rect x="3.4" y="3.4" width="6.4" height="6.4" rx="1.4" />
      <rect x="14.2" y="3.4" width="6.4" height="6.4" rx="1.4" />
      <rect x="3.4" y="14.2" width="6.4" height="6.4" rx="1.4" />
      <path d="M14.2 14.2h3v3h-3zM20.6 14.2v3M17.2 20.6h3.4" />
    </g>
  ),
  party: (
    <g {...S}>
      <circle cx="8.6" cy="8" r="3.4" />
      <path d="M2.8 20c0-3.4 2.6-5.8 5.8-5.8s5.8 2.4 5.8 5.8" />
      <path d="M15.6 5.2a3.4 3.4 0 0 1 0 6.6M16.4 14.6c2.8.4 4.8 2.6 4.8 5.4" />
    </g>
  ),
  travel: (
    <g {...S}>
      <rect x="6.4" y="2.6" width="11.2" height="18.8" rx="2.6" />
      <path d="M6.4 9.6h11.2M10.6 18.4h2.8" />
    </g>
  ),
  play: (
    <g {...S}>
      <path d="M7.4 4.6l11.2 7.4-11.2 7.4z" fill="currentColor" />
    </g>
  ),
  waiting: (
    <g {...S}>
      <path d="M7 3.4h10M7 20.6h10" />
      <path d="M8 3.4v3.2c0 2.2 4 3.6 4 5.4 0 1.8-4 3.2-4 5.4v3.2M16 3.4v3.2c0 2.2-4 3.6-4 5.4 0 1.8 4 3.2 4 5.4v3.2" />
    </g>
  ),
  star: (
    <g {...S}>
      <path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.8z" fill="currentColor" />
    </g>
  ),
  levelup: (
    <g {...S}>
      <path d="M5.4 13.6L12 7l6.6 6.6" strokeWidth="2.2" />
      <path d="M5.4 19L12 12.4 18.6 19" strokeWidth="2.2" />
    </g>
  ),
  guard: (
    <g {...S}>
      <path d="M12 2.8l7.2 2.6v6c0 4.6-3 8.2-7.2 9.8-4.2-1.6-7.2-5.2-7.2-9.8v-6z" />
    </g>
  ),
  steps: (
    <g {...S}>
      <ellipse cx="8.4" cy="14.6" rx="3.4" ry="4.6" />
      <circle cx="15.6" cy="7.4" r="1.5" fill="currentColor" />
      <circle cx="18.6" cy="10.6" r="1.5" fill="currentColor" />
      <circle cx="18.6" cy="14.6" r="1.5" fill="currentColor" />
    </g>
  ),
  down: (
    <g {...S}>
      <circle cx="5.6" cy="9.4" r="2.6" />
      <path d="M3.4 17.2h13.4a3.4 3.4 0 0 0 3.4-3.4" />
      <path d="M8 14.4l4.4-2.6 3.6 2" />
    </g>
  ),
  ready: (
    <g {...S}>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.8 12.4l3 3 5.4-6" strokeWidth="2.2" />
    </g>
  ),
  vote: (
    <g {...S}>
      <path d="M6.6 20.4V11a2 2 0 0 1 4 0V5.2a2 2 0 0 1 4 0V11" />
      <path d="M14.6 11V8.6a2 2 0 0 1 4 0v6.2a5.6 5.6 0 0 1-5.6 5.6z" />
    </g>
  ),
  palette: (
    <g {...S}>
      <path d="M12 3.2a8.8 8.8 0 0 0 0 17.6c1.5 0 2.2-1 2.2-2 0-1.6-1.4-1.8-1.4-3 0-1 .9-1.8 2-1.8h1.6a4.4 4.4 0 0 0 4.4-4.4c0-3.6-3.8-6.4-8.8-6.4z" />
      <circle cx="7.6" cy="11" r="1.4" fill="currentColor" />
      <circle cx="11" cy="7.4" r="1.4" fill="currentColor" />
      <circle cx="15.6" cy="8.6" r="1.4" fill="currentColor" />
    </g>
  ),
  name: (
    <g {...S}>
      <path d="M3.4 8.6a2 2 0 0 1 2-2h13.2a2 2 0 0 1 2 2v6.8a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2z" />
      <path d="M7 14V10l2.4 3L11.8 10v4M14.6 10v4h3" />
    </g>
  ),
  trophy: (
    <g {...S}>
      <path d="M7.4 3.6h9.2v5.2a4.6 4.6 0 0 1-9.2 0z" />
      <path d="M7.4 5.2H4.6v1.6a3.4 3.4 0 0 0 3 3.4M16.6 5.2h2.8v1.6a3.4 3.4 0 0 1-3 3.4" />
      <path d="M12 13.4v3.4M8.4 20.4h7.2l-.8-3.6H9.2z" />
    </g>
  ),
  map: (
    <g {...S}>
      <path d="M3.4 6.4l5.6-2.2 6 2.6 5.6-2.2v12.8l-5.6 2.2-6-2.6-5.6 2.2z" />
      <path d="M9 4.2v14.8M15 6.8v12.8" />
    </g>
  ),
  scroll: (
    <g {...S}>
      <path d="M5.4 4.4h11.2v13a3 3 0 0 0 3 3H7.4a2 2 0 0 1-2-2z" />
      <path d="M8.6 8.4h5.6M8.6 12h5.6M8.6 15.6h3.4" />
      <path d="M16.6 4.4h1a2 2 0 0 1 2 2v11" />
    </g>
  ),
  rest: (
    <g {...S}>
      <path d="M20.4 14.4A8.4 8.4 0 1 1 9.6 3.6a6.6 6.6 0 0 0 10.8 10.8z" />
    </g>
  ),
  swords: (
    <g {...S}>
      <path d="M4 4h3.4l9 9-3.4 3.4-9-9z" />
      <path d="M20 4h-3.4l-9 9 3.4 3.4 9-9z" />
      <path d="M5.4 20.4l3-3M18.6 20.4l-3-3" />
    </g>
  ),

  // --- Content icons -----------------------------------------------------
  // Every `icon` string in content/rules.json, content/items.json and the
  // chapters resolves to something here. A name that does not still renders
  // (the fallback glyph), which is why a new item can ship before its art does.
  acorn: (
    <g {...S}>
      <path d="M6 8.6h12a1.1 1.1 0 0 0 0-2.2C17.2 4 15 2.6 12 2.6S6.8 4 6 6.4a1.1 1.1 0 0 0 0 2.2z" />
      <path d="M7 8.6c0 5.6 2.2 12.8 5 12.8s5-7.2 5-12.8" />
    </g>
  ),
  bead: (
    <g {...S}>
      <path d="M3 12h18" />
      <circle cx="6.8" cy="12" r="2.6" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <circle cx="17.2" cy="12" r="2.6" />
    </g>
  ),
  boot: (
    <g {...S}>
      <path d="M6 3.4h4.6v8.8l6.2 2.4a3.2 3.2 0 0 1 2 3v3H6z" />
      <path d="M6 16.6h12.8" />
    </g>
  ),
  cake: (
    <g {...S}>
      <path d="M4.4 20.6v-5.4a2 2 0 0 1 2-2h11.2a2 2 0 0 1 2 2v5.4z" />
      <path d="M4.4 16.6c1.6 1.4 3.2 1.4 4.8 0s3.2-1.4 4.8 0 3.2 1.4 4.8 0" />
      <path d="M12 13.2V9.6" />
      <circle cx="12" cy="7.6" r="1.6" fill="currentColor" />
    </g>
  ),
  charm: (
    <g {...S}>
      <path d="M9.4 3.4h5.2l-1.2 3.2a4.6 4.6 0 1 1-2.8 0z" />
      <circle cx="12" cy="14.4" r="1.6" fill="currentColor" />
    </g>
  ),
  crown: (
    <g {...S}>
      <path d="M3.4 18.6h17.2l1.2-10.4-5.6 3.8L12 5l-4.2 7-5.6-3.8z" />
      <path d="M6.6 21.4h10.8" />
    </g>
  ),
  drop: (
    <g {...S}>
      <path d="M12 3c3.7 4.7 5.7 7.6 5.7 10.2a5.7 5.7 0 0 1-11.4 0C6.3 10.6 8.3 7.7 12 3z" />
    </g>
  ),
  feather: (
    <g {...S}>
      <path d="M18.8 3.4c-6.2.4-10.7 3.4-12 8.4-.6 2.4-1.4 4-3.2 6.2l1.6 1.6c2-1.6 3.6-2.5 6-3 5-1 7.9-5.4 7.6-13.2z" />
      <path d="M6.4 19.2L15.4 9" />
    </g>
  ),
  lantern: (
    <g {...S}>
      <path d="M9 3.4h6M10.4 3.4v2.4M13.6 3.4v2.4" />
      <path d="M8 5.8h8l1.3 10.4a2 2 0 0 1-2 2.2H8.7a2 2 0 0 1-2-2.2z" />
      <path d="M10 20.6h4M11 10v4.4M13 10v4.4" />
    </g>
  ),
  leaf: (
    <g {...S}>
      <path d="M20.4 3.6C10.6 3.6 4.6 7.8 4.6 14.4c0 2 .6 3.7 1.7 5.1 8.2-.4 13.7-5.8 14.1-15.9z" />
      <path d="M6.3 19.5L15 10.4" />
    </g>
  ),
  note: (
    <g {...S}>
      <path d="M10.6 17.4V4.6l7.8-1.6v12" />
      <circle cx="7.6" cy="17.4" r="3" />
    </g>
  ),
  pin: (
    <g {...S}>
      <path d="M12 21.6v-8.4" />
      <path d="M8.2 3.4h7.6l-1.2 5.4 2.6 2.8H6.8l2.6-2.8z" />
    </g>
  ),
  ribbon: (
    <g {...S}>
      <path d="M11.4 12L5.4 7.4v9.2z" />
      <path d="M12.6 12l6-4.6v9.2z" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </g>
  ),
  thorn: (
    <g {...S}>
      <path d="M3.6 20.4c6.4-.6 11-3.8 13.6-9.6" />
      <path d="M7.6 16.2l-3.4-1.4 1.2 3.6M12 12.6l-3.2-1.8.7 3.7M15.6 7.8l-2.8-2.3.2 3.8" />
      <path d="M17.2 10.8l3.2-2.4-3.8-.6z" fill="currentColor" />
    </g>
  ),
  whistle: (
    <g {...S}>
      <path d="M4.6 9h9.6l5.8-2.6v9.4L14.2 13H9.4v3.6a2.4 2.4 0 0 1-4.8 0z" />
      <circle cx="9.4" cy="11" r="1.2" fill="currentColor" />
    </g>
  ),

  // --- Keeping your characters (architecture §4.5) ----------------------
  // The one adult-facing corner of the game, so these read as *stationery and
  // keepsakes* rather than as security furniture. No padlocks and no shields:
  // this is a memory box, not a login.
  envelope: (
    <g {...S}>
      <rect x="2.8" y="5.4" width="18.4" height="13.2" rx="2.4" />
      <path d="M3.4 7l7.4 5.4a2 2 0 0 0 2.4 0L20.6 7" />
    </g>
  ),
  passkey: (
    <g {...S}>
      {/* A key whose bow is a small flame — the same mote the lantern holds,
          so "one tap next time" and "kept" are visibly the same idea. */}
      <path d="M9.6 4.2c1.9 2.2 3.2 3.3 3.2 5.3a3.2 3.2 0 0 1-6.4 0c0-1.2.6-2 1.3-2.6.2.7.7 1.2 1.3 1.2.5 0 .8-.4.8-1 0-1-.8-1.8-.2-2.9z" />
      <path d="M9.6 12.8v6.8" />
      <path d="M9.6 15.6h2.6M9.6 18.2h2" />
      <circle cx="16.4" cy="16.4" r="2.6" />
    </g>
  ),
};

/**
 * Names that mean the same picture. Chapter content is written by hand, so it
 * uses the word an author reaches for ("fist"), not our internal stat id.
 */
const ALIASES: Record<string, string> = {
  // spec §4.1 lists two icon senses per stat; both resolve to the stat glyph.
  fist: "might",
  boulder: "might",
  wing: "quick",
  spark: "clever",
  // Heart's senses are their own glyphs — a flame and a hand read differently
  // as choices, so they stay distinct and only `heart` maps to the heart.
  strength: "might",
  speed: "quick",
  mind: "clever",
  // Item kinds and common content synonyms.
  potion: "consumable",
  gem: "trinket",
  key: "quest",
  item: "bag",
  inventory: "bag",
  shield: "guard",
  moon: "rest",
  // Interface synonyms.
  roll: "d20",
  die: "d20",
  d20icon: "d20",
  next: "forward",
  prev: "back",
  confirm: "check",
  cancel: "close",
  surprise: "shuffle",
  players: "party",
  phone: "travel",
  hp: "heart",
  xp: "star",
  chapter: "scroll",
  story: "scroll",
  encounter: "swords",
  choice_point: "vote",
  // Keeping your characters. `keepsake` is the lantern because the lantern is
  // the motif the whole flow is built on (see KeepsakeLantern.tsx).
  keepsake: "lantern",
  mail: "envelope",
  email: "envelope",
  code: "envelope",
  signin: "lantern",
};

const DEFAULT_SIZE = "1em";

/**
 * The one icon component. Never throws, never renders nothing: an unknown name
 * degrades to a neutral glyph so a typo in chapter JSON cannot break a scene.
 */
export function Icon({ name, label, size = DEFAULT_SIZE, className }: IconProps): ReactElement {
  const key = ALIASES[name] ?? name;
  const glyph = GLYPHS[key] ?? UNKNOWN;
  const decorative = label === undefined;
  return (
    <svg
      className={className === undefined ? "kad-icon" : `kad-icon ${className}`}
      viewBox="0 0 24 24"
      // Sized in CSS rather than by attribute so `size` may be a var() token.
      // The 1em default lives on `.kad-icon` (shared.css): icons are the most
      // rendered component in the app, and allocating a fresh style object per
      // render just to say "1em" again made every one of them a guaranteed
      // DOM-prop diff.
      style={size === DEFAULT_SIZE ? undefined : { inlineSize: size, blockSize: size }}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={label}
      focusable="false"
    >
      {glyph}
    </svg>
  );
}

/** True when `name` has real art. Callers may use it to pick a better label. */
export function hasIcon(name: string): boolean {
  const key = ALIASES[name] ?? name;
  return GLYPHS[key] !== undefined;
}

export const statIcon = (stat: StatId): string => stat;
export const speciesIcon = (species: SpeciesId): string => species;
export const classIcon = (klass: ClassId): string => klass;
export const itemKindIcon = (kind: ItemKind): string => kind;
