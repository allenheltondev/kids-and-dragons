---
name: chapter-cohesion
description: Write, edit or review a chapter under content/ (chapters/*.json, a campaign's chapters, Gemfall or any other) so it hangs together at the table. Use whenever someone writes a new chapter, rewrites scenes, adds a person, item or check, fixes an audit finding, or asks for a cohesion, continuity, interactivity or voice review of a chapter. Gives a repeatable six-check procedure with the commands, sweeps and merge-point reads that verify each check, and a findings format.
---

# Chapter cohesion

A chapter can pass `content:validate` and still confuse the table: a "cult" nobody met, a goal
never said, a check that is really a chat, an old friend greeted as a stranger. This skill is the
review that catches those. It came out of the chapter 7 fixes (#355, PRs #364 and #365) and the
whole-campaign audit in #368.

**The rules live elsewhere. Read them first and link to them in findings; do not restate them:**
[CLAUDE.md](../../../CLAUDE.md) ("Writing for the game"),
[content/README.md](../../../content/README.md) (especially "Interactivity" and "Priority scenes"),
[gemfall-authoring.md](../../../docs/campaigns/gemfall-authoring.md) (§4 shape, continuity, voice),
and, for a graph campaign,
[graph-campaigns-authoring.md](../../../docs/campaigns/graph-campaigns-authoring.md#continuity-introduce-before-you-use).

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

## The six checks

### 1. Nothing appears unannounced

A name, group, object or idea is used before **every** way into the scene introduced it.

- **Capitalised names:** `content:continuity` finds them. Fix the prose; an allow-list entry
  needs a one-line reason (CLAUDE.md, "Continuity").
- **Lowercase concepts** (the masks, the cult, the seal, the Gate, the boggarts, the waystation,
  drakes, the Keystone): continuity cannot see them. List candidates by reading the spine for
  "the X" a kid would ask about, then run the **removal sweep** from #364:
  1. `concept '<regex>'` with no introducer. Its *first mentions* are the scenes a party can reach
     without passing another mention; each must introduce the concept in its own words.
  2. Decide which scenes are the introductions, then rerun with `--introduced-by` naming them.
     The sweep removes them from the graph; any mentioning scene still reachable is a **leak**, a
     way in that never heard the introduction. Done when every chapter says `leaks ... none`.
     Introducers may be `chapter/scene` to sweep several chapters at once.
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

### 3. The spine is doing, not talking

- Pacing's interactivity table: `doing` under half, or a `read` run over about three, gets a
  `!`. It names the talking checks on the spine and the scene each long run starts at.
- **Human read** of each spine check's prompt: is the party doing something with hands, feet or
  wits, or persuading someone?
- **Which fix:** if the prompt is already physical but the stat counts it as talk (a `heart`
  check to "hum three notes back to the choir", "hold the middle of a tug-of-war"), add
  `"checkKind": "doing"`. Wording only. If the prompt is a conversation, rewrite the prompt into
  an action at the same stat and TN (#364's `check_ledger`, `check_two_scouts`). Never mark a
  real conversation as doing to move the number (#365 kept `check_who_keeps_table` talking: the
  party asks, two others lift), and do not mark a check whose stat already reads right.
  Changing a check's `stat` changes play: a graph change (below).
- Break a long reading run with a vote or a check on the spine, never a detour. A new scene or
  choice is a graph change; turning a one-button beat's prose into two real choices that land on
  result scenes is still one.

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
  - **One concrete funny detail** per scene, warm, a little spooky, never scary.
  - **Em dashes and US spelling:** `npm test` (`spelling.test.mjs`, `gemfall-flow.test.mjs`).
  - **UK idioms the spelling test misses:** `idioms` lists "round" for around, biscuit, jumper,
    sweets, crisps, "you lot", nan, teatime, full stop. A hit is a word to read, not a verdict:
    "a round table" and a character named Nan are fine.

## Setbacks: never from one ordinary failed roll

`setbacks` prints, for each `"outcome": "setback"` ending, the route there with the fewest
failures, then every failure after which the ending can follow with nothing else going wrong.

- **`! can be the first failure` on a failed roll** is the CLAUDE.md case: one ordinary roll ends
  the chapter. In 08, a first failed tether check reaches Broken Tether and a failed Keystone
  check reaches Turned Back.
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
  1–6, or `setback`.
- **Kind** is `wording` (narration, labels, prompts, `checkKind`) or `graph` (a scene, edge,
  flag, effect, stat, TN or outcome changes). Say which; the owner chooses graph changes.
- An audit is read-only. Report, then let the owner pick fixes.

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
