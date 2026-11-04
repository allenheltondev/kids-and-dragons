# The caravan

**Status: design, nothing built.** Every decision below marked *decided* was made by the
product owner; everything else is a proposal, and the open questions are at the end.

The caravan is the crew's traveling camp. It follows the heroes from chapter to chapter and
campaign to campaign, it grows as they do, and the kids fill it with things they found, things
they bought and creatures they befriended. It is never part of the story. It is the place the
game shows whenever nothing is being told: the lobby, a rest stop, the chapter's end, the
adventure book.

It exists because the game's biggest promise (spec §1.7, *the party is persistent*) is mostly
invisible today. Levels show on the hero, but everything else the crew did lives in a bag, a
Field Guide and a story-so-far. The caravan makes "look at all the things we've done" into
something a kid can point at on the TV.

## 1. What it is, and what it is not

| The caravan is | The caravan is not |
| --- | --- |
| **Cosmetic only** (*decided*). Nothing in it changes a stat, a roll, a fight, a bag slot or a choice. | An equipment system. Spec §9.3 keeps that reward space for the level-up transformation, and the caravan respects it. |
| **The crew's** (*decided*). One caravan per crew (architecture §4.5, "Crews"), so two groups at one household each have their own. | The household's, or one hero's. |
| **Permanent** (*decided*). A failed campaign takes back levels and items (spec §8.3), never the caravan. | A provisional gain. It is the one thing a campaign earns that is kept on failure, which is safe only because it is cosmetic. |
| **Outside the story** (*decided*). Narration never mentions it, never assumes it and never gates on it. | A place a chapter can send the party, or something a scene can say "back at the caravan" about. |
| **Seen in downtime** (*decided*): the lobby, rest stops, the chapter's end and the adventure book, online or off. | A destination that competes with a chapter for the 30 minutes. |
| **Always glad to see you.** | A pet to keep alive. Nothing in it gets hungry, sad, dirty or lost. No timers, streaks, daily rewards or "come back tomorrow". |

The last row is a hard rule. Needs meters and streaks work on guilt and compulsion, and this is
a family game for 8 to 12 year olds. A caravan left alone for a month looks exactly as it did.

## 2. Who it is for

- **The eight-year-old** wants to see Pepper again, tap her and hear her snort. Friends and
  petting are this kid's caravan.
- **The twelve-year-old** finds petting babyish and wants ownership: *my* tent, *our* banner,
  the upgrade *we* voted for, the trophy that proves we beat the volcano. Customizing and showing
  off are this kid's caravan.
- **The grown-up** wants none of it to cost table time or start arguments. That is what the
  downtime-only rule (§3) and the own-space-plus-vote rule (§6) are for.

## 3. Where it appears

The caravan is the **default picture outside narration**. Whenever the shared screen has no
scene to tell, it shows the caravan, parked in the terrain the crew is in. Proposed placement:

| Moment | Shared screen (TV, or a phone's World pane) | Phones |
| --- | --- | --- |
| **Lobby**, while seating and getting ready | The caravan, parked where the crew last stopped. It replaces the lobby's current backdrop; the room code, ready ticks and adventure vote stay on top. | A **Caravan** button beside Ready: tap a friend, change your own space (§6.1). |
| **Rest scene** | The rest scene's narration is read first, as now. Once read, the picture crossfades to the caravan parked in this chapter's terrain, with the scene's words on the plate. | Trading and stat points as now, plus the Caravan button. |
| **Chapter's end** (`chapter_complete`) | After the recap and XP, a short caravan beat: tokens counted in (§5.2), anything found this chapter unpacked onto the caravan, and a big-upgrade vote if the crew can afford one (§6.2). | The vote, and the Caravan button. |
| **Adventure book** (`/journal`, spec §2.3) | n/a | A fifth tray object, **Caravan**: the crew's caravan to look at and tap, online or offline, from the last copy this phone read. |
| **In a scene, a check or a fight** | Never. The story owns the screen. | Never. |

**Nothing waits on the caravan.** The lobby's Begin, the rest scene's Go on and the chapter
end's "back to the lobby" all work exactly as they do now. Begin closes any caravan panel a phone
has open, and an unfinished vote is simply left for next time (§6.2). This keeps the session
budget untouched: the caravan only fills time that already exists.

**Travel Mode** has no TV, so the caravan view lives behind the same Caravan button on each
phone during downtime, and in the World pane during the lobby.

### 3.1 Parked in the right place

Each terrain family (`assets/manifest.json` → `biomeFamilies`, twelve of them) gets one caravan
backdrop: a wide, calm campsite painting with room for the caravan in the middle third and its
hotspots (§4.2) on a fixed layout. The view picks the backdrop from the chapter's biome, and in
the lobby from the chapter the crew would pick up from.

Painting all twelve is a lot of art, so they ship in order of how often a party rests there.
Counting `rest` scenes across today's 42 chapters:

| Terrain family | Rest scenes | Ships |
| --- | --- | --- |
| `red_sky_volcanic` | 31 | First wave |
| `frozen_north` | 26 | First wave |
| `open_plains` | 25 | First wave, and the fallback for every family not painted yet |
| `enchanted_forest` | 7 | Second wave |
| `sky_islands` | 6 | Second wave |
| `whispering_marsh` | 5 | Second wave |
| `cliffside_exchange`, `great_river` | 4 each | Third wave |
| `bone_yard` | 1 | Third wave |
| `expanse`, `skullwater_caverns`, `mermaid_cove` | 0 | When a chapter rests there |

(`sallow_wastelands`, with 3 rest scenes, is in no family today; it falls back to `open_plains`
until it is given one.)

## 4. What is in it

### 4.1 The frame: it grows with the crew

The caravan's size is its **frame**, and the frame grows a stage each time the crew finishes a
campaign, matching spec §8.1's one tier per campaign:

| Stage | Frame | Reached |
| --- | --- | --- |
| 1 | A handcart and a campfire | The crew's first chapter |
| 2 | A covered wagon | First campaign finished |
| 3 | A small caravan: two wagons and a lead animal | Second campaign finished |
| 4 | A traveling camp: wagons, a lookout and banners | Third campaign finished |

The frame is **earned, never bought**, so a crew that spends nothing still watches its caravan
grow. Each stage adds hotspots (§4.2), so a bigger caravan also has more room. When a stage
arrives at the chapter's end it gets its own short moment: the old frame is wheeled off and the
new one rolls in. That's a small cousin of the transformation cutscene, never longer than it.

Only a *finished* campaign moves the frame. A failed campaign keeps everything already in the
caravan (§1) but does not grow it.

### 4.2 Hotspots, not free placement

The caravan is a fixed layout of **hotspots**: the banner pole, the cookfire, the awning, the
lantern hooks, the pen, each hero's space. Changing the caravan is tapping a hotspot and picking
from what the crew owns for it. There is no dragging, no rotating and no free placement.

Hotspots keep it doable for an eight-year-old on a phone, keep every combination looking painted
rather than cluttered, and let the art be composed once per frame stage rather than for every
possible arrangement. They also make the stored state small (§8).

### 4.3 Pieces

A **piece** is anything that goes on a hotspot. Every piece belongs to one hotspot kind and
comes from one of three places:

| Source | How the crew gets it | Examples |
| --- | --- | --- |
| **Found** (§5.1) | A chapter hands it over as part of normal play | A striped awning from the Saltrot market, a cracked bell from the Ashspan Bridge, a pinecone wreath |
| **Bought** (§5.2) | Trail tokens, at the chapter's end, by vote if it is a big upgrade | A cookfire with a kettle, a lookout ladder, a second lantern string |
| **Kept** | Something the game already gives that has nowhere to show | Souvenirs from a failed campaign (spec §8.3), the crew's banner and name (`CrewIdentity`), trophies for each finished campaign |

### 4.4 Friends

A **friend** is a creature the crew befriended in a chapter, who now travels with the caravan.
Friends stand on the pen and campfire hotspots, idle with the existing motion system
(`world/idle-motion.ts`), and react when a kid taps them, using the same reaction model as the
`play` story interaction (content/README.md, "Interactivity"). The reactions are words today;
the caravan is a good reason to give them a little animation.

The first friends almost write themselves, because the story already makes kids care about them:

| Friend | Met in | What befriending already is |
| --- | --- | --- |
| Bun | The Practice Meadow (`first-steps-01`) | "Offer Bun something nice" |
| Pepper | Gemfall 5A | Calming her until her ears come forward |
| The mosshorn | Gemfall 4B | Being gentle until it lowers its antlers |
| A duckling | Riftlight, Ashspan Bridge | Settling the ducklings |
| The kid goat | Riftlight, Exchange Rift | Warming it up together |

Following the continuity rules, a friend joins because a **choice** says so ("Ask Pepper to come
along" beside "Say goodbye"), never because of a variant. Saying goodbye costs the story nothing
and is never sad: the friend waves off, and the chapter goes on.

### 4.5 Each hero's space

Every hero seated with the crew has **one space of their own**: a tent, a bedroll or a wagon
corner, in their own color (the palette rule heroes already use), with two or three small slots
for things they choose. Only that hero's player changes it. It shows whenever the hero is seated,
and a hero sitting with another crew brings their space along, because it belongs to the hero,
not the crew (§8).

## 5. How the crew earns things

There are two ways in, and both happen during normal play.

### 5.1 Finds: pieces handed over in a chapter

*Decided:* chapters drop caravan pieces as part of normal gameplay, the way they drop items now.

A find is a new chapter effect, `findForCaravan: { pieceId }`, beside `grantItem`. It does not
go in a bag, never takes a slot and never vanishes, unlike a quest item (spec §9.2). The phone
says "For the caravan!" with the piece's picture, and the piece is unpacked onto the caravan at
the chapter's end (§3).

Authoring rules, so finds keep to the house rules:

- **A find is a bonus, never a gate.** Nothing in the story checks whether the crew has a piece.
- **A find is a reward for something done**, not a thing lying on the floor: helping at the
  Saltrot steps earns the striped awning; calming the ducklings earns a feather for the banner.
  It lands on the scene that shows the result, like any other choice.
- **The scene names the thing, not the caravan.** "Grandmother Winkle presses a striped awning
  into your hands" reads true for every party. "For your caravan" in narration does not, so that
  line belongs to the phone's notice, outside the narration.
- **A find the crew already owns** turns into trail tokens instead (§5.2), and the notice says so.
- **Finds are a few per campaign, not per chapter.** Roughly one every two chapters keeps each
  one an event.

The pieces live in a catalog of their own, `content/caravan.json` (§8), validated like the rest
of `content/`. They are not world canon in `canon/items.yaml`: a caravan piece is a game object
the crew owns, not an object in the realm's lore.

### 5.2 Trail tokens: points for the crew to spend

*Decided:* chapter points the crew collects and spends on upgrading the caravan. **Trail tokens**
is the working name (open question 1).

Tokens are paid to the **crew**, once, at the chapter's end, from things the chapter already
measures:

| Earned for | Tokens |
| --- | --- |
| Finishing a chapter, any ending | 2 |
| Each step of the chapter's goal ticked (content/README.md, "The chapter's goal") | 1 each, so 2 to 4 |
| Each optional objective met (spec §8.2) | 1 each |
| A find the crew already owns (§5.1) | 1 |

That is about 5 to 8 tokens a chapter, and a big upgrade costs around 10 to 15: one big upgrade
every couple of chapters, and plenty of small ones. The numbers are a starting point for playtest.

Rules, borrowed from what already works for XP:

- **Party-wide, never individual.** Like story XP and objective bonuses, tokens go to the crew,
  so no kid is behind on the caravan.
- **Paid once per crew per chapter.** A chapter the crew has been paid for pays no tokens again,
  the way a chapter pays each hero once (spec §8.2, #408). A crew replaying for the story can
  still find pieces it does not own.
- **A setback ending still pays its finishing and goal tokens.** Failure reroutes; it doesn't
  zero out.
- **Tokens are not coins.** The story's purse (`grantCoins` / `spendCoins`) stays separate, so
  "costs cost" in the story stays a real choice and nobody refuses to pay the ferryman to save up
  for an awning.
- **Kept on a failed campaign**, with the rest of the caravan (§1).

## 6. Who changes what

*Decided:* anyone in the crew can update the caravan; each hero has their own space; big
upgrades go to a vote.

### 6.1 Free changes: any time it is on screen

Tap a hotspot, pick from what the crew owns. These are free, instant and undoable:

- **Shared hotspots** (banner, awning, lanterns, cookfire, pen): any seated player.
- **A hero's space:** only that hero's player.

If two phones pick for one hotspot at once, the later pick wins and the TV shows it; there is
nothing to lose, because the crew still owns both pieces. To keep one kid from redecorating
everything while another watches, a phone may change **one shared hotspot per downtime moment**
(per lobby, per rest stop, per chapter end). Their own space is unlimited.

### 6.2 Big upgrades: spend tokens, by vote

A **big upgrade** is a bought piece: it costs trail tokens and adds something new to the crew's
collection. Spending is a crew decision:

1. At the **chapter's end**, if the crew can afford something, the phones show two or three
   upgrades it can buy, plus "Save our tokens."
2. Every seated player votes, the way a choice point works: most votes wins, and a tie goes to
   the turn marker (spec §6.1). "Save our tokens" is always an option and always free.
3. The winner is unpacked onto the caravan on the TV, and the crew can place it right away.

The vote lives only at the chapter's end, never in the lobby (which already has the adventure
vote and should not hold up Begin) and never at a rest stop (which is for trading and stat
points). If the chapter ends before the vote finishes, nothing is bought and the tokens wait.

The shop is a short, fixed list for each frame stage, so a crew is choosing between a few things
it can picture, never browsing.

## 7. In the adventure book, and offline

The adventure book (spec §2.3) gets a **Caravan** tray object: the crew's caravan, with friends
to tap and every piece's name and where it came from ("Found at the Ashspan Bridge"). The
caravan's record rides in the same `GET /api/journal` read and is saved with the book, so it
opens without a signal like the rest of it.

**In the first version the book is look-only**, keeping its rule that nothing in it can change
anything. A phone between games belongs to one kid, not a crew, so the natural exception later
is letting that kid change **their own hero's space** from the book while online (open question
3). Votes and shared hotspots stay at the table.

## 8. The data

New records (architecture §3), each versioned like every stored shape:

| Record | PK | SK | What it holds |
| --- | --- | --- | --- |
| Caravan, first crew | `HH#<hhId>` | `CARAVAN` | The first crew's caravan (the first crew has no `CREW#` row or id, architecture §4.5). |
| Caravan, other crews | `HH#<hhId>` | `CARAVAN#<crewId>` | The same shape, one per `CREW#<crewId>`. |

```ts
// packages/shared/src/types/caravan.ts (proposed)
interface CaravanRecord {
  version: number;
  frameStage: 1 | 2 | 3 | 4;
  tokens: number;
  owned: Record<PieceId, { from: "found" | "bought" | "kept"; chapterId?: string; at: string }>;
  placed: Record<HotspotId, PieceId>;           // shared hotspots only
  friends: Record<FriendId, { chapterId: string; at: string }>;
  paidChapters: string[];                        // tokens paid once per chapter (§5.2)
}

// on Character (domain.ts, stored at CHAR#<charId>), because the space follows the hero (§4.5)
interface CaravanSpace {
  style: SpaceStyleId;                           // tent, bedroll, wagon corner
  slots: (PieceId | null)[];                     // two or three
}
```

- **Written only by the server**, as every authoritative change is: phones send intents
  (`caravanPlace`, `caravanVote`, `spacePlace`), and the server checks the piece is owned, the
  hotspot fits it and the sender may change it.
- **Outside the commitment rule.** Tokens, finds and friends go straight onto the record in the
  chapter's commit, not into provisional gains, so `failCampaign()` never touches them (§1).
- **On the run state**, a slim `caravan` view for the screens in the lobby, at rest and at the
  chapter's end, and nothing during scenes.
- **Content**: `content/caravan.json` (pieces, hotspots, frame stages, shop lists, friends and
  their reactions) with a schema in `schemas/`, checked by `npm run content:validate`: every
  `findForCaravan` names a real piece, every friend a real cast figure, every shop list prices
  pieces of its own stage.
- **Art**: a `caravan` section in `assets/manifest.json` (backdrops per terrain family, frames per
  stage, pieces, hero-space styles), owed in `npm run art:inventory` like story plates.
- **Deleting**: the caravan goes with its crew and its household, and a hero's space goes with the
  hero. It names no kid, so a kid's own delete (#252) leaves the crew's caravan alone.

## 9. Building it in phases

Each phase is playable on its own, and the first one tests the whole idea cheaply.

**Phase 1: the caravan exists.** The record and its view; the `open_plains` backdrop for
everywhere; frame stage 1 and 2; souvenirs and the crew banner as kept pieces; the lobby
showing it on the TV; the adventure book's look-only tray. No tokens, finds or friends yet. The
test: do kids point at the TV during the lobby?

**Phase 2: earning and changing it.** Trail tokens at the chapter's end; the shop and the vote;
free hotspot changes; each hero's space; the caravan beat on the chapter's end; the first
`findForCaravan` finds, in Riftlight and the Practice Meadow first (Gemfall is pinned, below).

**Phase 3: friends and places.** The five friends above, each with a befriend choice in its
chapter; tapping friends; the rest-scene crossfade; the first-wave backdrops
(`red_sky_volcanic`, `frozen_north`); frame stages 3 and 4; Travel Mode's Caravan button.

**Later:** the remaining backdrops in the order of §3.1, editing your own space from the
adventure book, more friends and finds as chapters are written.

**Gemfall is pinned.** `gemfall-compat.test.ts` hashes every Gemfall file, so adding a find or a
befriend choice to a Gemfall chapter is a deliberate re-hash with its reason in the commit. A new
effect must not move the gameplay digests below the hashes: `findForCaravan` changes nothing the
digests measure (no flag, XP, item or route), and that should be checked when Pepper and the
mosshorn are added.

## 10. Open questions

1. **The token's name.** "Trail tokens" is a placeholder. It should be one short word or two an
   eight-year-old says out loud, and it must not collide with coins or with star words
   (Starweaver, Starborn).
2. **Rest-scene timing.** Should the TV crossfade to the caravan as soon as the rest scene's
   narration has been read, or only when a phone opens the Caravan panel? The first is more
   magical; the second never takes the picture away from a family still talking about the scene.
3. **Editing from the adventure book.** Is changing your own hero's space between games worth
   breaking the book's look-only rule? It needs a write path from a device binding with no room.
4. **The frame and a crew's first campaign.** A crew's first finished campaign might be its first
   chapter of a second campaign rather than its first ever. Does the frame track campaigns
   *finished* or campaigns *started*?
5. **How many friends at once.** The pen has room for a few. When a crew has more friends than
   spots, do the kids pick who is out today, or do friends take turns on their own?
6. **Riftlight's graph campaign.** A graph campaign can reach a place in more than one order, so
   a find or friend there must be offered on every way into that place, or tied to a scene every
   way passes through.
