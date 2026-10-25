/**
 * Shared icons: painted game artwork and purpose-built SVG glyphs.
 *
 * spec §1.5 ("iconography carries the text") and the roadmap's "icons before
 * text" rule mean no interactive element ships without an icon — so the icon
 * lookup can never be the thing that breaks a scene. Every unknown name falls
 * back to a neutral glyph instead of throwing or rendering nothing.
 *
 * No icon library: an 8-year-old's TV is 3 metres away, the glyphs have to be
 * heavy and few, and we own the whole set anyway (roadmap ch.1, Allen
 * commissions the finished art). These purpose-built storybook glyphs use rounded, carved outlines,
 * creature silhouettes and enchanted objects. Details stay sparse enough to
 * read at 24px on a phone and at 120px on a TV.
 *
 * spec §11: status is never carried by colour alone, so every status glyph is
 * distinguishable by *shape* — check vs. cross vs. hourglass, not green vs. red.
 */

import type { ReactElement } from "react";
import type { ClassId, ItemKind, SpeciesId, StatId } from "@kad/shared";
import { PAINTED_ART } from "../assets/artwork";

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

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The neutral glyph. Used for any name we do not know. */
const UNKNOWN: ReactElement = (
  <g {...S}>
    <path d="M12 3l7 4v10l-7 4-7-4V7Z" />
    <path d="M12 8l1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" fill="currentColor" stroke="none" />
  </g>
);

/** Geometric controls; story objects are paintings in PAINTED_ART. */
const GLYPHS: Record<string, ReactElement> = {
  back: (
    <g {...S}>
      <path d="M13 4 4 12l9 8v-5h7V9h-7Z" />
    </g>
  ),
  forward: (
    <g {...S}>
      <path d="M11 4 20 12l-9 8v-5H4V9h7Z" />
    </g>
  ),
  check: (
    <g {...S}>
      <path d="M4 12 9 18 20 5" />
      <path d="M4 12l5 3L20 5" />
    </g>
  ),
  close: (
    <g {...S}>
      <path d="M6 4 12 10l6-6 2 2-6 6 6 6-2 2-6-6-6 6-2-2 6-6-6-6Z" />
    </g>
  ),
  // The two sound states are distinguished by *shape* (spec §11): waves out
  // of the speaker versus a cross over where the waves would be.
  sound: (
    <g {...S}>
      <path d="M3 9h4l6-5v16l-6-5H3Z" />
      <path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
    </g>
  ),
  muted: (
    <g {...S}>
      <path d="M3 9h4l6-5v16l-6-5H3Z" />
      <path d="M17 10l5 5m0-5-5 5" />
    </g>
  ),
  plus: (
    <g {...S}>
      <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z" />
    </g>
  ),
  minus: (
    <g {...S}>
      <path d="M3 9h18v6H3Z" />
    </g>
  ),
  shuffle: (
    <g {...S}>
      <path d="M3 5h4c5 0 5 14 10 14h4m-5-4 5 4-5 3" />
      <path d="M3 19h4l3-4m4-6 3-4h4m-5-3 5 3-5 4" />
    </g>
  ),
  qr: (
    <g {...S}>
      <rect x="3.4" y="3.4" width="6.4" height="6.4" rx="2" />
      <rect x="14.2" y="3.4" width="6.4" height="6.4" rx="2" />
      <rect x="3.4" y="14.2" width="6.4" height="6.4" rx="2" />
      <path d="M14.2 14.2h3v3h-3zM20.6 14.2v3M17.2 20.6h3.4" />
    </g>
  ),
  play: (
    <g {...S}>
      <path d="M6 3c5 1 10 5 15 9-5 4-10 8-15 9Z" />
      <path d="M10 8v8l6-4Z" />
    </g>
  ),
};

/**
 * Names that mean the same picture. Chapter content is written by hand, so it
 * uses the word an author reaches for ("fist"), not our internal stat id.
 */
const ALIASES: Record<string, string> = {
  // Synonyms without dedicated paintings keep their shared stat artwork.
  boulder: "might",
  // Heart's senses are their own paintings — a flame and a hand read differently
  // as choices, so they stay distinct and only `heart` maps to the heart.
  strength: "might",
  speed: "quick",
  mind: "clever",
  // Item kinds and common content synonyms.
  gem: "trinket",
  item: "bag",
  inventory: "bag",
  coins: "coin",
  purse: "coin",
  // Interface synonyms.
  roll: "d20",
  die: "d20",
  d20icon: "d20",
  next: "forward",
  prev: "back",
  confirm: "check",
  cancel: "close",
  surprise: "shuffle",
  song: "note",
  players: "party",
  travel: "phone",
  d20_solid: "d20",
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
  const artwork = PAINTED_ART[key];
  if (artwork !== undefined) {
    return <img
      className={`kad-icon kad-icon--painted${className === undefined ? "" : ` ${className}`}`}
      src={artwork}
      alt={label ?? ""}
      aria-hidden={decorative ? true : undefined}
      style={size === DEFAULT_SIZE ? undefined : { inlineSize: size, blockSize: size }}
      draggable={false}
      decoding="async"
    />;
  }
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
  return PAINTED_ART[key] !== undefined || GLYPHS[key] !== undefined;
}

export const statIcon = (stat: StatId): string => stat;
export const speciesIcon = (species: SpeciesId): string => species;
export const classIcon = (klass: ClassId): string => klass;
export const itemKindIcon = (kind: ItemKind): string => kind;
