# Gemfall mini-game review, November 16, 2026

Gemfall contains 121 interactions across 16 playable chapters: 36 timing, 15 precision, four balance, four cooperative hauls, 15 sequences, 18 memory patterns, 12 tracking games, ten relays, and seven expressive scenes. The original precision renderer treated lifting a calf, rubbing a rune, and holding a hum as throws. A four-person timing game required twelve largely identical successes. Those were the main problems, rather than a need to make every game harder.

## What changes

| Situation | Read and act | Consequence and recovery |
| --- | --- | --- |
| Steady work | Find the support/contact point, then choose effort. Working off-center wastes effort. Pressing, tightening, lifting, and humming use their authored subject and handling presentation. | Too little stays short, too much strains, and a misplaced grip asks for a different correction. Successful work shifts the weight and passes the next move to a friend. Near misses leave less strain; recovery widens the safe range. |
| Timed work and crossing | Fit the entire move inside a readable opening. Authored work, water, wind, and watch settings distinguish pushing/pulling from crossing. | Each safe move changes the opening. A slip slows and widens recovery. Brief late openings are insufficient even if they look momentarily clear. Two to four shared stages replace the per-person quota. |
| Carrying | Players hold distinct ends; raising an end changes tilt. Ground height shifts between three steps. A prop supports the other end in solo play. | A poorly balanced step adds strain while preserving safe progress. Friends can correct either end before committing again. |
| Shared hauling | Choose effort for near/far ropes with different leverage. A friend's set effort changes the remaining share. Set efforts can be revised before everyone commits. | Under-effort leaves the load in place. Excess combined effort strains the cords. The weight changes after each safe move; a remaining player can finish a move after an unset phone disconnects. |
| Sequence | Share clues and test a complete arrangement. | Tests report how many parts respond, without revealing an exact correct prefix. Tests remain safe; committing the plan selects the authored outcome. |

Memory, tracking, relay, and free play keep their existing mechanics. Tracking still rewards following the actual swaps; expressive scenes still have no wrong answers. Existing painted subjects now replace unrelated reveal art in several tracking games. The calf and Pepper have explicit figure art; free-play scenes can show their authored recipient. Chapter warming includes these figures, even when a scene does not separately cast them.

## Save and client compatibility

Only a new Gemfall attempt started by a v4-capable phone uses these rules. Riftlight continues to negotiate v3. Active v1/v2 saves retain their controls and progression. A cached phone's older input switches the whole attempt back to compatible controls. Actual per-player completion credits survive that switch, including after a disconnect. Stale attempt/round input is rejected, and outcomes preserve the resolved actor.

The Gemfall play pins are deliberately retaken for the new timing durations/settings and handling metadata. Story exits, rewards, health costs, route flags, and the separate saved `resumeInteractions` snapshots are preserved. Stale cue recordings are removed so old spoken instructions cannot contradict the controls; updated cues use the existing speech fallback.

## Verification and reproduction

The engine matrix completes every authored scene with one, two, and four heroes, in ordinary and relaxed play, through its success branch. Additional cases exercise poor and near actions, failure/assistance branches, weighted compensation and revision, stale/invalid inputs, serialization, disconnects, and cached-client fallback. Existing Gemfall and Riftlight suites remain separate compatibility checks.

The browser checks drive real phone controls for slipping carries, compensated and excessive hauling, reloads, small screens, health charged only on continuation, earned flags/items, and a read-only TV. The hauling recovery layout is also checked at the largest text setting and with a wider fallback font. The TV uses a side-by-side action/feedback layout rather than allowing recovery text to push the subject out of its board.

All 121 active activities were captured with zero failed image URLs. Eleven representative browser flows reached their success result and story continuation: calf lifting, bark mending, humming, four-person climbing, wagon timing, water-tray carrying, four-person seal bracing, expressive play, tracking, shared route clues, and rune memory. The visual review caught stretched cargo and a TV backdrop stacking error; cargo now keeps its proportions, and the loaded game painting sits above the world background. These are running-browser observations, separate from the engine matrix.

With a local server running:

```powershell
$env:KAD_REVIEW_OUT='staging/playtests/gemfall-catalog'
npx tsx tools/playtest/riftlight-catalog-review.ts gemfall
$env:KAD_REVIEW_OUT='staging/playtests/gemfall-flows'
npx tsx tools/playtest/gemfall-review.ts
```

The catalog captures each active scene on a TV and two 320 x 640 phones and records failed images. The flow review captures complete representative activities, misses/reloads, recovery, results, and continuation. Both accept the existing playtest base/API environment variables; the flow review also accepts comma-separated scene IDs. Captures are ignored local artifacts, not committed artwork.

No new raster art or dependency is introduced. The measured payload is about 1892 KB, with a documented total allowance of 1894 KB; first paint stays at 336 KB with its cap unchanged. These checks establish mechanics, compatibility, and presentation coverage. They do not establish family enjoyment: anticipation, deliberate corrections, cooperation, and appetite for another turn still need an observed playtest.

November 17 review fixes restore Restart inside Help for active Gemfall games, including returning to readiness to select Relaxed play. Hauling guidance now hides its safe range when another connected hero has set zero effort and names the pull that needs revision; the range returns when that effort is corrected. The phone regression exercises both paths. After merging the Field Guide trivia feature from main, the combined payload measures 1916 KB against a 1919 KB allowance; first paint remains 336 KB.
