# Node design — Glacierflow Washout

**Status:** Approved scenario concept; numeric checks and implementation specifics TBD.
**Provisional node ID:** `glacierflow-washout`
**Narrative role:** First vivid fail-forward multi-stage skill challenge.
**Spoiler level:** Early-campaign player-facing; **no emperor reveal**.

## Entry
Party follows the Riftseekers' lead toward the mountain route and **fails** a dangerous crossing along Glacierflow. The current sweeps them away from their intended course. They must react immediately.

## Core dramatic rule
**The dice decide how far downstream the party goes.** A bad result changes their adventure, not their chance to continue playing. There is no drowning/game-over outcome through the required escape sequence. The sequence is a *single encounter with stages*, not three mandatory chapter-level transitions.

## Proposed scene beats
### 1. The ice shelf
The first opportunity is to grab ice, rope, ledge, or help one another. Success: escape close to the glacier and potentially rejoin the mountain lead. Failure: carry onward in the rising current. Example **proposal**: Might check TN 12, but allow sensible alternative tactics.

### 2. The fallen tree
An overhanging branch/tree or shoreline obstacle creates an opportunity to escape. Success: emerge on an unfamiliar stretch of riverbank with its own encounter and discoveries. Failure: reach rapids. Example **proposal**: Quick check TN 12, with class abilities, coordinated actions or tool use as viable alternatives.

### 3. The rapids
A gravel bar, shore signal or environmental opportunity is the final active escape. Success: exit farther south. Failure: carried to a downstream refuge/rescue; party remains playable. Example **proposal**: Quick or Heart TN 16, to be balanced against current stats.

### Optional rift under pressure
A rift might appear within reach along the washout, offering a meaningful choice: commit to an unknown rift route or keep battling the river. Its **Riftlight** informs a perceptive character of properties (e.g. amber and violet indicating single-use/one-way), but does not automatically explain destination. Whether this scene includes the rift, what it requires and what it connects to remain **TBD**.

## Consequences / world state
Capture, at minimum:
- Where the party escaped (early, middle, late/rescue).
- Whether an optional rift was crossed.
- Whether the party can still follow Orin's original lead easily.
- Any assistance/rescuer earned (actual character TBD).

**Suggested flags, not yet finalized schema IDs:** `river_escaped_early`, `river_escaped_middle`, `river_escaped_late`, `river_took_rift`. Enforce mutual exclusion appropriately and use named graph edge effects/guards only as supported.

## Exits to design
- `glacier-foothills` — early escape, near previous lead.
- `riverbank-encounter` — middle escape, unexpected local adventure.
- `downstream-refuge` — late escape or assistance.
- `rift-destination-tbd` — alternative crossing if authored and taken.

Exact upstream/midstream/downstream locations must be verified on the canonical map. Do **not** place an accidental washout directly at the distant Sallow Wastelands/Bone Yard.

## QA / acceptance criteria
- Success and failure at each stage have intentional outcomes, with multiple class-appropriate actions available.
- Every roll sequence eventually results in a valid playable graph node; no softlocks.
- A party without Starweaver can finish and can learn enough to make fair optional choices.
- Flags/edges reflect the exit actually taken; no duplicate crossing.
- River progression can be unit/playtest simulated; Gemfall remains unchanged.

## Unresolved
Party-wide vs individual skill rolls; check TN calibration; harm/resource effects (if any); names and populations of downstream sites; availability of the optional rift; exact prose, visuals, audio, NPCs, rewards.
