# Continental Rift — mechanics and rift canon

## Fundamental rules — agreed
- Rifts are **ancient magic**, not inventions of the emperor or Riftseekers.
- Skilled characters may **summon or manipulate** a rift's presence, activation circumstances or surrounding energy.
- **Nobody chooses or changes the rift's intrinsic behavior.** Summoning and influence are not equivalent to programming a portal.
- Behavior is learnable through observing Riftlight, even when the underlying source and cause remain secret.
- A rift can have **multiple simultaneous properties**, represented by multiple colors.
- Do not claim that magic can override a rift's fixed one-way / once-only nature. Detailed summoning constraints are still TBD.

## Riftlight — agreed principle
Rifts emit colored magical light. In the fiction **only certain people can see the meaningful spectrum**: ordinary observers notice an anomaly but not its diagnostic colors; Starweavers have a natural affinity; select Riftseekers use attunement or tools.

At the table the reading is **shared**, because every screen shows the same world ([spec.md](../../spec.md)). Everyone sees that a rift shimmers. A Starweaver's *Read the Riftlight* choice narrates its colors to the whole party. A party without a Starweaver gets the same reading another way: a Riftseeker tool (a choice gated on the item) or Orin. In the story only the Starweaver sees; in the game only the Starweaver's choice reveals, to everyone. This needs a class gate on choices (`requiresClass`, beside `requiresSpecies`), which [#199](https://github.com/allenheltondev/kids-and-dragons/issues/199) adds. Exactly which colors each route can read is TBD.

Each color conveys a current property **or state**. Properties compose; a rift might display two or three colors, with unusually complex rifts showing more. Observing colors helps infer rules; it need not reveal a destination, precise activation condition or solution.

### Green — agreed and important
**Green means that an activation/operation requirement has NOT been satisfied.**
- The rift needs *something* before it can operate.
- The green light tells the party a requirement is outstanding, **not what the requirement is**.
- As soon as the condition is fulfilled, **green disappears**; the other colors remain and continue to convey the rift's properties.
- Green is thus a *live state indicator*, **not a permanent 'triggered' rift type**.
- **How it is built:** a green rift is a rift edge whose `when` guard does not hold yet. The UI shows green while the guard fails and drops it once the guard holds; no separate 'triggered' property is needed ([#196](https://github.com/allenheltondev/kids-and-dragons/issues/196)).
- Conditions could be items, actions, environment, timing, party actions, or story states. Whatever the fiction, the condition is **resolved inside a chapter and recorded as a journey flag** (e.g. `glacier_rift_woken`), and the rift edge guards on that flag. Graph guards read the journey, never the party, so "carrying the frost lens" is a chapter choice gated on the item, and "at dusk" is a story state a chapter sets. Individual puzzle implementations are still TBD.

### Other colors — proposed palette, awaiting explicit lock
| Color | Provisional interpretation | Notes |
| --- | --- | --- |
| Amber | Single-use | One coordinated party traversal, then spent/collapses |
| Violet | One-way | Traversal does not offer an immediate reverse via the same rift |
| Blue | Persistent | More than one crossing while active |
| Red | Unstable | Exact meaning needs definition: avoid changing fixed property types unpredictably |
| White / Silver | Dormant or latent | May overlap with green; resolve semantics before building |
| Gold | Resonant/attunable | Must not imply users can alter intrinsic behavior |

A **green + amber + violet** rift starts unavailable, becomes **amber + violet** when its requirement is met, then collapses after party crossing. Color is not a shorthand for geographic destination. Use distinctive movement/patterns alongside hues for color-accessible play.

## Discovery and player progression — agreed direction
- At first, colors are noticed but largely unexplained; repeated encounters help players learn associations.
- Starweaver: Sense → Attune → Manipulate as planned specialty progression; this must not let them rewrite intrinsic rift rules.
- Thornguard, Duskrunner and Songkeeper should have unique contextual utility; rift puzzle completion must remain feasible for parties without Starweaver.
- Rift energy may grant temporary buffs, bounded by duration/stacking rules (actual values TBD).
- Choices to harvest, stabilize or interact may carry risks or sacrifice paths **only when consistent with the immutable behavior rule**. Design any 'stabilize' action as managing external conditions or safe access, not turning a once-only rift into a persistent one.
- A fixed set of colors need not disclose what lies on the far side.

## Fail-forward dice sequence — agreed
The Glacierflow river washout is a **multi-stage escape challenge**. The party is swept downstream after failing a dangerous crossing. At each subsequent opportunity a successful skill check lets the party exit at a different geographical node; failure advances them downstream to a new encounter, not game over or automatic death. After final failures there is a rescue/refuge fallback. Each stage uses an existing check mode: `roller: "best"` when one person can save everyone, `roller: "all"` when everyone has to hold on. Exact ability selection, TNs, damage and item consequences remain TBD.

## Engine constraints
See [graph-campaigns.md](../graph-campaigns.md), issue #191 and successors. Graph node transitions happen after a chapter visit finishes. Multi-stage skill checks should be authored as scene/encounter transitions **inside** the washout chapter, with journey flags, not chapter outcomes, feeding later edge choices. A graph outcome is only `success` or `setback`, and a setback counts toward `setbackLimit` and pays half XP, so fail-forward branches end as `success` and route by flag. Mutually exclusive exits use a `routeSets` fork. Preserve deterministic branch testing and no-softlock coverage.
