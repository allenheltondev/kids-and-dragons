# Kids & Dragons

Rules, items, campaigns and chapters are JSON under `content/`, validated by `schemas/` and
`tools/content/validate.mjs`. The TypeScript types in `packages/shared/src/types/` are the
contract; where a schema disagrees with them, the schema is wrong.

## Commands

- `npm run typecheck` — tsc across shared, server, client and tools
- `npm test` — vitest (includes the `tools/**/*.test.mjs` content suites)
- `npm run content:validate` — schemas and scene graphs; a malformed chapter must fail here, never at the table
- `npm run content:continuity` — names a scene uses that some way in never showed, across every campaign in `content/campaigns`
- `npm run content:graph` — a chapter's scene graph, with its gates labeled
- `npm run content:pacing` — shortest and typical path through each chapter, and its predicted minutes (reports, never gates)

## Writing for the game

The rules below are distilled from the authoring docs; the docs win where they say more. Read
them before writing or editing a chapter:
[content/README.md](content/README.md) (the format),
[docs/campaigns/gemfall-authoring.md](docs/campaigns/gemfall-authoring.md) (the house rules, worked
out on Gemfall), and for a nonlinear campaign
[docs/campaigns/graph-campaigns-authoring.md](docs/campaigns/graph-campaigns-authoring.md).

### Story shape

- **Every chapter ends on its beat.** A campaign is a ladder of beats, each a sentence that must be
  true when the chapter closes, whichever road the party took to get there. Write toward it.
- **Put new material on the spine every path walks**, never on a detour a party can skip. A
  chapter is one 30–45 minute sitting, so the shortest path to a success ending is at least 30
  scenes, 14 of which ask something.
- **Every choice lands on a scene that shows its result** before paths merge. Every check branch
  narrates.
- **Failure reroutes; nothing is a retry.** A failed roll keeps the story going somewhere real. A
  lost fight robs, rescues or reroutes, and costs something. Setback endings are rare, never from
  one ordinary failed roll.
- Each chapter needs a rest waypoint (a `rest` scene with choices) and at least one ending (a
  scene with `"choices": []`).

### Interactivity

`content:pacing` measures the second and third on every spine (it reports, never gates). See
[content/README.md, "Interactivity"](content/README.md#interactivity).

- **The chapter's goal is clear in scene 1.** The entry scene says, in plain words, what the
  party is here to do.
- **Never more than about three scenes in a row without something to decide**: a vote, a check
  or a fight. One-button beats are reading.
- **Most spine checks are things the party does, not says.** Might and quick are doing; clever
  and heart are talking. Where the stat misleads, the check sets `checkKind`.
- **New people arrive with a stake for the party.** The scene that introduces someone says what
  they want from the party, or what they can do for it.

### Continuity: introduce it before you use it

- **Nobody and nothing appears unannounced.** The first scene that uses a name (a person, a place,
  an item) introduces it: `a clerk named Pellam`, `called Gullet`, `his daughter Posy`, a `cast`
  entry. A later scene may use the name only if **every** way into it introduced it first.
- **Transitions are caused, not cut to.** If a mail sack bursts over the market, somebody mentioned
  the overloaded griffins first. A payoff needs its setup on every path to it.
- **Merge points are where continuity breaks.** Where paths meet, the scene must read true for a
  party that came by any of them. Check the paths that skipped the setup, not the one you wrote first.
- **A route flag says where a party is going, not where it has been.** Roads weave: in Gemfall a
  4B party may never have met Gullet or seen the Hollow Gate. A callback to an earlier chapter gates
  on something only that chapter gives (its facet, a prop, a flag it alone sets).
- **Facts later scenes depend on are decided by choices, not variants.** A variant says how
  something looks to this party; who is friendly, what was given and which door is open go in a
  choice with a `setFlag`.
- **In a graph campaign, every place can be reached in more than one order.** Introduce what a
  chapter needs inside that chapter, or gate the way in on the place that introduced it:
  `completed: X` proves what X showed, a journey flag proves what every setter of it showed, an
  edge's label counts. `visited`, facts and `outcome` prove nothing to the sweep, so a way chosen
  by a world fact is judged as if any party could take it.
- **What the tool cannot see, read for.** `content:continuity` only sees capitalised names. "The
  jar", "your goat" and "that ledger" need a human read at every merge point. Fix findings in the
  prose; an entry in `tools/content/continuity-allow.json` needs a one-line reason.

### Priority scenes

A non-combat scene may set `priority`: `1` for a revelation the campaign turns on, `2` for a clue
worth noticing. Leave it off everywhere else, which is nearly everywhere. At most one p1 on any
path through a chapter, and the fact goes plainly in the narration itself. Priority scenes are
drawn differently on the shared screen, and every p1 visited is retold, in its own words, on the
end-of-chapter recap. A reveal written as a check's branch narration
cannot be marked, so give a big reveal its own scene. See
[content/README.md, "Priority scenes"](content/README.md#priority-scenes); Gemfall's p1 per beat is
in [gemfall-authoring.md](docs/campaigns/gemfall-authoring.md#priority-scenes).

### What carries between chapters

- **Only route-set flags cross a chapter boundary.** Everything else a chapter sets dies with it.
- **Never set two members of one route set on one path** (the engine refuses to guess and keeps
  the old value), and a set a chapter must decide is set on every path to every ending.
- **A carried flag only ever adds an option.** Gates hide choices, and every scene keeps one
  ungated choice, so a callback is a bonus, never the only way forward.

### Writing for the party you have

- **Never count the party.** A table seats one to four, so "all three of you" is wrong at most
  tables. Say "all of you", or write `{party}` and let the engine count.
- **Text that names, counts or hands over a great stone (a `facet_*`) reads the inventory**
  (`when` or `variants`). No chapter guarantees a facet, so the empty-handed party gets its own
  words and something to do.
- **Costs cost.** Paying, buying and sharing food use `spendCoins` / `takeItem`, gated on the party
  having it, beside a choice that costs nothing.
- Species gates appear where a species shines, always beside an ungated way.

### Voice

- Players are about eight, listening to an adult read off the TV: short sentences, one concrete
  funny detail per scene, warm and a little spooky, never scary. Match `bramblewood-01` read aloud.
- Nobody dies; losses are grief and consequence, never gore, and end on a spark. Mysteries are
  witnessed, not explained.
- US spelling and no em dashes in Gemfall text (`spelling.test.mjs`, `gemfall-flow.test.mjs`).
- `discovers` and `cast` are for who is physically there and met, not mentioned. Do not tag a
  protected mystery before the scene that reveals it.

### Gemfall is pinned

`packages/server/src/handlers/gemfall-compat.test.ts` hashes every Gemfall file. A deliberate
content edit re-takes those hashes and says why in the commit; the gameplay digests below them
must not move.
