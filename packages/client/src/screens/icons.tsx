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

const GLYPHS: Record<string, ReactElement> = {
  // --- Choice icons used by chapter content -----------------------------
  eye: (
    <g {...S}>
      <path d="M2 12c5-8 15-8 20 0-5 8-15 8-20 0Z" />
      <path d="M12 8c-4 0-4 8 0 8s4-8 0-8Zm-7-3-1-2m8 1V2m7 3 1-2" />
    </g>
  ),
  ear: (
    <g {...S}>
      <path d="M8 21c-2-1-3-3-3-7V8c0-5 9-7 13-2 4 5-1 7-4 9-2 2-1 6-6 6Z" />
      <path d="M9 10c-1-4 6-4 6 0l-4 3" />
    </g>
  ),
  flame: (
    <g {...S}>
      <path d="M12 2c5 5 8 8 8 12a8 8 0 0 1-16 0c0-3 2-5 4-6 0 4 5 3 4-6Z" />
      <path d="M12 12c-5 4-4 7 0 7s5-3 0-7Z" />
    </g>
  ),

  // --- Items (spec §9.2) ------------------------------------------------

  // --- Dice (spec §4.1 — one die, one animation) ------------------------
  d20: (
    <g {...S}>
      <path d="M12 2 21 7v10l-9 5-9-5V7Z" />
      <path d="M12 2 7 10h10Zm-5 8 5 12 5-12M3 7l4 3-4 7m18-10-4 3 4 7" />
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
      <path d="M12 2L21 7v10l-9 5L3 17V7Z" fill="currentColor" opacity="0.18" />
      <path d="M5.6 8.2h12.8L12 19.6z" fill="currentColor" opacity="0.3" />
      <path d="M12 2L21 7v10l-9 5L3 17V7Z" strokeWidth="1.4" />
      <path d="M5.6 8.2h12.8L12 19.6z" strokeWidth="1.4" />
      <path
        d="M12 1.8L5.6 8.2M12 1.8l6.4 6.4M3 7l2.6 1.2M21 7l-2.6 1.2M3 17l2.6-8.8M21 17l-2.6-8.8M12 19.6v2.6"
        opacity="0.8"
      />
    </g>
  ),
  dice: (
    <g {...S}>
      <path d="M7 3 19 4l2 14-3 3-14-2L3 7Z" />
      <path d="M8 8h.01m4 4h.01m4 4h.01" />
    </g>
  ),

  // --- Interface --------------------------------------------------------
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
  travel: (
    <g {...S}>
      <path d="M7 2h10l2 3v15l-2 2H7l-2-2V5Z" />
      <path d="M5 6h14m-8 13h2m-4-8 3-2 3 2-3 4Z" />
    </g>
  ),
  play: (
    <g {...S}>
      <path d="M6 3c5 1 10 5 15 9-5 4-10 8-15 9Z" />
      <path d="M10 8v8l6-4Z" />
    </g>
  ),
  waiting: (
    <g {...S}>
      <path d="M5 3h14M5 21h14M7 3c-1 4 0 6 5 9-5 3-6 5-5 9m10-18c1 4 0 6-5 9 5 3 6 5 5 9" />
      <path d="M9 6h6l-3 3Zm0 12 3-3 3 3Z" />
    </g>
  ),
  // Placeholder glyph for Numbed (#227) until the effect sheet lands: a
  // drooping spine with a drop of poison, distinct by shape from every status.
  numbed: (
    <g {...S}>
      <path d="M12 3c-1 4-4 7-4 11a4 4 0 0 0 8 0c0-4-3-7-4-11Z" />
      <path d="M12 8v6m-2-2 2 2 2-2" />
      <path d="M5 21h14" />
    </g>
  ),
  // Placeholder glyph for a puffed-up enemy (#227): a round body ringed with
  // spines, so it reads by shape and not by colour.
  puffed: (
    <g {...S}>
      <circle cx="12" cy="12" r="5" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" />
      <path d="M10 11h.01M14 11h.01" />
    </g>
  ),
  levelup: (
    <g {...S}>
      <path d="M4 16 2 9l6 3 4-9 4 9 6-3-2 7-8 5Z" />
      <path d="M8 16h8m-4-5v5" />
    </g>
  ),
  down: (
    <g {...S}>
      <path d="M3 19h18M4 15l4-3 4 2 4-3 4 4" />
      <path d="M4 8c0-4 6-4 6 0s-6 4-6 0Zm11-5 3 3-3 3m3-3h-5" />
    </g>
  ),
  ready: (
    <g {...S}>
      <path d="M12 2 20 6v9l-8 7-8-7V6Z" />
      <path d="M8 12l3 3 5-6" />
    </g>
  ),
  vote: (
    <g {...S}>
      <path d="M7 3h10l-1 8H8ZM4 13l4-3m8 0 4 3v8H4v-8Z" />
      <path d="M9 6l2 2 3-3m-6 9h8" />
    </g>
  ),
  rest: (
    <g {...S}>
      <path d="M16 3C2 0 0 19 12 21c5 1 8-2 9-6C10 19 7 7 16 3Z" />
      <path d="M18 5v4m-2-2h4" />
    </g>
  ),

  // --- Content icons -----------------------------------------------------
  // Every `icon` string in content/rules.json, content/items.json and the
  // chapters resolves to something here. A name that does not still renders
  // (the fallback glyph), which is why a new item can ship before its art does.
  leaf: (
    <g {...S}>
      <path d="M4 20C-1 8 10 3 21 3c0 11-5 20-17 17Z" />
      <path d="M7 17 17 7m-6 7 4-1" />
    </g>
  ),
  thorn: (
    <g {...S}>
      <path d="M3 21c10-2 15-8 17-18" />
      <path d="M6 19l-3-5 6 2m3-3-2-6 6 2m2-3 4 1" />
    </g>
  ),
  // The party's purse: a coin with a stamped center.
  coin: (
    <g {...S}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
    </g>
  ),

  // --- Keeping your characters (architecture §4.5) ----------------------
  // The one adult-facing corner of the game, so these read as *stationery and
  // keepsakes* rather than as security furniture. No padlocks and no shields:
  // this is a memory box, not a login.
  envelope: (
    <g {...S}>
      <path d="M3 6l9-3 9 3v13H3Z" />
      <path d="M3 6l9 8 9-8m-18 13 6-7m12 7-6-7" />
    </g>
  ),
  passkey: (
    <g {...S}>
      <path d="M9 3c8 7 5 11 1 11S2 10 9 3ZM10 14v7h5v-3h-5" />
      <path d="M9 8v3m8-7v4m-2-2h4" />
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
  coins: "coin",
  purse: "coin",
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
