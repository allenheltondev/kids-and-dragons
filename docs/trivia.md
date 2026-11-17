# Trivia: the Field Guide quiz in the adventure book

**Status: design approved (2026-11-17); not built.** Decisions marked *decided* are the product
owner's own, from 2026-11-17, and the owner approved the rest of this doc the same day. Nothing
is still open; §8 lists the later phases.

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
- **Every question shows a picture** (*decided*): the painting of the page it is about. A
  question about the cloud whale has the cloud whale on screen, and a question about the Sallow
  Wastelands has the Wastelands behind it (§3.5).
- **It covers the whole guide** (*decided*): creatures and biomes, and also the four **classes**
  and the **landmarks** (Stone Crossing, the Hollow Gate, Mount Red Sky and the rest), then
  peoples, folk, named characters and factions (§3.4).
- **It points back at the guide** (*decided*). Every wrong answer offers a link to that part of
  the Field Guide. She reads it there, and the question comes back later.
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
  "link": "entry",                            // "entry" | "shelf" (§4.3)
  "image": "creature.restless_remains"       // optional: show another page's painting (§3.5)
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
- **Options are words, under 10 words each**, and questions are under 20 words. The picture is
  the question's own (§3.5). A later phase may add picture options ("Which one is the Gullet?")
  from the entity and cast art.
- **Voice rules apply**: US spelling, no em dashes, warm and never scary. These are the same checks
  as Gemfall text (`spelling.test.mjs`).

### 3.3 Spoiler rules, checked by `content:validate`

- A question's `entry` and every `also` must be ids in `content/field-guide.json`.
- An option or stem that contains another entry's title must list that entry in `also`.
- A protected mystery (a page a chapter reveals with `priority: 1`) gets questions that
  only ask what the page itself says, never what a later chapter reveals about it. This is
  enforced by review, not by the tool, and the authoring guide says so.

### 3.4 How many

| Pages | Today | Questions each | About |
|---|---:|---|---:|
| Creatures | 19 | 4 or 5 | 85 |
| Biomes | 13 | 4 or 5 | 60 |
| Classes (*decided*) | 4 | 5 or 6 | 22 |
| Landmarks (*decided*) | 14 | 3 or 4 | 50 |
| Peoples, folk, named characters, factions | 25 | 2 or 3 | 60 |

That is **about 270 questions** for a household that has found everything.

- **Classes** get the most per page. A kid plays one for months, and the page holds what she
  should know about it: its gear ("What does a Thornguard carry?" a thorn bracer), its home
  landmark (the Dojo), its job at the front or the back, and its three moves by rank ("Which move
  does a Thornguard learn first?" Shove). Questions about other classes' moves teach her what her
  friends at the table can do. The class pages are short today (a line and the `class` block), so
  some questions will draw on `content/abilities.json` too; the answer must still be on the guide
  page, so the link always helps. Where it isn't, the page gains a line first (through
  `canon:field-guide`, never by hand).
- **Landmarks** are the 14 location pages. Nine have a full place write-up (origin, beliefs,
  neighbors) and get 4 questions. Five are short (the Academy, the Conservatory, the Dojo, the
  Rookery, the Whirlpool) and get 2 or 3, mostly tying them to their class or their region ("Which
  heroes train at the Dojo?").

The ladder (§5) is sized so that its top rungs need most of the guide discovered:
playing unlocks questions, and questions unlock rewards. The ladder (§5) is sized so that its top rungs need most of the guide discovered:
playing unlocks questions, and questions unlock rewards.

### 3.5 The picture (*decided*)

Every question is asked over a painting, so the quiz looks like the guide and a kid who has read
the guide recognizes what she is being asked about.

- **By default it is the `entry`'s own painting**, the one its Field Guide page shows (`art` in
  `content/field-guide.json`). A creature, a people, a folk or a person is shown as its figure on
  the guide's card. A biome or another place is shown as its backdrop, filling the top of the
  screen behind the question.
- **`image` names a different page** when the entry's own picture would give the answer away, or
  when another picture fits better. Example: "Who builds their shells from these?" over the
  Restless Remains. It must be the `entry` or in `also`, so it is a page she has found.
- **Today 71 of the 75 pages have a painting.** The four class pages (Thornguard, Duskrunner,
  Starweaver, Songkeeper) have none, so their questions use the class's gear portrait
  (`assets/gear-portraits/<class>`). `content:validate` fails a question that resolves to no
  picture, so a page added to the guide later can't get questions until it has art. That makes
  "every question has a picture" a gate, not a hope.
- **A `link: "shelf"` question still shows its picture.** The painting has no caption, so
  recognizing the bone crawler from its shell is knowing the guide, which is the point. Only the
  name is kept off screen.
- **Offline**, the pictures are the ones the book already saves for the guide once it has been
  opened with a signal (spec §2.3), so the quiz fetches nothing new. A question whose picture is not on the phone
  yet is held back from an offline round rather than shown without one. On a phone, places draw
  the half-size copy (`@0.5x.webp`), as backdrops do everywhere else.

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
- **The question goes back into her pool, shuffled** (*decided*: next round). It cools down until
  her next round, so it is
  never asked twice in one sitting. When it comes back, three wrong options are drawn fresh from
  its five or six, and the right one is in a new place. A kid who remembers "it wasn't the second
  one" or "it wasn't river pebbles" has learned nothing that counts. The way to answer it is to
  know it.
- **Wrong answers cost nothing else.** No lost progress, no broken streak on the ladder. The only
  cost is that the question doesn't count yet.

### 4.3 The link to the guide (*decided*: every kind of page)

After every wrong answer, whatever the page is about, the screen offers one button: **"Read about
it in the Field Guide."** The question's `link` says where the button goes:

- **`entry`**: the page the question is about (`selectGuideEntry`). Use this when the question names
  its subject ("What does a bone crawler build its shell from?"). Reading the page is the point:
  the answer is in there, and the question will be back.
- **`shelf`**: that page's tab (Creatures, Peoples, Classes, Folk, Places or Factions;
  `selectGuideTab`), not the page itself. Use this when the answer
  is the subject's name ("Which creature is a hermit crab that moved into history?"). Opening the
  page would give away the answer, so the link sends her to the shelf and the reading is hers to do.
`content:validate` fails a question with no `link`, and a `link: "entry"` whose correct answer is
the entry's own title. Following the link ends the round's current question (already marked wrong),
closes the quiz onto the guide, and keeps the rest of the round for when she comes back.

### 4.4 A right answer

The right option glows, there's a small chime, and the question is **mastered**. It leaves her
pool for good and counts once toward the ladder. A mastered question is never asked again, so
right answers can't be farmed.

## 5. The ladder (*decided*: badges and cosmetics for heroes and camp, at these counts)

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

The counts are decided. The badge, look and decoration names are working names that may change
when the art is briefed. The shape:

- **The first reward is reachable early** (10). A kid who has played two or three chapters has
  enough finds to get there, so she learns the quiz pays.
- **The middle needs real reading** (50 to 120). With wrong answers cooling down and coming back
  with new options, getting here means knowing pages, not guessing.
- **The top needs most of the guide found** (175 and up, out of about 270). These rungs come from
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

1. **Content and validation**: `trivia.json`, its schema and types, the spoiler, link and picture
   checks in `content:validate`, and `trivia:draft`. Write creatures, biomes and classes first,
   then landmarks, then the rest.
2. **Rules in shared**: the pool (found entries, mastered, cooling down), drawing a round and its
   options, marking an answer, and the ladder. All pure and all tested, like `look-unlocks.ts`.
3. **Server**: `TriviaRecord`, the answer endpoint, rung grants writing look and kit receipts,
   badges, and the journal read.
4. **Client**: the Quiz button and round screen in the Guide pane (each question over its
   picture), the guide links, the offline queue, and reward toasts.
5. **Art**: the ladder's decorations, frames and special.

Phase 1 can ship with the badges and the looks that need no new art (titles), and the rest as its
art lands.

## 8. Later phases (*decided*: planned, not in this one)

1. **Story questions.** Questions about the revelations (the `priority: 1` scenes) a household
   actually visited, the ones the end-of-chapter recap retells. They have the same spoiler shape as
   guide questions, but each needs a record of which p1 scenes the household has seen. The picture
   is the scene's backdrop, and the link goes to the Story page.
2. **Picture options.** "Which one is the Gullet?" with four portraits as the options, from the
   entity and cast art. The same rules apply: every portrait must be a page she has found, and the
   wrong portraits are drawn fresh each time.

A shared question on the TV in the lobby was considered and is not planned.
