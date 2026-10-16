# Continental Rift — mechanics and rift canon

## Fundamental rules — agreed
- Rifts are **ancient magic**, not inventions of the emperor or Riftseekers.
- Skilled characters may **summon or manipulate** a rift's presence, activation circumstances or surrounding energy.
- **Nobody chooses or changes the rift's intrinsic behavior.** Summoning and influence are not equivalent to programming a portal.
- Behavior is learnable through observing Riftlight, even when the underlying source and cause remain secret.
- A rift can have **multiple simultaneous properties**, represented by multiple colors.
- Do not claim that magic can override a rift's fixed one-way / once-only nature.

## Where a rift goes — agreed
| Who | Learns before crossing |
| --- | --- |
| **Everyone** | A **sensory glimpse**, one line of chapter narration through the rift: salt wind and gull cries for the Saltrot; thin cold air and distant whale song for the Sky Islands. Enough to choose by, never a place name. |
| **An attuned Starweaver** | **Direction and distance** on top of the glimpse: "far to the south, low down". |
| **Nobody** | The destination's name, until someone has crossed. |

**Authoring it on the merged #196 engine:** give every Riftlight rift `reveal: "when-crossed"` and **leave the edge's `label` unset**. Until crossed, the exit then reads "Into the rift" (`HIDDEN_RIFT_LABEL`) and nothing sent to a phone names the destination; once crossed, a two-way blue rift shows the destination's title for return trips. An edge `label` would override both, so the glimpse belongs in the chapter's narration, not the label. One-way and single-use rifts never need a second label.

## Who summons and shapes rifts — agreed
**Players never summon rifts in this campaign.**

| Who | Can | Cannot |
| --- | --- | --- |
| **Emperor** | Summon rifts: how places are being moved, mostly offstage until the reveal | Choose what a summoned rift does; that is his flaw |
| **Lady Olivia** | Attempt one summoning, late. It works, and its colors surprise her: the emperor's mistake in miniature, on screen | Control what she summoned |
| **Orin** | Study rifts; he never summons | — |
| **Starweaver** | Sense → Attune → Manipulate (below) | Summon, or change amber, blue or violet |

## Riftlight — agreed principle
Rifts emit colored magical light. In the fiction **only certain people can see the meaningful spectrum**: ordinary observers notice an anomaly but not its diagnostic colors; Starweavers have a natural affinity; select Riftseekers use attunement or tools.

**Who sees the colors — agreed, an owner-approved exception to the spec.** The colors are **private to the Starweaver**: they appear only in the **world view on the Starweaver player's phone**, and **never on the TV** or any other phone. When a rift with Riftlight is visible, an **indicator lights up on that player's menu**, so they know to look. Everyone else, TV included, sees only a **neutral, colorless shimmer**. What the Starweaver tells the table is up to them: reading the light and explaining it is their part to play. This is the one deliberate exception to [spec.md](../../spec.md)'s "no private information channel", for Riftlight and the Starweaver only.

- **A party without a Starweaver** reads rifts with the Listening Chime or Orin, whose answers are shared (below). The TV never shows colors to them either.
- **Story text never states the colors.** In-chapter narration says the Starweaver studies the light, not what it shows. A *Read the Riftlight* choice still exists so chapters can react to it (it sets journey state, e.g. `starweaver_read_first_rift`).
- **UI: built in [#229](https://github.com/allenheltondev/kids-and-dragons/issues/229).** At an exit choice the world view draws every lit (dormant or open) rift. On a phone whose seated character is a Starweaver it shows the Riftlight layers over the colorless tear, each color with its pattern and words for what is seen (never what it means): green while dormant, amber at `uses: 1`, blue for `persistent`, violet for `oneWay`, and motion for timed (while its clock runs), unstable and linked. The TV in every mode and every other phone show only the neutral shimmer and "A faint shimmer". The Starweaver's World tab lights with the Riftlight indicator while such a rift is in view and they are not already looking at the world. The journey view itself still reaches every screen; the line is drawn on the client (`packages/client/src/screens/riftlight.ts`). Layers are placeholders until the Part A effect sheets land.

**Engine state.** [#199](https://github.com/allenheltondev/kids-and-dragons/issues/199) shipped class gates on **rift actions** taken at the exit choice between chapters: a `discover` way with `requires: { anyClass: ["starweaver"] }`, and a `hint` for a table without one ("A Starweaver could read this light"). A reading **inside a chapter** uses `requiresClass` on a chapter choice ([#228](https://github.com/allenheltondev/kids-and-dragons/issues/228)): `"requiresClass": "starweaver"` (or a list) offers the choice when anyone seated has the class and does not draw it otherwise, with no hint. It is judged against the seated party and never stored, so the choice sets a journey flag (e.g. `starweaver_read_first_rift`) and later guards read that. A scene whose every choice is class-gated fails validation (`CLASS_GATED_ONLY_EXIT`): keep one way on that needs no class.

**The Listening Chime — agreed.** Orin gives the party a ***Listening Chime*** (a quest item) with his lead at `riftseekers-departure`, which every route passes through, so every party has one. Struck near a rift, it answers two questions:
- **Can it open yet?** The note goes sour while green is lit.
- **Can we come back this way?** The note echoes back only if the rift stays open (blue) and is not one-way (no violet).

It never tells the colors themselves, nor motion or sound (timed, unstable, linked, attunable); only the Starweaver reads those. That gives every party enough to choose fairly, the washout rift's "no way back" included, while later puzzles and the Attune hum stay the Starweaver's. Inside a chapter the chime is a choice gated on the item (`requiresItem`), which works today; at an exit it is a rift action way with `requires: { anyItem: ["listening_chime"] }`. Only the Starweaver's in-chapter reading waits on the chapter class gate above.

Each color conveys a current property **or state**. Properties compose; a rift might display two or three colors, with unusually complex rifts showing more. Observing colors helps infer rules; it need not reveal a destination, precise activation condition or solution.

### Green — agreed and important
**Green means that an activation/operation requirement has NOT been satisfied.**
- The rift needs *something* before it can operate.
- The green light tells the party a requirement is outstanding, **not what the requirement is**.
- As soon as the condition is fulfilled, **green disappears**; the other colors remain and continue to convey the rift's properties.
- Green is thus a *live state indicator*, **not a permanent 'triggered' rift type**.
- **How it is built:** a green rift has an `opensWhen` that does not hold yet. The merged [#196](https://github.com/allenheltondev/kids-and-dragons/issues/196) engine keeps such a rift `dormant` until it holds, then `open`: show green while it is dormant and drop it once open. #196 calls that a *triggered* rift; in the fiction green is a live state, not a type, because once open only the other colors remain.
- Conditions could be items, actions, environment, timing, party actions, or story states. Whatever the fiction, the condition is **resolved inside a chapter and recorded in the journey**, as a flag (e.g. `glacier_rift_woken`) or a world fact (#198), and the rift's `opensWhen` reads it. Graph guards read the journey, never the party, so "carrying the frost lens" is a chapter choice gated on the item, and "at dusk" is a story state a chapter sets. Individual puzzle implementations are still TBD.

### The first two rifts — agreed
They are designed to teach opposite lessons:
- **Washout rift — amber + violet** (single-use, one-way): a gamble taken under pressure that cannot be undone. It leads to the **Sky Islands**, otherwise reachable only by air.
- **Hidden glacier rift — green + blue** (requirement unmet, then persistent): a puzzle solved by patience that stays open as a way back. It leads to **the Saltrot**. Details in [story.md](story.md).

### The palette — agreed
Four colors, each answering one question. Every color has its own **pattern** too, so players who cannot tell colors apart read the same thing.

| Color | Answers | Meaning | Pattern |
| --- | --- | --- | --- |
| **Green** | *Can it open yet?* | Not yet: something is needed first (above) | Slow breathing pulse |
| **Amber** | *How many times?* | Once: one coordinated party traversal, then it collapses | A single candle-like flicker |
| **Blue** | *How many times?* | It stays open: more than one crossing while active | Steady ripple |
| **Violet** | *Which way?* | One way only. No violet means both ways | Light spirals inward, like an arrow |

Every open rift shows **exactly one of amber or blue**, and violet or not. A typical rift shows two colors, three while green is lit. A **green + amber + violet** rift starts unavailable, becomes **amber + violet** when its requirement is met, then collapses after the party crosses. Color is never a shorthand for destination.

### How rifts are authored — agreed
The palette only works if every Riftlight rift is one the palette can describe. On the merged #196 engine:

| Shows | Author as | Notes |
| --- | --- | --- |
| **Amber** | `uses: 1` | Consumed after one crossing. Never edge `once` as well (`RIFT_ONCE_AND_USES`); `once` is for ordinary one-off edges |
| **Blue** | `persistent: true` | Open for good once open |
| **Violet** | `oneWay: true` | The claim that no rift leads straight back, checked by `RIFT_ONE_WAY_HAS_WAY_BACK` |
| **Green** | `opensWhen` | Shown while the rift is `dormant` |

- **Every Riftlight rift is either `uses: 1` or `persistent: true`,** so it always shows exactly one of amber or blue. No `uses: 2` or more, and no rift with neither.
- **Timed (`lasts`) and unstable (`unstable`) rifts are always amber** (`uses: 1`). The engine already refuses either with `persistent`.
- **No violet does not make a way back.** Edges are directed, so a rift shown without violet must be authored as a **linked pair** of opposite edges: `linkedTo` on both, mutual, with the same lifecycle. This applies to every two-way rift: the blue glacier↔Saltrot rift and the Sky↔Coast pair at `whale-road`. A rift without violet and without a partner is a content bug.

**Conditions show as motion, not color.** The remaining #196 properties:
- **Timed:** the rift visibly shrinks.
- **Unstable:** it stutters. It closes at a point the story sets, without a timed rift's visible countdown. Its rules never change; they are fixed.
- **Linked:** it pulses in time with its other mouth. Every two-way rift is a linked pair in the engine, so **every two-way rift pulses**: the pulse means "this rift has another mouth somewhere". Wandering Sky still teaches it, because at `whale-road` the party can see both mouths.

**Attunable shows as sound.** The rift hums back when a Starweaver is near, which is the signal for the Attune progression.

**Not in the palette, deliberately:** red (it already means the red sky, which the Deep Hollow Cult calls "the wrong color"; red rifts would suggest the sky caused them), white/silver (overlaps green, and silver belongs to the Hollow Crown shard), gold (too close to amber on a TV). Violet also colors the Riftseekers' cloaks, which suits them as the rift people.

## Discovery and player progression — agreed direction
- At first, colors are noticed but largely unexplained; repeated encounters help players learn associations.
- **Starweaver: Sense → Attune → Manipulate — agreed.** Earned through the story as journey state, never through levels: a #198 world fact such as `attunement`, raised by effects and read by `when`, as the #199 contract does. level 6 lands in this campaign and already brings Tanglelight, which must not change.
  - **Sense:** from the start; *Read the Riftlight*.
  - **Attune:** earned in the first regional strand entered, whichever it is, so no strand is required. The rift's hum also hints at **what kind** of thing green needs (a sound, an object, a place, a time), never the exact answer.
  - **Manipulate:** earned at convergence. The Starweaver can **meet or hold a condition**: keep a green requirement met for one crossing, or hold a timed rift open until the whole party is through. Conditions around a rift, never its rules.
- **Equivalents for every class, so none is required:** the Thornguard holds back cracking ice or rockfall so a shrinking rift stays reachable; the Songkeeper keeps a sung note going; the Duskrunner gets everyone through before a timed rift closes.
- Thornguard, Duskrunner and Songkeeper should have unique contextual utility; rift puzzle completion must remain feasible for parties without Starweaver.
- **Riftspark — agreed (the design values for #200).** Crossing a rift for the **first** time grants the party a Riftspark: **+2 on one check**, matching the Brave Whistle. The party holds it; before a check the roller's phone offers *"Use Riftspark (+2)?"*, so the choice is spend now or save it for a harder check. It lasts until used or until the **next chapter played** ends; **at most one** is held and a new crossing while holding one grants nothing. Re-crossing the same rift grants nothing, so a two-way blue rift cannot be farmed. Checks only, not attacks (combat has Ready +2; #201 may revisit). The cost is the rift itself: the spark comes with an amber or violet gamble. Fallback if a phone prompt is too much for #200: apply it automatically to the party's next check.
- Choices to harvest, stabilize or interact may carry risks or sacrifice paths **only when consistent with the immutable behavior rule**. Design any 'stabilize' action as managing external conditions or safe access, not turning a once-only rift into a persistent one.
- A fixed set of colors need not disclose what lies on the far side.

## Fail-forward dice sequence — agreed
The [headwaters washout](nodes/headwaters-washout.md) on the Great River is a **multi-stage escape challenge**. The party is swept downstream after failing a dangerous crossing. At each subsequent opportunity a successful skill check lets the party exit at a different geographical node; failure advances them downstream to a new encounter, not game over or automatic death. After final failures there is a rescue/refuge fallback. Each stage uses an existing check mode: `roller: "best"` when one person can save everyone, `roller: "all"` when everyone has to hold on. Exact ability selection, TNs, damage and item consequences remain TBD.

## Engine constraints
See [graph-campaigns.md](../graph-campaigns.md), issue #191 and successors. Graph node transitions happen after a chapter visit finishes. Multi-stage skill checks should be authored as scene/encounter transitions **inside** the washout chapter, with journey flags, not chapter outcomes, feeding later edge choices. A graph outcome is only `success` or `setback`, and a setback counts toward `setbackLimit` and pays half XP, so fail-forward branches end as `success` and route by flag. Mutually exclusive exits use a `routeSets` fork. Preserve deterministic branch testing and no-softlock coverage.
