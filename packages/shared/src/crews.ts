/**
 * The names a household's crews go by (architecture §4.5, "Crews"): a fixed list,
 * so a crew is named by tapping on a TV remote, never by typing, and every name
 * is a kid's. The server picks the next free one for a new crew and accepts only
 * these for a rename; the Room panel offers the same list.
 */
export const CREW_NAMES = [
  "The Otter Crew",
  "The Lantern Crew",
  "The Acorn Crew",
  "The Comet Crew",
  "The Puddle Crew",
  "The Kettle Crew",
  "The Thistle Crew",
  "The Pebble Crew",
] as const;

/** What the household's first crew is called until the household names it. */
export const FIRST_CREW_NAME = "The first crew";
