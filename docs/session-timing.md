# Family-session timing (#511)

`estimatedMinutes` is a planned figure and `npm run content:pacing` a synthetic prediction. Neither
says how long a family really sits. Session timing records that, from real play, so the chapters
that drag can be found and revised. It is off unless a deployment turns it on, and it keeps
nothing that names a child.

## What is recorded

Timing is derived from each run's event log, which already carries a server-stamped time on every
committed step. An event that opens, advances, pauses or ends a chapter also carries a small
`TimingNote` (`EventRecord.timing`), written in the same conditional commit as the state it
describes. So a lost race, a retried request, a second phone, a reload or a server restart cannot
leave a note without its step, or count a step twice.

| Note | When | Carries |
|---|---|---|
| `start` | the chapter's first playable scene is presented | chapter id, campaign id, **content revision**, party size, `prefaced`, `revisit`, `resumedFrom`, source, first scene |
| `step` | the open scene changed | scene id and type; `success`, `recovery` (a failed check, a lost or fled fight) or `assisted` (an interaction's assisted route) |
| `pause` / `resume` | the host's control | nothing |
| `off` / `on` | the host switches timing off or on for the room | nothing |
| `note` | the host types one short note | up to 140 characters, newest wins |
| `end` | the chapter finished | `success` or `setback`, and the road (route-set) flags carried |
| `close` / `stop` | the host closed the room, or stopped to save | nothing |

Never kept: names, chat, audio, device ids, or anything a child typed. The party size is a count.
A grown-up's note is free text, so the panel asks them to leave names out.

**The content revision** is a short hash of the chapter's JSON (`chapterRevision`). Any edit makes a
new revision, and the report never mixes two. `content:timing` marks which revision is the text on
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

## Attempts, revisits and resumes

A **sitting** is one chapter in one room. A stopped game picked up in another room is a chain of
sittings (`resumedFrom`) read as one **resumed** attempt. A chapter the household had already
finished is a **revisit**. A graph campaign's second visit to a place is a revisit too. Fresh
attempts, revisits and resumes are counted and reported apart; only completed **fresh** attempts
make the headline figure. The practice (`first-steps`) is never timed.

## Who keeps it

`HandlerDeps.timing` says whose play the clock is keeping, and **absent means nothing is recorded**,
which is what tests, the load tool and seeded playthroughs get. A synthetic run can therefore never
be labelled a family observation.

- Deployed Lambda: `family`, only when the stack parameter `SessionTiming=on` (`KAD_TIMING=on` when
  running `scripts/deploy.sh`). The default is off.
- Dev server: `playtest` by default (a developer's own runs); `KAD_TIMING=family` for a real family
  sitting at your machine; `KAD_TIMING=off` for none.

The report keeps `family` and `playtest` apart and `content:timing` prints playtests only with
`--include-playtest`, under their own heading.

## The host's controls

In the Room panel (`SessionClock`), host only, drawn only when the server is keeping time:
**Pause the clock / Resume the clock**, **Save note**, and **Don't keep time / Keep time again**.
Each is one committed change: pausing a paused clock writes nothing, two phones tapping at once are
ordered by seq, and every screen sees the pause in the same patch. At the end of a chapter the host's
screen says how long it took, and that it is not a score.

## Reading it

- `GET /api/timing`: JSON for the device's household (its 40 most recent runs): `sittings`, and
  `aggregates` per chapter and revision. `?format=csv` gives one row per sitting for a spreadsheet.
- `npm run content:timing -- <export.json> [--include-playtest] [--scenes N] [--json]`: per chapter and
  revision, the observed median and middle half of active minutes against the planned minutes and the
  30-minute budget, minutes by kind of play (story and choices, activities, fights), attempts by kind,
  and the longest scenes.

Observed numbers are never mixed with `estimatedMinutes` or `content:pacing`'s prediction. Every
figure carries its sample size: fewer than 3 completed fresh attempts is "too few to say anything",
fewer than 8 is "preliminary". The longest scenes are a reading list. Elapsed time does not show a
scene is dull or fun, and nothing here infers engagement.

## Retention and deletion

There is no shared analytics. The notes live on the run's event log, so they last exactly as long as
the household's runs do and go when the household is deleted (a guest household's seven days, an
owner's retention window, or "delete household"). Nothing is sent anywhere else. Before any
cross-household aggregation is built, it needs its own retention rule and a way to delete a
household's contribution; this feature does not decide that for it.

## Not covered

- There is no relaxed-play mode in the game, so none is recorded; assisted routes are.
- The time a family spends in a plate or recap is inside the first scene, flagged `prefaced`.
- The time between a `note` or a pause and "now" on a table that closes its tab is unknowable and is
  counted as idle or abandoned, never as play.
- Time is attributed to the scene that was open when the previous event happened. A step that does not
  change the scene (a vote tick, a ready toggle) is not an event of its own.
