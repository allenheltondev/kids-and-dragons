# Mini-game timing fairness (#566)

Story interactions (#493, the tactile games of #555 and #557) run on the TV and on every phone,
and the server decides every outcome. This page says, game by game, what timing can touch, how
each screen keeps time, what the simulated matrix showed, and what still needs real devices.

## Which games timing can touch

| Game | What the server scores | Can timing change it? |
| --- | --- | --- |
| Precision (aim) and timing (wait for NOW) | the position the acting phone sends with `stop` | Only through what the phone drew. Arrival time plays no part. |
| Team lift (`cooperate`) | an unbroken hold by every connected hero for `TEAM_HOLD_MS` (1.8 s) of server time, kept alive by 6 s leases renewed every 1.5 s | Yes, at the end of the lift (fixed, below). |
| Memory and tracking | the answer, refused until the pattern or shuffle has played (`playbackMs`, server time) | Only whether the phone shows the pattern at all (fixed, below). |
| Balance (lever drag), relay (catch and flick), play, sequence | levels, catches, passes, taps and answers, in the order they land | No. Each message is a turn or a step; none is scored on when it arrives. |

## Precision and timing

- **The phone sends where its marker was drawn, and the server scores that.** The engine checks
  the attempt (`openedSeq`, `attempt`), the phase and that the sender is the acting seat, then
  calls `precisionSuccess` on the sent position and keeps it as `stopPosition`, so the TV and a
  refreshed phone freeze the marker where it was hit. A stop that takes two seconds to land
  scores the same as one that takes twenty milliseconds.
- **The press counts, from the frame on screen.** The stop fires on pointer down (`KindControls`,
  shipped in #557), and since #566 it reads the marker from the frame that was drawn, on the
  same clock the board draws with. Before, it read this phone's own clock at the moment of the
  press: up to a frame later (0.033 of the track at 30 fps on a 2 s sweep, two thirds of a
  0.1-wide target's half-width) and, on a phone whose clock was off, nowhere near the marker on screen.
- **One stop per attempt per phone.** The button sends once, even from a second tap that lands
  before its first render disables it, and takes the tap back if the send fails. The server
  refuses any later stop for the attempt, and any stop from an attempt the party has restarted,
  however late it arrives.
- **The outcome stays the server's.** A phone chooses only a number between 0 and 1. The rule
  (target, width, relaxed widening), the attempt and the actor are the server's. A modified
  client could send a perfect position; that is the documented trust boundary (below).

## How each screen keeps time

The server stamps `startedAt` and, on every state it sends, `updatedAt`, both on its own clock.
Before #566 each screen read `Date.now() - startedAt`, its own clock against the server's. A
phone 5 s fast drew the marker half a sweep from the TV, played the GO stamp and the lamp's
ticks at the wrong moments, and skipped a 3 s memory pattern entirely (it was "already over"),
leaving the child to answer a pattern they never saw. A phone 5 s slow froze the marker at the
start and held the pads locked for five seconds after the TV had finished.

Now (`interactionStartLocal`, `serverClockGap`, `client/src/store/server-clock.ts`, `serverNow`
in `StoryInteraction.tsx`):

1. Every state that reaches a screen records `received - updatedAt`. The smallest of the last 16
   is the **clock gap**: this clock's offset from the server's plus its quickest delivery. One-way
   stamps cannot tell those two apart.
2. A gap between 0 and `CLOCK_TRUSTED_MS` (400 ms) could be only a delivery, so the clock is
   taken to be in step with the server's (the usual case for a phone or a TV on network time) and
   the sweep is read straight off it, as before.
3. A larger or negative gap means the clock is off; the gap stands in for its offset, and the
   screen runs late by at most its quickest delivery.
4. With no earlier states (a cold screen), `updatedAt - startedAt` says how far into the attempt
   this state was sent, so the screen is late only by this one delivery. The game never starts
   later than that, whatever the gap says.
5. The start is fixed per attempt on each screen, so a better gap arriving mid-sweep never makes
   the marker jump. A phone that rejoins mid-attempt picks the game up where it is.
6. The wall clock is read once per attempt, to align. From then on the attempt runs on the
   monotonic `performance.now()`, so a phone whose clock is reset mid-attempt (a network time
   update, a time zone change) neither skips a memory pattern nor jumps the marker
   (`story-interaction.test.tsx`, a 5 s reset back and a 3 s reset forward).

Everything that reads `now - startedAt` on the board uses this clock: the marker and its trail,
the lamp, the GO stamp, memory pads and their notes, the cup shuffle and its frame rate, and the
TV's room sounds. The team lift keeps its own clock (next section).

## Team lift

Each phone draws the lift from when the state that started it (`steadySince`) reached it, using
`performance.now()` (`useCooperationClock`), so it is never ahead of the server and never shows
full early. That clock is unchanged.

The defect was at the other end. The server finished a lift only when a hold renewal or the
lead's "complete" landed after 1.8 s. A child who let go the moment their bar looked full sent a
release that could land first; the release broke the hold and the lift started over, though the
team had held it for its whole time and every phone showed it full. Now any support message
(hold, prop or release) that lands after an unbroken full hold finishes the lift first. A release
before the hold is full still breaks it. Because a phone's bar is never ahead of the server, a
release sent when the bar is full always lands after the lift is complete.

## The matrix

`packages/shared/src/interaction-timing.test.ts` simulates a server, a TV and one, two or four
phones, each with its own clock skew, delivery delay, seeded jitter and frame rate, and plays
three specs through the real engine: precision 0.3 wide on a 4 s sweep, precision 0.1 wide on a
2 s sweep (the hardest), and timing 0.2 wide on a 3 s sweep. For every cell it checks:

- every phone draws the marker within a stated tolerance of the TV, cold and warm (tolerance:
  the difference between the two screens' lateness, plus a frame on each);
- the acting child, pressing on the first frame their phone draws inside the inner half of the
  target, succeeds whether the stop lands at once, after a jittered uplink, or a sweep and a half
  later;
- a second stop is refused and changes nothing, and no other seat can stop the marker.

It also pins the old raw clock's 5 s error, a mid-attempt rejoin, a stale-attempt stop, why the
press is scored rather than the release, and the team lift: with two and four seats and 20, 300
and 600 ms each way, a release sent when the lift looks full lifts it, and an early release
still breaks it. The six lift cases fail without the engine change.

`packages/client/src/screens/story-interaction.test.tsx` ("timing fairness across clocks, frames
and taps") checks the rendered TV and phone: markers agree on clocks 5 s and 250 ms fast or slow,
a rejoin, a fast clock with a quick earlier delivery, an in-step clock with a slow start, the
position sent from the frame drawn at 30, 60 and 120 fps with the finger landing between frames,
one stop from a double tap for precision and timing, and a memory pattern shown from its start
on a phone 5 s fast. Twelve of those fourteen fail against the code before #566; the two that
pass are the clocks already in step, where the old raw clock was right too.

### Observed: worst TV-to-phone marker gap

As a share of the track (1.0 is the whole track). "Raw" is the pre-#566 clock, "cold" a screen
with no earlier states, "warm" a screen with a clock gap from twelve earlier states, which is
what a table has by the time a mini-game opens. Precision 0.1 wide on a 2 s sweep; its target
half-width is 0.05, so a gap well under that is invisible in play.

| Cell | Seats | Raw | Cold | Warm |
| --- | --- | --- | --- | --- |
| One phone, quiet LAN (15 ms, 60 fps) | 1 | 0.000 | 0.004 | 0.000 |
| Slow cellular phone (300 ms ± 150) | 1 | 0.000 | 0.430 | 0.000 |
| Phone clock 300 ms fast (inside the trusted gap) | 2 | 0.300 | 0.029 | 0.300 |
| Phone clock 5 s fast | 2 | 1.000 | 0.029 | 0.040 |
| Phone clock 5 s slow | 2 | 1.000 | 0.029 | 0.040 |
| TV clock 90 s off | 2 | 1.000 | 0.015 | 0.031 |
| Old phone at 30 fps (120 ms ± 60) | 2 | 0.017 | 0.136 | 0.017 |
| 120 Hz phone, 30 Hz TV | 2 | 0.025 | 0.024 | 0.025 |
| Four phones: clocks −2 s to +30 s, 15 to 400 ms, 30 to 120 fps | 4 | 0.983 | 0.432 | 0.432 |
| Four phones, 250 ms ± 250 jitter | 4 | 0.000 | 0.438 | 0.000 |

The easier specs scale down with the sweep: on the 4 s, 0.3-wide precision the warm column's
worst is 0.201 (the four-phone mixed cell) and every other cell is 0.150 or less; on the 3 s
timing cell, 0.258 and 0.200.

In every cell, for all three specs, the acting child's press inside the target scored a success
however late the stop arrived. The marker the child sees and the position the server scores are
the same number.

## Supported limits

- **Precision and timing scoring:** exact. The scored position is the one drawn on the acting
  phone's frame when the finger went down. No latency, jitter, frame rate or skew changes it.
- **TV and phones agree** within a frame each plus the difference in their lateness:
  - clocks in step with the server: a frame each (under 0.03 of the track on the 2 s sweep);
  - a clock off by more than 400 ms either way: its quickest delivery in the last 16 states
    (on home broadband, tens of milliseconds);
  - a clock 0 to 400 ms fast that looks in step: up to that much (see below);
  - a screen that has seen no earlier states: this one delivery, until the next attempt.
- **Team lift:** a hold the server saw unbroken for 1.8 s succeeds, whichever message lands
  next. Holds survive up to 4.5 s of delivery trouble between renewals (6 s lease, 1.5 s renew).
- **Memory and tracking:** every screen plays the pattern at the server's pace. The answer
  unlocks 250 ms after the pattern ends on the phone's clock, so a phone up to 400 ms fast that
  looks in step can unlock up to 150 ms before the pattern ends on the server's. The server
  accepts an answer up to 400 ms early (`ANSWER_EARLY_MS`, the same as `CLOCK_TRUSTED_MS`), so a
  child who watched it all is never told to "watch the magic" again; anything earlier was given
  while the pattern was still playing and is refused.
- **Relaxed play** doubles a precision or timing target, and makes a team lift a tap-to-prop
  toggle. **Reduced motion** shows no moving marker, and the acting phone opens "Take a helping
  hand"; the assisted branch is authored and decided by the server like any other.

## Not fixed here (recorded, not implied solved)

- **A clock 0 to 400 ms fast hides inside the trusted gap.** One-way stamps cannot separate a
  slightly fast clock from a slow delivery. Such a screen is off by its skew, as it was before
  #566. Fixing it needs a round-trip clock exchange with the server (NTP-style), which the
  realtime channel does not carry today.
- **A screen whose quickest delivery is slow and whose clock is far off** stays late by that
  delivery (the 0.43 in the four-phone mixed cell is a phone 30 s off whose quickest delivery is
  400 ms). Also needs a round trip.
- **The team lift's bar runs behind** by the time it took the starting state to arrive, and a
  phone that joins mid-lift starts its bar from empty. Both are by design (never full early), so
  a team may hold a little past 1.8 s by their own eyes. Never unfair, sometimes slow.
- **The client chooses the stop position.** The server cannot see the phone's screen; a forged
  position is accepted. A server-side plausibility window would need the round-trip clock above to
  avoid refusing honest taps, and would still not stop a determined forger. Left as the documented
  trust boundary for a cooperative family game.
- **Display latency is not modelled.** The simulation and tests treat the last drawn frame as what
  the eye sees. Real panels add 10 to 100 ms (TVs in non-game picture modes the most), and
  touchscreens add their own sampling delay. Both act on the press the same way on every path, so
  they shift the TV against the phone rather than the score against the phone.
- **The simulation is not a device.** It cannot say how a given TV browser schedules frames,
  whether a backgrounded phone throttles `requestAnimationFrame`, or how a child actually holds a
  phone. Real-device spot checks could not be run from the container this was written in.

## Real-device spot checks (for the owner)

Run on a real TV and at least two real phones, one an older or low-power device. For each step,
note the devices, browsers and connection in the pass record.

1. Open a precision scene (`npm run play:jump -- --list` finds them) and start it. Film the TV and
   the acting phone together at 60 fps or more. Step through the video: the two markers should
   sit within about a twentieth of the track of each other.
2. Set one phone's clock 5 minutes fast by hand (automatic time off), rejoin, and repeat step 1.
   The markers should still agree, and the phone's marker should start moving the moment the
   start appears, not freeze.
3. With that phone still 5 minutes fast, play a memory scene. The phone should light the pads in
   step with the TV, from the first one.
4. On the acting phone, touch the marker as it crosses the gold. The frozen marker on the phone
   and on the TV should sit where it was touched.
5. Double-tap the aim button quickly. Exactly one result should appear.
6. With two phones, play a team lift. Both children hold, and one lets go the instant their bar
   is full. The lift should succeed. Repeat with one phone on cellular, Wi-Fi off.
7. Turn the acting phone's screen off mid-sweep, wait five seconds, turn it on. The marker should
   resume in step with the TV; no stop should have been sent.
8. Turn on reduced motion on the acting phone (system setting or the game's), open a timing scene,
   and finish it with "Take a helping hand".
9. With four phones seated, disconnect the acting phone mid-sweep. The next seat should be able to
   stop the marker, and its marker should be in step with the TV.
