# Gemfall: the final six encounter redesigns

The previous pass stopped after the foothill batch, PR #653. An audit of all 34 Gemfall encounter scenes found six without authored battlefield goals. This pass covers those six. It finishes that catalog pass; it does not establish that every fight meets the wagon benchmark or that children enjoy the pacing.

| Encounter | Read and decide | Consequence and recovery |
| --- | --- | --- |
| 03A river drakes | Hold the bargaining rock for two round ends, while watching the fixed tail-sweep ground. | Leaving danger costs a beat, but earned progress stays. Friends can hold, protect, interrupt or draw attention. Winning still earns the drake's rate; losing still sends the party downstream. |
| 03B marsh-step crabs | Work beside the drain stone for two hero turns; take the side route or risk the slippery middle step. | Stopping on the slippery step pushes a hero west without damage. Work already done stays saved. Drainage sends the crabs after their puddle; a miss still gets Gullet's rescue, without the whistle. |
| 07H warm-ground crabs | Defeat the crabs or take every standing friend around the cool edge, avoiding marked claw sweeps. | Each friend crosses separately. Remaining heroes still need room to follow; the masks arrive after six rounds. Both successful plans reach the bend, while losing keeps the existing robbed setback. |
| 07H echo hunters | One hunter commits a pulse; the other pursues. Hold Grandmother's pot for two round ends to drown them out. | Move clear, interrupt the pulse, or draw the pursuer away for a friend. A missed beat preserves the first. Losing still brings Grandmother's rescue, without her whistle. |
| 07L wagon crawlers | Work beside the box lid for two hero turns, while the crawlers pursue nearby heroes. | Drawing them away opens working room. Earned lid progress survives repositioning and reload. Winning retains the luckstone; delay retains the box rescue and missed reward. |
| 07R frightened wolves | Pull the cart into the pullout with two hero turns beside its wheel, or shoo the pack off. | Protect the worker or draw the wolves away. Partial work persists. Delay keeps the tipped-cart setback and missed caravan. |

All clocks take their existing defeat branch. Rewards, route choices, endings, and legacy save/arithmetic digests remain pinned. Objective effects set local completion flags before selecting narration, so an attack victory does not falsely report drainage or box work. Only the five intentionally changed chapter play pins move.

The encounters reuse painted locations, creature poses, and existing rock, pot, box, wheel, water and stepping-stone props. No new raster art, runtime mechanic, dependency or payload-budget increase is introduced.

## Verification

Rules tests exercise all six goals without attacking for one, two and four support heroes, plus unattended-goal outcomes. Dedicated tests check the slippery step's position cost and escape, and earned hold progress after retreat and JSON reload. The ordinary drake arithmetic probe explicitly retains its old ford map and non-windup enemy specs; its digest is unchanged.

The real phone/TV browser cases exercise each alternative ending, 320 px phones, 390 px phones at largest text, largest text on the shared display, and current committed threat cues where relevant. The marsh case deliberately takes the slippery step, reloads, and recovers. Screenshots and TV recordings are produced in `test-results/` by `e2e/combat-roadside.spec.ts`.

Final command results and captured evidence are recorded in the PR. Family observation is still needed for difficulty, anticipation, cooperation and pacing.

## Captured review

| Encounter | 320 px | Largest TV text | Ending | Recording |
| --- | --- | --- | --- | --- |
| River drakes | [Phone](https://assets.kd.readysetcloud.io/sha256/64/64aaa14b60415677d6f37e13511cfb483c5ed5ead00dbcff29ec16787760618b.png) | [TV](https://assets.kd.readysetcloud.io/sha256/12/1201ed74d4d2fc29ada35aa05e96c0dfd8bad9850141b4d281c92d59ec143598.png) | [Outcome](https://assets.kd.readysetcloud.io/sha256/0f/0f20fc6a05cd95596ee6a740f1376f96750a60b7f286cdf651950d7a71ca762f.png) | [Play](https://assets.kd.readysetcloud.io/sha256/c9/c9fc1370d25dc6a3faa705bc18d83ebefaeda36267df38fda70ef408bac1aff8.webm) |
| Marsh steps | [Phone](https://assets.kd.readysetcloud.io/sha256/d5/d5849124bd339568a1f36127def12fa9bdf9446dbd43634569510e69ac994261.png) | [TV](https://assets.kd.readysetcloud.io/sha256/8c/8c377fa8e4e091d0db5f577ef9183123587cc940a620e9776e69614fee305957.png) | [Outcome](https://assets.kd.readysetcloud.io/sha256/35/3530e170c4e5427f395127e7e96ecdc416cbfc9e7ee1a574de329486ba1abe59.png) | [Play](https://assets.kd.readysetcloud.io/sha256/33/3375bc22068a49c6ab6282000b18914ad5a649caa7caef6e48bb7dfb3ae9bca4.webm) |
| Warm ground | [Phone](https://assets.kd.readysetcloud.io/sha256/8d/8d69bb831a3ecec0e1d9d50137610a73755e924348ef57fdbce63e591ff3769b.png) | [TV](https://assets.kd.readysetcloud.io/sha256/6b/6b4cd9ceab1d34d3518090c6dfc8097695ecb01322b3c0ce013c23d1872d31c5.png) | [Outcome](https://assets.kd.readysetcloud.io/sha256/4b/4b39f3f5ab25610700c1f0b145a2dc8c486a1d3304b7431553fc2ef2cbe8b8ff.png) | [Play](https://assets.kd.readysetcloud.io/sha256/ca/ca3f5a149c93bfdbe472c88585effbc73a925e81fd05af9ece5a374c9bbdbacc.webm) |
| Echo hunters | [Phone](https://assets.kd.readysetcloud.io/sha256/96/963993e78d784d426c98d45bdaaf5235080e409fc9ef4d21de9c17250afc5fdc.png) | [TV](https://assets.kd.readysetcloud.io/sha256/34/34b297c1603d577da905817a022b71203f90ecc4fee220770dd6adb3d4f610a0.png) | [Outcome](https://assets.kd.readysetcloud.io/sha256/a2/a2c5e2e0d02fa19e3e864f2dc198f637d418b6f6b5220c856a02cb9ee37b3ccf.png) | [Play](https://assets.kd.readysetcloud.io/sha256/27/27fca4bfc7efe34175a90bcea20a61f93231b738b15296990825d95dba9bb7ae.webm) |
| Wagon crawlers | [Phone](https://assets.kd.readysetcloud.io/sha256/5c/5c384916c563a4849fbc16e4ba16e603989c6ea40e3f896651e6873fde4fb903.png) | [TV](https://assets.kd.readysetcloud.io/sha256/37/37578c6bd562d69780a29a06964172009022fee6b68e2fba2d4e6ac275193156.png) | [Outcome](https://assets.kd.readysetcloud.io/sha256/83/83395886104d6a0afbf73967694040cefdc03258f318203515874e70a66c7e1e.png) | [Play](https://assets.kd.readysetcloud.io/sha256/11/110eb5462be6418b2200f0709c32a4539e76b68a7329b6bafff0aab78536977e.webm) |
| Frightened wolves | [Phone](https://assets.kd.readysetcloud.io/sha256/47/47dd1d8dd408a856e5ba3722e3c95de5b4f1c26bf1fdfa65ab4288276c4db3cc.png) | [TV](https://assets.kd.readysetcloud.io/sha256/27/27fb951f345687c146f9f1f527928690d8ae206bea32979cdabcf09df07b3473.png) | [Outcome](https://assets.kd.readysetcloud.io/sha256/8b/8b005c4e45db668a2aae1dec4680fe6da78e74c2c14d212dc440df8fe481cdee.png) | [Play](https://assets.kd.readysetcloud.io/sha256/52/52652d349acab50be8efbb4e726833e3da91440522a1616f13f41451257d44ad.webm) |

The marsh capture includes [the slip and recovery](https://assets.kd.readysetcloud.io/sha256/26/2613d29343e8592fb870be6639c8ca7d4a7cfbdd0200103bcbecfccab493d423.png). The cool edge includes [the first friend past the crabs](https://assets.kd.readysetcloud.io/sha256/c9/c946bd433997b3e885b74cf0035d2867bc69b975c5e4c36de7a02a0332951d8f.png); its counter names the friends already safe. Recordings show the movement and outcomes; the stills include the final caption and layout polish.

The pot mission follows the existing mission layout rule that leaves out the repeated chapter goal. Mission panels also leave out the empty opening log line, keeping the turn, objective and threat prominent.

Final affected checks: 334 tests passed across rules, campaign playthroughs, legacy saves, authored environments and combat UI; a subsequent 30-test UI check passed after the caption/crossing changes. All six final browser cases passed together. Typecheck, content validation (218 passes, five warnings), continuity (zero new or stale findings), voice verification and the production-length build/bundle gate pass. Payload: 331 / 332 KB first paint and 1802 / 1802 KB total.

Windows recording/trace teardown stalled after reaching an outcome in earlier runs. The final functional run used tracing off and `KAD_COMBAT_VIDEO=off`; recordings were collected separately. Recording stays on by default. The full local unit run also reports failures outside this change; its final counts and the reproduced baseline asset-URL failure are detailed in the PR.

## Full-suite findings

`npm test -- --maxWorkers=2` completed: 11,666 passed, 33 failed, 27 skipped, plus two worker-start errors. The failures are outside the files edited here:

- 16 timeouts across camp art/layout, authoring examples, class-gated graph validation and Riftlight opening fights.
- 14 asset-store failures involving Windows file URLs and an upload-stamp assertion. The public-URL failure also reproduces in the original checkout.
- A Windows path-separator mismatch in MCP provenance, CRLF-sensitive resource parsing in the asset budget test, and a failed MCP-template suite setup.
- One painted-rift test initially lacked its original source painting. Pulling `art/` resolved it. That test and the player-panel suite whose worker failed both pass on rerun: 135 tests. The combat-panel worker failure is covered by the passing 334-test affected run.

The full run remains red; the focused and browser passes above do not replace that result. No fresh family timing or enjoyment observations were collected.
