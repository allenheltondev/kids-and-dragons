---
name: chapter-cohesion
description: Design, write, edit or review Kids & Dragons chapters under content/. Check continuity, kid-readable voice, session length, varied interactive play and choices with consequences. Use for new chapters, scene rewrites, campaign chapter audits and cohesion fixes.
---

# Chapter cohesion

A chapter can pass `content:validate` and still confuse the table: a "cult" nobody met, a goal
never said, a check that is really a chat, an old friend greeted as a stranger. This skill is the
design and review workflow that catches those, along with chapters that are valid but repetitive.
It came out of the chapter 7 fixes (#355, PRs #364 and #365) and the whole-campaign audit in #368.

**Read the relevant rules first and link to them in findings:**
[CLAUDE.md](../../../CLAUDE.md) ("Writing for the game"),
[content/README.md](../../../content/README.md) (especially "Interactivity" and "Priority scenes"),
[gemfall-authoring.md](../../../docs/campaigns/gemfall-authoring.md) (§4 shape, continuity, voice),
and, for a graph campaign,
[graph-campaigns-authoring.md](../../../docs/campaigns/graph-campaigns-authoring.md#continuity-introduce-before-you-use).

## Start with the intended play session

Preserve the user's target duration when revising a boring chapter. Ordinary campaign chapters
should offer about a thirty-minute sitting unless the brief says otherwise; practice and other
intentionally short chapters keep their own targets. Shorter prose does not imply a shorter
adventure. Fill the time with worthwhile discoveries, complications, debate and interactive play.
Do not solve repetition by shrinking the chapter or by replacing each roll with the same minigame.

For a new design or substantial rewrite, read [references/play-design.md](references/play-design.md).
It covers time budgets, mechanics, consequential branches and verification. Historic Gemfall scene
and decision minima are compatibility/context constraints, not proof of duration or fun. Apply
explicit user direction to the current chapter; preserve pinned Gemfall behavior unless changing
it is in the authorized scope.

## 0. Get the numbers

Run these for the chapter under review (`<id>` is the file name without `.json`; `--chapter`
takes a prefix):

```sh
npm run content:validate
npm run content:continuity
npm run content:pacing -- --chapter <id>
npm run content:graph                                     # writes .graph/<id>.html: the scene graph, gates labeled
node tools/content/cohesion.mjs opening  --chapter <id>   # goal.text beside scene 1
node tools/content/cohesion.mjs merges   --chapter <id>   # every merge point and what leads in
node tools/content/cohesion.mjs setbacks --chapter <id>   # the cheapest road to each setback
node tools/content/cohesion.mjs idioms   --chapter <id>   # UK idioms spelling.test misses
node tools/content/cohesion.mjs concept '<regex>' [--introduced-by scene,scene] --chapter <id>
```

`cohesion.mjs` is read-only and reports, never gates (its header says what each mode does).
Validate and continuity must be clean before and after. Pacing's interactivity table gives the
spine (the shortest path to a success ending), its longest reading run (`read`, and the scene it
starts at) and its doing share. Most findings sit on that spine, so walk it in the graph first.
These numbers do not measure the quality of play. The existing dice-oriented minute model does
not budget authored interaction time. Inspect the reachable activities and flag-dependent routes
through the engine as well; report planned minutes separately from observed family timing.

## The six checks

### 1. Nothing appears unannounced

A name, group, object or idea is used before **every** way into the scene introduced it.

- **Capitalised names:** `content:continuity` finds them. Fix the prose; an allow-list entry
  needs a one-line reason (CLAUDE.md, "Continuity").
- **Lowercase concepts** (the masks, the cult, the seal, the Gate, the boggarts, the waystation,
  drakes, the Keystone): continuity cannot see them. List candidates by reading the spine for
  "the X" a kid would ask about, then run the **removal sweep** from #364:
  1. `concept '<regex>'` with no introducer. Its *first mentions* are the scenes a party can reach
     without hearing the concept on the way; each must introduce the concept in its own words.
  2. Decide which scenes are the introductions, then rerun with `--introduced-by` naming them.
     The sweep removes each as far as its words reach; any mentioning scene still reachable is a
     **leak**, a way in that never heard the introduction. Done when every chapter says
     `leaks ... none`. Introducers may be `chapter/scene` to sweep several chapters at once.

  The sweep follows paths, not scenes. Narration, prompt and cast introduce on every way out. A
  choice label, or a check or fight result's narration, introduces only on its own way out: the
  party that passed never heard the failed roll's words. A variant never introduces, because
  only some parties see it. So an introduction written only in `onFailure`, a gated label or a
  variant leaves the other paths uncovered. The sweep lists *variant-only* mentions and
  introducers that *introduce nothing on any path*. Read each one by hand, at every way in.
- **Human read:** at every scene `merges` lists on the spine, read the text as a party from each
  scene leading in. Look for "the jar", "your goat", "that ledger": references no regex finds.
  A concept from an earlier chapter needs saying again here, or a gate on something only that
  chapter gives (CLAUDE.md, "A route flag says where a party is going").

### 2. The opening states the goal

Scene 1 says, in the story's own words, what the party is here to do tonight and why.

- `opening` prints the chapter's `goal.text` beside scene 1. The opening should say the goal
  near word for word (#364's openings do). No `goal` field yet (#356 / #367)? Write the goal
  sentence first and hold the opening to it.
- **Human read:** read scene 1 aloud. Could an eight-year-old answer "what are we doing?" after
  it? A destination alone ("the road goes north") is not a goal. Keep the opening at or under
  about 600 characters: longer ones overflow the TV (`layout-fit` e2e; #364 hit it).

### 3. The spine offers varied play and consequential choices

- Trace what the children actually do on required routes: choose priorities, share clues, aim,
  remember, balance, support a friend, explore, use an ability, fight, or play with the cast.
  Repeated `explain -> two options -> roll -> accept -> repeat` is a design finding even when
  every check counts as doing. Repeated ordering puzzles or hold-and-complete tasks can have the
  same problem. Pick mechanics for the fictional job; do not impose a catalog or activity quota.
- Use existing `interaction` scenes where direct play suits the task. Read
  [content/README.md, Story interactions](../../../content/README.md#story-interactions) for
  current schemas and the implementation's accessibility and presentation limits. A completed
  activity determines its authored result; do not add a roll that can undo the players' work.
- For each important decision, name the tradeoff before selection, show the immediate result,
  then identify the later task, capability, evidence, cost, relationship or ending it changes.
  Two labels and identical results are flavor, not a consequential branch. Flavor and free play
  are welcome, but cannot stand in for the chapter's important decisions.
- At merges, verify that different routes keep their costs and gains. A flag is meaningful only
  if a reachable scene consumes it. Distinguish consequences within the chapter from memories
  that the campaign actually carries; a local flag alone does not promise a later callback.
- Keep dice for uncertain risks where both outcomes move the story somewhere useful. Routine
  recording, explaining a discovery and cleanup do not each need a roll. A physical prompt whose
  stat mislabels it may use `checkKind: "doing"`; never recategorize or rewrite a conversation
  just to improve the doing percentage.
- Break a long reading run with an action or a real decision on the required route. Do not add
  a token binary vote to satisfy a metric. A well-placed conversation can itself be worthwhile
  play when the party has something consequential to decide.
- Budget time by acts or story movements, including reading, discussion, interactive turns and
  a satisfying payoff. Check the shortest valid route as well as an engaged route, solo and
  multiplayer, including class shortcuts and assistance. Treat about thirty minutes as a design
  target to test with families, not something scene counts or `estimatedMinutes` can establish.

### 4. The party's past comes back, ungated

- **Returning people:** list who the chapter casts or names and grep earlier chapters for them
  (`grep -l 'Pellam' content/chapters/gemfall-0*.json`). Anyone a party may have met before is
  greeted as known, through a gate on what proves the meeting or in words true either way
  ("You again!" only where every way in met them). Nobody is reintroduced as a stranger.
- **The party's choices** (in Gemfall: motive, ember, sprites, road, record): at least one
  ungated spine line reads them back in a way true for every party, as Pellam's record lines in
  07 do (the audit's other model is Marda's rumor board in 02). Gated callbacks are a bonus, never the only callback.
- **Human read:** walk the spine once as a party that skipped every optional meeting.

### 5. New people arrive with a stake

- For each first appearance (a `cast` entry, `named X`, `discovers`), the introducing scene
  says what they want from the party or what they can do for it.
- **Stranger-chore padding:** a run of strangers asking for small favors that change nothing
  later. Each new person should touch the goal, the beat or a later scene. If not, cut, merge
  them into someone who matters, or give the chore a payoff.

### 6. Reading runs and voice

- Reading runs: from check 3's pacing output. Also glance at the typical path's `read`.
- Voice, against CLAUDE.md "Voice" and "Writing for the party you have":
  - **Party counting:** `gemfall-flow.test.mjs` catches the common forms; read for the rest
    ("fills a fourth bowl", "both of you").
  - **Concrete funny details:** use a character's actions, a prop mishap or an occasional running
    joke. Keep the house voice warm and a little spooky, never scary. Do not bury the goal or the
    next action under jokes, repeated disclaimers or explanations of how children should feel.
  - **Em dashes and US spelling:** `npm test` (`spelling.test.mjs`, `gemfall-flow.test.mjs`).
  - **UK idioms the spelling test misses:** `idioms` lists "round" for around, biscuit, jumper,
    sweets, crisps, "you lot", nan, teatime, full stop. A hit is a word to read, not a verdict:
    "a round table" and a character named Nan are fine.

## Setbacks: never from one ordinary failed roll

`setbacks` prints, for each `"outcome": "setback"` ending, the route there with the fewest
failures, then every failure after which the ending can follow with nothing else going wrong.
These are **structural lower bounds**: the walk takes gated choices too. A route through a gated
choice is marked, along with its count when every gated choice is left out. A first failure
reachable only through a gate says so. Confirm any flagged route by hand: can a real party take
it with no other failure first?

- **`! can be the first failure` on a failed roll** is the CLAUDE.md case: one ordinary roll ends
  the chapter. In 08, a failed `check_keystone` reaches Turned Back. Every party can reach the
  bare-handed tether checks with no failure first, and failing one reaches Broken Tether; the
  other two tether checks sit behind a gate.
- **A short route through one lost fight** skips the beat: 05c's failed `check_one_rule` then a
  lost crab fight reaches `end_rolled_down` in 8 scenes. Lost fights rob, rescue or reroute at a
  cost; a setback that early should reroute instead.
- **Human read:** does the setback come from a bad run of luck or a lost fight late enough that
  the beat is still true? Rerouting a failure changes the graph (below).

## Reporting findings

One finding per row, ranked by how much it hurts at the table:

| # | Scene | Quote | Check | Fix | Kind |
|---|---|---|---|---|---|
| 1 | `gemfall-05b/choice_elders` | "The Skywardens at Redspire Citadel" (label) | 1 | Say who they are in this scene's words; a Wild Road party never heard of them | wording |

- **Scene** is `chapter/scene_id`; **Quote** is the exact words (trim with ...); **Check** is
  1–6, or `setback`; use check 3 for variety, duration and consequence findings.
- **Kind** is `wording` (narration, labels, prompts, `checkKind`) or `graph` (a scene, edge,
  flag, effect, stat, TN, interaction specification or outcome changes). Say which.
- A review-only request produces findings. When the user also requests design changes or fixes,
  implement those within the existing authorization; do not turn every graph edit into a fresh
  permission request. Keep the separate pinned-Gemfall constraints below.

More worked findings from the audit, and the shape of the #364 / #365 fixes, are in
[references/examples.md](references/examples.md).

## Gemfall is pinned

`packages/server/src/handlers/gemfall-compat.test.ts` hashes every Gemfall file, and below the
hashes it digests the endings, roads, setbacks and resumed saves.

- **Wording-only edit** (text, labels, prompts, `checkKind`, `priority`, cast): re-take only the
  edited files' hashes in `GEMFALL_FILES`, add a "Re-pinned for ..." paragraph to the comment
  above them saying what changed and that no scene, edge, flag, effect, stat or TN moved, and say
  why in the commit. The digests must not move; if one does, the edit was not wording-only.
- **Graph change** (anything that moves a digest, such as 08's setback reroutes or a check's
  stat): needs the owner's sign-off before it is written, its own issue or PR, and re-taken
  digests via `gemfall-compat-probe.ts` as its header describes.

Before pushing any chapter edit: `npm run typecheck`, `npm test`, `content:validate`,
`content:continuity`, and the pacing before and after in the PR (#364's table is the model).
When a graph campaign's flag writes or graph changes, regenerate `npm run content:proofs`. For interaction edits, verify
real engine controls, assistance and recovery, plus complete routes through the changed decisions;
use the relevant content tests rather than relying on a schema pass. Report the duration target,
what fills it and any family timing still unmeasured.
