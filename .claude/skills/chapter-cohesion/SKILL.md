---
name: chapter-cohesion
description: Write, lengthen, edit or review a chapter under content/ (chapters/*.json, a campaign's chapters, Gemfall, Riftlight or any other) so it hangs together at the table. Use whenever someone writes a new chapter, lengthens a short one, rewrites scenes, adds a person, item, check, interaction or fight, fixes an audit finding, or asks for a cohesion, continuity, interactivity or voice review of a chapter. Gives a repeatable eight-check procedure with the commands, sweeps and merge-point reads that verify each check, a recipe for bringing a short chapter up to length, and the traps in authoring chapters in parallel.
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
npm run content:cast                                      # scenes that name someone the chapter casts elsewhere (reports)
node tools/content/cohesion.mjs opening  --chapter <id>   # goal.text beside scene 1
node tools/content/cohesion.mjs merges   --chapter <id>   # every merge point and what leads in
node tools/content/cohesion.mjs setbacks --chapter <id>   # the cheapest road to each setback
node tools/content/cohesion.mjs idioms   --chapter <id>   # UK idioms spelling.test misses
node tools/content/cohesion.mjs concept '<regex>' [--introduced-by scene,scene] --chapter <id>
```

`cohesion.mjs` is read-only and reports, never gates (its header says what each mode does).
Validate and continuity must be clean before and after. (A graph campaign's `content:validate` also
fails while its proof is stale; see "Working in parallel" for who retakes it.) Pacing's interactivity table gives the
spine (the shortest path to a success ending), its longest reading run (`read`, and the scene it
starts at) and its doing share. Most findings sit on that spine, so walk it in the graph first.
Pacing's `votes` and `checks` columns do **not** count `interaction` scenes (they count only as
"asks the table something" for the reading run), so a chapter's 14-decision bar has to be met by
votes plus checks alone.

## The eight checks

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

### 7. The table does things besides vote

A long chapter of group votes and one-person rolls is still a slideshow. The engine has more, and
a chapter should use it where the story fits (the owner asked for this after Riftlight shipped as
votes).

- **Whole-party and best-of rolls:** `"roller": "all"` (everyone rolls, half or more succeeding
  carries it) for things the whole table does together; `"roller": "best"` where the story calls
  for the strongest in a stat. At least two `all` checks per full-length chapter, and `party` (the
  default, whoever has rolled least) for the rest.
- **Class and species moments:** `requiresClass` / `requiresSpecies` choices, **always beside an
  ungated way**. Use the *ability-assisted* convention: the enabling ability is separate from the
  roller's task (wings carry the kid or the rope, Smash supplies a barrier, a Songkeeper supplies
  the pace), so a party without the class still has a roll to make and the narration never
  claims an ability the roller lacks. Write ability names lowercase in labels and prompts
  ("Use skyward"): `content:continuity` reads a capitalised one as a name nobody introduced.
- **Story interactions** ([content/README.md, "Story interactions"](../../../content/README.md#story-interactions),
  [docs/briefs/story-interactions.md](../../../docs/briefs/story-interactions.md)): `interaction`
  scenes with a `kind` of `precision`, `timing`, `cooperate`, `relay`, `balance`, `sequence`,
  `memory`, `tracking` or `play`. Put four or five on the spine of a full-length chapter, in at
  least three different kinds, fitted to what the beat is physically about (a rope toss is
  `precision`, a bag chain is `relay`, a carry is `balance`, a settling herd is `play`).
  - Both `onSuccess` and `onFailure` must continue the story, and failure is a gentle detour, never
    a dead end. `onAssisted` is the untimed helping hand and defaults to success.
  - Never gate a required clue or support on a class or species, and do not stack an interaction
    with a roll that can negate it. Cues are one sentence an eight-year-old can follow, and every
    label and clue is a literal string (no tokens).
  - `relay`, `balance` and `play` cannot be failed at the table, so a failure branch written for
    one is unreachable; do not hang a flag on it that nothing else sets.
  - A chapter that needs art for an interaction (a rope-coil prop, a note glyph) uses only existing
    art ids and lists the wish in the art issue; the art gate must stay green.
- **Human read:** from the spine, could a table go five scenes without touching anything but a
  vote? Then add one of the above on the spine.

### 8. The bag and the purse matter

- **Give:** two to four `grantItem` rewards per full-length chapter, earned by a task, a check or
  helping someone, using only ids in `content/items.json` (read what each one does). At least one
  `grantCoins` (2 to 8). Never `grantXp`.
- **Use:** a place to `spendCoins` (a stall, a fare, a repair), gated `when: { coins: { min: N } }`
  beside a free choice; a `takeItem` where something is shared or handed over, gated on holding it;
  and two or more choices gated on an item (`requiresItem`) that open a better way, **beside
  ungated ways**, using an item the party could have earned earlier in the same chapter. A
  carried item only ever adds an option and no later chapter requires one.
- **Fights pay for themselves:** in a campaign named in `rules.loot` (Riftlight) a won fight drops
  coins automatically and the next scene opens with "You find N coins". Do not also hand-author a
  coin reward on a fight's victory.
- **The purse starts empty** in a campaign that does not carry one, so earn coins before any
  spend, and never make the only way forward cost something. `content:validate` refuses a spend
  or a take with no matching gate (see gemfall-authoring.md, "Coins and food are real").
- **The test walker's blind spot:** the path walker's state key ignores the bag, so an
  item-gated scene can read as unreachable. Give the choice that earns or consumes the item its
  own flag (a `fed_the_goats` or `bought_the_whistle`) so the walker sees both worlds.

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

## Lengthening a short chapter

When pacing says a chapter is a few minutes with few decisions (`npm run content:pacing -- --chapter
<prefix>` shows `predMin`), bring it to the standard in CLAUDE.md: a shortest path of at least 30
scenes with at least 14 votes and checks. Riftlight's twelve openers went from 2 to 15 predicted
minutes to 29 to 37 this way.

1. **Find the beat first.** The chapter ends on one sentence that must be true. Everything added
   is a task, discovery or consequence in service of it: a rope to anchor, a stranger to help, a
   thing to carry, a test to run. Never pad with narration or a repeat roll, and never fill with a
   run of strangers asking small favors (check 5).
2. **Build the spine, not detours.** New material goes on the path every party walks. Detours are
   a bonus on top.
3. **Keep every pinned id and promise.** Existing scene ids, the flags each ending sets, the
   route-set rules, and the continuity ledger's `entryFacts` and `entryByFlag` for the next
   chapter must still hold on every path. Retarget `goto`s through new scenes rather than
   deleting old ones; only remove scenes you wrote yourself, and the ledger entry with them.
4. **Failures reroute.** A failed roll or a missed interaction lands on a scene that shows its
   result and rejoins the spine. Keep party-wide damage to one or two nonlethal hits: more
   multiplies the path walker's states.
5. **Mind the walker's cap.** The ledger path walker stops at 5000 states. Every flag a scene
   sets that something reads doubles paths; set flags sparingly and drop ones nothing reads. If
   the cap trips, drop per-branch ledger facts before dropping real content.
6. **Check the clock.** The pacing model is uncalibrated (130 wpm, 40s a vote, 30s a check, 4s
   a scene): a path that predicts a little under 30 is not a reason to pad. Nothing here has
   been played at a table; say so in the PR.
7. **Set `estimatedMinutes` truthfully** and add the new scenes to the ledger, one entry each
   (`docs/campaigns/continental-rift/continuity.json` for Riftlight).

## Working in parallel

Several authors can lengthen different chapters at once (each in a git worktree), but:

- **Branch from the real tip.** A new worktree can start from a stale base and miss other
  people's cast-figure swaps, restructured scenes and rule changes. The first thing each author
  does is `git reset --hard <the working branch>` (nothing of theirs exists yet) or merges it in
  and ports what changed in their chapters (`git diff <old-base> <branch> -- <chapter>`). Merge a
  finished branch only after it contains the current tip.
- **One owner for shared files.** Authors each fixing the test walker, `continuity.mjs`,
  `cohesion.mjs` or `route-paths.mjs` for the same new scene type produce several slightly
  different fixes that conflict at merge. Land the shared fix once, first, or have the lead pick
  one version and delete the others' dead code (an unreachable second `else if` for the same
  prompt kind is the usual leftover).
- **Generated files belong to the lead.** Nobody in a worktree runs `npm run content:proofs`;
  the lead retakes the graph proof once, after merging, and commits it. A merge conflict in
  `content/graph-proofs/` is resolved by regenerating, not by hand.
- **Run the heavy suites serially.** On a shared, loaded machine use
  `npx vitest run <files> --no-file-parallelism --testTimeout=120000`; running everything at once
  makes unrelated tests time out. Never `pkill` another author's test run.
- **Give heavy walks explicit timeouts.** Vitest's default is 5 seconds, and a full-length chapter
  makes the route walks and name sweeps slower on CI than locally (2 to 4 seconds here, over 5 on
  CI). A test that walks whole chapters gets an explicit timeout argument (`}, 60_000);`), never
  a skip.
- **`npm install` rewrites `package-lock.json`** (it adds `"peer": true` lines); `git checkout
  package-lock.json` before committing unless the change is meant.

## Reporting findings

One finding per row, ranked by how much it hurts at the table:

| # | Scene | Quote | Check | Fix | Kind |
|---|---|---|---|---|---|
| 1 | `gemfall-05b/choice_elders` | "The Skywardens at Redspire Citadel" (label) | 1 | Say who they are in this scene's words; a Wild Road party never heard of them | wording |

- **Scene** is `chapter/scene_id`; **Quote** is the exact words (trim with ...); **Check** is
  1–8, or `setback`.
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

Before pushing any chapter edit: `npm run typecheck`, `npm test` (the content suites serially if the
machine is loaded), `content:validate`,
`content:continuity`, and the pacing before and after in the PR (#364's table is the model).
