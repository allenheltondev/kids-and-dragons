# Class mastery: switching classes, class places and distinctions

> **Status.** Partly built. Per-class distinctions on the character and moves by distinction (§5,
> §7) landed with #308, deeds and rank-ups (§5, §6) with #310, the switch itself (§3) with
> #311: a scene marked `classPlace` is a class's room
> ([content/README.md, "Class places"](../content/README.md#class-places-311)), the tokens on
> screen with the rank-up moment (§4, §5) with #314, and the fitting stall (§1) with #312
> ([content/README.md, "The fitting stall"](../content/README.md#the-fitting-stall-312)).
> [spec §4.3](./spec.md) and [§8.1](./spec.md) state them. The four rooms are written for the
> Riftlight campaign (#315, [its routes and endings](campaigns/continental-rift/routes-and-endings.md)).
> Tracked by epic
> [#307](https://github.com/allenheltondev/kids-and-dragons/issues/307) (#308–#315); the reason to
> come back to the Exchange is [#306](https://github.com/allenheltondev/kids-and-dragons/issues/306).

A hero can change class. A hero picks a class at creation, may swap it once for free at the
Exchange while new, and after that changes class only at that class's own place: the Dojo, the
Academy, the Rookery or the Conservatory. Each class has three **distinctions** (Apprentice,
Expert, Master), earned only by doing that class's deeds. Distinctions are never lost by switching,
but only the class the hero is wearing counts.

## 1. Picking a class

- **At creation**, exactly as today ([spec §4](./spec.md), creation step 2). Kids meet their whole
  hero on day one: species, class, outfit.
- **At the Exchange, once, while new.** The Exchange is a market, and a **fitting stall** there lets
  a new hero swap class for free. Gemfall opens at the Exchange, so a hero who starts in Gemfall
  gets the same offer. It is the only place a hero can change class that is not that class's own.
  *(Built, #312.)*
  - **New** means two things: the hero has **finished no chapter** (her effective XP is 0, since
    every chapter's end awards XP and nothing else does) and **has not used the stall**
    (`CharacterProgress.fitted`). A hero who joined at a tier floor has XP and is not new.
  - **Where.** `rules.json` names the scenes the stall stands in (`fittingStall.stands`): today
    Gemfall's `scene_prologue_city`, where the Exchange is first described as a market. It lives in
    the rules, not in a chapter, so Gemfall gets the stall without a Gemfall file changing.
  - **How it plays.** Exactly a class place (§3) with a different gate. When a party with at least
    one new hero arrives, the shared screen introduces the tailor, and each new hero answers alone
    on their phone: any class but the one worn, or "Stay". A swap asks "are you sure?" first, and
    the way on waits for every connected new hero's answer. A table with nobody new walks through
    that scene as if the stall were not there.
  - **Once.** The swap is spent in the same write as the class (`fitClass`), on the same progress
    half, so it rolls back with it: a **failed campaign gives the swap back** along with the class it
    took off, and since the failure also takes back the XP, the hero is new again and is offered the
    stall when the campaign starts over. A finished campaign keeps both.
- **At a class's place**, any time after that (§2).

Nowhere else. A class never changes mid-fight, in the lobby, or between chapters.

## 2. The class places

One per class, and each teaches only its own class.

| Class | Place | Who teaches, and the detail |
|---|---|---|
| Thornguard | **The Dojo** (Sky Islands) | The teacher has held the same door shut against the wind for forty years. Students practice Brace by catching falling pillows. |
| Starweaver | **The Academy** (Marshland) | The roof is open to the sky, so the homework floats away. The big telescope sneezes. |
| Duskrunner | **The Rookery** (The Exchange) | A rooftop school run by the crows, as a flock. |
| Songkeeper | **The Conservatory** (Glacier of Origins) | A music school that is also a greenhouse. The plants lean toward whoever is singing best. |

### The crows

The Rookery is taught by **the crows**, all of them. No crow is named or singled out, and there is
no single teacher. The crows always tell people, at least subtly, **"don't mess with us."** Every
Rookery scene says it in some form, from a sign on the chimney ("NO MESSING. (WITH US.)") to a
note in your pocket after a fight ("Saw that. Nice. Don't mess with us."). Whenever a Duskrunner
earns a distinction anywhere in the world, a crow lands on a nearby fence, says it, and flies off.

### How a party gets there

- **A class place is a side room of an existing place**, never a place on the graph of its own: the
  Academy is in the marsh village, the Rookery is on the Exchange's rooftops. The party enters it
  from that place's `rest` scene, so a campaign pays for four rooms, not four chapters.
- **Every graph campaign has all four reachable.** `content:validate` fails a graph campaign that is
  missing one, or whose only way to one is gated *(built, #313)*. A way counts when no flag, item,
  species, class, world fact, lock or rift rule (`opensWhen`, `lasts`, `actions`, ...; `uses` alone does not, since every party crosses once) stands in it; a `completed:` or `visited:` gate on a place any
  party can reach is open. A room must be entered from a `rest` scene. A graph campaign that does not
  have its rooms yet is listed with a reason in `tools/content/class-place-allow.json`, which warns
  and which #315 empties; an entry for a campaign that has them all fails, so it cannot go stale.
- **Introduced on every visit.** Places in a graph campaign can be reached in any order, so each
  room introduces its teacher (and the crows) whenever a party walks in. A second visit can read
  shorter ("The crows eye you. 'Back again.'").
- **Gemfall gets none.** It is pinned, and its only class change is the Exchange stall.
- **Riftlight (#483).** The Rookery is on the Exchange's rooftops, the Conservatory off the
  glacier's singing hall, and the Dojo off the sheltered path in the Sky Islands arrival chapter.
  The Ashspan Bridge chapter offers an optional visit to a village in the Whispering Marsh
  to fetch a dry ferry mat. The Academy is a side room off that village's rest bench. Parties that
  visit walk back to the bridge before the chapter ends; parties that stay at the ferry can finish
  without the errand. Class locations appear in the field guide only after a first visit.
- **A free heal is deliberate.** The game always keeps somewhere to heal for free. In Riftlight it is
  the singing hall: its rest heals on every arrival, so walking into the Conservatory and back heals
  again, as often as a table likes. That is intended, not a loophole.

## 3. Switching

- **Any hero may switch at a class's place, as often as they like.** The party being there opens it
  for everyone; each kid decides alone. There is no vote and no per-campaign limit.
- **Stats stay where they are.** A Thornguard with everything in Might is a weak Starweaver, and
  deciding when to switch is part of the strategy.
- **Two heroes may share a class.** That is the party's call.
- **What it costs:** getting there, stats that suit the old class, and starting the new class with
  only what it has already earned.
- **How it plays** *(built, #311).* The room's scene carries `classPlace: "<class>"`. Each kid
  there who is not already that class answers on their phone, "Be a Thornguard" or "Stay a
  Songkeeper"; switching asks "are you sure?" first (what comes off, what goes on, that it keeps
  everything earned, and where to switch back). The way on waits until every connected hero who
  could switch has answered, and the TV shows who switched. A kid who said no can still switch
  while the room is open. A dropped phone is not waited on.
- **Deeds follow the worn class** *(built, #310 and #311).* From the switch on, the class just
  put on is the one whose deeds count. What the class taken off earned earlier in the chapter is
  kept and folded into the hero at the chapter's end, and switching back mid-chapter picks it up
  again at once (`withRunDeeds`).

## 4. The gear

In the lore, a class's power comes from a piece of gear the hero wears.

| Class | Gear |
|---|---|
| Thornguard | a thorn bracer |
| Duskrunner | a dusk hood |
| Starweaver | a star circlet |
| Songkeeper | a song bell on a cord |

- **Wear two and they argue.** The bell will not ring near the bracer; the circlet makes the hood
  itch. Neither works, which is why a hero has one class at a time.
- **Distinctions show on the gear**: notches on the bracer, stars on the circlet. A hero's old gear
  rides in their pack with its notches, which shows "kept, but only counts while worn" with no
  explanation.
- **Spare gear takes no inventory slot.** Switching is not also a punishment for the pack.
- **On screen, always the specific name** ("your thorn bracer"). In code and docs the four are
  **class tokens**.
- The Sworn tier already adds a "first gear layer, class-colored accent" ([spec §8.1](./spec.md)),
  and rigs exist for every class, tier and species. The token can be that layer; below Sworn it
  shows as an icon on the phone.

### On screen *(built, #314)*

- **Names** are `CLASS_TOKENS` in [`tokens.ts`](../packages/shared/src/tokens.ts), beside
  `deedTrack`, which picks the one track a hero sees (rule 6, §6): the further along of a rank's
  two, or with neither started, the alone track for a hero alone and the friends track at a table.
- **The token** (`ClassToken.tsx`) uses dedicated painted bracer, hood, circlet and bell icons through
  `Icon`, at every tier. Its notches are three seats, always drawn: a cut notch is a filled chevron and
  one to come a dash; a pip done is a filled dot and one to go a ring. Shape, never colour alone.
- **Where it shows:** the phone's own view and every sheet (the token, "Thornguard Apprentice",
  the next notch's deeds as pips, or a bar with its count past ten, as a Songkeeper's hearts are),
  and the TV lineup in the lobby (the token and its notches in the class icon's seat). Pressing
  and holding a token says what it is (`help.json`, `things.token`).
- **Spare tokens** are `ResolvedCharacter.spares`: every class with a `mastery` entry that is not
  the worn one, since only wearing a class writes one. They sit under the six slots ("Your old
  gear"), with their notches, and take none. A switch (`switchClass`) gives the class put on an
  empty entry, so a token worn without earning anything still goes in the pack when it comes off.
  The switch's "are you sure?" shows both tokens, notches and all, and the TV's roll call draws
  each hero's worn token.
- **The rank-up moment** (`RankUpMoment.tsx`, loaded on the first rank-up): the TV lifts the token
  over the stage with its new notch dropping in, for four seconds, taking no taps and hidden from
  screen readers; #310's line stays under the story as the words of record and is read aloud once.
  The TV remembers a moment it has shown only while that landing is on the state, so a redraw does
  not cheer twice but the same rank landing again (a failed campaign played over) does.
  The earning kid's phone shows the line as a card with the token glowing, in the line's own place.
  A Duskrunner's crow lands on both. Under reduced motion it shows lit and still.

## 5. Distinctions

| Rank | Unlocks (today's level 3 / 6 / 9 move) |
|---|---|
| *(none)* | the class's signature |
| **Apprentice** | the first unlock (Shove, Vanish, Glimmer, Soothe) |
| **Expert** | the second (Bramble Wall, Twin Step, Tanglelight, Chorus) |
| **Master** | the third (Unbreakable, Storm of Blades, Starfall, Encore) |

The screen reads "Starweaver Apprentice" or "Thornguard Master". A hero with no rank yet in their
class is shown with the class name alone.

- **Class moves come from distinctions, not level.** Level keeps everything else it grants: the stat
  point and the appearance tiers.
- **Earned only by deeds** (§6). No XP, and no level cap. Two grants stand outside that, both so no
  hero has fewer moves than before distinctions: heroes from before them (§7), and a hero who joins
  at a tier floor ([spec §8.4](./spec.md)). A hero who levelled between #308 and #310 was given
  ranks by level in the meantime; those ranks are stored, and kept.
- **Never lost by switching.** Each class remembers its own rank and its partial progress. Going back
  to Thornguard later picks up exactly where the hero left it.
- **Only the worn class counts.** Its moves are the only class moves on the phone, and only its deeds
  count.
- **A failed campaign rolls back class, distinctions and deed progress** to how they stood when the
  campaign began, together with everything else that rolls back. They live in `CharacterProgress`
  for exactly that reason (see its `unspentPoints` note in
  [`domain.ts`](../packages/shared/src/types/domain.ts)).
- **When a rank lands** *(built, #310)*: deeds count live as they happen; the rank lands at the end
  of the fight (or at once, for a story deed outside one), and the new move is usable from the next
  fight. The TV and the hero's phone say so in one line ("Mira is a Thornguard Apprentice now! New
  move: Shove."), and a Duskrunner's crow has its say. The moment around it (the token
  glowing and gaining its notch) is built too (#314, §4 "On screen").
- **Kept with the chapter.** Deeds counted in a chapter are folded into the hero when the chapter
  ends, beside its XP and under the same rule; a chapter abandoned partway keeps neither. The run
  keeps each class's count apart, so a hero who changes class mid-chapter keeps what the class she
  took off earned. A class way
  at a rift, taken between chapters, is written straight onto the hero.

## 6. Deeds

### Rules

1. **Counted by the game**, from events it already produces: fight actions, choice outcomes, rift
   actions. Never a judgment call like "an enemy had to walk around your wall".
2. **Earnable at any table size.** A table seats one to four. Where a deed needs a friend, the rank
   has a solo deed beside it, and either counts.
3. **Never rewards bad play.** No "take 20 damage", no "get lifted up 3 times".
4. **Each rank is earned with the move just unlocked**, so every move is taught by being used.
5. **Master includes a story deed**: a class-only choice (`requiresClass`, #228) or a class way at a
   rift (#199). Fights are not the only way to grow.
6. **One visible track per hero.** No menu of deeds to pick from.

### The ladder

Counts are a first tuning, for playtesting; they live in `content/rules.json` (`deeds` on each class)
and the deeds themselves in [`deeds.ts`](../packages/shared/src/deeds.ts). Each rank's count starts
from zero when the rank before it lands. Either track completes a rank, at any table; "alone" is
the one with nothing in it that needs a friend.

**Thornguard**
| Rank | With friends | Alone |
|---|---|---|
| Apprentice | Brace takes a hit meant for a friend, 2 times | End your turn on your feet next to a monster, 2 times |
| Expert | Shove a monster that is next to a hurt or knocked-down friend, 3 times | Shove 5 times |
| Master | Grow a Bramble Wall in 3 fights, **and** take a Thornguard choice or rift way once | same |

The draft's "finish 3 fights without being knocked down" is gone: a hero alone is outnumbered in
almost every fight content has, so it asked a solo Thornguard to win, and rewarded fights more than
the job. Holding the line beside a monster is the job.

**Duskrunner**
| Rank | With friends | Alone |
|---|---|---|
| Apprentice | Hit a monster you have not hit yet this fight, 3 times | same |
| Expert | A monster misses you because you Vanished, 3 times | same |
| Master | Twin Step finishes a monster, 3 times, **and** take a Duskrunner choice or rift way once | same |

The draft's "land the first hit of a fight" was a race a Duskrunner lost at a full table: a
Starweaver's Burst from across the board lands first in nearly every fight. Each monster is now its
own first hit, and nobody else's swing can take it away. Everywhere at once.

**Starweaver**
| Rank | With friends | Alone |
|---|---|---|
| Apprentice | Catch 2 or more monsters in one Burst, 3 times | same |
| Expert | A friend you Glimmered hits with that roll, 6 times | Catch 2 or more monsters in one Burst, 6 times |
| Master | Tanglelight a monster close enough to reach a friend next turn, 8 times, **and** take a Starweaver choice or rift way once | Tanglelight 10 times, plus the story deed |

"Caught" is standing in the square when it goes off, hit or missed.

**Songkeeper: hearts restored by your own songs**

One track at every table size: hearts **actually restored** by Rally, Soothe and Chorus, on anyone,
the Songkeeper included. Potions, Help Up, species heals and other classes' healing do not count.
Healing a hero at full health restores nothing and counts nothing, so it cannot be farmed. Lifting a
knocked-down friend with Rally counts as 3.

| Rank | Hearts restored | And |
|---|---|---|
| Apprentice | 4 | |
| Expert | 15 | |
| Master | 25 | take a Songkeeper choice or rift way once |

(25 more hearts after Expert's 15 after Apprentice's 4: 44 in all, against the draft's 50.)

### How fast

`deeds.test.ts` plays the shipped rules and abilities through the real engine, fight after fight,
with heroes who do what their next deed needs when the fight offers it and swing otherwise: a hero
alone against two wolves (most of whose fights are lost), and a table of four, one of each class,
against three. Fights until each rank lands, median (worst) of ten seeds:

| | Apprentice | Expert | Master |
|---|---|---|---|
| Thornguard alone | 1 (1) | 5 (6) | 8 (9) |
| Duskrunner alone | 2 (3) | 3 (5) | 9 (12) |
| Starweaver alone | 2 (3) | 6 (8) | 11 (12) |
| Songkeeper alone | 2 (3) | 6 (8) | 10 (13) |
| Thornguard, table of four | 2 (3) | 6 (12) | 9 (15) |
| Duskrunner, table of four | 2 (3) | 3 (4) | 5 (9) |
| Starweaver, table of four | 2 (2) | 4 (6) | 6 (8) |
| Songkeeper, table of four | 2 (2) | 4 (6) | 8 (13) |

A chapter's shortest and typical paths hold about one fight (`npm run content:pacing`), so
Apprentice lands in one or two chapters, Expert around the end of a hero's first campaign, and
Master in their second: roughly the old 3 / 6 / 9 rhythm (§8).

## 7. Engine changes this implies

- **Songkeeper self-targeting.** Rally and Soothe may target the Songkeeper; a single-target
  ally ability skips its own user (`legalTargetsFor` in
  [`encounter.ts`](../packages/shared/src/encounter.ts)) unless its target rule says
  `"includeSelf": true`, which only those two abilities do (done in #309). Rally's revive stays friend-only, since a
  knocked-down hero cannot act. Chorus already includes the Songkeeper. This changes every
  Songkeeper fight, not just deeds; if self-healing proves too strong in playtests, Rally's
  self-heal can be smaller than its heal on others.
- **Deed attribution.** *(Built, #310.)* Fight events say what happened but not always who caused it
  (a `heal` event names only who was healed), so the engine counts a hero's action where it has the
  acting hero, the ability and the fight as it stood before (`actionCredits` in `deeds.ts`), and
  everything else — the monsters' turns, the place fighting back — by its events. Counting is a
  pure read: no event, roll or turn changes, and Gemfall's pinned digests hold. The chapter's count
  lives on the run (`RunState.deeds`) and is folded into each hero at chapter completion.
- **Per-class progress on the character.** *(Built, #308.)* `CharacterProgress.class` is the worn
  class and `CharacterProgress.mastery` holds each class's rank and deed counts, so failure rolls
  them back. `Character.class` is gone: one answer to "what class is she", in the half that rolls
  back.
- **Moves by distinction.** *(Built, #308.)* `resolveCharacter` derives the class moves from the
  worn class's rank, not level: its signature plus one move per rank, and no others. The stored
  `unlockedActions` list is gone, since a stored copy of a derived answer goes stale.
- **Existing heroes keep every move they have.** *(Built, #308: character schema v5.)* On
  migration, a hero's current class is given the rank matching the moves their level already
  unlocked (level 3 → Apprentice, 6 → Expert, 9 → Master), read from each half's XP and its old
  `unlockedActions`. No kid opens the game to a missing move.
- **Switching.** *(Built, #311.)* Offered by a scene marked `classPlace` and checked by the
  server (`prepareClassSwitch`): the party is in that room, read from the chapter, and the hero is
  not already that class. `switchClass` (character.ts) writes the worn class into the effective
  half, so it rolls back with a failed campaign. `RunState.classPlace` carries the room's class
  and each kid's answer.
- **Validation**: all four rooms reachable in every graph campaign (§2).
- **The fitting stall.** *(Built, #312: character schema v6.)* The same `RunState.classPlace`,
  as `{ stall: true, answers }`, opened by the engine where `rules.fittingStall` stands while a seated
  hero is new (`isNewHero`, class-place.ts); the same `SWITCH_CLASS` / `KEEP_CLASS`, carrying
  `stall: true`; the same `prepareClassSwitch`, which checks the stall stands in this scene and that
  the stored row is new, then writes `fitClass`.
- **Gemfall is pinned** (`gemfall-compat.test.ts`). The stall is engine-level: no Gemfall file
  changed, no hash was re-taken, and the gameplay digests hold. A table that declines plays
  `gemfall-01` exactly as before; the only difference is one tap per new hero, which advances the
  run's seq (`fitting-stall.test.ts`).

## 8. Open questions

- ~~**What counts as "new"** for the fitting stall~~ *Decided in #312:* has finished no chapter
  and has not used the stall (§1).
- ~~**Heroes who join at a level floor**~~ *Decided in #308:* the joiner's class arrives with the
  rank its level used to unlock (4 → Apprentice, 7 → Expert, 10 → Master), the same moves a joiner
  always had and the rank the migration gave heroes of that level; every other class starts at none
  ([spec §8.4](./spec.md)).
- **The §8.1 rhythm.** Level 3 / 6 / 9 moves interleave with the 1 / 4 / 7 / 10 tiers ("breathe,
  new move, new look"). Deeds decouple moves from levels, so that rhythm is no longer guaranteed.
  Deed counts are the lever for keeping it roughly true.
- **Brace and Glimmer alone.** Both still have no target for a hero playing solo. The ladder covers
  their deeds, but the moves stay dead; a separate decision.
- **Deed counts** are a first tuning against a simulated table (§6, "How fast"); real tables will move
  them.
- **A reason to go back to the Exchange** after a hero is no longer new: [#306](https://github.com/allenheltondev/kids-and-dragons/issues/306).
