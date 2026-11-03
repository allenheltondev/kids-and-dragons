# The Maps Come Together

The endgame's first chapter (`riftlight-convergence`), rewritten in November 2026 against
[arc.md](arc.md#endgame-every-party). Every party plays it, with two or three of the three key
pieces. The earlier version had no dice, 14 inert games, three echo votes and fifteen quoted
scenes: comparing sheets, weighing paper, passing gear.

**Beat.** The party has laid its pieces on Orin's map, seen they fit one old shape, and stood with
Bram, or with Olivia, when she tried her summoning. **Question** (the goal, said in scene 1):
*What do our pieces show when we put them together?* **Adds:** the p1 (`fit`): the old lines
match each other, not today's land; they are one old map, and someone is putting the land back
on purpose. Orin says only "whoever is moving the land". Manipulate is learned.

**Who carries it.** Orin and his big map from the departure; **Bram Lock** (`cast/bram_lock`),
introduced with his stake ("When she does, I need everyone behind this line. Will you help me
make it strong?"); Lady Olivia, greeted as the party parted from her (`olivia_trusted`,
`whales_guided`, or neither, for a party that skipped the Sky); Pip with his notebook, whose
"Lady Olivia says a real scout goes first" is tested twice; Seren, who teaches the lesson.

## Rhythm

| Movement | What the table does |
| --- | --- |
| The ledge (≈5 min) | Snow sliding uphill; help Bram stake his line (roll; a bigfoot just does it) or go and hear Olivia's plan first (the line comes out wiggly) |
| The pieces (≈8 min) | Tell Orin each learned piece in its own words (a missing piece is a question mark); trace the old lines (roll); **the fit**; Olivia: "Then somebody knows how!"; the chime drags your pack toward the deep ice (roll); Pip runs for the passage: chase him or call him back (roll) |
| Supper (≈4 min) | Rest; sit with Olivia (her reason: people losing their roads) or with Bram (two claps and a stomp means stop); tell Olivia to wait for Seren, or to go ahead |
| The summoning (≈8 min) | The opening's colors surprise her and it pulls; save Orin's map (timing game) or run to Olivia (the map tears); Bram's rope or Seren's edge if earned; **help Bram stop her or stand with her** (roll), or a way earned earlier; Pip mirrors you; a fish falls out (roll) |
| The lesson (≈5 min) | Manipulate: hold the chime still yourself, or teach Pip to (roll), or use a clean tracing; Orin draws the joining lines; what was lost comes home; the campaign question again |

## Consequences

| Choice | Immediate | Later |
| --- | --- | --- |
| Stake the line (pass) / hear Olivia first | A sharp line / a wiggly one, and Olivia's "I only want to ask" | "Trust Bram's rope" at the pull; "Remind her she only meant to ask" at the decision |
| Sit with Olivia / with Bram | Her reason / the stop signal | Her line at the decision / "Two claps and a stomp!" |
| Wait for Seren / go ahead | Seren ready / Olivia glad | "Let Seren hold its edge" at the pull / "Stay right beside her" at the decision |
| Save the map / run to Olivia | A game; a miss tears the map / the map tears for sure, and you are beside her | The torn corner comes home at the joining lines |
| Help Bram (or Orin, the signal, the reminder) / stand with Olivia (or beside her) | `helped_bram` and `pip_stayed_back`, or `olivia_continued` | The node's onComplete: trusted and stopped is redeemed, trusted and stood by is ally, untrusted is rival; the ending shows each |
| Trace well / roughly | Clean lines | "Use your tracing to find its edge" at the lesson |
| Hold the opening well / not | It folds shut / it stays, roped off | The ending reads it |

Failed rolls cost a wiggly line, a squashed supper, a scrape, Pip's notebook (it comes back), a
fishy map or an opening left for the watchers; none ends the chapter. Orin talking her down needs
`orin_chime_shared` and counts as helping Bram. Journey flags written: `helped_bram`,
`olivia_continued`, `pip_stayed_back`, `manipulate_learned`, as the contract says. Local flags are
cleared once their last reader is behind every party.

## Shape and pacing

| | Before (Nov 1) | After |
| --- | ---: | ---: |
| Reachable scenes | 46 | 48 |
| Dice checks | 0 | 10 |
| Fights | 0 | 0 |
| Games / inert | 17 / 14 | 1 / 0 |
| Echo votes | 3 | 0 |
| Scenes with a quoted line | 15 | 41 |
| Spine scenes / votes / checks | 26 / 4 / 0 | 30 / 7 / 7 |
| Spine words | 892–987 | 1,790–2,158 |
| Longest reading run | 3 | 3 |
| Predicted minutes (uncalibrated) | 12 | 26.8 |

Tests: [riftlight-final-play.test.ts](../../../tools/content/riftlight-final-play.test.ts) (route
matrices through the engine: pieces, history, every way to each side, every cost and its
readback, the node's Olivia status) and
[riftlight-convergence.test.ts](../../../tools/content/riftlight-convergence.test.ts) (the
convergence edges, every species and class shortcut, the p1, the contract flags, pacing). Family
timing remains unmeasured.
