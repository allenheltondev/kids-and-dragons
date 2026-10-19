/**
 * What the game keeps about a family, in plain words (#252): the page at
 * `/what-we-store`, and its source of truth.
 *
 * Every row the server writes is named here twice: by its name in the data
 * model (architecture.md §3, `rows`) and by the `entity` tag the stores stamp
 * on it (`entities`). `what-we-store.test.ts` reads both from the source, so a
 * new kind of row that is not described here fails the build instead of
 * quietly going unmentioned.
 */

/** Whose it is (architecture §4.5, "Who owns what"). */
export type Owner = "kid" | "hero" | "table" | "grown-up" | "device" | "nobody";

export interface StoredThing {
  title: string;
  /** What it is, for a grown-up. */
  what: string;
  /** How long it is kept. */
  kept: string;
  owner: Owner;
  /** The entities it is, as architecture.md §3 names them. */
  rows: readonly string[];
  /** The same rows, as the stores tag them (`entity`). */
  entities: readonly string[];
  /**
   * For a row whose fields the page describes one by one (the kid's profile,
   * #299): every field of its type. `what-we-store.test.ts` reads the type, so
   * a field added to it and not described here fails the build.
   */
  fields?: Readonly<Record<string, string>>;
}

export const OWNER_LABEL: Record<Owner, string> = {
  kid: "The kid",
  hero: "Her hero's record",
  table: "The table's save",
  "grown-up": "The grown-ups",
  device: "A device",
  nobody: "Nobody in particular",
};

const UNTIL_DELETED =
  "With the household. A household nobody signed in to keep is deleted a week after it last played. A kept one keeps it until a grown-up deletes it, or for the window they chose.";

export const STORED: readonly StoredThing[] = [
  {
    title: "Each kid",
    what:
      "A nickname, a color and an avatar, and when they last played. If a kid chooses to dress up her own page, which she opens from her own phone, that is kept too: a color, a frame for each hero and a title, all picked from a short list, never typed or uploaded. No real name, email, birthday, photo or contact detail is asked for, and no kid ever has a login or a password.",
    kept: UNTIL_DELETED,
    owner: "kid",
    rows: ["Player profile"],
    entities: ["player"],
    fields: {
      id: "A random id.",
      householdId: "Which household she calls home.",
      displayName: "Her nickname.",
      color: "The color her seat shows at a table.",
      avatar: "Her picture from a short list.",
      retired: "That a grown-up took her off the picker.",
      flair: "What she picked for her own page: a color, a frame for each hero, a title. Shown only to her own household and her own devices, never at a table.",
    },
  },
  {
    title: "Each hero",
    what:
      "The hero's name, kind and look, and everything earned: level, points, items and keepsakes, which adventures the hero has finished and is in the middle of, and whether the hero has played the practice. It belongs to the kid and goes wherever she plays.",
    kept: UNTIL_DELETED,
    owner: "hero",
    rows: ["Character"],
    entities: ["character"],
  },
  {
    title: "The Field Guide",
    what:
      "The household's book of discoveries. Each entry says which kid found it first, by an id, not by name.",
    kept: UNTIL_DELETED,
    owner: "table",
    rows: ["Field Guide"],
    entities: ["field-guide"],
  },
  {
    title: "Saved games",
    what:
      "Where the party is in each adventure: the chapter, the road taken, the setbacks, the coins. A game stopped for today is kept as it stood, to pick up another day. Every choice and dice roll in a game is kept in order (the event log), so a phone that drops out can catch up. The hero names of whoever played are in it, until that kid is deleted.",
    kept: UNTIL_DELETED,
    owner: "table",
    rows: ["Campaign run", "Chapter progress", "Game state", "Event log", "Campaign attempt"],
    entities: ["run", "chapter-progress", "state", "event", "campaign-progress"],
  },
  {
    title: "When each phone was last here",
    what: "During a game, the time each phone last said it was still at the table, so the game can wait for it.",
    kept: "Six hours after the last one.",
    owner: "table",
    rows: ["Presence"],
    entities: ["presence"],
  },
  {
    title: "Tables a kid visited",
    what:
      "Which other households' games a kid has played in. It is kept only so that deleting her can find those games and take her name out of them.",
    kept: "Until she, or the household she visited, is deleted.",
    owner: "kid",
    rows: ["Visit"],
    entities: ["visit"],
  },
  {
    title: "A delete still being finished",
    what:
      "While a kid is being deleted: her nickname, her heroes' names and the other households' games still to clean, so that taking her name out of them always finishes, even if something fails part-way.",
    kept: "Until every one of those games is clean, usually moments; if one fails, the next day's tidy-up tries again.",
    owner: "kid",
    rows: ["Forget job"],
    entities: ["forget"],
  },
  {
    title: "Phones and tablets",
    what:
      "A random id for each device, which kid it plays as (or that it is a family tablet), when it was last used, and its browser's own description of itself (the user agent), so a grown-up can tell which tablet is which. The device keeps a token in its own storage; the game keeps only a scrambled copy.",
    kept: "With the household. A grown-up can forget a device at any time, and it is turned away from then on.",
    owner: "device",
    rows: ["Device binding", "Moved device"],
    entities: ["device", "moved-device"],
  },
  {
    title: "The grown-ups",
    what:
      "The household's name, which signed-in grown-ups run it, the email each signed in with, and how long it keeps a kid who stops playing. The sign-in itself is handled by a separate sign-in service, which holds the email.",
    kept: "Until the household is deleted, or that grown-up leaves it.",
    owner: "grown-up",
    rows: ["Household", "Owner", "Account → household"],
    entities: ["household", "owner", "account"],
  },
  {
    title: "One-time codes",
    what: "Codes for joining as an organizer, moving a kid to another home, or pairing a new device.",
    kept: "Until used, or ten minutes to three days.",
    owner: "grown-up",
    rows: ["Organizer invite", "Transfer code", "Pairing code"],
    entities: ["invite", "transfer", "pairing"],
  },
  {
    title: "Room codes",
    what: "The four letters on the big screen, and which game they open.",
    kept: "Six hours.",
    owner: "table",
    rows: ["Room"],
    entities: ["room"],
  },
  {
    title: "Wrong codes",
    what: "How many wrong room codes a network address has tried, so nobody can guess their way into a game.",
    kept: "About half an hour.",
    owner: "nobody",
    rows: ["Code misses"],
    entities: ["code-lookups"],
  },
];

/** What is not in the game's own table, said anyway. */
export const ELSEWHERE: readonly { title: string; what: string }[] = [
  {
    title: "Request logs",
    what: "Our servers log each request (its address, what it asked for, and any error) for a limited time, to keep the game running.",
  },
  {
    title: "Live narration",
    what: "Only when it is switched on: the hero and kid names in a scene are sent to the AI that writes the narration.",
  },
];

/** What deleting does, in the order a grown-up would ask. */
export const DELETING: readonly string[] = [
  "Deleting a kid removes her profile, with the colors, frames and title she picked for her page, her heroes and her phones. Other households' saved games and Field Guides keep their story, and call her \"a friend\" instead.",
  "Deleting a household removes everything in it: its kids, their heroes, its devices, its Field Guide and its saved games. A kid visiting from another household keeps her hero; it lives at her home.",
  "A hero in the middle of an adventure is deleted too. The table she was playing at carries on without her.",
  "Any grown-up who runs a group can delete one of its kids. The whole group can be deleted only by the last grown-up left in it.",
];
