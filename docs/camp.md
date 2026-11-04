# The camp: the crew's campsite

**Status: design approved, nothing built.** Every decision below marked *decided* was made by the
product owner, and the implementation requirements in §12 are approved as a whole. Nothing is
still only proposed. Every decision is listed in §11; acceptance criteria and playtest questions
are in §13. Prices and payouts remain starting points for playtest (§5.2).

**Review status:** repository references are implementation context. File names, type names and
interfaces below are the intended shape, and may be refined during implementation as long as the
behavior they describe holds.

**Purpose:** make the crew's shared history visible during existing downtime. A successful camp
gives children something to recognize, show and personalize without adding a new obligation or
delaying play.

The camp is the crew's campsite: tents, a campfire, bedrolls and packs, pitched wherever the
heroes stop. The heroes carry it with them from chapter to chapter and campaign to campaign, it
grows as they do, and the kids fill it with things they found, things they bought and creatures
they befriended. It never takes part in the authored story. It is the place the game shows
whenever nothing is being told: the lobby, a rest stop, the chapter's end, the adventure book.

It exists because the game's biggest promise (spec §1.7, *the party is persistent*) is mostly
invisible today. Levels show on the hero, but everything else the crew did lives in a bag, a
Field Guide and a story-so-far. The camp makes "look at all the things we've done" into
something a kid can point at on the TV.

**Why a camp and not a caravan** (*decided*). The heroes cross terrain no wagon could: glaciers,
sky islands, marsh, a volcano. A camp goes on their backs. "Caravan" is also already a story
word: twelve Gemfall chapters narrate a caravan of travelers, with a `caravan_master` and a great
stone called `facet_caravan`, and the crew's own camp must never be confused with it. The story
uses "camp" as an ordinary verb ("the travelers camp for the night"), which fits; narration still
never says "your camp" (§1).

## 1. What it is, and what it is not

| The camp is | The camp is not |
| --- | --- |
| **Cosmetic only** (*decided*). Nothing in it changes a stat, a roll, a fight, a bag slot or a choice. | An equipment system. Spec §9.3 keeps that reward space for the level-up transformation, and the camp respects it. |
| **The crew's** (*decided*). One camp per crew (architecture §4.5, "Crews"), so two groups at one household each have their own. | The household's, or one hero's. |
| **Permanent** (*decided*). A failed campaign takes back levels and items (spec §8.3), never the camp. | A provisional gain. Its rewards survive campaign failure, alongside existing cosmetic souvenirs. |
| **Outside the story** (*decided*). Narration never mentions it, never assumes it and never gates on it. | A place a chapter can send the party, or something a scene can say "back at camp" about. |
| **Seen in downtime** (*decided*): the lobby, rest stops, the chapter's end and the adventure book, online or off. | A destination that competes with a chapter for the 30 minutes. |
| **Always glad to see you.** | A pet to keep alive. Nothing in it gets hungry, sad, dirty or lost. No timers, streaks, daily rewards or "come back tomorrow". |

The last row is a hard rule. Needs meters and streaks work on guilt and compulsion, and this is a
family game for children aged 8 to 12. A camp left alone for a month looks exactly as it did.

## 2. Who it is for

- **The eight-year-old** wants to see Bun again, tap her and watch her hop. Friends and petting
  are this kid's camp.
- **The twelve-year-old** finds petting babyish and wants ownership: *my* tent, *our* banner,
  the upgrade *we* voted for, the trophy that proves we beat the volcano. Customizing and showing
  off are this kid's camp.
- **The grown-up** wants none of it to cost table time or start arguments. That is what the
  downtime-only rule (§3) and the own-kit-plus-vote rule (§6) are for.

## 3. Where it appears

The camp is the **default picture outside narration**. Whenever the shared screen has no scene
to tell, it shows the camp, pitched in the terrain the crew is in:

| Moment | Shared screen (TV, or a phone's World pane) | Phones |
| --- | --- | --- |
| **Lobby**, while seating and getting ready | The full camp, pitched where the crew last stopped. It replaces the lobby's current backdrop; the room code, ready ticks and adventure vote stay on top. | A **Camp** button beside Ready: tap a friend, change your own kit or buddy (§4.4, §4.5). |
| **Outdoor rest scene** (§3.2) | The picture crossfades to the full camp, pitched in this chapter's terrain, as the rest scene opens. The scene's narration, when it has any, is shown on the camp screen's plate and read as usual (*decided*). | Trading and stat points as now, plus the Camp button. |
| **Indoor rest scene** (§3.2) | The scene keeps its own picture. The camp is packed down into it: each hero's bedroll and pack, and the friends. Narration as usual. | As outdoors, but only your own kit and buddy can change. |
| **Chapter's end** (`chapter_complete`) | After the recap and XP, a short camp beat in the full camp: the chapter's Dash Cash counted in (§5.2), anything found this chapter shown beside the campfire (§12.5), and a purchase vote if the crew can afford something (§6.2). | The vote, and the Camp button. |
| **Adventure book** (`/journal`, spec §2.3) | n/a | A fifth tray object, **Camp**: the crew's camp to look at and tap, online or offline, from the last copy this phone read. |
| **In a scene, a check or a fight** | Never. The story owns the screen. | Never. |

**Nothing waits on the camp.** The lobby's Begin, the rest scene's Go on and the chapter end's
"back to the lobby" all work exactly as they do now. Begin closes any camp panel a phone has open.
Leaving the chapter's end cancels an unfinished vote without spending, and the balance waits for
a future chapter-end shop (§6.2). This keeps the session budget untouched: the camp only fills
time that already exists.

**Travel Mode** has no TV, so the camp view lives behind the same Camp button on each phone
during downtime, and in the World pane during the lobby.

### 3.1 Pitched in the right place

Each terrain family (`assets/manifest.json` → `biomeFamilies`, twelve of them) gets one camp
backdrop: a wide, calm campsite painting with room for the camp in the middle third and its
hotspots (§4.2) on a fixed layout. The view picks the backdrop from the chapter's biome, and in
the lobby from the chapter the crew would pick up from. The lobby and the chapter's end always
show the full, outdoor camp.

Painting all twelve is a lot of art, so they ship in order of how often a party rests outdoors
there. These are all rest scenes, counted from the repo on 2026-11-04; once rest scenes are
tagged (§3.2), recount the outdoor ones before commissioning art:

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

### 3.2 Indoor and outdoor rest scenes

*Decided:* rest scenes are marked indoor or outdoor, and an indoor rest packs the camp down to
backpacks and sleeping bags instead of tents.

Not every rest happens where a tent could go. The party sleeps in bunks in a warden's room
(Gemfall 6), in a cupboard or hayloft (Gemfall 1), on warm stone under silent bells (Gemfall
5C). A campsite painting would contradict those scenes, so every rest scene declares its setting:

- **`"setting": "outdoor"`**: somewhere a campsite could be pitched. The TV crossfades to the full
  camp in this terrain (§3).
- **`"setting": "indoor"`**: everywhere else, including outdoor places no campsite fits (a boat
  deck, a narrow ledge). The scene keeps its own illustration, and the camp appears packed down
  inside it: each hero's bedroll and pack along the front of the picture, and the friends beside
  them. No tents, no campfire and no shared hotspots. Each hero's own bedroll can still change
  (§4.5), and friends can still be tapped.

The field is **required on every rest scene**, so `npm run content:validate` refuses a rest scene
without it and nothing has to guess. Tagging today's 112 rest scenes is a one-time pass: a keyword
scan already flags 31 of them as possibly indoor (rooms, bunks, cupboards, "inside"), but every
scene gets a human read, since "under the bridge" is outdoors and "a warm room" is not. Tagging
a Gemfall chapter re-takes its hashes (§10, "Gemfall is pinned").

## 4. What is in it

*Decided:* everything in the camp belongs either to the **crew** or to **one hero**, and the two
never mix:

| | **The crew's camp** | **Each hero's kit** (§4.5) |
| --- | --- | --- |
| What | The frame, the shared hotspots (banner, cookfire, awning, lanterns, friends' corner), the friends, trophies, the crew's banner and name | The hero's tent, bedroll and pack, their personal decorations, and their souvenirs |
| Stored | On the crew's camp record (§9) | On the character (§9) |
| Goes where | Stays with the crew. A hero seated with another crew sees that crew's camp | Goes everywhere the hero goes: any crew, any table, a move to another home |
| Earned by | The crew: shared finds, Dash Cash purchases, finished campaigns, befriending | The hero: the free catalog, kit finds every hero gets a copy of, and the hero's own milestones (§5.4) |
| Changed | At the table, during downtime (§6) | At the table, and from the adventure book between games (§7) |

### 4.1 The frame: it grows with the crew

The camp's size is its **frame**, and the frame grows a stage each time the crew finishes a full
campaign. This cosmetic ladder is separate from character tiers, which are level-derived (spec
§8.1). Everything at every stage is something the heroes could carry:

| Stage | Frame | Reached |
| --- | --- | --- |
| 1 | Bedrolls around a small campfire | The crew's first chapter |
| 2 | A tent for each hero and a cookfire | First full campaign finished |
| 3 | A bigger camp: an awning, lantern strings and a lookout post | Second full campaign finished |
| 4 | A grand camp: a big shared tent, banners and a lookout | Third full campaign finished |

The frame is **earned, never bought**, so a crew that spends nothing still watches its camp grow.
Each stage adds hotspots (§4.2), so a bigger camp also has more room. When a stage arrives at the
chapter's end it gets its own short moment: the heroes pitch the new camp. That's a small cousin
of the transformation cutscene, never longer than it.

**Only full campaigns count** (*decided*). The Practice Meadow (`first-steps`) is the tutorial and
never grows the frame. Today's full campaigns are Gemfall and Riftlight. The campaign file says
so (`"growsCamp": true`), so a new campaign is a deliberate choice rather than an accident.
The Hollow Crown (`the-hollow-crown`, the one-chapter reference campaign) does not grow the frame
either (*decided*). Both still pay Dash Cash and can hand over finds and friends.

Only a *finished* campaign moves the frame. A failed campaign keeps everything already in the camp
(§1) but does not grow it. A crew still working toward its first finished campaign keeps the camp
changing through the shop, and that is enough (*decided*).

### 4.2 Hotspots, not free placement

The camp is a fixed layout of **hotspots**: the banner pole, the cookfire, the awning, the lantern
hooks, the friends' corner, each hero's tent. Changing the camp is tapping a hotspot and picking
from what the crew owns for it. There is no dragging, no rotating and no free placement.

Hotspots keep it doable for an eight-year-old on a phone, keep every combination looking painted
rather than cluttered, and let the art be composed once per frame stage rather than for every
possible arrangement. They also make the stored state small (§9).

### 4.3 Pieces

A **piece** is anything that goes on a hotspot. Every piece belongs to one hotspot kind and comes
from one of three places:

| Source | How the crew gets it | Examples |
| --- | --- | --- |
| **Found** (§5.1) | A chapter hands it over as part of normal play | A striped awning from the Saltrot market, a cracked bell from the Ashspan Bridge, a pinecone wreath |
| **Bought** (§5.2) | Dash Cash, by vote at the chapter's end (§6.2) | A cookfire with a kettle, a lookout ladder, a second lantern string |
| **Kept** | Something the game already gives the crew that has nowhere to show | The crew's banner and name (`CrewIdentity`), trophies for each finished campaign |

These are the crew's pieces. A hero's souvenirs from a failed campaign belong to that hero (spec
§8.3 gives them to the character), so they are part of the hero's kit (§4.5), shown at their tent.

### 4.4 Friends

A **friend** is a creature the crew befriended in a chapter, who now travels with the camp.
Friends stand in the friends' corner and by the campfire, idle with the existing motion system
(`world/idle-motion.ts`), and react when a kid taps them, using the same reaction model as the
`play` story interaction (content/README.md, "Interactivity"). The reactions are words today; the
camp is a good reason to give them a little animation.

**A friend must belong to nobody in the story.** A creature that has an owner, a job or a later
scene of its own cannot also live at the camp. Pepper was the first idea and fails this test: she
is Nim's pony, Nim needs her to carry news north (Gemfall 5A), and she appears again in Gemfall
7H. The candidates that pass:

| Friend | Met in | What befriending already is |
| --- | --- | --- |
| Bun | The Practice Meadow (`first-steps-01`) | "Offer Bun something nice" |
| The mosshorn | Gemfall 4B | Being gentle until it lowers its antlers |
| A duckling | Riftlight, Ashspan Bridge | Settling the ducklings |
| The kid goat | Riftlight, Exchange Rift | Warming it up together |

*Decided:* more friends will be new characters written for the purpose: a creature met in a
chapter, with a befriending moment, and no claim on it anywhere else in the story.

**At most four friends are out at once** (*decided*), and **each kid can pick a buddy**
(*decided*):

- **A buddy is one friend a hero picks** from the crew's friends. While that hero is seated, their
  buddy is always out. With up to four heroes and up to four friends out, every kid gets exactly
  one say, and nobody can bench another kid's choice.
- **Seats without a buddy rotate automatically**: each downtime moment (a lobby, a rest stop, a
  chapter's end) fills them with the friends who have been out least, and a friend just
  befriended is always out at its first chance (§12.5). A solo player with a buddy sees the buddy
  plus three rotating friends.
- **Two heroes can pick the same buddy.** The friend is shared, and the spare seat rotates.
- **A buddy is picked from the phone**, at the table or in the adventure book (§7), since it only
  decides that kid's own seat. Friends belong to the crew, so a hero's buddy applies in that
  crew's camp only (§12.1).
- Until a hero picks one, they have no buddy and every seat rotates, exactly as before. Rotation
  stays the default; buddies are an option, never a chore.

Following the continuity rules, a friend joins because a **choice** says so ("Ask the kid goat to
come along" beside "Say goodbye"), never because of a variant. Saying goodbye costs the story
nothing and is never sad: the friend waves off, and the chapter goes on.

### 4.5 Each hero's kit

*Decided:* the personal parts of the camp belong to the hero, not the crew, so a kid can look after
them even when nobody else is playing.

A hero's **kit** is their tent, their bedroll and pack, and two or three small slots for personal
decorations, all in their own color (the palette rule heroes already use). Outdoors the tent
stands in its spot in the camp; indoors (§3.2) the bedroll and pack are laid out along the front
of the scene. At frame stage 1, before tents, it is the bedroll and pack everywhere. The hero's
souvenirs (spec §8.3) hang at their tent.

- **Only that hero's player changes it**, at the table during any downtime moment (no limit, §6.1)
  and from the adventure book between games (§7).
- **It goes everywhere the hero goes.** A hero seated with another crew brings their kit along,
  and a hero who moves home (#251) takes it with them, because it is stored on the character (§9).
- **It never borrows from the crew.** Nothing the crew owns can be put in a kit, and nothing in a
  kit can be put on a shared hotspot (§12.1).

Where kit pieces come from is in §5.4.

## 5. How the crew earns things

The crew earns its camp through finds and Dash Cash (§5.1, §5.2). Each hero earns their kit
separately (§5.4). All of it happens during normal play.

### 5.1 Finds: pieces handed over in a chapter

*Decided:* chapters drop camp pieces as part of normal gameplay, the way they drop items now.

A find is a new chapter effect, `findForCamp: { pieceId }`, beside `grantItem`. It does not go in
a bag, never takes a slot and never vanishes, unlike a quest item (spec §9.2). The phone says "For
the camp!" with the piece's picture. The piece is the crew's the moment the effect is applied
(§12.2), and the chapter's end shows it off beside the campfire.

Authoring rules, so finds keep to the house rules:

- **A find is a bonus, never a gate.** Nothing in the story checks whether the crew has a piece.
- **A find is a reward for something done**, not a thing lying on the floor: helping at the
  Saltrot steps earns the striped awning; calming the ducklings earns a feather for the banner.
  It lands on the scene that shows the result, like any other choice.
- **The scene names the thing, not the camp.** "Grandmother Winkle presses a striped awning into
  your hands" reads true for every party. "For your camp" in narration does not, so that line
  belongs to the phone's notice, outside the narration.
- **A find the crew already owns** turns into Dash Cash instead (§5.2), and the notice says so.
- **In a graph campaign, offered on every way in, given once** (*decided*). Riftlight can reach a
  place in more than one order, so a find or friend there is offered on every way into it. The
  crew gets it the first time and never again from that place, whichever way it came (§12.2).
- **Finds are a few per campaign, not per chapter.** Roughly one every two chapters keeps each one
  an event.

The pieces live in a catalog of their own, `content/camp.json` (§9), validated like the rest of
`content/`. They are not world canon in `canon/items.yaml`: a camp piece is a game object the crew
owns, not an object in the realm's lore.

### 5.2 Dash Cash: points for the crew to spend

*Decided:* chapter points the crew collects and spends on the camp, called **Dash Cash**.

Dash Cash is paid to the **crew**, once, at the chapter's end, from things the chapter already
measures:

| Earned for | Dash Cash |
| --- | --- |
| Finishing a chapter, any ending | 2 (*decided*) |
| Each optional objective met (spec §8.2) | 1 each |
| A find the crew already owns (§5.1) | 1 |
| A lucky drop: a 1 in 8 chance after each won mini-game or fight (below) | 1 |

**Goal steps pay nothing** (*decided*). Every path to a success ending ticks every goal step by
design (content/README.md, "The chapter's goal"), so a party cannot miss one, and paying for them
would be free money. Optional objectives are different: a party can miss them, so they are the
part of the payout that rewards how the chapter was played.

So a chapter pays 2 to 5: 25 of today's 42 chapters have no optional objectives (2 Dash Cash), 5
have two and 12 have three. That is 4 to 10 after two chapters, plus any lucky drops (below). A
crew whose first chapters had objectives or a lucky drop can buy a 5-Dash-Cash starter piece the
moment the shop opens; one whose first two chapters had none arrives with 4 and makes its first
purchase a chapter later. Either way the money is earned, and a 10-to-15 piece follows every four
or five chapters. Every purchase goes through the same vote (§6.2); there is no separate flow for
cheaper pieces. The numbers are a starting point for playtest.

**Lucky drops** (*decided*): after each mini-game the party succeeds at and each fight it wins,
there is a 1 in 8 chance the crew finds 1 Dash Cash. It is a small surprise on top of the
chapter's pay, not something to grind for:

- **Shown at once, saved at once.** The TV shows a little "Dash Cash!" sparkle as the result
  lands, the phones echo it, and the server writes it to the crew's camp then, the way a find is
  saved when found (§12.2). It is counted again in the chapter's end tally so nobody misses it.
- **The server rolls.** The roll is part of the server's own resolution of the mini-game or fight,
  from the engine's per-action seeded `rng` (`engine/port.ts`), so replaying the event log rolls it
  the same way. A refresh, a reconnect or a retried message cannot roll it again.
- **No near misses.** A drop that doesn't happen shows nothing. There is no "so close!", no meter
  and no odds on screen.
- **Only games a party can fail count** (*decided*). `play` interactions (feeding, petting,
  celebrating, content/README.md) always succeed, so, by the same reasoning as goal steps, they
  never drop. Relaxed play still counts: it is easier, not automatic.
- **At most 2 lucky drops a chapter**, and **none in a chapter already paid for** (*decided*)
  (§12.2), so replaying a chapter is never a way to farm them.

Across today's 42 chapters there are 184 mini-games a party can fail and 61 fights, about 5 per
chapter in all; a single road through a chapter meets fewer. That makes a lucky drop worth roughly
half a Dash Cash per chapter on average: about one drop every two chapters, which is a treat
rather than a salary, and leaves the economy above unchanged in practice.

Rules, borrowed from what already works for XP:

- **Party-wide, never individual.** Like story XP and objective bonuses, Dash Cash goes to the
  crew, so no kid is behind on the camp.
- **Paid once per crew per chapter.** A chapter the crew has been paid for pays no Dash Cash again,
  the way a chapter pays each hero once (spec §8.2, #408). A crew replaying for the story can still
  find pieces it does not own.
- **A setback ending still pays for finishing.** Failure reroutes; it doesn't zero out.
- **Dash Cash is not coins.** The story's purse (`grantCoins` / `spendCoins`) stays separate, so
  "costs cost" in the story stays a real choice and nobody refuses to pay the ferryman to save up
  for an awning. The TV and phones never show the two side by side.
- **Kept on a failed campaign**, with the rest of the camp (§1).

### 5.3 The first reward comes in the first session

*Decided:* children see something that is theirs in their very first session, so the camp's
purpose is clear before anyone has to wait. Frame growth takes a whole campaign, and the shop
opens only after two chapters, so neither can be the first reward.

- **A personal choice at the first downtime moment.** The first time a hero is seated with a crew
  that has a camp, their kid picks their kit's style and color (§4.5) from the free catalog
  (§5.4). It takes one tap, can be skipped, and is the first thing the camp asks of anyone.
- **A recognizable find in the first chapter.** The Practice Meadow and the first chapter of every
  `growsCamp` campaign each hand over one find on their spine, so every path to every ending gets
  it. It is something the kids will remember from that chapter (a pinecone wreath from the meadow,
  say), and the chapter's end shows it beside the campfire and highlights where it can go.
- **The shop opens after two chapters** (*decided*). A crew needs a little skin in the game before
  it can buy anything: the chapter-end shop appears only once the crew has been paid for at least
  two chapters, in any campaign. Before that, the chapter's end shows the balance and says the
  shop opens after the next chapter. The first pieces in each shop cost **5 Dash Cash**
  (*decided*). Most crews can afford one when the shop opens; a crew that earned only the 4 for
  finishing two chapters buys a chapter later (§5.2).

### 5.4 Each hero's kit pieces

A hero's kit (§4.5) fills from three places, none of them Dash Cash, which stays the crew's:

- **The free catalog** (*decided*, §12.1): a starting set of tent styles, colors and simple
  decorations every hero has from the start, so there is always something to choose.
- **Kit finds** (*decided*): a chapter effect, `findForKit: { pieceId }`, that gives **every
  seated hero their own copy** of a personal piece ("everybody gets a feather for their tent").
  Like every reward, it is party-wide, so no kid misses out. A hero who already has it gets
  nothing more; Dash Cash is the crew's and is never paid for a kit duplicate. The same authoring
  rules as crew finds apply (§5.1): a bonus, never a gate, and the narration names the thing, not
  the kit.
- **The hero's own milestones** (*decided*). Reaching a new appearance tier unlocks a tent style in
  that tier's look, and earning a class distinction unlocks a small decoration in that class's
  colors. These are the hero's own deeds, so they belong in the hero's kit, recorded in
  `HeroKit.unlocked` with `from: "milestone"`. Like souvenirs, they are cosmetic and kept even if a
  failed campaign later puts the tier or distinction back (spec §8.3): the hero earned them once.
  The unlock lands when the tier or distinction does, and the phone says so after the
  transformation, never during it. A tier whose art isn't painted yet (spec §8.1 draws Ascendant
  and above as Mythic until it is) unlocks its tent style when that art ships.

## 6. Who changes what

*Decided:* anyone in the crew can update the camp; each hero has their own kit; purchases go to a
vote.

### 6.1 Free changes: any time it is on screen

Tap a hotspot, pick from what the crew owns. These are free, immediate and reversible by picking
another owned piece (subject to the shared-change limit below):

- **Shared hotspots** (banner, awning, lanterns, cookfire, friends' corner): any seated player, in
  the full camp only. An indoor rest has none (§3.2).
- **A hero's kit:** only that hero's player, indoors or out, and from the adventure book (§7).

If two phones pick for one hotspot at once, the later pick wins and the TV shows it; there is
nothing to lose, because the crew still owns both pieces. A kid's own kit is unlimited.

**The shared-edit limit is a playtest question, not a settled rule** (*decided*). The starting
proposal is that each seated player may change **one shared hotspot per downtime moment** (per
lobby, per rest stop, per chapter end), to keep one kid from redecorating everything while another
watches. It may also frustrate a child who picks the wrong thing, so it ships with two softeners
to test (§12.5):

- **Undo is free.** Undo puts back what the hotspot showed before that player's change, during the
  same downtime moment, and does not use up their change, so a wrong pick can be fixed and
  re-made.
- **Placing something new is free.** Putting a piece found or bought this chapter on its hotspot
  at the chapter's end does not count against the limit.

Playtests decide whether the limit stays, loosens or goes (§13).

### 6.2 Buying: spend Dash Cash, by vote

Buying a piece costs Dash Cash and adds something new to the crew's collection. Spending is a crew
decision:

1. At the **chapter's end**, once the shop is open (two chapters played, §5.3) and the crew can
   afford something, the phones show up to three pieces it can buy, plus "Save our Dash Cash."
2. Every seated player votes, the way a choice point works: most votes wins, and a tie goes to
   the turn marker (spec §6.1). "Save our Dash Cash" is always an option and always free.
3. The winner joins the collection and is shown beside the campfire on the TV, and the crew can
   place it right away (§12.5).

The vote lives only at the chapter's end, never in the lobby (which already has the adventure
vote and should not hold up Begin) and never at a rest stop (which is for trading and stat
points). If the group leaves the chapter-end screen before the vote finishes, nothing is bought
and the Dash Cash waits.

The shop is a short, fixed list for each frame stage, so a crew is choosing between a few things
it can picture, never browsing.

## 7. In the adventure book, and offline

The adventure book (spec §2.3) gets a **Camp** tray object: the crew's full camp, with friends to
tap and every piece's name and where it came from ("Found at the Ashspan Bridge"). The camp's
record rides in the same `GET /api/journal` read and is saved with the book, so it opens without a
signal like the rest of it.

**The crew's camp is look-only in the book; each kid's own things are not** (*decided*). A phone
between games belongs to one kid, not a crew, so the book lets that kid do what is theirs alone:

- **Change their hero's kit** (§4.5): tent style, colors and decorations. Kids want to play even
  when they're by themselves, and this is something they can do on their own that still shows up
  at the next game.
- **Pick their hero's buddy** (§4.4) for each crew the hero plays with.
- **Tap the friends**, as before.

Everything shared stays at the table: shared hotspots, purchases and votes. The book's old promise
narrows rather than breaks: nothing in it can change anything **anybody else** owns, so nothing a
kid does there can upset another kid's game.

**They work offline too** (*decided*). With a signal, an edit goes straight to the server through a
small write path authorized by the phone's device binding, like the book's read (§12.6). Without
one, the book makes the change on screen at once, keeps it in a queue on the phone, says "Saved
on this phone, will share when you're back online", and sends it when the signal returns:

- **What can queue:** only the kid's own kit and buddy changes. Nothing shared is editable in the
  book, so nothing shared can queue.
- **Each change says what it replaced.** A queued edit records, field by field (style, color, each
  slot, the buddy for each crew), the value it was made over.
- **Merging, field by field.** When the queue is sent, each field applies only if the server
  still has the value the edit was made over. If that same field was changed elsewhere in the
  meantime (at a table, or on the kid's other phone), the newer server value stays, and the book
  shows the kit as it now is with a short note. Fields nobody else touched always apply, so a long
  car ride's worth of changes is never thrown away because of one clash.
- **Only real pieces.** The server rechecks every queued change: a piece the hero doesn't have, or
  a buddy the crew doesn't have, is skipped, as it would be online.
- **The queue is the phone's.** It lives in the phone's own storage and is sent with the phone's
  binding. If the binding is revoked or the kid is moved off the phone, the queue is dropped
  unsent.

## 8. Movement: a camp that is alive

*Decided:* characters walk and move around the camp and use the things in it. Not much more than
walking and moving, but it has to look clean.

This is what makes the camp a place rather than a picture. A hero crawls out of their tent when
their kid sits down, wanders over to warm up at the cookfire, and the kid goat trots over when
someone taps it. None of it needs new figure art.

### 8.1 Paper-puppet motion, from the art we already have

Every figure is one finished transparent cutout (docs/art-pipeline.md: the Rive rigs and split
parts are retired). The camp does not bring rigs back. It moves cutouts the way a paper puppet
theater does: the whole figure steps, leans, turns and settles, and **the motion, not the
drawing, says what it is doing**. This is the look to hold the line on. Done carefully it reads
as charming and deliberate. Done carelessly it reads as sliding stickers.

The parts already exist and are shared by the story lineup and the combat board
(`world/actor-art.ts`):

- **Facing.** Art is drawn facing left, and a figure turns by easing `scale.x` through zero to
  `-1`, as combat already does (`facingFor`, `board.ts`).
- **Smoothing.** `approach` moves a value toward its target at a fixed rate, so nothing snaps.
- **Grounding.** Feet sit at the canvas's ground contact (512, 900), with a contact shadow
  (`drawContactShadow`) that follows them.
- **Idle by stance.** `stanceIdle` already breathes standing figures and bobs hovering, flying
  and swimming ones (`world/idle-motion.ts`, #362).
- **Walking a route.** The combat board walks a figure one square at a time at a steady pace and
  leaves fading footprints. The camp walks the same way along its own paths (§8.3).

### 8.2 The walk

A standing figure walks as a series of **steps**, never a glide:

- **Each step is a small hop**: rise about 3% of the figure's height and land. The shadow
  tightens at the top and spreads on landing, so the feet are plainly on the ground between steps.
- **A lean into the walk**: a couple of degrees forward while moving, easing upright on stopping,
  with an alternating wobble of about 1.5° per step for the gait.
- **A tiny squash on landing** (about 2% shorter and wider, back within a tenth of a second).
  It's the one cartoon touch, and it's what keeps the hop from looking mechanical.
- **Starts and stops ease.** The first step and the last are shorter, and a figure arriving
  settles: one small dip, then it breathes. It never brakes to a halt.
- **Speed and step size come from size.** True size is already known (`figure-scale.ts`,
  `height_cm`). A duckling patters with quick, tiny hops; a hero steps at a walking pace; the
  mosshorn lumbers with slow, long ones. Speed grows more slowly than height, so big things don't
  rush.
- **By stance.** Hovering and flying figures don't hop: they glide along the path with their
  existing bob and a little lean. Swimmers stay near water.

### 8.3 Where figures can go

Each camp backdrop (§3.1) declares its ground in the manifest. Each frame stage declares the
camp's spots on that ground.

- **Ground lanes.** The walkable floor is two or three horizontal lanes at fixed depths (near,
  middle, back), not a free 2D field. Lanes make depth order trivial (a nearer lane always draws
  in front), keep figures from overlapping in ugly ways, and make every route a short, readable
  line. A nearer lane draws its figures slightly bigger, so depth reads without a perspective
  engine.
- **Stand points.** Every hotspot (§4.2) has one or more stand points: a place on a lane, the way
  to face, and what to do there (§8.4). The cookfire might have three, the banner one, each hero's
  tent one at its door.
- **Paths, not pathfinding.** A figure gets from one stand point to another along its lane, and
  changes lanes only at the ends of a crossing marked on the layout. It walks around the tents,
  never through them. All of it is authored data on a fixed layout, keeping route planning small
  and testable.
- **One figure per stand point**, and passing figures in one lane take turns: one waits a beat
  rather than walking through another.
- **Clear of the words.** Stand points never sit under the parts of the screen the lobby, the vote
  and the narration plate cover. `stage-inset.ts` already reports how much of the pane the
  narration plate covers, so the story stage stands figures above it; the lobby reports its
  header and panels the same way. The camp is one painting, edge to edge: it is scaled to cover
  the pane's width (or the window's height, if that needs more) and slid up or down so its focus
  band, from a standing hero's head on the back lane to just below the near lane, sits centered
  in the open window between the header and the panels. Its plain sky is trimmed off the top and
  its plain grass runs on under the panels (`camp-framing.ts`); the backdrop is painted for that
  (docs/briefs/camp.md).
- **Indoors, one lane.** A packed-down camp (§3.2) uses a single generic layout laid over the
  scene's own picture: one near lane along the bottom, a bedroll stand point for each hero and a
  spot for each friend. No per-scene authoring.

### 8.4 What figures do there

A stand point's **action** is a short, looped pose made of the same transforms as the walk, with
the hotspot's piece doing its half:

| Action | The figure | The piece |
| --- | --- | --- |
| **Warm up** (cookfire, campfire) | Faces the fire, settles a little lower, slow breath | Flames flicker while they stand there; a spark rises now and then |
| **Look up** (banner, lookout) | Leans back a few degrees and holds | The banner ripples |
| **Peek** (supply chest, pack) | Leans in, hops once, leans back | The lid or flap lifts and drops |
| **Rest** (own tent or bedroll) | Turns to it, dips and holds still | The tent flap sways |
| **Greet** (another figure) | Turns to face them, one hop | n/a |
| **Pet** (a friend) | Steps close, leans in | The friend hops, turns toward them and its reaction shows (§4.4) |

**A piece moves only while a figure is using it** (*decided*). Everything else is static: a
cookfire nobody is warming up at is a painting, and its flames flicker only while someone stands
at it. A piece that a stand point uses gets its moving part as a small cutout of its own (a flag,
a flame, a lid, a tent flap) on top of the painted piece, with simple motion: sway, ripple,
flicker, lift. Pieces no stand point uses need no moving part at all, which keeps the shop cheap
to paint. The backdrop is static too.

### 8.5 When things move

The camp should feel calm, like watching a campsite, not a busy screen:

- **Wandering.** Each figure stays at a stand point for a while (roughly 8 to 20 seconds), then
  picks another nearby free one and walks there. **At most two figures are walking at once**, so
  the eye always has something to follow and never everything. Indoors nobody wanders: the heroes
  rest on their bedrolls, and a friend moves only when it's tapped.
- **Moments the game already has** take priority over wandering, and each is a little scene:

| Moment | What happens |
| --- | --- |
| A kid sits down in the lobby | Their hero crawls out of their tent (or sits up on their bedroll, at stage 1), looks around and waves (a hop and a turn toward the screen) |
| A kid taps Ready | Their hero shoulders their pack and walks to the trailhead at the edge of camp |
| A player steps away (#258) | Their hero walks back to their own tent and fades the way the lineup already fades a stepped-away hero |
| Begin | Everyone sets off together down the trail as the chapter's first scene fades in, at the start of every chapter (*decided*) |
| An outdoor rest scene opens (§3.2) | The heroes walk in from the edge, and each settles at a spot |
| An indoor rest scene opens (§3.2) | Bedrolls and packs fade in along the front of the scene, with each hero on their own |
| A find or a purchase is shown (§5.1, §6.2) | It appears beside the campfire, the crew gathers round, and its hotspot is highlighted for placing (§12.5) |
| A kid taps a friend on their phone | The friend reacts on the TV, then walks over to that kid's hero |

- **Taps on a phone show on the TV.** A tap is a short-lived message, never saved, sent to the
  room's screens the way room cheers already are (#388, `RoomCheers`). It's rate-limited per
  phone, and the TV queues and drops extra taps, so a kid hammering the button gets a happy friend
  rather than a jittering one.
- **Movement is the screen's own, not the game's.** The server stores where pieces and friends are
  placed (§9), never where anybody is standing. Wandering runs on each screen from a seed taken
  from the downtime moment (§12.6), so the TV and a phone looking at it mostly agree, and nothing
  has to sync. It's the same reasoning as the victory flourish (`world/victory.ts`): spectacle is
  read from state, never put in the protocol.

### 8.6 What "clean" means: the rules

A movement that breaks one of these is a bug, not a matter of taste:

1. **Nothing slides.** A standing figure only moves across the ground while stepping. Every pixel
   of travel belongs to a hop.
2. **Feet stay on the ground line**, and the contact shadow is always under them, including
   mid-turn (combat already keeps the shadow under the feet on a turn).
3. **Nothing snaps.** Every change of position, angle, scale and opacity eases (`approach`). A
   figure that has to be somewhere else at once (a lane full, a resize) fades out and back in
   rather than jumping.
4. **Nothing overlaps badly.** Depth order comes from the lane, one figure per stand point, and
   figures in one lane don't pass through each other.
5. **Calm by default.** Slow walk speeds, long holds, two walkers at most, no idle fidgeting
   beyond the breath.
6. **Small, consistent amounts.** Hop, lean and squash use the same few constants for every
   figure, scaled by size, so the whole cast moves like one family.
7. **Smooth on the slowest screen.** Movement runs on frame time, not frame count, so a dropped
   frame advances the animation by elapsed time without changing its overall speed. A long pause
   resumes without replaying missed movement. It runs at 60 fps on a living room mini-PC and stays
   readable at 30 on an older phone, checked with the frame meter (`?perf`, docs/hardware.md) with
   a full camp: four heroes, four friends and the pieces they are using.

### 8.7 Reduced motion and no WebGL

- **Reduced motion** (`a11y/prefs.ts`, the device preference or the in-game setting): nobody
  wanders and nothing hops. Figures stand at their stand points, as the idle already does when
  `still`. A moment like a hero arriving or a friend being tapped becomes a soft fade at the new
  spot, and the reaction's words show as usual.
- **No WebGL** (`RendererFallback`, `StaticStage`): the camp is drawn as a still picture with
  everybody at their stand points. Nothing is lost but the movement.
- **A hidden or backgrounded screen** stops the movement and picks it up fresh, rather than
  catching up on everything it missed.

### 8.8 How it is built and tested

- **A third stage beside the story lineup and the combat board.** `world/camp.ts` draws it, both
  the full camp and the packed-down indoor one, sharing `actor-art.ts` with the other two, under
  WorldView's usual rules: nothing reads the room mode, nothing uses a viewport unit.
- **The thinking is Pixi-free.** Lanes, stand points, routes, the wander planner and the step
  curve live in pure modules (like `cast.ts`, `board-math.ts` and `idle-motion.ts`), so "nothing
  slides", "one figure per stand point" and "two walkers at most" are things a test can hold
  without a WebGL context.
- **Frame-by-frame tests** run against the fake stage (`testing/fake-stage.ts`) with hand-driven
  frames, as `scene-motion.test.ts` already does.
- **Looking at it** uses `npm run play:jump` with `--record MS` (extended to open the lobby with a
  camp in it, and an indoor and an outdoor rest scene) to film the camp on a TV and phones side by
  side. "Clean" is judged on those recordings at real speed, not on stills.

## 9. The data

New records (architecture §3), each versioned like every stored shape. The sketch below includes
fields that serve §12's requirements (`revision`, `grownBy`, `rewardId`, receipts). Phase 1 writes
none of it (§10).

| Record | PK | SK | What it holds |
| --- | --- | --- | --- |
| Camp, first crew | `HH#<hhId>` | `CAMP` | The first crew's camp (the first crew has no `CREW#` row or id, architecture §4.5). |
| Camp, other crews | `HH#<hhId>` | `CAMP#<crewId>` | The same shape, one per `CREW#<crewId>`. |

```ts
// packages/shared/src/types/camp.ts (intended shape)
interface CampRecord {
  version: number;
  revision: number;                              // conditional writes (§12.4)
  frameStage: 1 | 2 | 3 | 4;
  grownBy: string[];                             // full campaigns that grew it, once each (§12.3)
  dashCash: number;
  owned: Record<PieceId, { from: "found" | "bought" | "kept"; rewardId?: string; at: string }>;
  placed: Record<HotspotId, PieceId>;            // shared hotspots only
  friends: Record<FriendId, { rewardId: string; at: string }>;
  buddies: Record<CharId, FriendId>;             // one per hero, this crew's friends only (§4.4)
  paidChapterCount: number;                      // the shop opens at 2 (§5.3)
  // Receipts (§12.2): paid chapters and claimed reward ids. Storage shape to be chosen
  // after checking transaction and record-size limits.
}

// on Character (domain.ts, stored at CHAR#<charId>), because the kit follows the hero (§4.5)
interface HeroKit {
  version: number;
  revision: number;                              // book and table edits (§7, §12.4)
  style: KitStyleId;                             // tent, bedroll and pack together
  color: KitColorId;
  slots: (KitPieceId | null)[];                  // two or three
  unlocked: Record<KitPieceId, { from: "catalog" | "found" | "milestone"; rewardId?: string; at: string }>;
}
```

- **Written only by the server**, as every authoritative change is: phones send intents
  (`campPlace`, `campVote`, `kitPlace`, `buddyPick`), and the server checks the piece is owned,
  the hotspot fits it, the sender may change it and the intent is not stale. `kitPlace` and
  `buddyPick` are also accepted from the adventure book, outside any room (§7).
- **Outside the commitment rule.** Dash Cash, finds and friends go straight onto the record, not
  into provisional gains, so `failCampaign()` never touches them (§1). A find or friend is written
  when its effect is applied, even if the room closes before the chapter's end; Dash Cash is
  written with the chapter's end (§12.2).
- **On the run state**, a slim `camp` view for the screens in the lobby, at rest and at the
  chapter's end, and nothing during scenes.
- **Content**:
  - `content/camp.json` (crew pieces, kit pieces, hotspots, frame stages, shop lists, friends and
    their reactions) with a schema in `schemas/`, checked by `npm run content:validate`: every
    `findForCamp` names a real crew piece and every `findForKit` a real kit piece, every friend a
    real cast figure, every shop list prices pieces of its own stage.
  - On every rest scene, a required `setting: "indoor" | "outdoor"` (§3.2).
  - On a campaign, `growsCamp: true` for the full campaigns (§4.1).
- **Art**: a `camp` section in `assets/manifest.json` (backdrops per terrain family, frames per
  stage, pieces, tent and bedroll styles), owed in `npm run art:inventory` like story plates.
- **Deleting**: the camp goes with its crew and its household, and a hero's kit goes with the hero,
  as do their entries in any crew's `buddies`. It names no kid, so a kid's own delete (#252) leaves
  the crew's camp alone.

## 10. Building it in phases

*Decided:* Phase 1 stays small. It proves the animated lobby is appealing before anything else is
built, and each later phase expands only once children notice and recognize their camp.

**Phase 1: an animated lobby.** One backdrop (`open_plains`) at frame stage 1, the seated heroes,
and movement: the walk and its rules (§8.2, §8.6), lanes and stand points, wandering, and the lobby
moments (a hero getting up when their kid sits down, heading to the trailhead on Ready, setting off
on Begin). Reduced motion and the still fallback come with it (§8.7), since they are how some
children will see it. Nothing is stored: a stage-1 camp with the seated heroes needs no camp record,
no catalog and no new intents. Not in Phase 1: the adventure book, offline caching, souvenirs, other
stages, Dash Cash, finds and friends. The test: do children look at the TV during the lobby, point
at their hero and talk about the camp?

**Phase 2: the camp is yours.** The camp record and each hero's kit (§9); the free kit catalog and
the first-session choice (§5.3, §5.4); the first-chapter finds (§5.3) and the first kit finds;
Dash Cash at the chapter's end, and the shop and the vote once two chapters are played; shared
hotspot changes, with the edit limit and Undo under test (§6.1); the chapter-end camp beat; frame
stage 2; the crew banner as a kept piece and souvenirs at each hero's tent. Finds go into
Riftlight and the Practice Meadow first. The test: can children find their own tent, change their
kit and place a piece without help, and recognize where their finds came from?

**Phase 3: friends and places.** The four friends in §4.4 and the first new ones, each with a
befriend choice in its chapter; tapping friends on a phone and seeing them react and walk over on
the TV (§8.5); buddies (§4.4); tagging every rest scene indoor or outdoor (§3.2), then the outdoor
crossfade and the packed-down indoor camp; the first-wave backdrops (`red_sky_volcanic`,
`frozen_north`); frame stages 3 and 4; Travel Mode's Camp button.

**Phase 4: the camp between games.** The adventure book's Camp tray (§7): the crew's camp to look
at, each kid's kit to change and buddy to pick, online and queued offline, and offline caching of
the camp and its art. The test: do kids open the book on their own to change their kit, and do
they notice the change at the next game?

**Later:** the remaining backdrops in the order of §3.1, more friends and finds as chapters are
written, and milestone tent styles for each tier as its art is painted.

Milestone kit pieces (§5.4) arrive with the kit in Phase 2, for the tiers and distinctions whose art
exists.

**Gemfall is pinned.** `gemfall-compat.test.ts` hashes every Gemfall file, so adding a find, a
befriend choice or a rest scene's `setting` to a Gemfall chapter is a deliberate re-hash with its
reason in the commit. Re-taking those hashes for the camp is approved (*decided*). Nothing here may
move the gameplay digests below the hashes: `findForCamp`, `findForKit` and `setting` change nothing
the digests measure (no flag, XP, item or route), and that should be checked when the mosshorn is
added and the rest scenes are tagged.

## 11. Decisions and open questions

Settled by the product owner:

| Question | Decision |
| --- | --- |
| What it is | A **camp**, not a caravan: carried on the heroes' backs, and clear of Gemfall's story caravan (intro) |
| The currency's name | **Dash Cash** (§5.2) |
| Rest scenes | Every rest scene is marked indoor or outdoor. Outdoor crossfades to the camp, with its narration on the camp screen; indoor keeps its picture with bedrolls and packs (§3, §3.2) |
| Editing from the adventure book | Each kid can change their own hero's kit and buddy from the book, online or queued offline and merged field by field (§7); the crew's camp stays look-only there (§7) |
| Who owns what | The crew owns the camp's shared parts and friends; each hero owns their kit (tent, bedroll, pack, decorations, souvenirs), which goes wherever the hero goes (§4, §4.5) |
| A crew with no finished campaign | The shop is enough; the frame still grows only on a finished full campaign (§4.1) |
| The tutorial and The Hollow Crown | Neither grows the frame; only `growsCamp` campaigns do (§4.1) |
| Gemfall's pinned hashes | Re-taking them for the camp's content changes is approved; the gameplay digests must still not move (§10) |
| Friends | Only creatures that belong to nobody in the story; Pepper is out, and new characters will be written (§4.4) |
| How many friends at once | Four at most. Each kid may pick one buddy who is always out while their hero is seated; the other seats rotate on their own (§4.4) |
| Finds in a graph campaign | Offered on every way in, given once (§5.1) |
| How much the pieces move | Only a piece a figure is using moves; everything else is static (§8.4) |
| Setting off on Begin | At the start of every chapter (§8.5) |
| Phase 1 | Small: the animated lobby only, expanding once children notice their camp (§10) |
| The first reward | Arrives in the first session: a kit choice and a first-chapter find (§5.3) |
| The shop | Opens once the crew has been paid for two chapters; its first pieces cost 5 Dash Cash (§5.3) |
| Lucky drops | A 1 in 8 chance of 1 Dash Cash after each won mini-game or fight, rolled by the server. Never from `play` interactions, at most 2 a chapter, none in a chapter already paid for (§5.2) |
| What a chapter pays | 2 for finishing, any ending, plus 1 per optional objective met (§5.2) |
| Milestone kit pieces | A tent style for each new appearance tier and a decoration for each class distinction, kept even if a failed campaign puts the tier back (§5.4) |
| Offline kit edits | Queued on the phone and merged field by field when the signal returns (§7) |
| Goal steps | Pay no Dash Cash: every success path ticks them all, so they would be free money. Finishing and optional objectives pay (§5.2) |
| Kit finds | Every seated hero gets their own copy; a duplicate gives nothing, since Dash Cash is the crew's (§5.4) |
| The shared-edit limit | Tested in playtest, with an Undo that does not use up a change (§6.1) |
| Implementation requirements | All of §12 approved, including its defaults: lower-stage pieces staying in later shops, and the migration policy for existing crews (§12) |

Nothing is open. The two parked questions from earlier (editing from the book, choosing friends)
are settled above as kit and buddy editing in the book and buddies.

## 12. Implementation requirements

These close gaps in the earlier draft, and are **approved** (*decided*): implementation follows
them. Where one says something is under test (the shared-edit limit and Undo, §12.5), the playtest
decides the number, not whether the mechanism is built. The two parked features in §11 do not
block the initial release.

### 12.1 Kit pieces belong to the hero, camp pieces to the crew

Crew inventory and hero-owned kits have separate ownership rules (§4). A piece in one crew's
inventory can never authorize anything in a hero's kit, at that crew or another.

Kit pieces and crew pieces are separate catalogs with separate ids, so one can never be placed as
the other. Every hero starts with the same free catalog. Earned kit pieces (kit finds, and
milestones, §5.4) are recorded on the character in `HeroKit.unlocked`, with where they
came from; that record moves with the hero when they move home (#251) and is deleted with them.
Never infer kit ownership from any crew's catalog. A buddy (§4.4) is the exception that proves the
rule: it names a crew-owned friend, so it is stored on the crew's camp record, keyed by the hero.

### 12.2 Rewards are permanent, once, and independent of presentation

The once-per-place rule and duplicate conversion need separate identities:

- Give each authored find or friend offer a stable `rewardId` shared across every route into the
  same place. Claiming it writes a crew-scoped receipt atomically with the reward.
- First claim: grant the piece, or 1 Dash Cash if the crew already owns it from another reward. An
  existing receipt grants neither a second piece nor more Dash Cash. Different routes and replays
  cannot farm the same offer.
- Pay chapter-completion Dash Cash and write its paid-chapter receipt together. Replaying an
  already-paid chapter grants no completion or optional-objective payment, including objectives
  missed the first time. Unclaimed finds remain available.
- Persist finds when their authored effect is applied, even if the room closes before the
  chapter's end. Showing a find at the chapter's end celebrates an owned piece; it is never the
  act that saves it. Declining a friend writes no receipt; that friend may be offered on a later
  visit.
- A lucky drop (§5.2) writes a receipt keyed by the run and the scene that dropped it, together
  with the Dash Cash, so a retried, replayed or reconnected result never pays it twice.
- Snapshot met optional objectives for payment. An objective backed by an item must still count if
  the party met it and later handed over the item.

Use stable award identities rather than scene ids that can change during editorial revisions. The
record sketch in §9 needs these receipts; choose their storage shape after checking transaction
and record-size limits. A content version update must not reset claims.

### 12.3 Progression has a ceiling and a replay rule

Count each distinct `growsCamp` campaign the crew successfully completes once
(`grownBy`), capped at stage 4. Failed or abandoned attempts do not advance the frame and do not
remove anything. Replaying a campaign does not advance it again. Later successful campaigns may
add cosmetic trophies after stage 4.

Existing crews need a migration policy: derive the starting stage and kept trophies from their
recorded successful `growsCamp` campaigns, initialize Dash Cash to zero, and do not back-pay
historical chapter rewards. Existing heroes do get the milestone kit pieces (§5.4) for the tiers
and distinctions they already hold: those are the hero's own record, not a payout. Keep that
migration idempotent.

Every frame must support the full seated party and the four visible friends. Frame growth can add
decorative hotspots, but cannot be required to display a hero's personal space. Early phases must
render a safe fallback for a crew whose derived stage exceeds the available frame art.

### 12.4 The chapter-end purchase is optional and atomic

Allow at most one purchase per chapter-end visit. Show up to three eligible,
unowned pieces for the current stage, in a stable catalog order, plus **Save our Dash Cash**. Show
the price and resulting balance. If none is affordable, show the balance without starting a vote.
Lower-stage pieces the crew does not own stay in later shops.

A vote belongs to one chapter-end instance and one crew. Use the existing choice-vote rules for
connected and stepped-away players, including the turn-marker tie break. Leaving the screen
cancels it; there is no pending vote to resume. On resolution the server rechecks eligibility,
ownership and balance, then debits and grants in one commit. Retried messages cannot buy twice.

Two rooms can potentially reach one crew. Use the record's `revision` or an equivalent conditional
write for purchases and placements. A losing concurrent purchase refreshes the offer and balance
without spending. A stale intent from a closed vote or a previous downtime moment is rejected.

### 12.5 Shared edits and automatic display do not discard anything

Identify each downtime moment on the server, and count shared edits by seated
player rather than device. Reconnecting or using a second phone does not reset the limit. Invalid
changes do not count. Explain the limit before the first edit and disable further shared edits
with a short message; personal edits remain available. Undo (§6.1) restores the hotspot's previous
piece, only for that player's own latest change in the same downtime moment, and gives the change
back; it never undoes another child's pick. Placing a piece first owned this chapter is not
counted. All of this is under test (§6.1), so keep the limit one server-side constant.

Awarding a piece never silently replaces a decoration another child chose. It joins the
collection, is shown beside the campfire, its matching hotspot is highlighted, and a player may
place it during downtime. If its hotspot is not available yet (a later frame stage), it stays in
the collection with a note saying when it can be displayed.

Choose the visible friends once per downtime moment: first each seated hero's buddy (§4.4), then the
rotating seats, with a stable tie break and newly acquired friends first. Persist enough rotation
history for "least seen" to survive reconnects; do not write positions or animation frames. More
than four new friends at once queue their first appearance for later downtime moments. Friends not
currently out remain visible in the collection; rotation never suggests that they left or were lost.

### 12.6 Story independence and presentation take precedence

Rest scenes are resolved by their `setting` (§3.2): only an outdoor rest crossfades to the full
camp, and an indoor one keeps its own picture. When tagging, an outdoor place no campsite fits
(a boat deck, a narrow ledge) is tagged indoor.

Friend invitations name the creature and offer "Come along" without naming the camp. A friend
must belong to nobody in the story (§4.4): check every later chapter for the creature before
adding it, and treat a later authored appearance as a reason to pick another friend, never a
reason to rewrite the story. Cosmetic collection state must never rewrite story continuity.

"Nothing waits" applies to animation too: Begin and Go on interrupt any gathering, purchase
celebration or setting off immediately. There is no countdown and no animation completion gate.
Local animation may differ between screens; use a downtime-moment seed rather than the wall
clock, and do not depend on matching positions to resolve a tap.

Every phone action also needs a named, keyboard-accessible control outside the canvas. Friends
have text reactions; pieces have labels, source and selected state. Follow
[accessibility settings](accessibility.md) for touch targets, largest text, contrast and reduced
motion. Still rendering keeps every interaction. Cache the camp snapshot and its required art for
the book, label its last-sync time, and provide a useful first-visit empty state. If the device can
reach more than one crew, name the selected crew explicitly in the book.

The book's kit and buddy edits (§7) use a write path authorized by the phone's device binding, as
its read is: the server accepts `kitPlace` and `buddyPick` only for heroes that belong to the kid
the phone is bound to, refuses everything else, and applies the same `revision` check as the
table, so an edit in the book and one at a live table resolve cleanly. A live room picks up a kit
change at its next downtime moment.

## 13. Acceptance criteria and playtest questions

### 13.1 Required checks

These follow from the decisions in §11, the requirements in §12 and the existing rules the camp
lives under.

- Failed campaigns keep every camp gain (§1).
- The tutorial, The Hollow Crown and any other campaign without `growsCamp` never grow the frame
  (§4.1).
- A find or friend in a graph campaign is offered on every way in and given once (§5.1).
- Every rest scene has a `setting`, and validation fails without one. An indoor rest never shows
  the campsite backdrop or tents (§3.2).
- The first session offers each kid a choice for their own kit, and the first chapter of the
  Practice Meadow and of every `growsCamp` campaign hands over a find on every path (§5.3).
- The shop does not open until the crew has been paid for two chapters (§5.3).
- Lucky drops come only from the server's roll, after a won mini-game or fight, at about 1 in 8
  over many trials; each pays once, whatever is retried or reconnected (§5.2, §12.2).
- No purchase can overspend, buy a piece twice or charge after the chapter's end has been left.
  Placements the sender may not make are refused (§6).
- A hero's kit, souvenirs included, goes with the hero to every crew and when moving home (§4.5).
  Household and character deletion follow existing lifecycle rules.
- A kit find gives every seated hero their own copy, and a hero who already has it gets nothing
  more (§5.4).
- A buddy is always out while its hero is seated; the other seats rotate (§4.4).
- From the book, a kid can change only their own hero's kit and buddy; nothing shared can change
  there (§7, §12.6). Offline changes queue, survive closing the book, and merge field by field when
  sent; a field changed elsewhere in the meantime keeps the newer value (§7).
- A new tier or class distinction unlocks its kit piece once, and a failed campaign that puts the
  tier back leaves the piece unlocked (§5.4).
- Begin, Go on and return to lobby remain available with panels open and during every animation
  (§3, §8).
- At most four friends are out, and four heroes and four friends fit each frame, and the indoor
  layout, without covering required controls or narration (§4.4). Review recordings for walking,
  crossings, occlusion and layout at phone and TV sizes (§8.6). Verify largest text, reduced
  motion and the still fallback (§8.7), and keyboard access as docs/accessibility.md already
  requires.
- The book opens offline after an online read with its saved pieces and friend reactions (§7).
- A reward reached through two routes, replayed, retried or reconnected grants once, by its
  `rewardId` receipt; a duplicate owned piece converts to Dash Cash once per distinct reward offer;
  skipping a celebration does not lose its reward, because finds are saved when found (§12.2).
- Each `growsCamp` campaign grows the frame at most once per crew, however often it is replayed,
  and the frame stops at stage 4; existing crews migrate idempotently (§12.3).
- Kit pieces and crew pieces never cross: no crew piece ever appears in a kit, and no kit piece on a
  shared hotspot (§12.1).
- At most one purchase per chapter-end visit; a losing concurrent purchase refreshes the offer
  without spending; a stale intent is refused (§12.4).
- Shared edits are counted per seated player, not per device; Undo gives the change back; placing
  a piece first owned this chapter is not counted (§12.5).
- The book names the crew and how fresh its saved copy is, and its first use without a cache is
  clear (§12.6).

### 13.2 Playtest questions

Playtest each phase with children in both target age groups and a grown-up. Observe whether children
recognize a past adventure, can find their own tent and can place a piece without help. Record
whether the shared-edit limit causes arguments or frustration, how often children use Undo, and
whether buddies and the rotating seats feel fair. Watch whether kids open the book alone to change
their kit. Note whether children understand what the camp is for
after their first session (§5.3). Measure added time before Begin and Go on: the technical target is
no forced delay; voluntary time spent decorating should be reported separately.

Before expanding art production, verify the first phase's central question: do children notice
and care about their crew's camp? Before tuning shop prices, measure actual first-play rewards,
time to the first affordable purchase and how often a crew chooses to save. The economy targets in
§5.2 are hypotheses until those observations exist.
