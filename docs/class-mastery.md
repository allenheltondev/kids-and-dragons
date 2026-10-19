# Class mastery: switching classes, class places and distinctions

> **Status.** Partly built. Per-class distinctions on the character and moves by distinction (§5,
> §7) landed with #308, and [spec §4.3](./spec.md) and [§8.1](./spec.md) now state them. The
> switch itself (§3) landed with #311: a scene marked `classPlace` is a class's room
> ([content/README.md, "Class places"](../content/README.md#class-places-311)). Deeds, the
> fitting stall, the four rooms and the tokens are still design. Tracked by epic
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
- **At a class's place**, any time after that (§2).

Nowhere else. A class never changes mid-fight, in the lobby, or between chapters.

## 2. The class places

One per class, and each teaches only its own class.

| Class | Place | Who teaches, and the detail |
|---|---|---|
| Thornguard | **The Dojo** | The teacher has held the same door shut against the wind for forty years. Students practice Brace by catching falling pillows. |
| Starweaver | **The Academy** | The roof is open to the sky, so the homework floats away. The big telescope sneezes. |
| Duskrunner | **The Rookery** | A rooftop school run by the crows, as a flock. |
| Songkeeper | **The Conservatory** | A music school that is also a greenhouse. The plants lean toward whoever is singing best. |

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
  missing one, or whose only way to one is gated.
- **Introduced on every visit.** Places in a graph campaign can be reached in any order, so each
  room introduces its teacher (and the crows) whenever a party walks in. A second visit can read
  shorter ("The crows eye you. 'Back again.'").
- **Gemfall gets none.** It is pinned, and its only class change is the Exchange stall.

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
- **Not a back door to a rank** *(built, #311).* Until deeds (#310), crossing level 3, 6 or 9
  raises the worn class one rank per threshold crossed. It never lifts a class to "the rank the
  level used to unlock", which would hand a level 7 hero who just switched an Expert rank at the
  next chapter's XP.

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
  at a tier floor ([spec §8.4](./spec.md)). A third is temporary: until deeds are counted (#310),
  reaching level 3, 6 or 9 earns the worn class Apprentice, Expert or Master (`levelBridge` in
  `character.ts`), so a hero made in between is never stuck on the signature. #310 removes it, and
  ranks it gave are kept.
- **Never lost by switching.** Each class remembers its own rank and its partial progress. Going back
  to Thornguard later picks up exactly where the hero left it.
- **Only the worn class counts.** Its moves are the only class moves on the phone, and only its deeds
  count.
- **A failed campaign rolls back class, distinctions and deed progress** to how they stood when the
  campaign began, together with everything else that rolls back. They live in `CharacterProgress`
  for exactly that reason (see its `unspentPoints` note in
  [`domain.ts`](../packages/shared/src/types/domain.ts)).
- **When a rank lands** (proposed default): pips fill live on the phone as deeds happen; the rank
  lands at the end of the fight with a moment on the TV (the token glows and gains its notch); the
  new move is usable from the next fight.

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

### The ladder (draft; counts are placeholders for playtesting)

**Thornguard**
| Rank | With friends | Alone |
|---|---|---|
| Apprentice | Brace for a friend 3 times | Finish 3 fights without being knocked down |
| Expert | Shove an enemy off a friend who is hurt or down, 3 times | Shove 5 times |
| Master | Bramble Wall in 3 fights, **and** take a Thornguard choice or rift way once | same |

**Duskrunner**
| Rank | With friends | Alone |
|---|---|---|
| Apprentice | Land the first hit of a fight 3 times | same |
| Expert | An enemy misses you because you Vanished, 3 times | same |
| Master | Twin Step to finish an enemy 3 times, **and** take a Duskrunner choice once | same |

First Strike happens on its own, so its deed is landing the first hit, not pressing a button.

**Starweaver**
| Rank | With friends | Alone |
|---|---|---|
| Apprentice | Catch 2 or more enemies in one Burst, 3 times | same |
| Expert | A Glimmered friend makes their roll, 3 times | Catch 3 enemies in one Burst |
| Master | Tanglelight an enemy about to reach a friend, 3 times, **and** steady a rift or take a Starweaver choice | Tanglelight 5 times, plus the story deed |

**Songkeeper: hearts restored by your own songs**

One track at every table size: hearts **actually restored** by Rally, Soothe and Chorus, on anyone,
the Songkeeper included. Potions, Mend and other classes' healing do not count. Healing a hero at
full health counts nothing, so it cannot be farmed. Lifting a knocked-down friend counts as 3.

| Rank | Hearts restored | And |
|---|---|---|
| Apprentice | 10 | |
| Expert | 25 | |
| Master | 50 | take a Songkeeper choice or rift way once |

This needs one fight change (§7): Songkeeper moves may target the Songkeeper.

## 7. Engine changes this implies

- **Songkeeper self-targeting.** Rally and Soothe may target the Songkeeper; a single-target
  ally ability skips its own user (`legalTargetsFor` in
  [`encounter.ts`](../packages/shared/src/encounter.ts)) unless its target rule says
  `"includeSelf": true`, which only those two abilities do (done in #309). Rally's revive stays friend-only, since a
  knocked-down hero cannot act. Chorus already includes the Songkeeper. This changes every
  Songkeeper fight, not just deeds; if self-healing proves too strong in playtests, Rally's
  self-heal can be smaller than its heal on others.
- **Deed attribution.** Fight events say what happened but not always who caused it (a `heal`
  event names only who was healed). Deeds need the acting hero and the ability on each counted event.
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
- **Gemfall is pinned** (`gemfall-compat.test.ts`). The fitting stall must not move its gameplay
  digests; whether it is engine UI at the start of a campaign that opens at the Exchange, or a scene
  in Gemfall's first chapter with re-taken hashes, is decided in its issue.

## 8. Open questions

- **What counts as "new"** for the fitting stall: has finished no chapter? no campaign?
- ~~**Heroes who join at a level floor**~~ *Decided in #308:* the joiner's class arrives with the
  rank its level used to unlock (4 → Apprentice, 7 → Expert, 10 → Master), the same moves a joiner
  always had and the rank the migration gave heroes of that level; every other class starts at none
  ([spec §8.4](./spec.md)).
- **The §8.1 rhythm.** Level 3 / 6 / 9 moves interleave with the 1 / 4 / 7 / 10 tiers ("breathe,
  new move, new look"). Deeds decouple moves from levels, so that rhythm is no longer guaranteed.
  Deed counts are the lever for keeping it roughly true.
- **Brace and Glimmer alone.** Both still have no target for a hero playing solo. The ladder covers
  their deeds, but the moves stay dead; a separate decision.
- **Deed counts** are all placeholders.
- **A reason to go back to the Exchange** after a hero is no longer new: [#306](https://github.com/allenheltondev/kids-and-dragons/issues/306).
