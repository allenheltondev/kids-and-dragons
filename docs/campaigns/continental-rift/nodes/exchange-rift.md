# Node design — The Exchange Rift

**Status:** draft for owner review.
**Provisional node ID:** `exchange-rift` (the graph's `entry`)
**Narrative role:** The campaign's first scene and first rift. It shows that places are moving, teaches **amber** and **violet** by doing, and drops the party at the Glacier of Origins.
**Spoiler level:** Player-facing opening; **no emperor, no Pangea**. Nobody explains the rift.
**Biome / art:** `exchange`, reusing Gemfall's Exchange backdrops (`scenes/gemfall/exchange-docks`, `exchange-quay`, `exchange-lighthouse`). Music `riftlight-theme` once the override in #226 lands.
**Length:** 30–40 minutes; about 125 XP on first completion. **No setback endings.**

## Why the Exchange
Gemfall began here, so the series' second campaign begins at the same front door: the party comes back as Sworn heroes to a city they know. It also keeps the opening **ending-neutral**: the Exchange has spent the time since Gemfall "absorbing the rush as a change in prices" whatever happened at the mountain, so no line depends on which ending a party reached. Locals may recognize them ("you're the ones who came back from the mountain") and say nothing about how it went.

## Scene beats

### 1. Market morning, slightly wrong
A busy morning on the docks, told through small displacements a child can spot before the adults name them. Each is an optional look-closer choice; the party needs to notice only one to move on.
- A fish stall's ice is **snow**, still falling, out of a clear sky.
- A gull lands with **frost on its wings** and complains about it.
- A Sky Island trade ship docks **a day early**, its kitsune captain baffled: "The island was not where we left it." This foreshadows Wandering Sky.

**Check (optional):** Clever TN 8 to piece it together: everything strange is coming from the same direction, the end of the long quay. Success gives a head start in beat 2; failure only means the party finds out the loud way.

### 2. The shimmer on the quay
At the end of the quay the air folds. A rift opens on its own, unsummoned by anyone present, with a **sensory glimpse**: cold, still air and the smell of very old ice. Riftlight shows **amber + violet**.
- **A Starweaver** may *Read the Riftlight* (choice gated on `requiresClass`, #199): "Two colors. The amber one flickers like it will only do this once. The violet one is turning inward, like it only goes one way." This is the first time anyone at the table hears what colors mean. It sets the journey flag `starweaver_read_first_rift`, which Seren reacts to at `riftseekers-departure`.
- **A party without a Starweaver** sees the shimmer and the two colors and learns nothing more yet. The chime comes from Orin later; this rift is not a choice anyway.

### 3. The pull
The rift starts pulling loose things toward it: crates, a noodle-stall awning, and a **little snowhorn goat kid** that wandered off a displaced patch of glacier and is now sliding across the wet quay toward the rift.
- **The choice:** grab the goat. Every option leads through the rift; what changes is how the party goes through and what they carry.
  - **Catch the goat:** Quick TN 12, `roller: "best"`. Success: the goat is safe in someone's arms. Failure: 1 damage, and the goat is caught anyway on the way through.
  - **Anchor the line:** Might TN 12, a dock rope tied off to slow the pull. Success: the party goes through together and on its feet. Failure: 1 damage, and they tumble through.
  - **Species and class options** lower a TN one step, as on the washout: a griffin's Skyward or a dragonling's Glide to swoop for the goat, Bigfoot's Smash to haul a crate into the rift's path, a Thornguard's Brace to hold the line.
- **No way to stay behind.** The pull takes the whole party together, which is also the campaign's first example of *one coordinated party traversal*.

### 4. Through, and gone
The party and the goat are carried through. Behind them the rift **collapses** (amber: once, then gone), and the violet means there is no way back the way they came. Riftspark: **this is the party's first crossing, so it grants a Riftspark** (+2 on one check) for the next chapter, as agreed.

The chapter ends on the far side, in cold air and blinding white: the Glacier of Origins. The node's one exit is the rift itself, into `glacier-survival`.

## Flags and effects
| Flag | Set when | Read by |
| --- | --- | --- |
| `starweaver_read_first_rift` | A Starweaver uses *Read the Riftlight* in beat 2 | Seren at `riftseekers-departure` ("One of you can see it.") |
| `noticed_the_sky_ship` | The party looked closer at the kitsune captain in beat 1 | `sky-islands-arrival`: the captain is there and remembers them |

Grants: a **Riftspark** on the first crossing (#222). No items.

The goat comes through on every path, so it needs no flag: `glacier-survival` always opens with the party holding it, and returning the kid to its herd is the party's first kindness at the glacier and earns the yetis' trust. `stuttering-flats` echoes it later.

## Exit
- `exchange-rift` → `glacier-survival`: the rift (amber + violet, `once`, `reveal: "when-crossed"`). The only exit; it is not a choice.

## Encounters
None. The opening is about noticing and helping, not fighting; the first fight comes at the glacier or later.

## QA / acceptance criteria
- Every path reaches `glacier-survival`, with no setback ending and no way to leave anyone behind.
- A party without a Starweaver finishes with nothing missing that the story requires.
- Nothing names Corvane, Pangea or an emperor; nothing depends on which Gemfall ending was reached.
- The goat comes through on every path.
- Minimum scene and decision counts follow the authoring guide for a 30–40 minute chapter.

## Unresolved
Exact prose and NPC names (the kitsune captain is chapter-scoped, in `npcVoices`); whether beat 1 shows a third or fourth displacement; the sound of the rift opening on the TV (`rift-open`, brief A3).
