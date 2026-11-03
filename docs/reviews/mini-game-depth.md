# Mini-game depth pass

The relay benchmark is now applied to the other eight interaction kinds. The intended audience remains a family table with children around eight: phone input, a read-only shared TV, forgiving recovery, and authored story consequences rather than repeated chores.

| Game | Read and act | Consequence and recovery |
| --- | --- | --- |
| Balance | Read the tilt and shared lift. Adjust individual lifting grips, then commit a careful step. The load shifts at each safe step. | A poor step accumulates slip according to its error. Safe steps remain reached, and steady carrying restores some footing. A fall uses the authored failure branch. |
| Cooperation | Read the changing effort target and draw the grip down to choose force. A committed effort changes the force the remaining friends need to supply. | Gentle under-pulls can be compensated by another friend. Insufficient support stays put; a jerk strains the support. Completed stages remain safe. Excess strain exposes the existing failure branch. |
| Precision | Read the moving prop's arc against a gold landing target. | A clean action finishes the authored task immediately. A graze allows an easier recovery than a wide miss. Repeated rough attempts lose footing and branch. |
| Timing | Read the visible opening and act when it clears. | Near misses permit correction; rough timing costs more footing. One clean crossing finishes the task. |
| Sequence | Share distributed clues. Arrange, drag, or keyboard-reorder the stones. Test any partial arrangement to operate the path. | The shared mechanism shows the last tested prefix that holds. Changing a verified prefix removes its confirmation. Testing is reversible; the final crossing commits success or failure. |
| Memory | Watch and hear the pattern, then rebuild the tune. | A broken tune retains the correctly remembered opening for one recovery. A repeated mistake takes the failure branch. Relaxed play keeps the pattern visible. |
| Tracking | Follow the existing painted shuffle, then lift a cover. | An empty cover stays raised and cannot be selected again. The remaining covers still permit a recovery; exhausting wrong choices takes the authored failure branch. |
| Free play | Choose what to contribute to the room's scene. | Contributions accumulate visibly by choice instead of replacing the previous reaction. There is no failure state. |

## Presentation and access

Chapter scenery now falls back to the chapter biome when a scene has no dedicated painting, including when an image fails. The practice meadow reuses existing painted props for its basket, stones, bell, gate, cups, and seeds. Balance and cooperation use actual party figures with the manipulated prop. The TV has a separate arrangement of the scene and status so the controls do not consume its action area.

Stationary aiming replaces moving timing under reduced motion. Strength sliders and buttons supplement the rope gesture and lifting grip. Sequence rearrangement supports touch and Alt + arrow keys. Gameplay changes remain authoritative on the server; input names the attempt and round, including balance adjustments, so a late move cannot affect the next load or pull.

## Compatibility and cost

Current phones request rules version 2 when starting an attempt. Already active saves retain their original controls. When an older phone sends a valid legacy control input during a v2 attempt, the server switches the entire attempt to v1 and announces the fallback on current phones and the TV. This also supports an older actor taking over after a disconnect. An explicit stale v2 round is still rejected. Fallback never grants completion; the original support and timing requirements still apply. Retry clears the challenge state, and a current phone's next start uses the new rules. Result continuation still applies the scene's original success, failure, or assisted branch; assistance remains available.

These seven views add approximately 16 KB of JavaScript across lazy game code. The total uncompressed payload budget moves from 1,462 to 1,470 KB for this feature; first paint remains capped at 328 KB. The reviewed build measures 1,470 KB total. No new runtime dependency or raster asset is required. Existing chapter warming already includes the reused biome and presentation props.

## Evaluation

Engine regressions cover clean actions, graded misses, recovery, team compensation, stale or duplicate inputs, disconnection, refresh, retries, relaxed rules, and branch application. Per-scene content drivers run the current rules at one, two, and four seats, including newly reachable balance and cooperation failure branches. Scripted full-route profiles explicitly retain preparation where their selected later choices require it.

Browser review exercises real phones and a TV, a short 390 × 640 phone, rope dragging, explicit strength controls, a recoverable slip, and refresh. Screenshots are evidence of layout and rendering, not proof that the games are fun. Family observation should still check whether children anticipate a change, deliberately adjust, help another player recover, and want another turn. The discrete balance steps are an intentional first pass; they do not simulate continuous physics.

## Review evidence

[Balance phone](mini-game-depth/balance-phone.png) · [Balance TV](mini-game-depth/balance-tv.png) · [Cooperation phone](mini-game-depth/cooperate-phone.png) · [Cooperation TV](mini-game-depth/cooperate-tv.png)

The full unit suite passed: 468 files and 9,622 tests, with 15 skipped. The final sequence-feedback regression passed, the final build and payload gate passed, and the live multi-phone/TV gesture and recovery test passed again after the screen review.


## Review corrections

Mixed-version balance and cooperation now have an explicit shared fallback, exercised with a current lead and pre-v2 wire inputs on a second live phone. The engine also covers actor handoff, invalid inputs, and the old completion control without awarding an unearned result. Reduced-motion memory retains its static pattern but observes the same study/unlock timer as ordinary non-relaxed playback; it never exposes inputs the server would reject as premature.
