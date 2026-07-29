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
4. **The app plays fine with the AI off.** Live LLM output is flavor, never load-bearing. If it fails, authored text takes over and nothing breaks.
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
┌─────────────────┐
│ [World] [You] ● │  the toggle, always there
├─────────────────┤
│                 │
│  one surface,   │  World — shared, identical on every phone
│  whole screen   │  You   — your sheet, your actions
│                 │
└─────────────────┘
```

This started as a 60/40 stack and that was wrong on a phone: neither half had
the room it needed, the party lineup fell off the bottom of one and the six
inventory slots off the bottom of the other. One surface at a time gives each
of them the whole screen, and the toggle costs a tap.

Design consequences, all of which we accept:

- **No private information channel.** Every phone shows the same world. That's fine — this game has no hidden information by design. It does mean **hidden-role or secret-objective mechanics are permanently off the table**, and that's a deliberate trade.
- **The grid needs a focus camera.** A 10×8 board on a phone has unreadable tiles at full extent. Combat gets an auto-framing camera that follows the active actor, with pinch-zoom and pan to override. This is good for the TV too — Party Mode gets it for free.
- **The dice take over.** On the TV the roll is the centerpiece; on a phone it takes the world for its ~1.5s wherever you were, then returns you.
- **Your turn comes to you.** Being asked something pushes your controls in front of you automatically — and so does having no character yet, because creation is the first turn anyone takes. The toggle keeps a marker on "You" while you are looking at the world, so a turn can never sit unnoticed behind it.
- **The question travels with the answers.** The scene's narration is echoed above your choices, because the question and its answers would otherwise sit on opposite sides of a toggle and an 8-year-old would flip back and forth to work out what she is choosing between. The world view remains where you go to read it properly.

Mode is chosen per-room at creation and can be switched mid-session — a phone that had a TV can absorb WorldView if the laptop dies.

---

## 3. Accounts & identity

Characters, levels, and inventory persist across sessions and campaigns, so identity has to be real. But an 8-year-old should never type a password.

**Household account, device-bound player profiles.**

- **The household** is the account. Owned by an adult, authenticated properly (email + passkey). It owns the party, the characters, the campaign history, the inventory, and the souvenirs.
- **Player profiles** live inside the household. Each is bound to a device with a long-lived signed token. Her phone simply *is* her — open the app, tap her avatar, play. No password, ever.
- **Binding a new device** requires either the household owner signing in, or approval from an already-bound adult device. Losing a phone is recoverable; a kid can't accidentally sign herself out of existence.
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

| Class | Stat | Role | Signature action |
|---|---|---|---|
| **Thornguard** | Might | Front line | **Brace** — take a hit meant for an adjacent ally |
| **Duskrunner** | Quick | Skirmisher | **First Strike** — act before anyone else on round one |
| **Starweaver** | Clever | Caster | **Burst** — hit every enemy in a 2×2 area |
| **Songkeeper** | Heart | Support | **Rally** — heal an ally, or lift a knocked-down one from range |

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

The character persists to the player's profile within the household and can be reused across campaigns, subject to §8.2.

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
| **Story** | Art + narration + 2–4 tappable choices. May branch. |
| **Check** | One player rolls d20 + stat vs. TN. Success and failure both continue the story down different paths. |
| **Encounter** | Tactical grid combat. See §7. |
| **Choice point** | Party votes; ties broken by whoever's turn marker is active. Prevents one player steamrolling. |
| **Rest** | Heal, spend a level-up, trade items, look at each other's characters. The natural end-of-session beat. |

### 6.2 Biomes

Each chapter declares a biome, which selects backdrop art, ambient palette, tile set, and music. Launch set: **Bramblewood**, **Frostpeak**, **Emberhollow**, **Sunken Market**, **Cloudreach**.

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

XP is awarded per chapter completed, not per enemy defeated — so exploring and talking are worth as much as fighting. Levels 1–10.

Each level grants a stat point and, at some levels, a new class action. **Four levels are appearance tiers:**

| Level | Tier | Visual change |
|---|---|---|
| 1 | **Fledgling** | Base form |
| 4 | **Sworn** | Grown proportions, first gear layer, class-colored accent |
| 7 | **Radiant** | Elaborated features (larger horn/wings/mane), glow accents, full gear |
| 10 | **Mythic** | Dramatic silhouette change, particle aura, animated signature effect |

Hitting a tier plays a **transformation cutscene** — the whole party stops to watch. This is the single most important moment in the game and gets the most animation budget.

### 8.2 Carryover — the commitment rule

A character's level, stats, and inventory are stored as a **committed snapshot** plus a set of **provisional gains** earned during the current campaign.

- **Campaign completed successfully** → provisional gains are committed. The character carries forward into the next campaign at their new level, with everything they found.
- **Campaign failed or abandoned** → the character **reverts to the committed snapshot**, and permanently gains a **souvenir**: a cosmetic memento of the attempt (a cracked pendant, a singed feather, a scrap of map) that displays on their sheet and in the world.

The souvenir is the point. A failed campaign still leaves a visible mark, so the time spent produced something. It is purely cosmetic and never mechanical — it can't become a consolation-prize power creep.

Campaign failure requires actively failing multiple chapters. It should be rare and it should feel like a story, not a punishment.

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

Two distinct jobs, two different models, two different times.

### 10.1 Authoring time (offline, high quality)

Chapters are generated by an LLM in a local authoring tool, hand-edited, and **committed as JSON**. The model designs scenes, branches, encounters, enemy stats, item placement, and narration. You review and revise before it ever reaches the table.

This makes play **deterministic, instant, free, replayable, and safe.**

### 10.2 Table time (live, low latency)

A thin live layer sits on top of the authored chapter and handles what can't be pre-written:

- Reactions to unexpected action/object combinations (including creative item use)
- NPC one-liners and banter
- "Previously on…" recaps at session start
- Personalized celebration lines on level-up

Every live call is **optional and cached**. Output passes a validator — length cap, banned-topic check, must reference the current scene — and anything that fails silently falls back to the authored text. The player never sees an error and never waits.

### 10.3 The invariant

> The game must be fully playable with the live LLM disabled.

This is a hard architectural rule, tested in CI with the live layer stubbed out.

---

## 11. Accessibility & kid-readability

- **Every interactive element has an icon.** Text labels supplement icons, never replace them.
- **TTS-ready from day one.** All narration and choice text flows through a `speak()` seam that is a no-op in v1 and can be wired to a TTS engine later without touching game code.
- **No timers on decisions.** Nothing is lost by thinking about it.
- **Colorblind-safe status indicators** — status effects and item rarity use shape + icon, never color alone.
- **Undo on non-committal taps.** Selecting a target is confirmable; only the confirm is final.
- **Big touch targets.** Phone UI assumes a small hand and imprecise taps — and stays that way in Travel Mode's compressed layout.
