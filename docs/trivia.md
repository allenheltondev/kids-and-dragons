# Trivia: the Field Guide quiz in the adventure book

**Status: proposed (2026-11-17).** Decisions marked *decided* are the product owner's own, from
2026-11-17. Everything else is a proposal for review. Nothing here is built.

**Review status:** repository references are implementation context. File names, type names and
interfaces below are the intended shape. They may be refined during implementation as long as the
behavior they describe holds.

**Purpose:** the Field Guide (spec §12) is the realm's canon written for an eight-year-old, and a
lot of work went into it. Most kids open a page once, when the toast says "New in your Field
Guide", and never go back. Trivia gives a kid a reason to read the guide between games. It turns
what she has met into questions, and turns right answers into badges and cosmetics for her heroes
and their tents. A kid who remembers the lore also follows the table better: "Last time…", the
callbacks, and the creature tips that win fights.

## 1. What it is, and what it is not

- **It is** a multiple-choice quiz in the adventure book. Each question has four options
  (*decided*). The questions are only ever about Field Guide pages this household has found. Right
  answers count toward a ladder of rewards: badges on her profile, and looks and tent decorations
  for her heroes (*decided*).
- **It is hard enough to mean something** (*decided*: "not a softball"). The ladder asks for a
  real number of right answers (§5). A wrong answer is never explained and can't be retried on the
  spot (§4).
- **It points back at the guide** (*decided*). A wrong answer about a creature or a biome offers a
  link to that part of the Field Guide. She reads it there, and the question comes back later.
- **It is not** a way to get stronger. No XP, coins, items, stat points or Help dice. Rewards are
  cosmetic, like every look and kit piece (docs/hero-looks.md §6, docs/camp.md §5), so a kid who
  quizzes in the car never sits down at the table ahead of a sibling who doesn't.
- **It is not** a spoiler. A question names only what this household has already found. That
  covers its answer, its wrong options and its link. An undiscovered page stays a "?" card.
- **It is not** shared. The crew's camp, its shop and its votes stay at the table (docs/camp.md
  §7). Trivia rewards are each kid's own: her badges, her heroes' looks, her heroes' tent
  decorations.

## 2. Where it lives

- **In the Guide.** The Guide pane of the adventure book gets a **Quiz** button beside its progress
  line. It isn't a new tray object, since the tray already holds Hero, Map, Guide, Camp and Play.
  The quiz opens over the guide, so "go read about it" means closing the quiz, not going somewhere
  new.
- **Whenever the book is open, and offline.** The quiz is available wherever the book opens: on the
  home screen between games, and on the in-game tray during downtime (the lobby, a rest, the
  chapter's end), with the same rules as `layout/BookTab.tsx`. It never covers a scene, a check or
  a fight. A family tablet's book (always on the tray) hides the Quiz button while a scene, check or
  fight is live.
- **One kid at a time.** The quiz belongs to the player profile on that phone, not to a hero or a
  crew. A family tablet asks whose quiz it is, the same way its book asks whose kit it is.

## 3. The questions

### 3.1 Authored, with a drafting tool

Questions are **authored content**, in `content/trivia.json` (schema `schemas/trivia.schema.json`,
types in `packages/shared/src/types/trivia.ts`), and checked by `npm run content:validate`. They
are not generated at runtime. Two reasons:

1. **Reading level.** Guide prose is written to be read aloud ("more heirloom than armor"). A phone
   question that a kid reads alone needs short options. Machine-cut options from `lore.pastimes`
   would be long and hard to tell apart.
2. **Not a softball.** A good wrong option is plausible: another creature that also lives near
   water, or a pastime that sounds like it could be this creature's. Picking those takes a human.

So that authoring is mostly editing, not starting from a blank page, `npm run trivia:draft --
<entry-id>` proposes candidate questions from the entry's fields. Wrong options are drawn from
other entries of the same kind. A writer keeps, rewrites or drops each one.

### 3.2 The shape of a question

```jsonc
{
  "id": "creature.bone_crawler.shell",
  "entry": "creature.bone_crawler",          // the Field Guide page it is about
  "ask": "What does a bone crawler build its shell from?",
  "answer": "Old fossil pieces",
  "wrong": [                                  // 5 or 6: three are drawn each time it is asked (§4.2)
    "River pebbles",
    "Other crawlers' claws",
    "Broken pots",
    "Dragon scales",
    "Woven seaweed"
  ],
  "also": ["creature.restless_remains"],     // other pages the question or its options name (§3.3)
  "link": "entry"                             // "entry" | "shelf" | "none" (§4.3)
}
```

- **Every question has one Field Guide `entry`.** It is in the pool only once the household has
  found that entry.
- **`also` lists every other page the question names**, in the stem or in any option, right or
  wrong. The question is in the pool only when every one of those has been found too. This is the
  spoiler rule: a kid who has never met the Restless Remains never sees the name in a wrong option.
  `content:validate` fails a question that uses another entry's title without listing it in `also`.
  It matches against every entry's `title`, the same way `content:continuity` finds names.
- **Five or six wrong options, not three.** Three are drawn each time the question is asked (§4.2).
- **Words only, under 10 words an option**, and questions under 20 words. A later phase may add
  picture options ("Which one is the Gullet?") from the entity and cast art, which already exists
  for every creature and person.
- **Voice rules apply**: US spelling, no em dashes, warm and never scary. These are the same checks
  as Gemfall text (`spelling.test.mjs`).

### 3.3 Spoiler rules, checked by `content:validate`

- A question's `entry` and every `also` must be ids in `content/field-guide.json`.
- An option or stem that contains another entry's title must list that entry in `also`.
- A protected mystery (a page a chapter reveals with `priority: 1`) gets questions that
  only ask what the page itself says, never what a later chapter reveals about it. This is
  enforced by review, not by the tool, and the authoring guide says so.

### 3.4 How many

Aim for **four or five questions a creature or biome**, and **two or three for every other page**
(peoples, places, folk, classes, factions). At today's 75 entries (19 creatures and 13 biomes, so
32 of them) that is roughly 130 + 110 = **about 240 questions** for a household that has found
everything. The ladder (§5) is sized so that its top rungs need most of the guide discovered:
playing unlocks questions, and questions unlock rewards.

## 4. A round

### 4.1 Asking

- A round is **8 questions**, about three or four minutes in the car. She can stop at any time,
  and every answer so far is kept.
- Questions are drawn from **her available pool**: questions whose `entry` and `also` the household
  has found, that she has not yet answered right, and that are not cooling down (§4.2). Questions
  about pages found most recently are drawn a little more often, so a new find shows up soon.
- If the pool holds fewer than 8 questions, the round is shorter. If it is empty, the Quiz button
  says why: "You've answered everything you've found. Go find more!" or "Back tomorrow:
  some questions are resting." This is the brake on endless quizzing: the pool refills by playing.
- The four options are shuffled every time a question is asked.

### 4.2 A wrong answer (*decided*)

- **The answer is not shown.** The screen says her pick was not it, gently: "Not this time." It
  doesn't mark the right option, explain it or hint at it.
- **No second try.** The round moves on to the next question.
- **The question goes back into her pool, shuffled.** It cools down until her next round, so it is
  never asked twice in one sitting. When it comes back, three wrong options are drawn fresh from
  its five or six, and the right one is in a new place. A kid who remembers "it wasn't the second
  one" or "it wasn't river pebbles" has learned nothing that counts. The way to answer it is to
  know it.
- **Wrong answers cost nothing else.** No lost progress, no broken streak on the ladder. The only
  cost is that the question doesn't count yet.

### 4.3 The link to the guide (*decided* for creatures and biomes)

After a wrong answer about a **creature or a biome**, the screen offers one button: **"Read about
it in the Field Guide."** The question's `link` says where the button goes:

- **`entry`**: that creature's or biome's page (`selectGuideEntry`). Use this when the question names
  its subject ("What does a bone crawler build its shell from?"). Reading the page is the point:
  the answer is in there, and the question will be back.
- **`shelf`**: the Creatures or Places tab (`selectGuideTab`), not a page. Use this when the answer
  is the subject's name ("Which creature is a hermit crab that moved into history?"). Opening the
  page would give away the answer, so the link sends her to the shelf and the reading is hers to do.
- **`none`**: no button. This is the default for questions about peoples, folk, places other than
  biomes, classes and factions, as decided. It can be revisited once creatures and biomes have been
  watched in use.

`content:validate` fails a creature or biome question with `link: "none"`, a `link: "entry"`
whose correct answer is the entry's own title, and any `link` on a question that isn't about a
creature or biome. Following the link ends the round's current question (already marked wrong),
closes the quiz onto the guide, and keeps the rest of the round for when she comes back.

### 4.4 A right answer

The right option glows, there's a small chime, and the question is **mastered**. It leaves her
pool for good and counts once toward the ladder. A mastered question is never asked again, so
right answers can't be farmed.

## 5. The ladder (*decided*: badges and cosmetics for heroes and camp)

Right answers are counted per kid (player profile), across every hero and campaign. Each rung
grants once and is never taken back, the same as every look and kit receipt.

| Mastered | Badge | Hero look | Tent decoration |
|---:|---|---|---|
| 10 | **Curious Reader** | | `deco_quiz_bookmark` |
| 25 | | title **the Learned** | |
| 50 | **Lore Hound** | nameplate frame **Scroll** | |
| 80 | | | `deco_quiz_lamp` |
| 120 | **Sage of the Guide** | special **Inkglow** (sparkle variant) | |
| 175 | | title **the Well-Read** | `deco_quiz_bookshelf` |
| 220 | **Keeper of Every Page** | nameplate frame **Gilded Scroll** | |

The names, ids and counts are placeholders for the owner to set. The shape is the proposal:

- **The first reward is reachable early** (10). A kid who has played two or three chapters has
  enough finds to get there, so she learns the quiz pays.
- **The middle needs real reading** (50 to 120). With wrong answers cooling down and coming back
  with new options, getting here means knowing pages, not guessing.
- **The top needs most of the guide found** (175 and up, out of about 240). These rungs come from
  playing campaigns as much as from quizzing.
- **A separate "first try" track** for badges only: **Sharp Memory** at 25 questions mastered on the
  first ask, and **Never Forgets** at 100. These reward knowing it cold without making the main
  ladder harsher.

### 5.1 How a reward reaches her heroes

- **Badges** are hers, on her profile page. `kid-profile.ts` computes badges from rows the game
  already keeps (`BadgeInput`). It gains `trivia: { mastered: number; firstTry: number }`, and the
  trivia badges sit beside the find and level badges.
- **Looks** are written as receipts on **each of her heroes'** looks, with a new source, `{ from:
  "trivia", rung: number }` beside `starter`, `found` and `milestone` (`types/look.ts`). The look
  shelf names where it came from: "From the quiz." Only looks every species can wear are used
  (titles, frames, specials), never a coat, so every hero she has gets every quiz look. A hero she
  makes later is backfilled on read, the way milestone looks are (`readEarnedLook`).
- **Tent decorations** are written as kit receipts on each of her heroes (`KitUnlock`, new `from:
  "trivia"`). They show in her hero's own tent slots in every crew's camp she plays in. They are
  never crew pieces, because a crew's camp is shared (docs/camp.md §7).
- **New art is owed**: three decorations, two frames and one special. These are declared in
  `assets/manifest.json` and owed in `npm run art:inventory`, through the art-creation skill. Until
  their art ships, those rungs give the badge or look that is already drawable, and the
  decorations wait. This is how milestone tents wait for theirs (`camp.json` → `milestones`).

## 6. Records, and offline

### 6.1 What is stored

One record per player profile, `TriviaRecord`, kept beside her profile (store `repository.ts`):

```ts
interface TriviaRecord {
  v: number;
  /** Question id → when it was mastered, and whether on the first ask. */
  mastered: Record<string, { at: string; firstTry: boolean }>;
  /** Question id → when it was last answered wrong (its cooldown, §4.2). */
  missed: Record<string, string>;
  /** The rungs granted, so a grant is never written twice. */
  rungs: number[];
}
```

It rides the book's read (`JournalResponse.trivia`, optional like `camp` and `story`) and is saved
with the book in IndexedDB, so the quiz opens offline from the last copy the phone read.

### 6.2 Answering offline

The quiz has to work in the car, so the phone holds the whole question bank (it ships with content,
like `field-guide.json`), including the right answers. The phone marks answers on the spot. **The
server decides what counts**:

- Each answer is queued as `{ questionId, optionsShown, picked, at }` and sent over the same queue
  and device binding as book kit edits (`store/kit-queue.ts`, `POST /api/journal/trivia`).
- The server checks each answer: the question exists, its `entry` and `also` are in the household's
  guide, the picked option was one of the four shown, and it is the right one. Then it merges the
  answer into the record (mastered is a union; a later right answer clears a miss), grants any new
  rung, and returns the record.
- **The device wins, as for kit edits**, because a kid's quiz is only on her one phone. Two
  devices for one profile simply union.
- Rewards show on the phone at once ("You earned the Learned!") and are confirmed when the queue
  drains. A rung the server refuses (which should never happen to an honest phone) is taken off the
  phone's copy on the next read. This is the one case where something shown can be withdrawn, and
  it needs a tampered client to happen.

Keeping the answers on the phone means a determined adult could read them out of the bundle. That
is acceptable: the rewards are cosmetic, and the server still refuses answers about pages the
household hasn't found.

## 7. What it costs to build, in order

1. **Content and validation**: `trivia.json`, its schema and types, the spoiler and link checks in
   `content:validate`, and `trivia:draft`. Write the creature and biome questions first.
2. **Rules in shared**: the pool (found entries, mastered, cooling down), drawing a round and its
   options, marking an answer, and the ladder. All pure and all tested, like `look-unlocks.ts`.
3. **Server**: `TriviaRecord`, the answer endpoint, rung grants writing look and kit receipts,
   badges, and the journal read.
4. **Client**: the Quiz button and round screen in the Guide pane, the guide links, the offline
   queue, and reward toasts.
5. **Art**: the ladder's decorations, frames and special.

Phase 1 can ship with the badges and the looks that need no new art (titles), and the rest as its
art lands.

## 8. Open questions for the owner

1. **The ladder's numbers and rewards** (§5): the counts, the names, and how many rungs give a tent
   decoration and how many give a look.
2. **The cooldown**: until her next round (proposed), or until the next day? A day is stricter, but
   it can empty a small pool for the rest of a car ride.
3. **The link for other pages**: peoples and places are as much the lore as creatures. Should
   `entry` and `shelf` links open to them after the first version?
4. **Story questions**: the p1 scenes a household visited (the end-of-chapter recap's revelations)
   would make good questions too. They have the same spoiler shape but need a "visited" record per
   household. Proposed as a later phase, not this one.
5. **The table version**: one shared question on the TV in the lobby, answered from each phone,
   from the same bank. This could come after the book's quiz has been watched in use.
