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

Balance uses deliberate lift/lower taps, not device tilt or continuous physics.
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

## Family playtest

For each prototype, observe whether the child understands a one-sentence cue,
looks up at the shared world, and wants another turn. Try solo, two and four
players, relaxed play, interrupted holds, wrong paths, and a missed shot. Record
confusion, exclusion, and pacing as well as delight. This local harness cannot
test network behavior, private screens, or real TV focus.

Next slices: painted world feedback, hero ability benefits, synchronized TV-only
aiming, and family playtesting. Keep #493 open and decide which remaining ideas
merit additional reusable mechanics.
