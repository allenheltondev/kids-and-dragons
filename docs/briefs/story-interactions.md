# Story interactions — #493

Status: nine reusable mechanics implemented as authored `interaction` scenes.
The original local playground remains available for quick experiments. Family
playtesting and richer visual feedback remain outstanding.

## Play them in the adventure

Start the Practice Meadow and choose **Try Tansy’s team tricks** at the picnic.
Tansy, Flick, and Bun demonstrate a precision toss, cooperative support, and a
shared sequence puzzle. The same controls render on actual phones and the TV,
through the authoritative engine, state persistence, and ordinary patch stream.
No campaign needs custom UI code to reuse a mechanic with different cast or text.

See [the authoring guide](../../content/README.md#story-interactions) for complete
fields and examples. Supported kinds are `precision`, `cooperate`, `sequence`,
`tracking`, `memory`, `timing`, `balance`, `relay`, and `play`.
Each scene supplies narration, optional art/cast, cues, action labels, and authored
`onSuccess`, `onFailure`, and optional `onAssisted` branches.

**Try more meadow games** at the picnic opens an optional catalog. Follow Flick
under cups; echo his symbol greeting; sneak past Tansy; balance a basket; pass
starlight; or choose a playful scene. Feeding Bun, building camp, celebrating,
and waking a stump all reuse `play`, with different authored options and reactions.

Tracking uses authored position swaps and a reveal/playback/answer flow. Normal
memory and tracking answers cannot be submitted before the server’s playback
ends. Relaxed tracking reveals the final cover; relaxed memory keeps the pattern
visible and allows an immediate answer. Replay is a fresh attempt.

Balance uses deliberate lift/lower taps or a drag lever, not device tilt or continuous physics.
The shared marker follows the team's average lift, and everyone must contribute.
Different amounts can succeed together (for example, a quarter lift and a three-quarter
lift). The final adjustment resolves success without a separate finish tap. A drag
sends its whole notch count in one bounded intent so it cannot finish halfway through
and then leave extra adjustments queued.

Cooperation gives every connected hero the same job: hold together until the object
reaches the star. The server records when this exact team began a continuous hold;
after 1.8 seconds a support renewal or the lead phone's automatic completion resolves
success. Release, expired leases and a changed connected team reset progress. Solo and
relaxed players tap a prop instead of maintaining pressure. Results still wait for an
explicit continue before applying the authored story branch.

Relay is an untimed catch/pass chain. Catch ownership follows the current player;
disconnecting after a catch cannot give the next receiver an already-caught spark.
Playful reactions remain shared text with the existing cast backdrop. Painted
interaction props are authored under `chapter.presentation.interactions`, keyed
by interaction scene id. Each entry's `props` array selects registered story
props for the shared renderer. Tracking scenes may also provide `coverIcons`,
one registered story prop per cover. The validator checks scene keys, IDs,
image files, and cover counts, and the existing chapter warmer derives the
required image URLs from these declarations. `fights` and `warmUrls` can be
omitted when unused. Pictures are decorative and never replace labels or status
words. If an image fails at runtime, a visible neutral cover remains. Tracking
covers keep the hidden answer concealed while they move, including when custom
visuals are present. `content/chapters/first-steps-01.json` demonstrates a
cooperative branch prop on a non-Riftlight chapter.

Results remain visible until a player continues. Branch effects apply exactly
once on continuing. The acting hero may retry without spending resources. Every
scene offers an untimed helping hand, using `onAssisted` or `onSuccess`.

## Jump to any game

`npm run play:jump -- <chapter> <scene>` seats a TV and phones at any scene of any
chapter and writes one composite PNG of every screen to `test-results/playtest/`.
`--start` taps "We’re ready" and shoots the game running; `--record 2000` captures
every painted frame for two seconds as a strip of composites; `--open` leaves visible
browsers up to play by hand. `--list riftlight-stuttering-flats` lists a chapter's
scenes with each game's kind and cue. The start is a dev-server playtest start
(`chapterId` on `POST /api/dev/seed`): out of campaign order, unlocked, with any
`--flag` and `--fact`, and it settles nothing into a saved journey. Scripts can use
`openTable()` from `tools/playtest/table.ts` directly to drive the phones.

## Try the prototypes

Run `npm run dev:client` and open `http://localhost:5173/interactions.html`.
The separate development entry renders a shared world above simulated phone
controllers. It has no server, persistence, or real multi-device synchronization.
It is absent from production build inputs and guarded by `import.meta.env.DEV`.
This standalone harness is separate from the integrated Practice Meadow path.

Choose one to four players and try all three interactions. For the gate, use
multiple fingers on a touchscreen, or enable relaxed play to latch supports on
a desktop. Solo play always uses a prop. Losing focus releases active holds and
stops aiming; start a fresh attempt when returning.

## First three authored moments

### Land the shot — the sleeping moss giant

“Tap when your hook reaches the gold.” Start aiming explicitly, then stop a
continuously repeating marker. There is no countdown or automatic failure.
Success retrieves a key quietly; a miss tickles the giant, who offers the key
for a joke. Both continue the adventure. Relaxed play widens the target; asking
a friend for help offers an untimed authored success instead. One player acts
at a time in this prototype; passing turns and character bonuses remain future
work. Proposed Quick benefit: wider target, never a requirement to participate.

### Hold the way open — roots around a fox

“Hold the roots apart while your friend brings the fox through.” All but the
last seat support roots; the last rescues. The action becomes available while
all supports are active. Solo and relaxed play prop roots in place. Releasing
does not hurt the fox or consume progress. A later authored scene can rotate
roles; this prototype lets families switch simulated controllers on replay.
Proposed Might benefit: one hero supports an extra root when a helper needs a
break. Do not require strength or simultaneous touch from every family member.

### Everybody has a clue — the animal bridge

“Share your clues, then choose three stones in order.” All clues are distributed
across seats, with multiple clues per seat for smaller parties. A fourth seat
helps assemble the path. Solo sees every clue. Wrong paths return the party to
the bank and allow unlimited retries. There is no speed or scoring component.
Proposed Clever benefit: reveal a helpful ordering hint on request.

## Runtime behavior and remaining limits

- Ordinary story choices stay untimed. Precision is a separate, explicitly
  started skill phase with repeatable motion, assistance, and no deadline. This
  is the owner-approved extension recorded in spec §11.
- Cooperative clues extend spec §2.2: everyone is encouraged to share, with no
  secrets or competing objectives. Every phone has a “share all clues” alternative.
  Full clues and the solution are in authored chapter data; this is not a secrecy
  or anti-cheating feature. Clues redistribute among the original connected seats.
- Authored interaction results choose story branches directly;
  avoid scoring performance and then adding a roll that can negate it. Existing
  heave/hum/tiptoe checks keep their current dice semantics. Character benefits
  should make tasks easier, with an accessible route for every party. Stat bonuses
  are future work; the three current mechanics do not consume or roll stats.
- Completed results live in authoritative room state. TV remains display-only;
  phones send intents and the server validates participation and phase identity.
  Holds use six-second server leases renewed every 1.5 seconds, and completion
  checks the leases again. Props remain until released. A lost release cannot
  preserve an abandoned hold indefinitely. Hold renewals use persisted intents;
  measure write volume before increasing group size or frequency.
- Precision scores the marker displayed on the acting phone, so network arrival
  delay does not determine success. The phone reports a bounded position and the
  engine evaluates it. A modified client can forge timing; this is a cooperative
  family mechanic. TV and phone clocks can differ, so the phone marker is the
  reference. Accurate TV-only aiming still needs clock synchronization and real
  device latency testing.
- On reconnect, completed outcomes persist. Active precision keeps its repeating
  marker; the acting hero can explicitly restart it. An absent actor is replaced
  by the first connected hero. Holds expire and solo players can prop the way.
- Travel precision shows the marker beside its button. Props allow a player to
  change views while supporting the way. Reduced-motion devices offer assistance
  without rendering the aiming animation.

## The game board (first family playtest)

The first family to play a chapter built on these mechanics (the goat rescue on
the Stuttering Flats) came away confused: the game was a small bordered widget
under the narration on both screens, the authored cue read like a manual
("Test while the whole-landing interval is clear"), every phone offered
"Take a helping hand" with no word about what it did, and nothing said whose
phone mattered or whether to look at the TV or the phone.

An interaction is now the whole screen, framed the same way everywhere
(`StoryInteraction.tsx`, `InteractionExtras.tsx`, `interaction-copy.ts`):

- **A name for the game** in kid words, from the kind (`Hit the gold`,
  `Wait for NOW`, `Copy the pattern`, `Share the clues`, `Follow the glow`,
  `Hold it level`, `Pass it along`, `All together`, `Everyone joins in`), then
  the authored cue. Before anyone starts, the board says how the game is played
  in one breath.
- **The board** fills the TV's plate and the phone's pane: the painted props
  and heroes, and the kind's own picture (a sliding marker with a gold stretch,
  a lamp that says Wait… / NOW!, the pattern tile by tile with progress dots,
  numbered answer slots, this phone's clue, a gauge per hero for balance, a
  row of hero faces for relays and holds, speech bubbles for play).
- **One line that says who does what, on which phone.** The TV reads
  `Aster: when the lamp says NOW!, tap "Ring the chime" on your phone.` A
  phone reads its own job, with a TV or phone icon for where to look:
  `Press and hold until Aster is done.` The lead follows the connected
  actor the engine already picks; nothing is asked of a phone that is away.
- **Help is one fold, explained.** `Stuck? Get help` holds Relaxed play and
  the helping hand, each with a sentence saying what it does. The helping hand
  is still offered on every phone (a parent can take it for a child), and it
  opens by itself on a phone that cannot aim under reduced motion.

Authored cues should still be plain: name the thing and the moment ("Ring the
chime when the whole snowy landing shows"), never the mechanic's vocabulary.
The Stuttering Flats cues and labels were rewritten this way. Authored scene fields
remain the same; the teamwork behavior described above is enforced by the engine.

## Play, not forms

Each kind is played with the hands. A balance adjustment may carry a bounded notch
count; cooperation stores the shared hold start time for synchronized feedback:

- **Precision** makes the moving-object board itself the large touch surface. The
  marker leaves a short trail and freezes at the finger-down position on every screen,
  including after refresh. The start badge stays out of the aiming path.
- **Timing**: the authored prop sits inside the tappable lamp. Its ring fills as NOW
  comes, and the finger-down moment remains frozen on both the phone and TV. Keyboard
  activation remains available for both aiming games.
- **Memory and sequence** are coloured pads, Simon-style. The TV lights each pad and
  plays its note as the pattern runs; the same phone pads stay in place when answering
  unlocks. Chosen tiles can be touched to remove a mistaken step. Submitted orders stay
  visible on the result screen, including the TV.
- **Relay**: one prop travels between the heroes' hand positions on the TV. The
  receiving phone is a pair of hands: touching the object catches it, and an upward
  drag moves both hands and object. Release to send it; short, sideways and canceled
  drags settle back. A tap also sends, and optional buttons live in a small fold.
  There is no separate decorative relay scene. A failed send returns the object to
  the hands for another try. The last flight lands before the success sound, stamp
  and Continue appear; reduced motion skips that animation delay.
- **Balance** is a shared load with one marker to bring into the gold. Each hero drags
  a lever or taps lift/lower; the team can contribute different amounts.
- **Cooperate**: everyone presses the object itself and the load rises to a star
  inside that hold surface. The TV has the same single object. Progress and the finish
  come from the shared server state. No extra decorative lift competes with it.
- **Tracking**: touch the actual cover after shuffling. It lifts to reveal the chosen
  position and the correct hiding place on every screen. The painted cover identities
  and positional answers remain aligned after swaps.
- **Play** picks fly off as stickers; each bubble shows who did it, and the chosen
  card stays visibly selected. A single-action prop, when authored, is the touch target.
- Every game opens with GO! (patterns excepted) and ends on a stamped word.

The TV voices the room with new cues (`pad-1` to `pad-4`, `catch`, `whoosh`,
`tick`), synthesized until recorded files exist. Phones answer their own taps with
short vibrations. All motion and vibration stop under reduced motion.

## Family playtest

For each prototype, observe whether the child understands a one-sentence cue,
looks up at the shared world, and wants another turn. Try solo, two and four
players, relaxed play, interrupted holds, wrong paths, and a missed shot. Record
confusion, exclusion, and pacing as well as delight. This local harness cannot
test network behavior, private screens, or real TV focus.

Next slices: painted world feedback, hero ability benefits, synchronized TV-only
aiming, and family playtesting. Keep #493 open and decide which remaining ideas
merit additional reusable mechanics.
