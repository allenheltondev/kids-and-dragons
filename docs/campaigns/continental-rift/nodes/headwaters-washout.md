# Node design — Headwaters Washout

**Status:** Approved scenario concept, places and rescuer; numeric checks and implementation specifics TBD.
**Provisional node ID:** `headwaters-washout`
**Narrative role:** First vivid fail-forward multi-stage skill challenge.
**Spoiler level:** Early-campaign player-facing; **no emperor reveal**.

## Entry
Party follows the Riftseekers' lead toward the Cairnstep and **falls** from the ice shelf above the Great River's headwaters. The failing scene sets `traverse_failed`, and the edge into this node guards on it ([graph.md](../graph.md#key-entryfail-forward-logic)), not on a setback outcome. The current sweeps them away from their intended course. They must react immediately.

## Core dramatic rule
**The dice decide how far downstream the party goes.** A bad result changes their adventure, not their chance to continue playing. There is no drowning/game-over outcome through the required escape sequence. The sequence is a *single encounter with stages*, not three mandatory chapter-level transitions.

## Proposed scene beats
### 1. The shelf's edge
The first opportunity is to grab ice, rope, ledge, or help one another. Success: escape onto the Frostfang shore, close enough to rejoin the lead. Failure: carry onward in the rising current. Example **proposal**: Might check TN 12, `roller: "best"` (one person grabbing hold saves everyone), but allow sensible alternative tactics.

### 2. The fallen tree
An overhanging branch/tree or shoreline obstacle creates an opportunity to escape. Success: emerge on the Red Sky Foothills bank among the old boundary stones, with its own encounter and discoveries. Failure: reach rapids. Example **proposal**: Quick check TN 12, `roller: "all"` (everyone has to get onto the tree), with class abilities, coordinated actions or tool use as viable alternatives.

### 3. The rapids
A gravel bar, shore signal or environmental opportunity is the final active escape. Success: reach the bank at Ashspan Bridge on their own. Failure: **Old Ossley** pulls them out at the bridge; party remains playable. Both land at `ashspan-bridge` and differ in narration. Example **proposal**: two choices, each its own check, because a check takes one stat: *swim for the gravel bar* (Quick TN 16) or *signal the shore* (Heart TN 16), to be balanced against current stats.

### The rift under pressure — agreed
A rift appears within reach along the washout, offering a meaningful choice: commit to an unknown rift route or keep battling the river. Its **Riftlight** is **amber + violet** (single-use, one-way) and tells a perceptive character so, but not where it goes. It leads to the **Sky Islands**, otherwise reachable only by air, which is what makes it a real temptation. Taking it sets `river_took_rift`; the edge is `once`. Which stage it appears at is TBD.

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
Check TN calibration; harm/resource effects (if any); which stage the rift appears at; exact prose, visuals, audio, rewards.
