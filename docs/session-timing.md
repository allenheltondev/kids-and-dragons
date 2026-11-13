# Family-session timing (#511)

`estimatedMinutes` is a planned figure and `npm run content:pacing` a synthetic prediction. Neither
says how long a family really sits. Session timing records that, from real play, so the chapters
that drag can be found and revised. It is off unless a deployment turns it on, and it keeps
nothing that names a child.

## What is recorded

A step that opens, advances, pauses or ends a chapter yields a small `TimingNote`. Once the step has
landed, the server writes it as a **mark** to a table of its own, `kad-timing-<stage>` (not the
game's): `PK = CH#<chapterId>`, `SK = <runId>#<seq>`, plus the server's time for that step and a TTL.
The key is the run and seq, so a retried write, a duplicate tap, a second phone, a reload or a
restart writes the same row and counts once. Only the server's clock is used.

The mark is written after the step commits, not inside it. A failed write is retried three times,
logged, and never fails the turn; the cost is a gap, not a wrong number (see "Not covered").

| Note | When | Carries |
|---|---|---|
| `start` | the chapter's first playable scene is presented | chapter id, campaign id, **content revision**, party size, `prefaced`, `revisit`, `resumedFrom`, source, first scene (and its mini-game kind, or `fighting` for a resume picked up mid-fight) |
| `step` | the open scene changed | scene id and type; `success`, `recovery` (a failed check, a lost or fled fight) or `assisted` (an interaction's assisted route); the mini-game kind when the new scene is one; how the fight ended (`victory`, `defeat`, `escaped`, `timedOut`) and in which round, when this step ended one |
| `game` | inside a mini-game: the acting hero pressed start (`play`), the result came out (`result`), or they went again (`retry`) | the scene, the attempt, `relaxed`, the outcome (`success`, `failure`, `assisted`) |
| `fight` | inside a fight: the board went up after the ready-up (`begin`), or a new round began (`round`) | the scene, the round; at `begin`, how many heroes and foes and the foes' content ids (`bogling`), never names |
| `pause` / `resume` | the host's control | nothing |
| `off` / `on` | the host switches timing off or on for the room | nothing |
| `note` | the host types one short note | up to 140 characters, newest wins |
| `end` | the chapter finished | `success` or `setback`, the road (route-set) flags carried, and how a fight ended if it ended the chapter |
| `close` / `stop` | the host closed the room, or stopped to save | nothing |

Never kept: names, chat, audio, device ids, or anything a child typed. The party size is a count.
A note is free text typed by the operator, so keep names out of it.

**The content revision** is a short hash of the chapter's whole JSON (`chapterRevision`), stamped on
every sitting when the chapter starts. Any edit to the story makes a new revision, a typo included,
and the report never mixes two; `content:timing` says which revision matches the file on disk and
which are older text. `content:timing` marks which revision is the text on
disk.

## The clock policy

1. The clock starts at the commit that presents the chapter's first playable scene. If the chapter
   opens on a plate or a "Last time" recap (`prefaced`), the server cannot see it dismissed, so that
   time sits in the first scene. It is flagged, not guessed.
2. Between two events, time is **active** up to 5 minutes (`IDLE_GAP_CAP_MS`); the rest is **idle**.
   A phone that went offline, a table that wandered off and a screen left open all look the same to
   the server, silence, and are reported as idle (`idleGaps` counts them), never guessed back into play.
3. The host's **pause** excludes everything until **resume** (`pausedMs`). Play is not blocked while
   paused; steps taken then are counted (`stepsWhilePaused`) but add no active time. Turning timing
   **off** excludes time the same way (`unrecordedMs`) and records no steps.
4. `wallMs = activeMs + idleMs + pausedMs + unrecordedMs`, always.
5. An unfinished sitting silent for 6 hours is `abandoned`; its last scene is not counted, since when
   the table left is unknowable. A closed room is `closed`; a stopped game is `saved`.
6. Times are read in seq order and never run backwards: a skewed clock reads as zero elapsed.
7. Only the server's clock is used. A client never reports a time.

## Mini-games and fights

A chapter's minutes are already split by kind of scene: story and choices, mini-games (interaction
scenes) and fights (encounter scenes). Since 2026-11-13 the server also marks what happens inside
them, so each visit is split by what the table was doing, under the same clock policy:

- **A mini-game** (`SittingSummary.games`): the **ready screen** (hearing the cue and getting ready,
  again after every retry), **play** (from the acting hero's start to the result) and the **result**
  (before going on or trying again); how many attempts, whether any was relaxed, and how it came out.
- **A fight** (`SittingSummary.fights`): the **ready-up** (every phone readying before the board goes
  up) and the **fight** itself; how many rounds, how many heroes and foes, and how it ended.

`packages/shared/src/play-timing.ts` groups visits by scene (and chapter revision, and source), by
kind of mini-game across every chapter, and over all fights. A visit counts when the table went on
from it, in a fresh or resumed sitting; revisits (the kids may know the answer) and visits a sitting
stopped inside are counted beside each row and kept out of its numbers.

Two things follow from the marks being events. A fight's rounds and a game's start and result now
break the silence, so a nine-minute fight with a round every two minutes is nine minutes of play,
where before this it read as five minutes of play and four of idle. And sittings recorded before
2026-11-13 have no game or fight rows; their minutes still count in the chapter's buckets.

## Findings

`timingFindings` (shared, `play-timing.ts`) turns a report into a ranked reading list: what crossed
which line, on what sample, and the first thing to try in the chapter's JSON. Only each chapter's
most recently played revision unless asked. Nothing on fewer than 3 visits; **look** on a
preliminary sample (3 to 7), **act** on 8 or more. The lines (`FINDING_THRESHOLDS`):

| Finding | When |
|---|---|
| `chapter_long` / `chapter_short` | the fresh median is over 1.25 or under 0.75 of the 30-minute budget |
| `scene_heavy` | one scene holds 15% or more of the chapter's median |
| `stalls_here` | in 2 or more, and a quarter, of completed fresh attempts the table went silent past the idle cap with this scene open |
| `left_here` | 2 or more unfinished attempts, and a fifth of all attempts, ended with this scene open |
| `game_long` | a mini-game's median play is over 4 minutes |
| `game_hard` | half or more of its visits failed or were assisted, or were retried |
| `game_slow_start` / `fight_slow_start` | the ready screen, or the ready-up, takes over 2 minutes at the median |
| `fight_long` | a fight's median is over 8 minutes, or over 6 rounds (rules §7.1 tunes a fight to about four) |
| `fight_hard` | half or more of its fights were lost or ran out of time |

A finding is a reason to read and play a scene, never proof that it is wrong: a lost fight may be
the road the chapter means, and bedtime falls somewhere.

## Where tables stall, who was seated, and kinds of screen

Three cuts of the same numbers, for judging a change to the screens rather than to one chapter:

- **Stalls.** Every silence past the idle cap is counted against the scene that was open
  (`SceneTiming.idleGaps`), and each scene of a chapter says in how many completed fresh attempts that
  happened (`SceneAggregate.stalls`). A table stuck on an unclear screen, a vote waiting on someone,
  and a dropped phone all look like this; so does a snack. The `stalls_here` finding says where it
  keeps happening.
- **Party size.** A chapter's completed fresh minutes by how many were seated
  (`ChapterAggregate.byPartySize`), and a fight's minutes and rounds by heroes on the board
  (`FightAggregate.byHeroes`): whether four at the table is slower than two.
- **Kinds of screen.** Every story scene, vote (`choice_point`), check, rest, mini-game and fight
  visit across all chapters (`aggregateSceneTypes`): minutes per visit, its share of all play, and how
  often the table stalled there. The figure a change to the vote screen or the dice is judged by.

## Trends and comparisons

`packages/shared/src/timing-trends.ts`:

- `timingTrends` buckets sittings by the Monday week (or day) they began: begun, finished, setbacks,
  left unfinished, completion rate, the median of completed fresh sittings, mini-game play and how
  often games were failed or assisted, fight minutes and rounds, silences per sitting and party sizes.
  Empty periods are kept, so a gap reads as a gap. It counts sittings, not households.
- `compareRevisions` puts one revision of a chapter beside another: its minutes, completion and
  setback rates, minutes by kind of play, every scene, game and fight side by side. It calls the
  chapter **shorter** or **longer** only on 3 or more completed fresh attempts a side whose middle
  halves no longer overlap; otherwise "no clear change" or "too few". Scenes are matched by id, and
  different families played each text, so a scene's change is a lead, not a measurement.

## Which revision is the current text

A sitting carries `chapterRevision`, a hash of the chapter **as the server loaded it** (enemies
resolved from the bestiary), not of the raw file. `content:timing` hashes the loaded chapters the
same way; before 2026-11-13 it hashed the raw file, and so called every chapter with a fight "an older
text". The MCP server has no content, so the build writes it an index of the chapters
(`infra/chapter-index.mjs`, `chapter-index.json` beside the MCP bundle): each chapter's current
revision, campaign and place in it, planned minutes, `content:pacing`'s uncalibrated prediction, and
its games and fights. Findings and every MCP tool read a chapter at its current revision when it has
been played, else at its most recently played one.

## Excluding a sitting

A sitting that is not a family's evening (a developer's test on the live site, a demo, an evening
broken by an outage) can be left out of every figure: `timing_exclude` on the MCP server
([mcp-server.md](mcp-server.md#timing)), undone by `timing_include`. It takes out the whole attempt
the sitting belongs to, so a resume never counts without the evening it picked up. Exclusions are
rows beside the marks (`PK = OPS#exclusions`), expire with them, and change no mark. The export,
`content:timing` and the MCP tools all honor them; the report lists them under `excluded`.

## Attempts, revisits and resumes

A **sitting** is one chapter in one room. A stopped game picked up in another room is a chain of
sittings (`resumedFrom`) read as one **resumed** attempt. A chapter the household had already
finished is a **revisit**. A graph campaign's second visit to a place is a revisit too. Attempts are chained
**before** they are grouped by content revision. A game stopped on one text of a chapter, the chapter
edited, and the game picked up on the new text is one **cross-revision** attempt: it belongs to no
revision's figures (neither text produced its duration), but its total time and fate are kept in the
report's `crossRevision` list, counted on each revision it touched, and printed by `content:timing`
under "Played across an edit". Fresh
attempts, revisits and resumes are counted and reported apart; only completed **fresh** attempts
make the headline figure. The practice (`first-steps`) is never timed.

## Who keeps it

`HandlerDeps.timing` says whose play the clock is keeping, and **absent means nothing is recorded**,
which is what tests, the load tool and seeded playthroughs get. A synthetic run can therefore never
be labelled a family observation.

- Deployed Lambda: `family`, **on by default**. The stack parameter `SessionTiming=off`
  (`KAD_TIMING=off scripts/deploy.sh`) records nothing.
- Dev server: `playtest` by default (a developer's own runs, kept in memory); `KAD_TIMING=family`
  for a real family sitting at your machine; `KAD_TIMING=off` for none. `GET /api/dev/timing` shows
  what that process has recorded; production has no such route and exports from its table instead.

The report keeps `family` and `playtest` apart and `content:timing` prints playtests only with
`--include-playtest`, under their own heading.

## Operator controls (not shown to players)

This is for operators: story-length validation, not something the table sees. **Nothing in the
client shows or asks for it**: no button, banner, note box or end-of-chapter summary on the TV or the
phones. The controls exist only as the host-authorised API, for an operator running a real sitting:

`POST /api/room/:code/timing` with `{ "action": "pause" | "resume" | "off" | "on" }` or
`{ "action": "note", "text": "..." }`, sent with the host device's token like the other host controls.
Each is one committed change: pausing a paused clock writes nothing, two calls at once are ordered by
seq, and play is never blocked. Pause is the way to keep a meal or a dead wifi out of the numbers;
`off` stops recording the room altogether. The pause flag is on the run state (`timingPaused`,
`timingOff`) as `quiet` is, so it rides the same patch, but nothing reads it for display.

## Reading it

- **From a deployed stack, with your AWS credentials** (the CLI's profile or environment):
  `npm run timing:export -- --stage prod --out timing.json`. It reads the stack's timing table only,
  never the game's: with `--chapter <id>` it is one query on that chapter's partition, without it a
  scan of a table that holds nothing but telemetry. It rebuilds every sitting with the same code the
  server uses and writes the report; `--csv` writes one row per sitting; `--table`/`--region`
  override. The rows hold no household, player or name. The IAM needed is read access to
  `kad-timing-<stage>` and nothing else.

- `npm run content:timing -- <export.json> [--include-playtest] [--scenes N] [--findings N] [--json]`: per chapter and
  revision, the observed median and middle half of active minutes against the planned minutes and the
  30-minute budget, minutes by kind of play (story and choices, activities, fights), attempts by kind,
  each mini-game and fight split as above, and the longest scenes; then every kind of mini-game and
  all fights rolled up across chapters, and the findings.

- **From an agent, over MCP**, with an `operator:read` key: `timing_overview`, `timing_findings`,
  `timing_chapter`, `timing_activities`, `timing_trends`, `timing_compare`, `timing_campaign` and
  `timing_sittings` answer the same report straight from the stack's timing table;
  `operator:write` adds `timing_exclude` and `timing_include`
  ([mcp-server.md](mcp-server.md#timing)). `timing:export` takes `--since <ISO>` to keep only sittings
  begun after a content deploy, as the tools do.

Observed numbers are never mixed with `estimatedMinutes` or `content:pacing`'s prediction. Every
figure carries its sample size: fewer than 3 completed fresh attempts is "too few to say anything",
fewer than 8 is "preliminary". The longest scenes are a reading list. Elapsed time does not show a
scene is dull or fun, and nothing here infers engagement.

## Retention and deletion

Marks expire 180 days after they are written (the table's TTL, `TIMING_RETENTION_DAYS`). They hold a
random run id, a chapter, a seq, a server time and a note, with **no household or player id**, so
deleting a household, a hero or a kid leaves nothing of theirs behind here and needs no hook. The
table is separate from the game's so an operator can be given read access to it alone, and so a heavy
export cannot compete with play. It is not retained on stack delete: it is telemetry and can be lost.
The MCP server's timing tools read the same table for an operator's agent, so their answers (counts,
minutes, scene and content ids, and the operator's own notes) go into that agent's model context;
the table holds nothing about a household for them to carry. Nothing is sent anywhere else. Any
cross-household analytics beyond this operator export needs its own retention decision first.

## Not covered

- There is no relaxed-play mode in the game, so none is recorded; assisted routes are.
- The time a family spends in a plate or recap is inside the first scene, flagged `prefaced`.
- The time between a `note` or a pause and "now" on a table that closes its tab is unknowable and is
  counted as idle or abandoned, never as play.
- A mark is written after its step commits, so a failed write (after retries) loses it: a missing step
  folds two scenes into one, a missing start drops the sitting, a missing end makes it read as
  abandoned. The loss is logged (`timing: lost a ... mark`). A sitting recorded before the table was
  deployed, or with timing off, is simply absent.
- Time is attributed to the scene that was open when the previous event happened. A step that does not
  change the scene (a vote tick, a ready toggle) is not an event of its own.
