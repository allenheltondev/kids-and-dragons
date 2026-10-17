# Riftlight opening: pacing playtest gate

**Status: not passed. No family timing observations have been recorded.**
The chapter minute fields are provisional budgets. A model estimate is not a measured session.
Do not mark opening pacing complete or promote these drafts into the production campaign until
the observations and decisions below are recorded. The wider bible targets 30–40 minutes per
ordinary node; the brief Riftseeker meeting is an intentional exception, not a length target.

## Run and observe

Run `npm run riftlight:preview` and use disposable preview characters. Have an adult observe
without steering the children's choices. Measure at least two family playthroughs: one without
a Starweaver, one with a Starweaver who can choose whether to share the reading. Take different
rescue and glacier approaches. Include a failed check, and let the children choose and explain
their own next investigation. Stop other dev servers first; stopping the preview deletes its
temporary saves, so keep it running if the table pauses between chapters.

Record each chapter separately, from its first scene to its ending, excluding meal/technical
breaks. Also record the combined session length, actual choices, dice failures, time spent
discussing choices, where a child proposed an idea, and any moment an adult had to explain an
unintroduced object or motivation. Use the blank observation file beside the draft chapters:
[`playtest-observations.json`](../../../content/drafts/riftlight/playtest-observations.json).
Keep its sessions list empty until someone actually plays; do not enter model predictions as
observations. Per-chapter measured rows can later be copied to `docs/review/playtest-timings.json`
using the existing timing template. The pacing CLI only reads shipped chapter paths today;
these draft estimates are computed from `pacingReport` against the drafts themselves.

## What the observer should check

| Beat | Evidence to record |
| --- | --- |
| Displaced barge landing | Can the children explain who needs help and what geography changed? Which rescue approach do they choose, and why? |
| Quay rescue | Do they notice the seller/pilot repaying their help? Does a failed roll still feel like a rescue? |
| Snow drift | Do they solve the route and kid-protection problem before the herder arrives? Does feedback distinguish probing, detouring and recovering from a bad step? |
| Singing seam | Do they predict, repeat or compare the note's effect? Do they understand that the ice is still shut? |
| Changed melt | Can they say why losing the grazing route matters to the herd? |
| Riftseekers | Can they distinguish Olivia's immediate help, Orin's safe passage, and Seren's listening without being lectured? |
| End of preview | Do they want to investigate the supply route or the glacier's openings? Record their reason in their own words. No playable fork is promised in this preview. |

## Decisions before the gate passes

- Attach at least two real observations with per-node times and engagement notes.
- Compare shortest and engaged runs against the 30–40-minute ordinary-node goal. If the first
  two nodes remain short, propose another consequential task or a changed outcome, play it,
  and remeasure. Do not pad narration or add repeat rolls simply to fill minutes.
- Keep the Riftseeker meeting short. Its single priority choice and practical lead should be
  remembered without an extended lesson on rifts.
- Record whether the author accepts the measured duration, needs another content pass, or
  explicitly changes the prologue's length goal. Shorter pacing must be a recorded design
  decision, rather than silently treating the minute metadata as finished.
- Resolve observed introduction/motivation gaps, update the continuity map, and rerun the
  content gate and path tests after revisions. Only then mark this gate passed with evidence.
