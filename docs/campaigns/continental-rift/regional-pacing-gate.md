# Regional pacing and production gate

Updated 2026-10-19 with the northern continuation and the island due back; the earlier regional expansion followed the request to avoid short play sessions.

The earlier **short exploratory preview exception is superseded for the initial three regional nodes**.
`riftlight-stone-counters`, `riftlight-whale-road`, `riftlight-buried-bridge`,
`riftlight-the-wrong-valley`, `riftlight-reading-room`, and `riftlight-the-island-due-back` now aim to
be ordinary 30–40-minute story nodes. Each has 14 decisions and six or seven checks on its shortest
modeled route, with 42–44 scenes on the shortest route. Their 80–106 authored scenes include
alternative methods and success/failure consequences; a party does not read all of them.
The 35-minute metadata is a planning budget, not a measured claim.

## What changed

- Stone counters: compare ground and witness viewpoints, preserve uncertain eruption counts,
  get a water delivery around the moved boundary, test runoff and warnings, retrieve a slate,
  negotiate local upkeep, demonstrate the shrinking signal and choose a traveling record.
- Whale-road: map the broken approach, observe song and pulse timing, practice invitations,
  question Olivia's costs, establish wind warnings and waiting places, recover loose shelter
  gear, respect a whale's refusal and rehearse keeper handover before the opening decision.
- Buried bridge: honor the guide's boundary, test footing, record the untouched site, recover
  tools, compare silt, prepare a work site, choose an inspection limit, test the river inference,
  decide how to distribute evidence, restore the bank and hand over a usable local warning.

Failures change the immediate method or leave a corrected warning/record; none calls for
repeating the same roll. Contextual class/species methods assist existing tasks without
removing the task or requiring a particular hero. The shortest route includes the investigations
rather than skipping them for optional exploration. The chosen road-record priority and the
party's voluntary promise to share sky-route news persist as journey flags. The old Orin,
Olivia and whale consequences remain intact; the sealed door remains shut.

## Planning evidence, not observations

Reproduce the [machine-readable report](regional-pacing-estimates.json) with:

```sh
npx tsx tools/content/riftlight-pacing.ts
```

| Node | Default shortest lower estimate | Default typical estimate | Fast-table sensitivity |
| --- | ---: | ---: | ---: |
| Stone counters | 31.7 min | 32.1 min | 23.4 min |
| Whale-road | 31.3 min | 31.7 min | 23.1 min |
| Buried bridge | 31.3 min | 31.5 min | 23.1 min |
| The Wrong Valley | 34.0 min | 34.0 min | 25.2 min |
| The Reading Room | 33.8 min | 35.6 min | 25.1 min |
| The Island Due Back | 36.0 min | 39.0 min | 26.9 min |

The island's inference follows the player comparison. Two failure recovery choices
can bring a route to 47 scenes and 16 decisions with the same six checks.

The uncalibrated model budgets 130 spoken words/minute, 40 seconds/decision, 30/check and
4/scene. Shortest estimates use the lower narration bound, including the shorter later-Attune
variant. Sensitivity uses 160 words/minute, 25 seconds/decision, 20/check and 3/scene. A brisk
adult-led table can still finish sooner; neither estimate guarantees a family's elapsed time.
Regression tests guard the shortest modeled path, not just the metadata or branch count.
These content checks have passed; no family timing observation has been collected.

## Production gate — waived at publishing

The substantial expansion and static pacing checks are implemented, including the two northern nodes. The owner published
Riftlight before this gate was passed; these remain the checks to run at real tables:

1. Record at least two real family playthroughs covering all six nodes across sessions,
   including a party without a Starweaver. Cover both whale choices, both bridge inspections,
   sharing/withholding Orin's readings and first/later Attune. Include both valley crossing plans,
   a changed plan after failure, private/shared memory notes and the optional prior-Coast comparison.
   Cover both island rescue priorities, whale-dependent sightings, incomplete versus verified
   carving evidence, private/shared island records and warning/inspection message priority. Record elapsed and discussion
   minutes, engagement, confusion and desired changes in the [observation log](playtest-observations.json).
   Keep observations empty until actual play and exclude technical/meal breaks.
2. Compare shortest and engaged measured runs with the 30–40-minute target. If ordinary nodes
   remain too short, add a consequential task or changed outcome, then play and remeasure.
   If they drag, simplify work that repeats a decision. Never add narration or rerolls solely
   to fill time. The implemented interactions above are the current candidate, not acceptance.
3. Link the observations and explicit author decision here, resolve introduction or motivation
   gaps found at the table, and rerun content, continuity and pacing checks. Only then mark
   the regional gate passed. Any changed production length goal needs a named measured exception.

The [opening pacing gate](opening-playtest.md) remains separate and open. Development pause
endings are optional testing boundaries; they are not complete campaign endings or evidence
of full-campaign play length. The remaining strands and convergence are still being authored.
