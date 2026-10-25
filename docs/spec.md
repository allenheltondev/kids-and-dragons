# Kids & Dragons — Game Design Spec

A multiplayer tabletop-style adventure for three players: two adults and an 8-year-old.
Playable on a shared TV with phones as controllers, or phone-only on the road.
~30 minutes per session, campaigns played in chapters.

---

## 1. Design principles

These are the constraints every other decision answers to.

1. **She taps, she doesn't type.** Every player action is a choice from a visible set. Free text is never required.
2. **Nobody dies.** Zero HP is "knocked down," not dead. See §7.
3. **Thirty minutes is a whole thing.** A session must reach a satisfying stopping point in ~30 min. Chapters are the save unit.
4. **No AI at the table.** Everything a table sees and hears is authored ahead of time. The game makes no model call while it plays, and nothing a kid types, picks or does is sent to one (§10).
5. **Iconography carries the text.** She reads fluently, but every choice, stat, ability, item, and status has an icon. Text is the label, not the interface.
6. **Progress is visible on the character.** Leveling up changes what her unicorn *looks like*. That is the reward.
7. **The party is persistent.** Characters, levels, and inventory survive across sessions and campaigns. Progress is never a session artifact.

---

## 2. Presentation modes

The game presents through two composable surfaces:

- **WorldView** — the shared board. Map, characters, animation, narration, the dice.
- **PlayerView** — your private controller. Character sheet, inventory, your legal actions, your turn prompt.

Where those two surfaces render is the only difference between modes. They are the **same components** in both — mode is a layout concern, not a feature fork.

### 2.1 Party Mode — at home

| Device | Renders |
|---|---|
| **TV** (browser on a laptop/mini-PC via HDMI) | WorldView, full screen. Shows the room code + QR when idle. |
| **Phone** (browser) | PlayerView only. |

The TV is a **pure display client** — no authority, refreshable at any time without losing state. Phones send intents; the server decides.

Any browser can be the TV client, so **a tablet propped on the table is just a small TV.** That falls out for free.

### 2.2 Travel Mode — on the road

No shared screen. Every phone renders **both** surfaces, one at a time, with a toggle:

```
┌───────────────────────┐
│                       │
│  one surface,         │  World — shared, identical on every phone
│  whole screen         │  Map   — the realm, or the chapter as a trail, the party on it
│                       │  You   — the scene behind your sheet and your actions
├───────────────────────┤
│ 🏮 World 🗺 Map 🎒 You │  the tray: objects on a shelf, always there, under the thumb
└───────────────────────┘
```

This started as a 60/40 stack and that was wrong on a phone: neither half had
the room it needed, the party lineup fell off the bottom of one and the six
inventory slots off the bottom of the other. One surface at a time gives each
of them the whole screen, and the toggle costs a tap.

Design consequences, all of which we accept:

- **No private information channel.** Every phone shows the same world. That's fine — this game has no hidden information by design. It does mean **hidden-role or secret-objective mechanics are permanently off the table**, and that's a deliberate trade. *One owner-approved exception:* in Riftlight, a Starweaver's phone alone shows a rift's Riftlight colors (`docs/campaigns/continental-rift/mechanics.md`). It is a class's perception, not a secret objective, and the player shares it by talking.
- **The grid needs a focus camera.** A 10×8 board on a phone has unreadable tiles at full extent. Combat gets an auto-framing camera that follows the active actor, with pinch-zoom and pan to override. This is good for the TV too — Party Mode gets it for free.
- **The dice take over.** On the TV the roll is the centerpiece; on a phone it takes the world for the few seconds the card is up (long enough to read the sum out loud), wherever you were, then returns you.
- **The map is on request.** "Where are we?" is the question a phone in the back of a car gets asked every three minutes, and the world pane answers only "what is happening now". The Map tab answers it twice, with a flip at the top. **World** is the realm painting with the party's own faces standing on the chapter's country, fitted to the phone and zoomable in steps, so "we are *here*" lands against the whole shape of the realm. **Route** draws tonight's chapter as a trail — the scenes the party has played, named; the party on the one it is in; everything ahead as fog, dots without names, so the shape of the road shows and nothing is spoiled. In Party Mode the map rides on the phone, never the TV: a Map button swaps your controls for it and back.
- **The scene comes with the question.** The You surface stands your controls in the scene's own picture, with the whole narration at the top and the answers at the bottom where a thumb is — a visual novel, not a form — so an eight-year-old is never flipping to the world to find out what she is choosing between. In a fight the board needs the contrast, so the picture steps back and the world pane's narration folds to a two-line strip.
- **Your turn comes to you.** Being asked something pushes your controls in front of you automatically — and so does having no character yet, because creation is the first turn anyone takes. The toggle keeps a marker on "You" while you are looking at the world, so a turn can never sit unnoticed behind it.
- **The question travels with the answers.** The scene's narration is echoed above your choices, because the question and its answers would otherwise sit on opposite sides of a toggle and an 8-year-old would flip back and forth to work out what she is choosing between. The world view remains where you go to read it properly.

Mode is chosen per-room at creation and can be switched mid-session — a phone that had a TV can absorb WorldView if the laptop dies.

### 2.3 Between games — the adventure book

A phone that is not in a game can still open what the games left behind and just look. **Your adventure book** (`/journal`) is offered on the home screen to any phone that has played (never to a TV that only hosted), and opens in the same tray as Travel Mode:

- **Hero** — your character sheet, with a picker when you have more than one. The bag is tappable here: each thing says what it is and what it does, because between games there is nothing to use it on and finding out is the point.
- **Map** — the realm painting with everything the household has found, and your hero standing where the party was *last*, labelled as such ("You were here").
- **Guide** — the household's Field Guide (§12), finds credited to the hero each player has taken furthest.
- **Play** — back to the home screen, where joining and hosting live.

Nothing in the book can change anything, so nothing in it can go wrong. It is the book you leaf through in the car — and so it opens without a signal too, even on a reload or in a fresh tab, showing the last copy this phone read and saying so. The map's painting and the pictures of everything found come with it, once the book has been opened with a signal.

---

## 3. Accounts & identity

Characters, levels, and inventory persist across sessions and campaigns, so identity has to be real. But an 8-year-old should never type a password.

**Household account, device-bound player profiles.**

- **The household** is the account. Owned by an adult, authenticated properly (email + passkey). It owns the party, the characters, the campaign history, the inventory, and the souvenirs.
- **Player profiles** live inside the household. Each is bound to a device with a long-lived signed token. Her phone simply *is* her — open the app, tap her avatar, play. No password, ever.
- **Binding a new device** to an existing player requires the household owner signing in. Losing a phone is recoverable; a kid can't accidentally sign herself out of existence.
- **No kid or adult accounts.** A profile is a player. Managing anything needs a signed-in owner; playing needs nothing.
- **Room codes still exist**, but now they join a *session*, not an identity. You are already you before you join.

Mechanics in [architecture.md §4.5](./architecture.md#45-accounts-devices-and-joining).

---

## 4. Characters

A character is **species + class**. Species defines who you are in the world; class defines what you do in a fight. They never overlap, which is what keeps the design small and the combinations meaningful.

### 4.1 Stats

Four stats, kid-legible, one per class:

| Stat | Icon sense | Governs |
|---|---|---|
| **Might** | fist / boulder | Hitting hard, shoving, forcing, enduring |
| **Quick** | wing / arrow | Moving far, going first, sneaking, dodging |
| **Clever** | spark / eye | Spells, puzzles, noticing, tinkering |
| **Heart** | flame / hand | Healing, calming, persuading, helping allies up |

Resolution is always the same: **d20 + stat vs. a target number.**

| Difficulty | TN |
|---|---|
| Easy | 8 |
| Normal | 12 |
| Hard | 16 |

The die decides on its two ends: a **natural 20 always succeeds** and a **natural 1 always fails**, whatever the stat and the target. Nothing is ever certain, and both faces get a name on the screen.

The target is shown as a word as well as a number (**Easy**, **Tricky**, **Hard**), so the table knows how much of a stretch a check is before anyone rolls. Chapters should use all three: a run of nothing but 12s makes every check feel the same.

**Helping.** While someone else's check waits, any other standing player can tap **Help** and add their own die to the roll: a d4 at Fledgling, d6 at Sworn, d8 at Radiant, d10 at Mythic. One helper per check, and each player can help once until the party next rests (or a new chapter starts). The d20 never changes size; the help you give grows as you do.

One roll type, one die, one big animation. She learns it in five minutes and it never changes.

### 4.2 Species — the world layer

Species grants a **passive trait** and one **world ability** usable outside combat. Encounters are authored knowing which species are in the party, so each species creates "only *you* can do this" moments.

| Species | Passive | World ability |
|---|---|---|
| **Unicorn** | +1 Heart | **Mend** — heal a small wound between fights; walk unharmed through thorns and brambles |
| **Dragonling** | +1 Might | **Glide** — cross a gap, chasm, or river the party can't walk around |
| **Griffin** | +1 Quick | **Skyward** — fly up and reveal the map ahead, spotting hazards and treasure |
| **Bigfoot** | +2 max HP | **Smash** — break a barrier, lift something enormous, carry a fallen ally |
| **Kitsune** | +1 Clever | **Beguile** — charm an NPC or slip past a guard unseen |
| **Manticore** | +1 Quick | **Leap** — reach a high ledge or drop safely from any height |

### 4.3 Classes — the combat layer

Four classes, one per stat. Class determines the action set on your phone during a fight.

A hero picks a class at creation (§5) and wears one class at a time. Each class has three **distinctions**, the same for every class: **Apprentice**, **Expert** and **Master**. The class's signature is yours from the start; each distinction unlocks one more of its moves (Apprentice the first, Expert the second, Master the third), and nothing else does: level grants no moves (§8.1). A distinction is earned by doing the class's **deeds** while wearing it: Brace taking a hit for a friend, a Burst that catches two monsters, hearts a Songkeeper's songs give back ([class-mastery.md §6](./class-mastery.md)). Deeds count as they happen; the distinction lands when the fight ends, and its move is on the phone from the next fight. The screen reads "Starweaver Apprentice"; a hero with no distinction yet shows the class name alone.

A hero keeps their distinctions and partial progress in every class they have worn, forever, but only the class they are wearing counts: its moves are the only class moves on the phone. Distinctions, and where and how a hero changes class, are designed in [class-mastery.md](./class-mastery.md): earned by the class's deeds, and changed only at the Exchange while new or at that class's own place. A failed campaign puts class and distinctions back where they stood when it began (§8.3).

| Class | Stat | Role | Signature action |
|---|---|---|---|
| **Thornguard** | Might | Front line | **Brace** — take a hit meant for an adjacent ally |
| **Duskrunner** | Quick | Skirmisher | **First Strike** — act before anyone else on round one |
| **Starweaver** | Clever | Caster | **Burst** — hit every enemy in a 2×2 area |
| **Songkeeper** | Heart | Support | **Rally** — heal an ally, or lift a knocked-down one from range |

| Distinction | Thornguard | Duskrunner | Starweaver | Songkeeper |
|---|---|---|---|---|
| *(none)* | Brace | First Strike | Burst | Rally |
| **Apprentice** | + Shove | + Vanish | + Glimmer | + Soothe |
| **Expert** | + Bramble Wall | + Twin Step | + Tanglelight | + Chorus |
| **Master** | + Unbreakable | + Storm of Blades | + Starfall | + Encore |

Songkeeper's Rally is deliberately the ranged version of the universal Help Up action (§7.2). Making the no-death rule into a *class strength* means it reads as a hero move, not a mercy rule.

6 species × 4 classes = **24 character identities**, built from only 6 world abilities and 4 combat action sets.

---

## 5. Character creation

A guided flow, one decision per screen, with the character rendering live on WorldView as choices are made.

1. **Pick a species** — six large animated portraits. Selecting one plays its idle animation and speaks its world ability.
2. **Pick a class** — four cards, each showing the signature action as a short animated loop.
3. **Assign stats** — 3 points to spend across the four stats, on top of species bonuses. Tap-to-increment, no math required.
4. **Customize appearance** — color palette (mane/scale/fur, accent), plus a small set of tier-1 cosmetic options (horn shape, wing style, marking pattern).
5. **Name and confirm** — name entry with an on-screen keyboard *and* a "surprise me" generator so typing is optional.

The character persists to the player's profile within the household and can be reused across campaigns, subject to §8.2. A player joining a new game with saved heroes is asked **who they are bringing** before creation starts: their heroes at the level and tier they reached, or "make someone new".

---

## 6. World, campaigns, and chapters

```
World  →  Campaign  →  Chapter  →  Scene
```

- **World** — the household's persistent setting. Holds the party, unlocked biomes, souvenirs, and campaign history.
- **Campaign** — a story arc of 4–8 chapters with a beginning and an ending. The unit of character progression commitment.
- **Chapter** — one ~30-minute sitting. Authored as a single JSON file. The save unit.
- **Scene** — a location within a chapter: a piece of art, narration, and a set of choices. Some scenes are encounters.

### 6.1 Scene types

| Type | What happens |
|---|---|
| **Story** | Art + narration + 2–4 tappable choices. May branch. Players **take turns** choosing: a story turn marker passes round the party after each choice, and the TV says whose turn it is. A beat that offers the party only one way on ("Go on") is not a decision, so tapping it keeps the turn where it is: the holder reads on and still gets to make the next real choice. A turn holder whose phone drops is skipped, and anyone may answer a choice they were holding. |
| **Check** | One player rolls d20 + stat vs. TN. Success and failure both continue the story down different paths. Checks **take turns** too: whoever has rolled the fewest checks this run rolls next, and the better stat breaks a tie. An author can pin a check to the party's best in that stat (`roller: "best"`) when the story needs it, or make it a **party check** (`roller: "all"`): everyone rolls their own d20 + stat, and if half or more make it, the party does. |
| **Encounter** | Tactical grid combat. See §7. |
| **Choice point** | Party votes; ties broken by whoever's turn marker is active. Prevents one player steamrolling. |
| **Rest** | Heal, spend a level-up, trade items, look at each other's characters. The natural end-of-session beat. |

### 6.1.1 Picking the adventure

The lobby offers the campaign the room was opened for, then every other campaign the household has part-way through, each at the chapter it would pick up from. With **one** option there is nothing to decide: it is picked automatically once everyone is ready. With **two or more**, each player taps one on the ready screen while waiting for the party. Begin appears once everyone is ready *and* every connected player has voted, and it plays the vote's pick (most votes; a tie goes to the turn marker, as at a Choice point). The TV shows the options and their votes. Finished or failed campaigns are not offered beyond the room's own. Starting a campaign that is under way over from scratch is not offered here.

### 6.2 Biomes

Each chapter declares a biome, which selects backdrop art, ambient palette, tile set, and music. The launch set is the **Realm of Red Sky** roster — seventeen named destinations across twelve shared terrain families, authoritative in [asset-brief §4.5](./asset-brief.md#45-biomes-effects-tiles). (An earlier five-biome roster is retired.) The reference chapter plays in `enchanted_woods`.

---

## 7. Combat

Tactical, but deliberately shallow. The goal is that she learns positioning matters without learning a rulebook.

### 7.1 The board

- **10 × 8 grid.** Fits a TV comfortably; auto-framed on a phone (§2.2).
- **3 players vs. 2–4 enemies.** Never more.
- **Target: 4 rounds.** Encounters are tuned to resolve in about six minutes.
- **Movement is in "steps," not feet.** Base 4 steps; Duskrunner gets 6. Diagonals cost 1, same as orthogonal — no math.

### 7.2 A turn

Turn order is Quick, highest first, rerolled each encounter so it isn't always the same person going first.

On your turn: **move up to your steps, then take one action.**

| Action | Available to |
|---|---|
| **Attack** | Everyone. d20 + your class stat vs. enemy Guard. |
| **Class action** | Your signature (§4.3), plus 1–2 more unlocked by level. |
| **Species action** | Once per encounter. The combat-flavored version of your world ability. |
| **Use item** | Everyone. A consumable from your six slots (§9). |
| **Help Up** | Everyone. Lift an adjacent knocked-down ally to 1 HP. |
| **Ready** | Skip and gain +2 to your next roll. |

PlayerView shows only the actions that are currently legal, with reachable tiles highlighted. Illegal moves are not presented, so they can't be attempted.

### 7.3 Knocked down, not dead

At 0 HP a character is **knocked down**: they lie on the grid, skip their turns, and can't act. Any ally who spends an action adjacent to them (or a Songkeeper's Rally from range) brings them back at 1 HP.

If the **whole party** is knocked down, the encounter is **lost, not fatal** — the story branches. You're captured, robbed, the bridge collapses, the treasure is gone. The chapter continues down a harder path. There is no game over screen and no character sheet is ever deleted.

---

## 8. Progression and carryover

### 8.1 Leveling

XP is awarded per chapter, not per enemy defeated — so exploring and talking are worth as much as fighting. Levels 1–10.

**A chapter pays each hero once, ever** (#408). Replaying a campaign is for the story: a chapter a hero has already been paid for, in an earlier attempt or at another table, pays her nothing more, bonuses included, while a chapter she has never finished (another road through Gemfall) pays in full. Each hero is judged on her own record, so a new hero at the table is paid while a veteran is not. A payment made during a campaign that then fails goes back with the XP, so she can earn it again (`CharacterProgress.paidChapters`).

Each level grants a stat point. Class moves are not on this ladder: they come from distinctions (§4.3), earned by deeds rather than XP, with no level cap. **Four levels are appearance tiers:**

| Level | Tier | Visual change |
|---|---|---|
| 1 | **Fledgling** | Base form |
| 4 | **Sworn** | Grown proportions, first gear layer, class-colored accent |
| 7 | **Radiant** | Elaborated features (larger horn/wings/mane), glow accents, full gear |
| 10 | **Mythic** | Dramatic silhouette change, particle aura, animated signature effect |

Hitting a tier plays a **transformation cutscene** — the whole party stops to watch. This is the single most important moment in the game and gets the most animation budget.

**One tier per campaign.** Three campaigns take a character from creation to Mythic:

| | Campaign 1 | Campaign 2 | Campaign 3 |
|---|---|---|---|
| Levels | 1 → 4 | 4 → 7 | 7 → 10 |
| Ends at | **Sworn** | **Radiant** | **Mythic** |

The tier itself lands one chapter before the campaign's finale, so the climax is fought as the new thing rather than the new thing being a trophy for winning.

Class moves used to unlock at levels 3, 6 and 9, interleaved with the tiers (1/4/7/10) as three bands of three, each one *breathe → new move → new look*. Since distinctions (§4.3), moves come from deeds and that rhythm is no longer guaranteed; the deed counts are the lever for keeping it roughly true ([class-mastery.md §8](./class-mastery.md)). A hero who had a move by level when distinctions arrived kept it: their class was given the distinction their level had unlocked (3 → Apprentice, 6 → Expert, 9 → Master), and so was a hero who levelled while deeds were still being built; neither loses it now that only deeds raise a distinction.

#### The curve

| | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 |
|---|---|---|---|---|---|---|---|---|---|
| **Total XP** | 100 | 300 | 700 | 1100 | 1700 | 2600 | 3500 | 4700 | 6300 |
| **Step cost** | 100 | 200 | 400 | 400 | 600 | 900 | 900 | 1200 | 1600 |

Superlinear on purpose — the last level costs 16× the first, which is what makes the early ones cheap. **Level 2 arrives at the end of the first chapter she ever plays**, before she has decided whether she likes this. The doubled steps at 400/400 and 900/900 sit on the tier boundaries: crossing into a new tier should not also be the moment the climb visibly steepens.

Chapter awards escalate to match, roughly **100–150 → 300 → 600** per chapter across the three campaigns. Because campaigns run 4–8 chapters, the number to author against is the **campaign total** — about 700, 1900, and 3700 — not the per-chapter figure. A short campaign just uses bigger numbers.

Two things fall out of the escalation, both wanted: replaying an early campaign with a late-game character earns almost nothing, so there is no grinding a easy arc to Mythic; and the numbers themselves getting bigger signals "we are playing at a higher level now" without anyone explaining it.

#### Why it stops at 10

Resolution is `d20 + stat` against a target number (§4.1). Push a modifier past about 12 and the die stops deciding anything — hard checks succeed on a 2, and the game quietly stops being about rolling. **The d20 is the real cap, not the number 10.** More levels could only be spent on stats that break it, or on nothing at all.

Games that go to 50 or 100 do it because level is their *only* progression currency, and they pay for it with levels you cannot feel. This game has five — the stat point, the class distinctions, the tier, the six inventory slots, and souvenirs — so every one of its ten levels can do something visible. At one 30-minute sitting a week, that is a level roughly every fortnight, each of which changes something.

The tier count is also an art budget, not a rules number: four tiers across six species with per-class overlays is already the largest art line in the project.

#### After level 10

Progression continues sideways, never upward.

- **XP keeps counting.** Past 6300 it accrues forever and shows on the sheet as a plain number with nothing mechanical attached. An ever-climbing number is real, and it costs nothing.
- **A new hero.** The data model already holds several characters per player. A Mythic character can retire into the world as a standing legend in the lobby while its owner rolls something new and runs the whole arc again with a different toy.
- **Breadth.** More items, more biomes, more class actions past Master — as sidegrades, never upgrades.

### 8.2 Chapter outcomes

A chapter ends when play reaches a scene with nowhere left to go, and a chapter may have several such endings. Each one declares its outcome:

| Outcome | XP | What it means |
|---|---|---|
| **Success** | full `xpAward` | The chapter's goal was met. |
| **Setback** | half, rounded down | It was not. The story continues down a different path. |

A setback is not a loss screen and not a retry. Play carries on from wherever the story went — the same principle as a failed check or a party wipe, which branch rather than stop (§6.1, §7.3). Which endings are setbacks is **authored**, not emergent: a chapter that should always succeed simply has no setback ending.

Halving rather than zeroing matters. A family that hits two setbacks should fall behind the pacing, not off it.

**Play matters, party-wide.** A chapter may declare optional objectives — find the hidden shrine, finish with nobody knocked down, resolve it without a fight — that pay a bonus to **the whole party or to nobody**. Never to an individual. Bonuses are capped at 25% of the chapter's `xpAward`.

Both caps exist to protect the pacing above: with setbacks at half and bonuses at a quarter, a campaign lands within about 25% of its intended total, which moves a tier by at most a chapter. Uncapped, "Sworn ends campaign 1" stops being true.

#### Why the story's XP is shared, and roll XP is not

The reward for a level is *visible* — a new body, and a cutscene where the whole party stops to watch. Uniform party XP for the story is what keeps everybody transforming on the same evening, and it is also what makes the pacing above a promise rather than an average.

Roll XP is individual. Each hero earns XP for her own rolls that go well: a check she succeeds, an attack she lands, a foe her action knocks out, and a natural 20 on top. It is paid into her own total when the chapter settles, and capped per hero by the chapter's roll-XP cap. Heroes therefore level at their own pace, and a hero who rolls well is a little further on. This is a deliberate choice, and it is why the pacing above is a rough average for each hero rather than a promise for all of them. The story's XP stays uniform: a chapter's base XP, its setback halving and its grantXp effects go to the whole party. Objective bonuses stay party-wide as well: they are never individual.

### 8.3 Carryover — the commitment rule

A character's level, stats, inventory, class and distinctions are stored as a **committed snapshot** plus a set of **provisional gains** earned during the current campaign.

- **Campaign completed successfully** → provisional gains are committed. The character carries forward into the next campaign at their new level, with everything they found.
- **Campaign failed or abandoned** → the character **reverts to the committed snapshot**, and permanently gains a **souvenir**: a cosmetic memento of the attempt (a cracked pendant, a singed feather, a scrap of map) that displays on their sheet and in the world.

The souvenir is the point. A failed campaign still leaves a visible mark, so the time spent produced something. It is purely cosmetic and never mechanical — it can't become a consolation-prize power creep.

**A campaign fails at three setbacks** (§8.2), tunable per campaign. Across 4–8 chapters that means a genuinely bad run — "actively failing multiple chapters," not one unlucky evening — which is what keeps failure rare and story-shaped rather than punishing.

#### Reverting past a transformation

The worst case the commitment rule permits: she reaches level 4 mid-campaign, the party stops, the camera pushes in, she becomes **Sworn** — and two chapters later the campaign fails and she reverts to Fledgling.

The rule stays as it is. Tier can't be exempted, because it's derived from level and exempting it would let a character's body outrun the level that earned it. Instead, **a campaign that reached a new tier before failing produces a tier-flavored souvenir**: she goes back to Fledgling and keeps something visible that says she was Sworn once. Purely cosmetic, honest about what happened, and it needs no machinery that `failCampaign()` doesn't already have.

### 8.4 Joining a party already underway

A character created after the party has been playing — a friend for one evening, a sibling joining for good — starts at **level 1 or at the party's tier floor** (1, 4, 7, or 10). Nothing in between, and the family chooses at creation, defaulting to joining.

The two options exist because the two situations pull opposite ways. A guest starting at level 1 beside a Radiant party has ten hit points and one action, and spends the evening as a passenger. A sibling starting at party level never plays a Fledgling and never earns Sworn, which may be exactly the arc they wanted.

The tier floor is the right number because it makes a joined character **arithmetically identical** to one that earned the level: three creation points plus one per level. No shortcut and no handicap. Distinctions are earned by deeds (§4.3), which a level cannot stand for, so a joiner's class arrives with the distinction its level used to unlock: none at 1, Apprentice at 4, Expert at 7, Master at 10. They sit down with the moves a joiner always had, and every other class starts with none. It also preserves what matters — you skip only the transformations you were never going to earn, and every one still ahead of you is yours. Join at Radiant and Mythic is still two campaigns away.

Starting XP is the **threshold for that level**, not zero, or the next chapter's award drops the character straight back to level 1.

A kid who sits down mid-chapter plays from the scene the party is in (mid-fight, they join in after it), and their phone opens on a one-line catch-up: what the party is doing right now. See §8.5.

### 8.5 Stepping away and coming back

Dinner, a bath, a phone call: a kid leaving partway through is a normal part of an evening, and so is coming back. **Nothing in a chapter waits on a chair nobody is sitting in.** A player whose phone has gone is **stepped away**, and the table goes on without them. Gone means the game page was closed, the phone has been quiet for a couple of minutes (it died, lost signal, or was put down and went to sleep), or the host took them out:

| Where the game was waiting | What happens |
|---|---|
| Their story turn | Skipped when it comes round; a choice they were already holding is open to anyone (§6.1). |
| Their check | Anyone at the table rolls instead, as themselves. A whole-party check stops waiting once everybody still to roll has stepped away. |
| A vote | Their vote does not hold it up. If they were the last one to vote, anyone who voted taps **Decide without them** to close it. |
| The ready-up before a fight | Not waited on. If everyone else had already said ready, a ready phone taps **Start without them**. |
| Their combat turn | Anyone at the table may tap **Pass their turn**: a pass, not their move or their action. Not skipped automatically, because a phone asleep on the sofa reads as away too, and the table can see who is really gone. |
| A full bag's "keep it or leave it" | Anyone may **leave it**. Nobody empties a friend's bag for them. |
| A rest, a trade on offer | Never waited on in the first place: a rest's way on is anyone's, and an offer just waits. |
| Beginning the chapter, the chapter's end | Not waited on. The lobby's Begin needs everyone *here* ready, and the chapter's end goes back to the lobby once everyone here is done. |

Their hero **follows the party**: it stays in the party, in the fight's turn order and on the board, with everything it had. The shared screen says "Rosie stepped away" in words and fades her figure, standing up, so nobody mistakes it for knocked down (§7.3). When the fight is waiting on her turn, it says that any phone can pass it.

**Coming back is opening the room again.** Same seat, same hero, back in the turn order, and the phone opens with one line saying what is going on ("Welcome back, Rosie! The party is in a fight, and your hero is right where you left them."). A late joiner (§8.4) hears "Welcome" instead. Nothing on either line counts the party.

---

## 9. Inventory

Small, visual, and free of management sim. The goal is "I have a cool thing and I get to decide when to use it," not spreadsheet optimization.

### 9.1 Slots

**Six slots per character**, shown as an icon grid on PlayerView. That's it — no weight, no encumbrance, no bag-of-holding, no sorting.

Full and you find something? A single prompt: keep it and drop one, or leave it. One decision, no menu.

### 9.2 Item kinds

| Kind | Slots | Behavior |
|---|---|---|
| **Consumable** | 1 | Single use. Tap on your turn — heal, boost a roll, escape a grab, throw for damage. Gone after. |
| **Trinket** | 1 | Passive, always on. Small always-true effects: +1 to a stat, +1 step, reroll a 1 once per encounter. |
| **Quest item** | **0** | Story keys — a rusted key, a torn map half. Never compete for slots, never usable in combat, vanish when the campaign ends. |

Quest items being slot-free is deliberate: a story gate must never be blocked because someone's bag was full.

### 9.3 No equipment

There are deliberately **no weapon or armor slots.** Visible gear is driven entirely by appearance tier (§8.1). An equipment system would compete with the level-up transformation for the same reward space, and the transformation has to win — it's the emotional core of the progression.

### 9.4 Trading

At **Rest scenes**, the party can freely pass items between characters. Drag on your phone, tap to accept on theirs.

This is a genuinely good table moment — it's the point in the session where the three of you talk to each other instead of to the screen. Worth building well.

### 9.5 Persistence

Inventory follows the same commitment rule as levels (§8.2): items found during a campaign are **provisional**, committed on success, lost on failure. Quest items are campaign-scoped and vanish either way.

---

## 10. The AI Game Master

A model helps write the game; it never plays it.

### 10.1 Authoring time (offline, high quality)

Chapters are generated by an LLM in a local authoring tool, hand-edited, and **committed as JSON**. The model designs scenes, branches, encounters, enemy stats, item placement, and narration. You review and revise before it ever reaches the table.

This makes play **deterministic, instant, free, replayable, and safe.**

### 10.2 Table time (no model)

Nothing at the table calls a model. There was a thin live layer here once (flavour lines, NPC
one-liners and a session recap from a model at table time, validated and falling back to the
authored text). It was removed in #347: the authored stories stand on their own, and a runtime
model call worked against keeping a child's play away from third parties (#320).

What the table gets instead is authored: priority scenes drawn so the room notices them, and an
end-of-chapter recap that retells the priority-1 scenes the party walked through in their own
words.

---

## 11. Accessibility & kid-readability

- **Every interactive element has an icon.** Text labels supplement icons, never replace them.
- **TTS-ready from day one.** All narration and choice text flows through a `speak()` seam that is a no-op in v1 and can be wired to a TTS engine later without touching game code.
- **No timers on decisions.** Nothing is lost by thinking about it.
- **Colorblind-safe status indicators** — status effects and item rarity use shape + icon, never color alone.
- **A tap does the thing, and the surface makes it safe.** No confirm step in a fight: a gold square walks you there (a step is cheap), a card that needs aiming asks who or where, and only legal answers are ever on screen. The one tap worth protecting, giving a turn away, has no button: once the action is spent the turn ends on its own, and Get Ready is how you pass. The only exception is a friend who has stepped away, whose turn anyone may pass (§8.5).
- **Big touch targets.** Phone UI assumes a small hand and imprecise taps — and stays that way in Travel Mode's compressed layout.

---

## 12. The Field Guide

A picture book of the world that the family fills in by playing — creatures, peoples, folk, places and factions, each with its painting, a story, what it does for fun, and who it likes and dislikes. It is the realm's canon told for an 8-year-old: entries are generated from the canon (`npm run canon:field-guide` writes `content/field-guide.json`, the same source the wiki is built from), never written by hand in the client.

**One book per household.** The guide belongs to the household (§3), not to a character or a run: every campaign, every evening and every player adds to the same book, and every phone and the TV read the same one. A guest household keeps its book for as long as it keeps its heroes, and the keepsake offer names the guide among what is kept once there is something in it.

**What fills a page.** Entries start undiscovered — a "?" card that gives nothing away. A page is filled the moment the party *meets* the thing at the table, never by reading ahead:

- a chapter starting discovers its **biome**;
- entering an encounter discovers every **creature it fights**;
- entering any scene discovers what that scene lists in **`discovers`** — the author's tag for meeting someone or somewhere the two rules above miss ([how to tag](../content/README.md#field-guide-tags-discovers)).

**First finder.** Each page remembers who found it first — the player whose action got there (or the player leading the story) — and that never changes. A later visit is not a new find.

**"New!" moments.** A find is celebrated once, live: a toast on the phones ("New in your Field Guide") and a banner on the TV, each waiting for a quiet moment rather than covering a question or a dice roll — a phone holds its toast while it is that player's turn. Tapping the toast opens the entry. Celebrations are never replayed by a reload or reconnect; the book keeps a "New" badge on each page until it is opened on that device.

**Open any time.** The guide is a permanent destination in the phone tray, beside World, You and Map — in the lobby, the story, at rest and in the middle of a fight. It is reading, not playing: opening it sends nothing and decides nothing, a half-made choice underneath survives, and the "Your turn" badge stays on You so the turn is always one tap away.
