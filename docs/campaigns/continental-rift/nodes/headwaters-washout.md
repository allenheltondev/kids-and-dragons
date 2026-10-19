# Node design — Headwaters Washout

**Status:** Implemented as an authored development-preview chapter. See [route review](../routes-continuity-review.md) for validation and boundaries.
**Provisional node ID:** `headwaters-washout`
**Narrative role:** First vivid fail-forward multi-stage skill challenge.
**Spoiler level:** Early-campaign player-facing; **no emperor reveal**.

## Entry
Party follows the Riftseekers' lead toward the Cairnstep and **falls** from the ice shelf above the Great River's headwaters. The failing scene sets `traverse_failed`, and the edge into this node guards on it ([graph.md](../graph.md#key-entryfail-forward-logic)), not on a setback outcome. The current sweeps them away from their intended course. They must react immediately.

## Core dramatic rule
**The dice decide how far downstream the party goes.** A bad result changes their adventure, not their chance to continue playing. There is no drowning/game-over outcome through the required escape sequence. The sequence is a *single encounter with stages*, not three mandatory chapter-level transitions.

## Scene beats — agreed
### 1. The shelf's edge
The first opportunity is to grab ice, rope, ledge, or help one another. Success: escape onto the Frostfang shore, close enough to rejoin the lead. Failure: carry onward in the rising current. **Check:** Might **TN 16**, one roller (normal turn-taking): a desperate grab. About 40%.

### 2. The fallen tree
An overhanging branch/tree or shoreline obstacle creates an opportunity to escape. Success: emerge on the Red Sky Foothills bank among the old boundary stones, with its own encounter and discoveries. Failure: reach rapids. **Check:** Quick **TN 12**, `roller: "all"`: everyone has to get onto the tree. About 65% for a party of three (60% solo, 84% for two, 82% for four).

### 3. The rapids
A gravel bar, shore signal or environmental opportunity is the final active escape. Success: reach the bank at Ashspan Bridge on their own. Failure: **Old Ossley** pulls them out at the bridge; party remains playable. Both land at `ashspan-bridge` and differ in narration. **Check:** two choices, each its own check because a check takes one stat: *swim for the gravel bar* (Quick **TN 12**) or *signal the shore* (Heart **TN 12**), one roller. About 60%.

### Odds, abilities and harm — agreed
- **Spread:** roughly **40% early, 40% middle, 20% late**, so the river's content is actually played. (A party-best roller at TN 12 on stage 1 succeeds about 90% of the time at Sworn and hides the rest.)
- **Species abilities lower that stage's TN one step** (16→12, 12→8) and never succeed outright. Each species gets its option at one stage. Griffin and dragonling wings are soaked: they can lift a friend, not the whole party. Bigfoot's Smash breaks off an ice handhold.
- **Harm:** 1 damage per failed stage, the standard scene damage, **only to anyone above 1 HP**: the river never knocks anyone down, whatever their health going in. Ossley's rescue heals. Story `damage` on `main` can take someone to 0 HP and down them, so this needs either a non-lethal damage option (a floor of 1 HP) or chapter gating on HP; it is a small engine follow-up. Playtest with a party member at 1–3 HP. No items are lost (content rules forbid permanent loss).
- **Ossley's rescue** comes with a **Supper Bundle** (heal 1) and his line "When I'm going your way."

### The rift under pressure — agreed
A rift appears within reach along the washout, offering a meaningful choice: commit to an unknown rift route or keep battling the river. Its **Riftlight** is **amber + violet** (single-use, one-way) and tells a perceptive character so, but not where it goes. It leads to the **Sky Islands**, otherwise reachable only by air, which is what makes it a real temptation. Taking it sets `river_took_rift`. The edge is `rift: { uses: 1, oneWay: true, reveal: "when-crossed" }`, not edge `once`. Which stage it appears at is TBD.

### The rescuer — agreed
**Old Ossley**, the frogfolk ferryman of Stone Crossing (canon). He works his ferry in flood years, and the changed melt makes this one. His Gemfall line "Later. When I'm going your way." pays off here. His price is never coin and never cruel.

## Consequences / world state
Capture, at minimum:
- Where the party escaped (early, middle, late/rescue).
- Whether an optional rift was crossed.
- Whether the party can still follow Orin's original lead easily.
- Whether Old Ossley rescued them.

**Flags (proposed IDs, not yet final).** Declare the escape points as one route set:

```json
"routeSets": { "river_exit": ["river_escaped_early", "river_escaped_middle", "river_escaped_late", "river_took_rift"] }
```

Setting one member clears the others, so exactly one holds. Each exit below guards on its own member (`"when": { "flag": "river_escaped_early" }`, and so on). Players pick the exit themselves after the chapter ends (`CHOOSE_EXIT`), so the guards are what make the dice decide. On a replay the newly set member wins and clears the old one ([graph-campaigns.md](../../graph-campaigns.md#the-runtime-194)).

The chapter ends as `success` on every path, the rescue included: this is fail-forward, not a setback.

## Exits to design
- `frostfang-shore` — early escape, east bank under Frostfang, near the lead. Guard: `river_escaped_early`.
- `boundary-stone-bank` — middle escape, Red Sky Foothills bank. Guard: `river_escaped_middle`.
- `ashspan-bridge` — late escape or Ossley's rescue. Guard: `river_escaped_late`.
- `sky-islands-arrival` — through the washout rift. Guard: `river_took_rift`.

No exit lands on the west bank below the glacier (the Expanse, a protected mystery). Do **not** carry the party past Ashspan Bridge: the Saltrot and the Bone Yard are far too far for one washout.

## QA / acceptance criteria
- Success and failure at each stage have intentional outcomes, with multiple class-appropriate actions available.
- Every roll sequence eventually results in a valid playable graph node; no softlocks.
- A party without Starweaver can finish and can learn enough to make fair optional choices.
- Flags/edges reflect the exit actually taken; no duplicate crossing.
- Every path ends the chapter as `success`; a replay leaves exactly one `river_exit` member set (unit test).
- River progression can be unit/playtest simulated; Gemfall remains unchanged.

## Unresolved
Implementation decision: the optional rift appears after a failed fallen-tree escape, before
the rapids. The chime gives every party a fair warning about the missing return. The new
`damage.nonlethal` option leaves standing heroes at 1 HP; Ossley's rescue heals the party
and supplies the bundle. The regional content beyond the arrival episodes remains unwritten.
