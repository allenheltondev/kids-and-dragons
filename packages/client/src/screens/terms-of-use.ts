/**
 * The terms of use (`/terms`), in plain words, for the grown-up reading them.
 *
 * DRAFT. Written by engineering in the voice of the privacy page, and not yet
 * reviewed by a lawyer. The lede says so on the page, the same way the privacy
 * page says its practices have not been reviewed. Before relying on these terms,
 * have counsel check them, especially for an audience under 13. Things a lawyer
 * would normally settle and these words leave alone on purpose: which state's
 * law governs, how disputes are resolved, and any arbitration clause.
 *
 * Like `privacy-policy.ts`, they promise only what the game does today: no
 * accounts for kids, no chat, nothing to buy with real money (Dash Cash and
 * coins are in-game only). `terms.test.tsx` holds them to that.
 *
 * Who runs the game, and how to reach them, comes from `operator.ts`.
 */

import type { PolicySection } from "./privacy-policy";

export const TERMS_UPDATED = "2026-11-10";

export const TERMS_LEDE =
  "These terms are for grown-ups. They are the rules for using Kids & Dragons, the family storytelling game at this address. By playing, or by letting a child in your care play, you agree to them. We have not had these terms reviewed by a lawyer yet. We will update this page when we do.";

/** Everything after "Who runs this", which the page draws from `operator.ts`. */
export const TERMS_SECTIONS: readonly PolicySection[] = [
  {
    id: "grown-ups",
    title: "A grown-up is in charge",
    paragraphs: [
      "Kids & Dragons is made for families to play together, with a grown-up running the game on a big screen or a phone. Kids play without accounts, but a parent or guardian decides whether a child plays, and is responsible for how the game is used by children in their care.",
      "If you set up a household, a family tablet or a group, you are agreeing to these terms for yourself and for the kids who play with it.",
    ],
  },
  {
    id: "playing-kindly",
    title: "Playing kindly",
    paragraphs: ["Please help everyone at the table follow a few simple rules."],
    bullets: [
      "Pick made-up names for heroes and nicknames. Never use a real full name, an address, a school or anything else that could identify a child.",
      "Keep names friendly. The game blocks bad words, but it cannot catch everything, and a grown-up who runs a game can remove a player.",
      "Only join rooms you were invited to, using the code the host shared.",
      "Do not try to break, overload, copy or get around the game, its servers or its rules, or use it to bother other people.",
    ],
  },
  {
    id: "free-to-play",
    title: "Nothing to buy",
    paragraphs: [
      "The game does not sell anything. Dash Cash, coins and everything heroes earn exist only inside the game. They have no real-world value and cannot be bought, sold or traded for money.",
    ],
  },
  {
    id: "whose-is-what",
    title: "Whose is what",
    paragraphs: [
      "The game's stories, pictures, music, characters and software belong to the people who run Kids & Dragons. You may play it and share it with your family, but please do not copy, sell or republish them.",
      "The heroes, names and choices your family makes are yours to enjoy. We keep them only to run the game, as the privacy page explains.",
    ],
  },
  {
    id: "changes",
    title: "When things change",
    paragraphs: [
      "We are still building Kids & Dragons. Chapters, rules and features may change, and we may pause or end the game. We will try to give notice of big changes on this site, but we cannot promise to keep any particular feature, chapter or saved hero forever.",
      "We may also update these terms. The date at the top of this page shows the latest version. If you keep playing after a change, the new terms apply.",
    ],
  },
  {
    id: "as-is",
    title: "The game as it is",
    paragraphs: [
      "Kids & Dragons is offered as it is, without promises that it will always work, be available or be free of mistakes. To the extent the law allows, the people who run it are not responsible for losses that come from using it or not being able to use it.",
      "Nothing in these terms takes away rights that the law gives you and that cannot be signed away.",
    ],
  },
  {
    id: "ending",
    title: "Stopping",
    paragraphs: [
      "You can stop playing at any time, and a signed-in grown-up can delete a kid or a whole household from the game. We may remove a player or close a room that breaks these rules.",
    ],
  },
];
