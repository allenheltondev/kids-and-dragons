# Graph campaigns — the authoring contract

A **graph campaign** is a campaign whose next chapter is chosen by *where the party goes*,
not by a chapter number. It names places-in-the-story (**nodes**) and the ways between them
(**edges**), each with a stable id, and plays an ordinary chapter at each node. Parties can
branch, go sideways, come back to somewhere they have been and find it changed, and finish at
one of several endings.

This document is the contract for the declaration (#192, part of epic #191). The shape is
`CampaignGraph` in [`packages/shared/src/types/campaign-graph.ts`](../../packages/shared/src/types/campaign-graph.ts);
the rules that read it are [`packages/shared/src/campaign-graph.ts`](../../packages/shared/src/campaign-graph.ts);
the schema is `graph` in [`schemas/campaign.schema.json`](../../schemas/campaign.schema.json).
Where this document and the TypeScript disagree, the TypeScript wins and this is a bug.

> **Status.** The declaration, its schema, its parser and the load-time checks exist (#192), and
> so does the journey runtime (#194, [§6](#the-runtime-194)): a graph campaign can be started,
> played node by node, its exits chosen (`CHOOSE_EXIT`), and its journey is saved on the
> household's attempt. Edges can be [rifts](#rifts-196) with lifecycles of their own (#196). The
> navigation screens are #195. No graph campaign ships; the only ones in the repo are the
> [Rift Sampler](#7-the-rift-sampler) and Rift Lifecycle fixtures, which live outside `content/`.

---

## 1. Ordered or graph — and why Gemfall does not change

```ts
campaignMode(campaign) // "ordered" | "graph"
```

- **No `graph` → ordered.** Beats 1..n by chapter `index`, routed beats chosen by flag
  (`routes.ts`, [gemfall-authoring.md](./gemfall-authoring.md)). Every campaign authored before
  this existed, Gemfall and the reference campaign included. Nothing about how an ordered campaign
  loads, validates, saves or plays changes, and `campaign-graph.test.ts` / `loader.test.ts` hold
  the shipped campaigns to that (no `graph`, same tour, same refusals).
- **`graph` present → graph.** The edges choose. `index` routes nothing.

**A campaign's mode is part of its identity.** An attempt in flight on an ordered campaign
remembers a beat (`lastIndex`), not a node; giving that campaign a `graph` would strand it. So
"make Gemfall nonlinear" is a *new campaign id*, never an edit to `gemfall.json`.

Use a graph when the story has geography that loops — places visited in any order, revisited,
changed. Keep ordered when the story is a road, even a forking one: routed beats are simpler to
author, to test and to read.

---

## 2. The declaration

```jsonc
{
  "id": "rift-sampler",
  "title": "The Rift Sampler",
  "blurb": "…",
  "chapters": ["sampler-waystone", "sampler-orchard", "sampler-orchard-flooded", "…"],
  "graph": {
    "version": 1,
    "entry": "waystone",
    "flags": ["mill_wheel_turning", "found_the_lens"],
    "nodes": {
      "waystone": { "chapter": "sampler-waystone", "title": "The Waystone", "revisit": "pass" },
      "orchard": {
        "chapter": "sampler-orchard",
        "variants": [{ "chapter": "sampler-orchard-flooded", "when": { "flag": "mill_wheel_turning" } }]
      },
      "mill": { "chapter": "sampler-mill", "revisit": "closed" },
      "dawn-gate": { "chapter": "sampler-dawn-gate", "ending": { "title": "The Dawn Gate" } }
    },
    "edges": {
      "to-orchard": { "from": "waystone", "to": "orchard", "kind": "forward", "label": "Down to the orchard" },
      "orchard-to-mill": { "from": "orchard", "to": "mill", "kind": "sideways" },
      "mill-to-orchard": {
        "from": "mill", "to": "orchard", "kind": "return",
        "effects": [{ "type": "setFlag", "flag": "mill_wheel_turning" }, { "type": "unlock", "edge": "orchard-to-tower" }]
      },
      "orchard-to-tower": { "from": "orchard", "to": "tower", "kind": "forward", "locked": true, "blocked": "shown" }
    }
  }
}
```

| Field | Meaning |
|---|---|
| `version` | The declaration's version. This build reads `1` and **refuses any other** rather than guess. A later issue that changes a meaning below bumps it. |
| `entry` | The node a fresh attempt starts at. One entry, deliberately: "choose where to start" is a forward fork out of a prologue node. |
| `nodes` | Places, keyed by stable id. Key order is authored order. |
| `edges` | Ways between places, keyed by stable id — unique across the graph so an effect, a guard or a save can name one without naming its node. A node's exits are offered in authored edge order. |
| `flags` | Journey flags beyond `routeSets` members ([§5](#5-journey-flags)). |

Node and edge ids match `^[a-z0-9]+([-_][a-z0-9]+)*$`. **They are stable**: saved attempts name
them, so renaming one is a content migration, not a tidy-up.

### `chapters` in a graph campaign

`Campaign.chapters` keeps its meaning — every chapter file in the campaign — and gains one rule
in each direction: **every chapter a node (or variant) plays is listed, and every listed chapter is
played by some node.** The loader and the validator already read `chapters` to know which files
belong to which campaign; a second list would be a second answer.

Chapters of a graph campaign are authored exactly as any other chapter, with three differences:

- `index` is still required by the chapter schema but **routes nothing** — no 1..n check runs.
  Use it as a rough act number.
- `route` is **refused** (`content:validate`): choosing the next chapter is the edges' job.
- An ending's `endsCampaign` has **no meaning**. Only [ending nodes](#ending) end a graph
  campaign; an ending that is a different place is a different node.

---

## 3. Nodes

| Field | Meaning |
|---|---|
| `chapter` | The chapter played here. |
| `title` | The map label; absent means the chapter's title. |
| `revisit` | What entering a **completed** node does — below. Default `"replay"`. |
| `variants` | A different chapter for this place when something holds — below. |
| `ending` | `{ "title": … }` makes this an ending — below. |

### `revisit`

A node not yet completed is always entered and played, whatever this says. Once completed:

| Policy | Entering again… | For |
|---|---|---|
| `"replay"` (default) | plays the chapter again from its entry scene, as a new visit (variants consulted, so "again" may be a changed place) | most places |
| `"pass"` | begins a new visit that is **already done**: straight to the exit choice, no chapter | hubs and crossroads a return edge leads back to |
| `"closed"` | is impossible: every edge into it is unavailable (`"closed"`) | the burnt bridge, the collapsed cave |

`arrivalAt(graph, node, journey)` answers this before the party moves: `"new"`, `"replay"`,
`"pass"` or `"closed"`.

### `variants`

```json
"variants": [{ "chapter": "sampler-orchard-flooded", "when": { "flag": "mill_wheel_turning" } }]
```

Consulted on **every** entry that plays the node — a first visit too, because a place can change
before the party ever reaches it — in authored order. The first whose `when` holds is played;
none holding plays `chapter`. `when` is read on arrival, *after* the incoming edge's effects, so
the edge that floods the orchard is the edge whose arrival sees it flooded
(`chapterAtNode(graph, node, journey)`).

A variant is a whole chapter because biome — backdrop, palette, music — belongs to the file, the
same reason routed beats are files. A change of *words* within one place is the chapter's own
narration `variants` and needs nothing from the graph.

### Ending

```json
"dawn-gate": { "chapter": "sampler-dawn-gate", "ending": { "title": "The Dawn Gate" } }
```

Completing an ending node's chapter **completes the attempt** — commitment, spec §8.3, exactly as
finishing Gemfall's last beat — and records which ending was reached. An ending has no exits
(refused). A graph with no ending is refused: no attempt could ever complete. Failure is unchanged:
`setbackLimit` setbacks fail the attempt wherever the party is.

---

## 4. Edges

| Field | Meaning |
|---|---|
| `from`, `to` | Node ids. |
| `kind` | `"forward"`, `"sideways"` or `"return"` — below. |
| `label` | What the choice says; absent means the destination's title. |
| `when` | Available only while this holds ([guards](#guards-when)). |
| `effects` | Applied in order when taken, **before arrival**. |
| `locked: true` | Unavailable until an `unlock` effect opens it. |
| `once: true` | May be taken once per attempt; then it is **spent**. |
| `irreversible: true` | The author's claim that there is no way back to `from` afterwards. Not enforced at runtime: #193 checks the claim, #195 warns before the crossing. |
| `blocked` | How the exit is drawn while unavailable: `"hidden"` (default — the house rule, unmet requirements hide, architecture §5) or `"shown"` (the locked door is part of the place). |
| `rift` | Makes the edge a [rift](#rifts-196): a link with a lifecycle (triggered, single-use, timed, unstable, persistent, linked, one-way, hidden destination). Absent: an ordinary edge. |

### `kind`, and which cycles are allowed

Movement is identical for all three. The kind is the author's statement of intent, which the
tools hold the graph to (#193) and the screens present (#195):

- **`forward`** — onward in the story.
- **`sideways`** — a neighboring place at the same point in the story: a side trip.
- **`return`** — back to somewhere the story has been. **A cycle is intentional when it runs
  through a `return` edge.** A loop made only of forward edges is the story arriving where it has
  been without anybody meaning it to, and #193 reports it.

Return edges name their destination. There is no "go back to wherever you came from" target:
static destinations keep reachability a property of the file rather than of a party's history.

### When an exit is available

Exits are chosen only **between visits** — once the node's chapter has completed (or a `"pass"`
revisit began done). There is no leaving a node mid-chapter. An exit is available when, checked in
this order (the first failure is the one reported, `exitAvailability`):

1. **not locked** — authored `locked` and never unlocked, or closed by a `lock` effect → `"locked"`
2. **not spent** — a `once` edge already taken → `"spent"`
3. **not closed** — it leads into a `revisit: "closed"` node already completed → `"closed"`
4. **its `when` holds** → `"guard"`
5. **its rift, if it is one, can be crossed** → `"rift-dormant"`, `"rift-faded"`, `"rift-closed"`,
   `"rift-consumed"`, `"rift-expired"` or `"rift-collapsed"` ([Rifts](#rifts-196))

`exitsFrom(graph, node, journey)` lists a node's exits in authored order with each one's
availability and whether it is drawn (`visible`: available, or blocked and `"shown"`).

### Effects

| Effect | Does |
|---|---|
| `{ "type": "setFlag", "flag": f, "value"?: bool }` | Sets a journey flag — the chapters' `setFlag`, same shape. A `routeSets` member is a fork: setting it clears the set's other members. |
| `{ "type": "unlock", "edge": e }` | Opens `e` (it is then available subject to its `when`). |
| `{ "type": "lock", "edge": e }` | Closes `e` for the rest of the attempt. |

### Guards (`when`)

`GraphCondition`. Every field present must hold, an empty one always holds — the chapters'
`Condition` rule, so authors learn it once. Node and edge fields take one id or a list; **a list
means every listed id** (`"visited": ["orchard", "quarry"]` — both).

| Field | Holds when |
|---|---|
| `flag` / `notFlag` | the journey flag is / is not set |
| `visited` / `notVisited` | the node has / has never been **entered** this attempt |
| `completed` / `notCompleted` | the node's chapter has / has never **completed** this attempt |
| `traversed` / `notTraversed` | the edge has / has never been taken this attempt |
| `outcome` | the **subject** node's most recent completion was `"success"` / `"setback"`. On an edge the subject is `from` ("if the chapter you just finished was a setback"); on a variant it is the node itself ("if it went badly here last time"). Never completed matches neither. |

**A guard reads the journey, never the party.** No items, coins or party size. A graph decision
has to come out the same on any evening for any phones, or a party resuming on Thursday sees
different doors than the one that stopped on Monday. "Only if somebody holds the key" belongs in
the chapter, as a choice that sets a journey flag. **There is no `or`**: two edges to the same
place, each with its own guard, say it — and say it in a way every tool can already draw.

---

## 5. Journey flags

The journey's memory is booleans, carried by **the ordered campaigns' carry rule, widened**:

- The journey flags are `graph.flags` **plus every `routeSets` member** (`journeyFlags`). Route
  sets keep their fork semantics, so they need not be repeated in `graph.flags`.
- Every journey flag is **seeded into each chapter run** of the attempt, so a chapter may gate on
  one it never sets (`content:validate` allows that, as it does for carried route flags).
- When a node's chapter completes, each journey flag's value in the run **becomes** its journey
  value (the run was seeded with it, so an untouched flag is unchanged). Any flag not declared
  dies at the chapter boundary, as it always has.
- Edge `setFlag` effects write them too.

This is how a chapter's choices reach the graph: the quarry chapter sets `found_the_lens`, and
the quarry's exit to the tower is guarded on it. Declared, rather than inferred, for the
`routeSets` reason — only a declared list can notice a guard reading a flag nothing will carry.

---

## 6. Visits, completion, and resuming

This is the part every later issue leans on. The words mean exactly this:

- **A visit** begins when the journey **enters** a node: at the entry node when a fresh attempt
  starts, or by taking an edge. Entering always begins a new visit and increments
  `visits[node]` — first time, `"replay"`, or `"pass"` alike. The visit's ordinal is that count,
  and `(attemptId, node, visit)` names one visit exactly.
- **Visited** = at least one visit has begun (`visits[node] > 0`), finished or not.
- **A visit completes** when its chapter run settles (CHAPTER_COMPLETE) — at most once per visit.
  That increments `completions[node]`, records the run's `outcome` as the node's latest, and
  reads the journey flags back from the run. **Completed** = at least one visit completed.
  A `"pass"` revisit begins done without playing, and so does **not** add a completion.
- **The visit ends** when the party takes an exit (or the visit completed an ending).

**One-session node completion.** A node is exactly one chapter, and a chapter is authored to be
played in one sitting (`estimatedMinutes`). There is no partial completion and no node that spans
chapters: the journey changes at exactly three moments — *enter*, *complete*, *take an exit* —
and never mid-chapter.

**Resuming is not revisiting.** If the session ends —

| …while the visit is | the next session | counters |
|---|---|---|
| `"playing"` (chapter not yet completed) | resumes **the same visit**: the same node, the same resolved chapter (variants are not re-evaluated) | unchanged |
| `"choosing"` (completed or passed, no exit taken) | resumes at the **exit choice** — never a replay | unchanged |
| `"ended"` | the attempt is complete | — |

Whether a dropped chapter run picks up mid-scene or restarts from its entry is the run layer's
business, unchanged from ordered campaigns. Either way it is the same visit.

**Replay is a new visit.** Re-entering a completed node by any edge — return, sideways, forward —
is a new visit, counted separately, and (under `"replay"`) plays the chapter again. A second report
of the same visit's completion, or of the same exit from it, is a **repeat**, not progress: #194
makes both idempotent on the visit's identity.

**XP is paid once per chapter per attempt.** A chapter's `xpAward` (and objectives) pays on its
first completion in the attempt and not on a replay: a cycle is a story device, not an XP farm. A
variant is a different chapter, so a changed place pays once more. (`JourneyState.chaptersCompleted`
records which have paid.)

### Save/load compatibility

The journey is stored on the campaign attempt (`CampaignProgressRecord.journey`, #194) as
`JourneyState`, `version: 1`. **An ordered campaign's attempt has no journey state** — every row
written before graphs, and every Gemfall row forever — and reads exactly as before: nothing on the
ordered path reads the field. A **graph** campaign's attempt with no journey written yet reads as a
fresh start at the entry (`startJourney` is deterministic, so every reader agrees on it). No graph
campaign has ever been played, so there are no in-flight graph attempts to migrate. Content may
change under a journey: a counter or lock state for an id the declaration no longer has is
ignored, never an error; renaming an id is a migration — and a journey *standing at* a node the
declaration no longer has is refused (`"unknown-node"`) rather than guessed at.

### The runtime (#194)

[`packages/shared/src/journey.ts`](../../packages/shared/src/journey.ts) moves the journey; it is
pure (no clock, no randomness, no store) and every transition returns a new `JourneyState`, a
**duplicate** marker, or a **refusal** value — never a throw:

| | |
|---|---|
| `startJourney(graph, campaign?)` | the first visit to the entry, `"playing"` (variants resolved) |
| `readJourney(graph, raw)` | the stored value checked: `null` when absent; refused when unreadable, from a newer build (`"version"`) or standing at an unknown node |
| `resumeJourney(graph, raw, campaign?)` | `readJourney`, or `startJourney` when nothing is stored (`fresh: true`) |
| `completeVisit(graph, journey, { node, visit, chapterId, outcome, flags }, campaign?)` | the visit's chapter settled: `completions`/`outcomes`/flags/`chaptersCompleted`; `firstCompletion` (XP pays), `ended` (an ending) |
| `takeExit(graph, journey, { edge, visit }, campaign?)` | traversed + 1, `lastExit`, effects in order, then enter the destination; `arrival` is `"new"`/`"replay"`/`"pass"` |
| `currentPlayable(graph, journey)` | `{ kind: "play", node, visit, chapter }` \| `{ kind: "choose", node, visit, exits }` \| `{ kind: "ended", node, visit, ending }` |
| `journeyView(graph, journey, titleOf?)` | `JourneyView`, the screens' read model (below) |
| `migrateJourney(raw)` | the migration ladder — one rung today (the hook a `JOURNEY_VERSION` 2 fills) |

`campaign` supplies `routeSets`: a route set member is a fork in a graph campaign too, so an edge's
`setFlag` clears the set's other members, and reading flags back from a run keeps the ordered
rule — the newly set member wins; two new ones is a content bug and the set is left as it was.
Journey flags are stored true-only.

**Idempotence.** Every report names its visit, and `(attemptId, node, visit)` is the key — the
attempt id is the row's, `(node, visit)` the report's:

| Report | Answer |
|---|---|
| completion of the current visit while `"playing"` | applied |
| completion of the current visit already done, or of any earlier visit (`visit ≤ visits[node]`) | **duplicate**: the journey unchanged, nothing counted or paid |
| completion of a visit the journey never had | refused `"stale-visit"` |
| completion naming another chapter than the visit resolved | refused `"wrong-chapter"` |
| the exit recorded as `lastExit` (same `node`, `visit`, `edge`) | **duplicate**, wherever the journey has got to since |
| an exit from another node / another visit / while `"playing"` / after `"ended"` | refused `"not-here"` / `"stale-visit"` / `"still-playing"` / `"ended"` |
| an unavailable exit | refused `"unavailable"` with `reason` (`ExitBlock`) |
| an edge id the graph does not have | refused `"unknown-edge"` |

**On the server.** `ContentStore.graph(campaignId)` is `chapterAt`'s by-node sibling: the parsed
graph, or `null` for an ordered campaign — the branch every caller takes first.

- **CONTINUE_CAMPAIGN** resumes the journey (`attemptJourney`: the active attempt's journey, or a
  fresh start for no attempt or a finished one) and starts the playing visit's chapter. A party
  that is choosing is refused until it chooses.
- **START_CHAPTER** of a graph campaign must name exactly that chapter. The chapter run is seeded
  with the journey's flags, and stamped with `RunState.journeyVisit = { node, visit }` beside
  `campaignAttemptId`. A start that creates the attempt writes it holding its fresh journey.
- **Settlement** (chapter completion) calls `completeVisit` with the run's stamp, its outcome and
  its flags, inside the same conditional commit as every campaign write. A run of a finished or
  different attempt, without a stamp, or whose visit is a duplicate or stale, settles nothing and
  is shown no XP. A replay (`firstCompletion: false`) records the visit and folds the bag but pays
  no XP. Setbacks count and the setback limit fails the attempt wherever the party is; completing
  an ending completes it (`commitCampaign`). `lastIndex` and `routeFlags` are not maintained for a
  graph campaign — the journey is the whole of where the party got to.
- **`CHOOSE_EXIT { edgeId, visit, campaignId? }`** (campaign defaults to the run's) calls
  `takeExit` and writes the attempt. Legal only between chapters (lobby, creation, completion
  screen). A duplicate answers `{ ok: true }` at the current seq and writes nothing. It moves the
  journey only; CONTINUE then plays where it leads (or, at a `"pass"`, the party is at a choice
  again).

**Concurrency.** Every journey write rides the run's `repo.commit` with
`campaignProgressExpectedVersion` — the attempt row's optimistic lock that already serialized the
setback counter across rooms. Two rooms completing one visit, or two phones taking different exits
from it, both read version *v*; exactly one write lands, the other's commit fails (`STALE_SEQ`),
and whatever it retries meets the moved journey — a duplicate, or a stale visit.

**`CampaignView.journey`** (`JourneyView`, for graph campaigns only): `node`, `title`, `visit`
(what `CHOOSE_EXIT.visit` echoes), `status`, `chapter`, `exits` (while choosing: the *visible*
exits in authored order — `edge`, `to`, `kind`, `label`, `available`, `reason?`, `arrival`,
`irreversible?`), and `reachedEnding` once an attempt has completed at an ending. `next` is null
while choosing. For a completed attempt, `journey` shows the ending reached and `next` the fresh
start a replay would begin.

**Versioning.** `JourneyState.version` is the stored record's (`JOURNEY_VERSION = 1`), separate in
meaning from the declaration's. A later change to what a saved journey means bumps it and adds a
rung to `migrateJourney`; a row from a newer build is refused (CONTINUE, START_CHAPTER and
CHOOSE_EXIT refuse; settlement settles nothing and logs) and never overwritten.

---

## Rifts (#196)

A **rift** is an edge with a life of its own: it may wait to open, be used up, run out of time,
flicker, collapse, or hide where it leads. It is declared as an optional `rift` on the edge, every
property optional and composable; an edge without one is exactly the edge of [§4](#4-edges). The
shape is `GraphRift`/`RiftState` in `types/campaign-graph.ts`; the read rules are `riftState`/
`riftBlock` in `campaign-graph.ts`; the moves are
[`packages/shared/src/rifts.ts`](../../packages/shared/src/rifts.ts). Opt-in like everything
else here: no `rift`, no change — and adding the field did not bump `CampaignGraph.version`.

```jsonc
"camp-to-isle": {
  "from": "camp", "to": "isle", "kind": "forward", "label": "Step into the shimmer", "blocked": "shown",
  "rift": { "uses": 1, "lasts": { "unit": "visits", "count": 4 }, "reveal": "when-crossed" }
},
"shore-to-ruins": {
  "from": "shore", "to": "ruins", "kind": "forward",
  "rift": { "opensWhen": { "flag": "tide_out" }, "oneWay": true }
}
```

| Property | Name in the issue | Meaning |
|---|---|---|
| `opensWhen: GraphCondition` | triggered | `"dormant"` until it holds, then `"open"`. Judged like an edge guard, subject = the edge's `from` (a linked pair: the `from` of its smaller id, so both mouths agree). Unless `persistent`, an open triggered rift can be **crossed only while it still holds** (`"rift-dormant"` otherwise); its lifecycle stays `"open"`. |
| `persistent: true` | persistent | Once open, open for good: `opensWhen` no longer gates it, and no action closes it. Refused together with `uses`, `lasts` or `unstable` (they would end it). |
| `uses: n` | single-use (`1`) | `"consumed"` after n crossings. |
| `lasts: { unit, count }` | timed | `"expired"` once `count` ticks of `unit` have passed since it opened. |
| `unstable: { flicker?: { open, shut }, collapsesAfter? }` | unstable | `flicker`: there on `open` visits to `from`, gone for `shut`, repeating — visit ordinal v is open when `(v − 1) mod (open + shut) < open` (`"rift-faded"` otherwise). `collapsesAfter: n`: `"collapsed"` after n crossings. No randomness: the rhythm reads the visit ordinal, so a resumed visit gives the same answer. |
| `linkedTo: edgeId` | linked | Its partner rift. The two are **one rift with two mouths**: one shared state (stored under both ids), so a crossing of either counts for both, and closing, consuming, expiring or collapsing one does the same to the other. Must be mutual, and must declare the same lifecycle (`opensWhen`, `persistent`, `uses`, `lasts`, `unstable`). A pair of opposite edges is a two-way rift. |
| `oneWay: true` | one-way | The promise that **no rift leads straight back**. Movement on any edge is one-way already; this is the claim, refused with a partner that is its own way back and checked against every rift edge `to → from` (`RIFT_ONE_WAY_HAS_WAY_BACK`), and shown on the screen. (Whether there is any way back at all is `irreversible`'s claim.) |
| `reveal` | destination reveal | `"always"` (default), `"when-open"` (hidden while dormant) or `"when-crossed"` (hidden until the party has crossed it, by either mouth of a pair). |

`{}` is a rift with no rules: open from the start, forever, and drawn as a rift.

### The lifecycle

```
  dormant ──(opensWhen holds, or openRift)──▶ open
     │                                         ├─(crossings reach uses)───────────▶ consumed  ┐
     │                                         ├─(age reaches lasts.count)────────▶ expired   ├ final
     │                                         ├─(crossings reach collapsesAfter)─▶ collapsed ┘
     └───────────(closeRift)──────────▶ closed ◀──(closeRift; not if persistent)──┘
                                         └──(openRift)──▶ open
```

- The lifecycle only moves forward. **`consumed`, `expired` and `collapsed` are final**: no
  condition, no clock, no content change and no explicit open brings one back — a used-up rift that
  returns is a different edge. A stored final status is never overwritten (closing one is a no-op).
- **`closed`** is a stop, not an end: only an explicit `openRift` (#197's action) reopens it.
  Nothing derived does.
- Absent state reads **as declared**: open, or dormant with `opensWhen`. A stored record that is
  not one (a corrupted row, a status from a later build) reads `"closed"` — the one thing a misread
  rift must never do is open by accident.
- Both `uses` and `collapsesAfter` reached by the same crossing: `consumed`.

### Clocks

There is no wall clock in a journey, and no turn clock between chapters. A timed rift counts the
moments the journey already has:

| `unit` | One tick | Reads as |
|---|---|---|
| `"visits"` | every exit taken and arrived through (a pass-through counts — it is a move) | "for four moves" |
| `"chapters"` | every chapter completed (a pass-through plays none) | the **session clock**: a chapter is one sitting, so "for two evenings" |

The age counts from the moment the rift **opened** (for an untriggered rift, the start of the
attempt). Turn-by-turn timing inside an encounter is #201's (environmental combat): the parser
refuses any other unit today, and `tickRifts(graph, journey, unit)` is the hook a turn clock would
call.

### When a rift moves, and what a crossing is

Only inside the journey's three transitions, in a fixed order, so the server, the phones and the
lint search walk a rift through the same states:

| Transition | Rift steps |
|---|---|
| start | enter the entry → `settleRifts` |
| complete a visit | `tickRifts("chapters")` on the journey the chapter played under → the completion (counters, outcome, flags) → `settleRifts` |
| take an exit | `crossRift` → `tickRifts("visits")` → traversed/`lastExit`/effects → enter → `settleRifts` |

Ticking *before* the transition's own changes means a rift opened by this move or chapter starts at
age 0; crossing *before* ticking means a timed rift can be taken on its last move. `settleRifts`
writes back what the journey now implies (a triggered rift opening, a timed one expiring) and
nothing for a rift still as declared, so a graph with no rifts never grows a `rifts` key.

**A crossing is the `CHOOSE_EXIT` that commits** — one party-wide move. The whole party crosses
with the exit; there is no per-hero crossing and no half-crossed party, because the journey has no
such state: the rift's count, the exit and the arrival are one `takeExit`, written in the attempt's
one conditional commit. So:

- a double tap, or a retry after a lost response, is `takeExit`'s **duplicate** (its `lastExit`
  check runs before availability) — never a second crossing, and never refused as "consumed";
- two phones crossing at once: exactly one write lands; the other's retry is the duplicate;
- a session that resumes after the write finds the rift as the crossing left it; one that resumes
  before it finds it untouched. There is nothing in between to resume.

### Stored state

`JourneyFacts.rifts?: Record<EdgeId, RiftState>`, `RiftState = { status, crossings?, age?,
revealed?, latched? }` — stored inside `CampaignProgressRecord.journey`, so it rides the same
versioned write. `JOURNEY_VERSION` stays 1: an absent `rifts` reads as declared, which is what
every journey written before rifts means. A record for an edge that is no longer a rift is ignored;
an edge that becomes a rift under a save starts as declared; a stored final status survives a
declaration that loosened.

### On the screen

`JourneyExitView` gains (#195 draws them):

- `rift?: JourneyRiftView` — `{ status, usesLeft?, expiresIn?: { unit, count }, collapsesIn?,
  oneWay?, unstable?, persistent?, linked? }`; `reason` already says why it cannot be crossed now.
- `hiddenDestination?: true` — the destination is not revealed: **`to` is `""`**, `label` is the
  authored label (write one that does not name the place) or `"Into the rift"`, and `arrival` is
  `"new"` (all the party knows). Nothing in the view names the place.

### For #197 (rift actions)

`rifts.ts` exposes the explicit transitions, each `(graph, journey, edgeId) → { ok: true, changed,
journey } | { ok: false, code: "not-a-rift" | "final" | "persistent", message }`:

| | |
|---|---|
| `openRift` | dormant or closed → open, **latched** (its `opensWhen` stops gating it). A timed rift opened from dormant starts at age 0; reopened from closed it keeps its age and count. Final → refused. |
| `closeRift` | dormant or open → closed. Already closed or final → unchanged. Open and `persistent` → refused. |
| `revealRift` | reveals the destination, whatever `reveal` says. |

No authored `GraphEffect` opens or closes a rift yet — a triggered rift is opened by its
`opensWhen` (which an edge's `setFlag` can satisfy). Effects, discovery and redirection are #197's.

### Checks

| Check | Where |
|---|---|
| counts are whole numbers ≥ 1, `unit` is `visits`/`chapters`, `unstable` is not empty, `reveal` is known, `opensWhen` names resolve, `persistent` not with `uses`/`lasts`/`unstable`, `linkedTo` exists, is a rift, links back, declares the same lifecycle, and is not a `oneWay` rift's own way back | schema and `parseCampaignGraph` |
| `RIFT_ONE_WAY_HAS_WAY_BACK` — a one-way rift with a rift edge straight back | lint (error) |
| `RIFT_ONCE_AND_USES` ⚠ — `once` and `rift.uses` on one edge | lint (warning) |
| `RIFT_REVEAL_MOOT` ⚠ — `reveal: "when-open"` on a rift open from the start | lint (warning) |
| contradictory `opensWhen` → `GUARD_CONTRADICTION`; a single-use, timed, collapsing or flickering rift as the only way on → `STRANDED`/`TRAPPED` with the path | the softlock search, which tracks rift state |

### The Rift Lifecycle fixture

[`packages/shared/src/fixtures/rift-lifecycle.campaign.json`](../../packages/shared/src/fixtures/rift-lifecycle.campaign.json)
shows every property, on placeholder chapters (not content, never loaded), and walks clean:

| Edge | From → to | Rift |
|---|---|---|
| `camp-to-shore` / `shore-to-camp` | camp (pass, entry) ⇄ shore | — (plain forward / return) |
| `camp-to-isle` | camp → isle | `uses: 1`, `lasts: 4 visits`, `reveal: "when-crossed"` — single-use + timed + hidden |
| `shore-to-ruins` | shore → ruins | `opensWhen: { flag: tide_out }`, `oneWay` — triggered + one-way |
| `camp-to-ruins` ⇄ `ruins-to-camp` | camp ⇄ ruins | linked pair, `uses: 2`, `opensWhen: { visited: ruins }` — a two-way gate that wakes once the ruins are found |
| `ruins-to-spire` | ruins → spire | `unstable: { flicker: 1 on / 1 off, collapsesAfter: 1 }` |
| `isle-to-spire` | isle → spire | `opensWhen: { completed: ruins }`, `persistent` |
| `isle-to-camp`, `ruins-to-shore` | back | — (plain returns) |
| `spire-to-dawn` | spire → dawn (ending) | — (`irreversible`) |

`rifts.test.ts` plays it: the shimmer's destination hidden until crossed and its four moves
counting down, the tide-rift there only while the tide is out, the twin gate waking when the ruins
are found and sharing two crossings between its mouths, the stair flickering by visit and
collapsing behind the party, the lantern bridge staying lit — and every property alone and
combined on a three-place map.

---

## 7. The Rift Sampler

[`packages/shared/src/fixtures/rift-sampler.campaign.json`](../../packages/shared/src/fixtures/rift-sampler.campaign.json)
is the illustrative fixture: every part of the declaration once, on placeholder chapter ids. It is
**not content** — it lives outside `content/`, so neither the loader nor `content:validate` ever
sees it, and nothing ships it. `campaign-graph.test.ts` holds it to the parser and
`tools/content/campaign-graph-schema.test.mjs` to the schema.

```
                        ┌──────────── orchard-to-waystone (return) ────────────┐
                        ▼                                                      │
  [waystone] ──to-orchard──▶ [orchard] ──orchard-to-mill (sideways)──▶ [mill] (closed)
   pass │                     ▲   │  ▲                                  │
        │                     │   │  └──── mill-to-orchard (return) ────┘
        │                     │   │        sets mill_wheel_turning, unlocks orchard-to-tower
        │                     │   └── orchard-to-tower (locked, shown) ──▶ [tower] ──▶ ((dawn-gate))
        │                     │                                             ▲   irreversible
        └─to-quarry (once)──▶ [quarry] ── quarry-to-tower (when found_the_lens) ┘
                              │   └── quarry-to-home (when outcome: setback) ──▶ ((long-road-home))
                              └── quarry-to-waystone (return) ──▶ [waystone]
```

- **Branch**: the waystone forks to the orchard and the quarry.
- **Sideways + return cycle**: orchard → mill → orchard. Starting the mill wheel floods the orchard
  (its `variants`) and opens the tower door; the mill is `closed` once done.
- **Hub**: the waystone is `pass` — returning walks through to the exits.
- **Guarded edges**: the quarry's climb needs the lens its chapter may find; the long road home
  opens only after a quarry setback.
- **Locked edge shown**: the tower door is visible from the start and opened by the mill.
- **Once**: the quarry road can be taken once.
- **Two endings**: the Dawn Gate and the Long Road Home.

---

## 8. What is checked where

| Check | Where |
|---|---|
| Shape — fields, kinds, policies, `version: 1`, id patterns, no unknown keys | `schemas/campaign.schema.json` (`content:validate`, editors) |
| Every name resolves — entry, edge ends, guard and effect targets, flags declared, node/variant chapters listed, every listed chapter played, no exit from an ending, at least one ending, rift declarations ([Rifts](#rifts-196)) | `parseCampaignGraph` — run by `content:validate` **and** at server startup (the loader refuses the content set) |
| No chapter of a graph campaign declares `route` | `content:validate` |
| The graph can be walked — reachability, dead ends, softlocks, unintentional cycles, `irreversible` claims, dead locked edges, contradictory guards, repeated ids, rift claims and rift softlocks | `lintCampaignGraph` (`campaign-graph-lint.ts`) — run by `content:validate` (errors fail, warnings print) **and** at server startup (errors only). See [Validation](#validation). |

`parseCampaignGraph` returns `{ graph, problems }`; `graph` is non-null only when there are no
problems, and is normalized: defaults filled (`revisit`, `blocked`), `nodeOrder`/`edgeOrder`,
`exits`/`entrances` per node in authored edge order, `endings`, sorted `flags`.

### Validation

Once every name resolves, `lintCampaignGraph(graph, options)` asks whether the graph can be
*walked*. Every finding has a stable `code`, a JSON-pointer `path`, a `message` naming the node or
edge, and a `hint` saying what to change. **Errors** fail `content:validate` and refuse the content
set at server startup; **warnings** (marked ⚠) only print in `content:validate`. Ordered campaigns
never reach it — Gemfall's validator output is unchanged.

**Static checks** read the edges and ignore guards ("possibly reachable"):

| Code | Error when |
|---|---|
| `UNREACHABLE_NODE` | no chain of edges leads to the node from `entry` |
| `NO_ENDING_REACHABLE` | no ending can be reached from `entry` |
| `DEAD_END` | a reachable non-ending node has no exits at all |
| `CANNOT_FINISH` | a reachable node has exits, but none of its routes ever reaches an ending |
| `UNINTENTIONAL_CYCLE` | a loop uses only `forward`/`sideways` edges (a self-loop counts). The message shows the loop and the edge to mark `"kind": "return"`. Loops through a `return` edge are fine |
| `LOCKED_EDGE_NEVER_UNLOCKED` | an edge is `locked: true` and no edge has an `unlock` effect for it |
| `GUARD_CONTRADICTION` | one guard cannot hold: `flag` and `notFlag` the same flag, `visited`/`notVisited`, `completed`/`notCompleted`, `traversed`/`notTraversed` the same id, `completed` with `notVisited`, `outcome` with `notCompleted`/`notVisited` of the same node |
| `GUARD_FLAG_NEVER_SET` ⚠ | a guard needs a flag no edge effect and no chapter on the graph sets true |
| `DUPLICATE_KEY` | (`content:validate` only, reads the file text) the same node or edge id appears twice in one object; JSON would keep the last and silently drop the first |
| `RIFT_ONE_WAY_HAS_WAY_BACK` | a `oneWay` rift has a rift edge leading straight back (`to` → `from`) |
| `RIFT_ONCE_AND_USES` ⚠ / `RIFT_REVEAL_MOOT` ⚠ | `once` beside `rift.uses` (both count the same crossings); `reveal: "when-open"` on a rift that is open from the start |

**The softlock search** is the part a static check cannot do: whether a *sequence* of choices
leaves the party with nowhere to go. It explores every state a party can be in at an exit choice —
the node plus the journey facts that can change what is available (flags, visited/completed nodes,
latest outcomes, taken edges, lock overrides, each rift's lifecycle, and the visit rhythm a
flickering rift reads) — by calling the same `exitsFrom`, `arrivalAt` and `chapterAtNode` the
runtime uses, and applying edge effects, `once`, `lock`/`unlock`, `revisit` policies, guards and
rift crossings, clocks and settling (the same `rifts.ts` functions, in the same order) exactly as
[§4](#4-edges), [§6](#6-visits-completion-and-resuming) and [Rifts](#rifts-196) say. The
search is breadth-first, so every path it prints is a shortest one.

| Code | Reported when |
|---|---|
| `STRANDED` | a reachable state at a non-ending node has **every** exit unavailable. The message gives the path (`start at "a" -[e1]-> "b" (setback) -[e2]-> ...`) and why each exit is closed (locked / spent / closed / guard / a rift dormant, faded, closed, consumed, expired or collapsed) |
| `TRAPPED` | a state still has exits, but from it **no ending can ever be reached** (a `once` edge used up, a `closed` place completed, a `lock`, a flag that cannot be set back, a rift used up, run out or collapsed). One finding per node, at the first point of no return |
| `NO_ENDING_WINNABLE` | an ending is connected to the entry but no play-through can enter one |
| `NODE_NEVER_ENTERED` / `ENDING_NEVER_REACHED` | a node (an ending) has incoming edges but no play-through can enter it — every edge into it is locked, guarded, spent or closed whenever the party stands at its start |
| `EDGE_NEVER_AVAILABLE` ⚠ | an edge out of a node the party reaches is never available in any state |
| `IRREVERSIBLE_NOT` | an edge marked `irreversible` can be followed by a path back into its `from` node. The claim is checked against the same search, so a way back closed by a guard, `once` or `lock` counts as closed |
| `SEARCH_TRUNCATED` ⚠ | the search hit its state cap (default 50,000); the "never"/"trapped" checks are skipped because they would be guesses. `STRANDED` findings made before the cap are still real |

What the search **assumes**, so you know what a clean result means:

- **Completion branches.** When a node's chapter finishes, both outcomes (`success`, `setback`) are
  explored wherever an `outcome` guard reads them. A graph must have an exit for each.
- **Chapters write flags only on completion**, and the search knows which flags a chapter can
  write only through `chapterFlags`. `content:validate` and the loader read each chapter's
  `setFlag` effects (`chapterFlagWrites`): a flag the chapter never writes keeps its value; one it
  can set true comes out true *or unchanged*; one it can set false, false or unchanged. For a
  chapter the search cannot see (a placeholder fixture chapter, a chapter that failed to load)
  **every** flag may come out either way — the conservative reading, so "unreachable" and "cannot
  finish" are never artefacts of ignorance. A `STRANDED` path can, rarely, rely on a flag value a
  real chapter would not produce; the path is printed so you can judge.
- **A chapter's own choices are not modelled** — only the union of what it can set. A chapter that
  sets `found_the_lens` on one path and not another counts as able to do either.
- **Route-set forks** (setting a member clears the rest) are applied to edge effects and chapter
  results when the campaign's `routeSets` are passed, as `content:validate` and the loader do.
- Only journey facts are tracked, never the party (guards cannot read it anyway, §4).

Severity choices: a guard that can never hold is a **warning** (it strands nobody by itself; if it
strands somebody, the search says so as an error), a guard that contradicts itself is an **error**
(it is plainly a typo), and a node or ending nothing can ever enter is an **error** (dead content
the player can never see).

---

## 9. Extension points for #193–#203

The declaration is closed (`additionalProperties: false`), so nobody can use an extension before
its issue defines it. Where each attaches:

| Issue | Attaches to |
|---|---|
| #193 validation | **Done** — [Validation](#validation). `lintCampaignGraph` reads `ParsedCampaignGraph`; hooked into `checkGraphCampaign` (`tools/content/validate.mjs`) and the server loader's `checkCampaign`. A new field that changes who can go where (a rift, a world-state guard) must teach the search: add it to what `exitAvailability`/`exitsFrom` read and, if it is state, to the tracked facts in `explore`. |
| #194 runtime | **Done** ([the runtime](#the-runtime-194)): `JourneyState` stored on `CampaignProgressRecord.journey`; `journey.ts` (`startJourney`, `completeVisit`, `takeExit`, `currentPlayable`, `readJourney`/`migrateJourney`, `journeyView`); `ContentStore.graph`; `RunState.journeyVisit`; `CHOOSE_EXIT`; `CampaignView.journey`. |
| #195 navigation UX | `CampaignView.journey` (`JourneyView`: visible exits with label, availability, reason, arrival, `irreversible`) and the `CHOOSE_EXIT` intent; underneath, `exitsFrom` / `arrivalAt`. |
| #196 rift links | **Done** — [Rifts](#rifts-196): optional `GraphEdge.rift`, `JourneyFacts.rifts`, `rifts.ts`, six `RiftBlock` reasons after the existing four, `JourneyExitView.rift`/`hiddenDestination`, lint tracking. |
| #197 rift actions | call `openRift` / `closeRift` / `revealRift` (`rifts.ts`; [For #197](#for-197-rift-actions)); new `GraphEffect` types beside `unlock`/`lock` if authored effects should open or close rifts. Final statuses stay final. |
| #198 world state | new `GraphCondition` fields read by `variants[].when` and edge `when`; the variant selection rule stays first-match. |
| #199 class rift interaction | edge-level requirements and actions; must stay journey-deterministic or say explicitly why not. |
| #200 temporary buffs | `GraphEffect` granting attempt-scoped buffs, stored on `JourneyState`. |
| #201 environmental combat | node-level (or variant-level) encounter modifiers. |
| #202 inspection | `ParsedCampaignGraph` + `JourneyState`. |
| #203 vertical slice | a real graph campaign under a **new** campaign id, never Gemfall. |

A change of *meaning* to anything above bumps `CampaignGraph.version`; adding an optional field
whose absence means today's behavior does not.

---

## 10. The shared API

From `@kad/shared` (and importable directly by `.mjs` tools — type imports only):

| | |
|---|---|
| `campaignMode(campaign)` | `"ordered"` \| `"graph"` |
| `parseCampaignGraph(campaign)` | `{ graph: ParsedCampaignGraph \| null, problems: GraphProblem[] }` |
| `journeyFlags(campaign)` | sorted journey flags (`graph.flags` ∪ `routeSets` members) |
| `evaluateGraphCondition(cond, journey, subject?)` | does a guard hold |
| `exitAvailability(graph, edge, journey)` | `{ available: true }` \| `{ available: false, reason: ExitBlock }` |
| `exitsFrom(graph, node, journey)` | every exit with availability and visibility |
| `arrivalAt(graph, node, journey)` | `"new"` \| `"replay"` \| `"pass"` \| `"closed"` |
| `chapterAtNode(graph, node, journey)` | the chapter entering would play |
| `lintCampaignGraph(graph, { chapterFlags?, routeSets?, maxStates? })` | `{ findings: { code, severity, path, message, hint }[], search: { states, complete } }` |
| `chapterFlagWrites(chapter)` | `{ setsTrue, setsFalse }` — what a chapter can write to the journey, for `chapterFlags` |
| `duplicateJsonKeys(text)` | repeated keys in one JSON object, by pointer |
| Types | `CampaignGraph`, `GraphNode`, `GraphEdge`, `GraphEdgeKind`, `RevisitPolicy`, `NodeVariant`, `GraphEnding`, `GraphCondition`, `GraphEffect`, `JourneyFacts`, `JourneyState`, `VisitStatus`, `JourneyView`, `JourneyExitView`, `NodeId`, `EdgeId` |

And from `journey.ts` (#194; **not** loadable by `.mjs` tools — it has value imports): `JOURNEY_VERSION`,
`startJourney`, `readJourney`, `migrateJourney`, `resumeJourney`, `completeVisit`, `takeExit`,
`currentPlayable`, `journeyView`, and the types `JourneyRefusal`, `JourneyRefusalCode`,
`JourneyDuplicate`, `VisitCompletion`, `ExitCrossing`, `Playable`, `VisitReport`, `ExitReport`,
`JourneyCampaign` — see [the runtime](#the-runtime-194).

Rifts (#196): from `campaign-graph.ts`, `riftState(graph, edge, journey)` (the settled
`RiftState`, or `null`), `riftBlock(graph, edge, journey)` (`RiftBlock` or `null`), `riftOwner`,
`flickerOpen`, `FINAL_RIFT_STATUSES`; from `rifts.ts` (loadable by `.mjs` tools through the lint),
`settleRifts`, `tickRifts(graph, journey, unit)`, `crossRift(graph, journey, edge)`, `openRift`,
`closeRift`, `revealRift` (`RiftChange`, `RiftRefusalCode`), `riftDestinationRevealed`, `riftView`;
types `GraphRift`, `RiftState`, `RiftStatus`, `RiftClockUnit`, `JourneyRiftView`. See
[Rifts](#rifts-196).
