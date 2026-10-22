/**
 * BadgeArt — the drawn medallion for each badge on a kid's page (#299).
 *
 * Every badge is a brass-rimmed medal on a ribbon with its own emblem in the
 * middle: a book for an adventure finished, a lantern for keeping going, an eye
 * for a sharp-eyed find. Drawn as SVG, like the class tokens (ClassToken.tsx),
 * so there is no raster art to commission or to 404, and it scales with the
 * text around it. The emblem, not the colour, tells two badges apart (spec §11),
 * and the badge's name is always printed beside it, so the picture is
 * decorative.
 *
 * Badge ids are the server's (shared kid-profile.ts): `finished:<campaignId>`
 * and the fixed ones. An id this build has never seen gets the star medal, so a
 * badge from a newer server still shows a medal instead of a hole.
 */

import { useId } from "react";
import type { ReactElement } from "react";

interface Look {
  /** The medal's face, light then dark. */
  face: readonly [string, string];
  /** The ribbon behind it. */
  ribbon: string;
  emblem: () => ReactElement;
}

const CREAM = "#fff3cf";
const GOLD = "#f5c86c";
const INK = "#2a1d3d";

const OUT = { stroke: INK, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" } as const;

/* eslint-disable react/jsx-key -- a static table of drawings, never mapped */
const EMBLEMS = {
  /** An open book with a star over its spine: an adventure seen to the end. */
  book: () => (
    <g {...OUT}>
      <path d="M50 38C43 33 33 33 27 36v26c6-3 16-3 23 2Z" fill={CREAM} />
      <path d="M50 38c7-5 17-5 23-2v26c-6-3-16-3-23 2Z" fill="#ffe7a8" />
      <path d="M50 38v26" fill="none" />
      <path d="M32 43c4-1 8-1 12 1M32 50c4-1 8-1 12 1M56 44c4-2 8-2 12-1M56 51c4-2 8-2 12-1" fill="none" strokeWidth={1.4} />
      <path d="M50 20l3.1 6.3 6.9 1-5 4.9 1.2 6.9L50 36l-6.2 3.1 1.2-6.9-5-4.9 6.9-1Z" fill={GOLD} />
    </g>
  ),
  /** Three books stacked and leaning: a shelf of stories. */
  stack: () => (
    <g {...OUT}>
      <rect x="30" y="55" width="40" height="11" rx="2.5" fill="#ff9aa8" />
      <rect x="34" y="43" width="34" height="11" rx="2.5" fill="#8fe0c0" />
      <rect x="31" y="31" width="38" height="11" rx="2.5" fill={GOLD} />
      <path d="M36 60.5h28M39 48.5h22M36 36.5h28" fill="none" strokeWidth={1.4} />
    </g>
  ),
  /** One big star with sparks: a guest of honour at somebody else's table. */
  star: () => (
    <g {...OUT}>
      <path d="m50 24 7.2 14.6 16.1 2.3-11.6 11.3 2.7 16-14.4-7.6-14.4 7.6 2.7-16L26.7 40.9l16.1-2.3Z" fill={GOLD} />
      <path d="M24 30v8M20 34h8M77 62v7M73.5 65.5h7" fill="none" stroke={CREAM} strokeWidth={2.4} />
    </g>
  ),
  /** A little lantern, lit: still going when it got dark. */
  lantern: () => (
    <g {...OUT}>
      <path d="M44 31c0-5 12-5 12 0" fill="none" />
      <path d="M40 34h20l3 4v22l-4 4H41l-4-4V38Z" fill="#ffd36e" />
      <path d="M44 38h12v22H44Z" fill="#fff3cf" strokeWidth={1.4} />
      <path d="M50 42c4 4 4 8 0 12-4-4-4-8 0-12Z" fill="#ff9a4d" strokeWidth={1.4} />
      <path d="M38 64h24" fill="none" />
    </g>
  ),
  /** A sprout with two leaves: growing strong. */
  sprout: () => (
    <g {...OUT}>
      <path d="M50 68V46" fill="none" strokeWidth={3} />
      <path d="M50 52C40 53 33 47 31 38c10-1 18 3 19 14Z" fill="#8fe0a0" />
      <path d="M50 46c1-10 8-16 19-16 0 10-8 17-19 16Z" fill="#b8f08a" />
      <path d="M38 68h24" fill="none" strokeWidth={3} />
    </g>
  ),
  /** A crown with three jewels: a mighty hero. */
  crown: () => (
    <g {...OUT}>
      <path d="m29 62-3-26 14 12 10-16 10 16 14-12-3 26Z" fill={GOLD} />
      <path d="M29 62h42v6H29Z" fill="#e8a94a" />
      <circle cx="26" cy="35" r="3" fill="#ff9aa8" />
      <circle cx="50" cy="29" r="3.5" fill="#8fd0ff" />
      <circle cx="74" cy="35" r="3" fill="#ff9aa8" />
    </g>
  ),
  /** An open eye: sharp eyes spot the first find. */
  eye: () => (
    <g {...OUT}>
      <path d="M24 50c8-13 18-19 26-19s18 6 26 19c-8 13-18 19-26 19s-18-6-26-19Z" fill={CREAM} />
      <circle cx="50" cy="50" r="11" fill="#6fd6cf" />
      <circle cx="50" cy="50" r="5" fill={INK} />
      <circle cx="46" cy="46" r="2.4" fill="#fff" stroke="none" />
    </g>
  ),
  /** A magnifying glass over a trail of dots: reading the trail. */
  glass: () => (
    <g {...OUT}>
      <circle cx="45" cy="45" r="15" fill="#cfeaff" />
      <path d="m56 56 14 14" fill="none" strokeWidth={5} />
      <path d="M37 40c3-5 8-6 12-5" fill="none" stroke="#fff" strokeWidth={2.4} />
      <path d="M30 70h.1M38 74h.1M46 71h.1" fill="none" strokeWidth={3.5} stroke={CREAM} />
    </g>
  ),
  /** A fat, clasped guide with a gem: a Field Guide getting thick. */
  guide: () => (
    <g {...OUT}>
      <rect x="31" y="27" width="38" height="46" rx="4" fill="#d8644f" />
      <path d="M36 27v46" fill="none" />
      <rect x="41" y="36" width="22" height="14" rx="2" fill={CREAM} strokeWidth={1.4} />
      <path d="M44 41h16M44 45h10" fill="none" strokeWidth={1.4} />
      <path d="m52 56 5 5-5 5-5-5Z" fill="#8fd0ff" />
    </g>
  ),
} satisfies Record<string, () => ReactElement>;
/* eslint-enable react/jsx-key */

const BLUE = ["#9ed0ff", "#3b6fb8"] as const;
const VIOLET = ["#c4a3ee", "#5b3d9b"] as const;
const TEAL = ["#8fe0c0", "#2c8a78"] as const;
const ROSE = ["#ffb3c1", "#b3425f"] as const;
const AMBER = ["#ffd98a", "#c8782c"] as const;
const GREEN = ["#b8e88a", "#3d8a3e"] as const;

const LOOKS: Record<string, Look> = {
  "finished-3": { face: TEAL, ribbon: "#d8644f", emblem: EMBLEMS.stack },
  "guest-star": { face: ROSE, ribbon: "#5b3d9b", emblem: EMBLEMS.star },
  "kept-going": { face: AMBER, ribbon: "#3b6fb8", emblem: EMBLEMS.lantern },
  "level-3": { face: GREEN, ribbon: "#c8782c", emblem: EMBLEMS.sprout },
  "level-5": { face: AMBER, ribbon: "#b3425f", emblem: EMBLEMS.crown },
  "finds-1": { face: BLUE, ribbon: "#2c8a78", emblem: EMBLEMS.eye },
  "finds-5": { face: BLUE, ribbon: "#c8782c", emblem: EMBLEMS.glass },
  "finds-15": { face: BLUE, ribbon: "#b3425f", emblem: EMBLEMS.guide },
};

const FINISHED: Look = { face: VIOLET, ribbon: "#d8644f", emblem: EMBLEMS.book };
const FALLBACK: Look = { face: VIOLET, ribbon: "#3b6fb8", emblem: EMBLEMS.star };

/** The medal for a badge id, as the server names it. */
export function lookOf(id: string): Look {
  return LOOKS[id] ?? (id.startsWith("finished:") ? FINISHED : FALLBACK);
}

export function BadgeArt({ id, className = "" }: { id: string; className?: string }): ReactElement {
  const look = lookOf(id);
  // Several medals share a page, and gradients are found by id.
  const uid = useId().replace(/\W/g, "");
  return (
    <svg className={`badge-art ${className}`.trim()} viewBox="0 0 100 100" aria-hidden="true" focusable="false"
      data-badge={id}>
      <defs>
        <radialGradient id={`${uid}f`} cx="38%" cy="30%" r="80%">
          <stop offset="0" stopColor={look.face[0]} />
          <stop offset="1" stopColor={look.face[1]} />
        </radialGradient>
        <linearGradient id={`${uid}r`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset="0.55" stopColor="#d9a24a" />
          <stop offset="1" stopColor="#9a6a2c" />
        </linearGradient>
      </defs>
      {/* The ribbon tails, behind the medal. */}
      <path d="m30 70-9 26 12-6 6 8 6-26Z" fill={look.ribbon} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <path d="m70 70 9 26-12-6-6 8-6-26Z" fill={look.ribbon} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      {/* The brass rim and the painted face. */}
      <circle cx="50" cy="46" r="40" fill={`url(#${uid}r)`} stroke={INK} strokeWidth={2.5} />
      <circle cx="50" cy="46" r="33" fill={`url(#${uid}f)`} stroke={INK} strokeWidth={2} />
      <path d="M22 40a30 30 0 0 1 20-16" fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={3} strokeLinecap="round" />
      <g transform="translate(0 -4)">{look.emblem()}</g>
    </svg>
  );
}
