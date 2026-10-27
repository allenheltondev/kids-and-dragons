/**
 * The privacy policy (#523), in plain words, for the grown-up reading it.
 *
 * It describes what the game does today, read from the code and the stack, and
 * claims nothing more: not compliance with any law, not a retention limit that
 * is not enforced yet, not a promise about a vendor's logs nobody has checked.
 * The audit behind each line is in docs/review/ (us-coppa-data-consent.md,
 * us-third-party-flows.md, us-retention-schedule.md). When one of those changes
 * what is true, this file changes with it; `privacy-policy.test.ts` holds it to
 * the claims it must never make again.
 *
 * Who runs the game, and how to reach them, is the one thing this file cannot
 * know. It lives in `operator.ts`, and the page says so plainly while it is
 * empty rather than showing a made-up address.
 */

export const PRIVACY_UPDATED = "2026-10-27";

export interface PolicySection {
  id: string;
  title: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
}

export const PRIVACY_LEDE =
  "This page is for grown-ups. It says what Kids & Dragons collects, why, who else handles it, how long it is kept and what you can do about it. We have not had these practices reviewed by a lawyer or an outside privacy program yet, so we do not claim they meet any particular law.";

/** Everything after "Who runs this", which the page draws from `operator.ts`. */
export const PRIVACY_SECTIONS: readonly PolicySection[] = [
  {
    id: "what-kids-give",
    title: "What kids give the game",
    paragraphs: [
      "Kids play without accounts. To sit at a table, a kid gets a nickname and makes a hero.",
    ],
    bullets: [
      "A nickname, a color and an avatar from a short list. The nickname can be typed. The game checks it for bad words, but it cannot tell a real name from a made-up one, so please help kids pick a made-up name.",
      "A hero: a name (also typed or chosen), a kind, a look, and everything the hero earns.",
      "What the party does in a game: the choices made and the dice rolled, in order, so a phone that drops out can catch up.",
      "A name for the table, if a grown-up types one on the big screen.",
      "A random id for each phone or tablet, and its browser's own description of itself, so a grown-up can tell tablets apart.",
    ],
  },
  {
    id: "what-kids-do-not",
    title: "What we do not ask kids for",
    paragraphs: [
      "No real name, birthday, photo, voice recording, location, address, phone number or contact list is asked for, and kids have no login or password. There is no chat between players. The game does not use the microphone, the camera or the phone's location.",
    ],
  },
  {
    id: "what-grown-ups-give",
    title: "What grown-ups give",
    bullets: [
      "Only if a grown-up chooses to keep a household: an email address, used to send a sign-in code. It is held by Amazon Cognito, the sign-in service, and a copy is kept with the household's list of grown-ups so they can tell each other apart. A grown-up may also add a passkey.",
      "Only if a grown-up turns it on in the installed app: a push address from the phone's own push service, so the game can say “It’s your turn.”",
    ],
  },
  {
    id: "automatic",
    title: "What is collected automatically",
    bullets: [
      "Like any website, our hosting sees the network address and browser description of every phone or screen that loads the game.",
      "When someone tries a wrong room code, we count it against their network address for about half an hour, so nobody can guess their way into a game.",
      "When the game breaks, it sends one short crash report: what kind of failure, which version, which page and whether it was a phone, tablet or TV. It never includes what the error said, so nothing a kid typed is in it.",
      "Our servers keep request logs to run the game. We have not yet confirmed how long our hosting provider keeps logs and backups, and we will not state a period here until we have.",
      "To learn how long chapters take, we record the time of each chapter's steps against a random run id, with no names in it. We add these up ourselves, across families, to see how long each chapter takes. They are deleted after 180 days.",
      "The game sets no cookies. Your phone's own storage holds a sign-in token for that phone, settings such as read-aloud, and a copy of your adventure book.",
    ],
  },
  {
    id: "why",
    title: "Why, and what we do not do",
    paragraphs: [
      "We use this to run the game, remember a party between sittings, keep it secure, fix what breaks and measure how long chapters take.",
      "We do not sell it, show ads, use third-party analytics or advertising trackers, or build profiles to market to anyone. The only measuring we do is our own, of how long chapters take, described above. No AI model is called while a table plays; the stories are written ahead of time, and nothing a kid types or does in a game is sent to one.",
    ],
  },
  {
    id: "who-else",
    title: "Who else handles it",
    bullets: [
      "Amazon Web Services runs everything: the website, the database that holds nicknames, heroes and saved games, the sign-in service and the live connection between the big screen and the phones. It handles this only to run the game for us.",
      "If push is turned on, Apple, Google or Mozilla carries each “It’s your turn” message. It is locked so only that phone can read it, but those companies see which device it goes to and when.",
      "Reading aloud uses the voice built into your browser or device. Some browsers use voices that run on the maker’s servers, which would send the words being read, including a hero’s name, to them. We have not confirmed which browsers do this, so treat read-aloud as possibly sending text to your browser’s maker.",
    ],
  },
  {
    id: "how-long",
    title: "How long it is kept",
    bullets: [
      "A household nobody signed in to keep is deleted a week after it last played.",
      "A household a grown-up kept has no automatic end today. It stays until a grown-up deletes it, or, for a kid who stops playing, for the number of days the grown-up chose (30, 90, 180 or 365). We plan to add a time limit and will update this page when we do; until then, please delete what you no longer want kept.",
      "A room code and the record of who was at the table last six hours. One-time codes last from ten minutes to three days.",
      "There is no warning before a household is deleted.",
    ],
  },
  {
    id: "your-choices",
    title: "What a grown-up can do",
    paragraphs: [
      "A signed-in grown-up can see what is kept on the “What we store” page and, from “Run a group”, delete one kid or the whole household, set how long a kid who stops playing is kept, and forget a device. Turning off turn notices stops the push address being used, and deleting a kid removes it.",
      "A household nobody signed in to keep has no grown-up on record, so nothing proves to us who it belongs to and we cannot look one up or delete one on request. It deletes itself a week after it last played. To get one gone sooner, sign in to keep it, then delete it.",
    ],
  },
  {
    id: "consent",
    title: "Kids and permission",
    paragraphs: [
      "Kids can start playing before any grown-up has signed in, and we have not yet built a step that asks a parent to agree first. We are working out the right way to do that. Until we have, please start games yourselves, sit with kids who are new to it, and keep nicknames and hero names made up.",
    ],
  },
  {
    id: "changes",
    title: "Changes",
    paragraphs: ["We will change this page when what the game collects changes, and update the date at the top."],
  },
];
