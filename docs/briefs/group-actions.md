# Brief: group actions on phones (everyone heaves together)

**Status: design, awaiting the owner (#360, part of #354).** Nothing here is
built. This brief answers the questions in #360 against the code as it stands
on `main` (c847b1b). File and line references are to that tree.

**The idea in one sentence.** Some checks become a short shared physical moment:
every phone shows a big pad, each kid presses it to grab hold (the TV shows their
hands on the rope) and lets go to heave. The release *is* that kid's roll. The dice,
the outcome and the narration are exactly what they are today.

**The design in one sentence.** A check with `roller: "all"` may add
`"together": "heave" | "hum" | "tiptoe"`. The phone swaps its Roll! button for a
press-and-release pad, and the press travels as a live-only preview that never
touches the state, the seq or the dice.

---

## 1. What the controls support today

The phones only take taps.

| Capability | Today | Where |
|---|---|---|
| Tap a button | Everything: choices, Do it!, Roll!, Help, combat | `screens/PlayerPanel.tsx` |
| Press and hold | Only to *show help* on a card, buff or item (500 ms). It never sends an intent. | `help/longpress.ts:24-29`, opt-in through `helpAttrs()` |
| Swipe | None. Drag and pinch exist only on the world canvas (pan and zoom). | `world/scene.ts:916-974` |
| Device motion / tilt | None anywhere in `packages/client/src` | |
| Vibration | An 8 ms tick on any tap. Skipped under reduced motion; iOS Safari has none. | `ui/PhoneMagic.tsx:28-34` |
| Timers on decisions | None, by rule: "There is no timer anywhere in this file, and there never will be." | `PlayerPanel.tsx:8-15`, spec §11 |

**How a check runs today.**

- **Who rolls.** A check is a whole scene (`CheckScene`, `packages/shared/src/types/chapter.ts:275-307`).
  `roller` picks who rolls: `party` (fewest checks so far), `active`, `best`, or `all`.
- **The prompt.** Entering the scene opens a `kind: "roll"` prompt (`engine.ts:836-862`).
- **Rolling.** The nominee's phone shows **Roll!** and sends `{ type: "ROLL" }` (`PlayerPanel.tsx:1232-1239`).
  The server rolls d20 + stat against `tn` (`engine.ts:1964-2022`).
- **The TV.** It animates the die from the `ROLL` presentation (`screens/DiceOverlay.tsx`).
- **Group checks already exist** (`roller: "all"`).
  - Every standing, connected hero is in `prompt.group.pending` (`engine.ts:837-847`).
  - Each of them taps their own Roll!. Each tap is its own `ROLL` intent and its own die (`doGroupRoll`, `engine.ts:1876-1934`).
  - Half or more succeeding carries the party.
  - The phone says "Everyone rolls! Half or more need to make it." (`PlayerPanel.tsx:1180-1185`).
  - Help is refused on a group check (`engine.ts:1949`).
- **The TV never acts.** A display client "sends nothing, ever" (`client/src/store/index.ts:1123`).
- **There is a live-only lane** for things that are not state.
  - **The lane.** A preview (`IntentPreview`, `protocol.ts:355-399`) is posted to `/api/preview`
    and relayed straight to the room by `handlers/preview.ts`.
  - **Never committed.** It is never logged, never replayed, and never moves the seq.
  - **What it is used for today.** The TV uses it to light up a half-made choice, a tile or an ability.
  - **Context.** `previewContext()` (`shared/src/preview.ts:106-129`) names the decision a preview
    belongs to, so a stale one fades by itself. Today it knows fights and choice prompts, and returns
    `null` for a roll prompt.

So nearly every piece a group action needs is already in place. The roll-per-kid
mechanic is `roller: "all"`, and the "show the table what I'm doing right now without
committing it" mechanic is the preview channel. What is missing is a gesture, a
TV picture, and one preview kind.

## 2. How a check opts in

### 2.1 The data shape

One optional field on the check scene, and a copy of it on the roll prompt.

```jsonc
// content/chapters/gemfall-03b.json, scenes
"check_cart_push": {
  "type": "check",
  "stat": "might",
  "tn": 12,
  "prompt": "Push a sausage cart out of marsh mud",
  "roller": "all",
  "together": "heave",            // new, optional
  "onSuccess": { ... },           // unchanged
  "onFailure": { ... }            // unchanged
}
```

```ts
// packages/shared/src/types/chapter.ts (the contract)
/**
 * How the party makes this check on the phones: press to grab hold, release
 * to do it. Presentation only. The roll, the branches and who rolls are as
 * if it were absent. Only on `roller: "all"`, where every release is a die.
 */
export type TogetherMove = "heave" | "hum" | "tiptoe";

export interface CheckScene {
  // ...every field as today...
  together?: TogetherMove;
}

// packages/shared/src/types/state.ts, Prompt kind "roll"
  /** The scene's `together`, copied when the prompt opens, so phones and TV can draw it. */
  together?: TogetherMove;
```

```ts
// packages/shared/src/types/protocol.ts, one new IntentPreview member
  | { kind: "grip" }          // this player's finger is on the pad
// a release sends the real ROLL; a cancel sends the usual `preview: null`
```

```ts
// packages/shared/src/preview.ts, previewContext() gains one branch
if (prompt?.kind === "roll" && prompt.together) {
  return ["roll", state.chapterId ?? "-", state.visited?.length ?? 0, prompt.sceneId].join(":");
}
```

The context deliberately leaves out `group.rolls.length`, so one kid's roll
landing does not blank the hands of the kids still holding on.

**Why a closed set of moves and not free text.**

- **Each move is a gesture, a picture and a line of copy, and all three are built.**
  An author picks one; they never write one.
- **Copy lives in the client.** It sits next to "Everyone rolls!" and stays under the
  no-AI rule (#347). Every line is authored once.

| `together` | Pad label | Press means | Release means | TV picture | Good for |
|---|---|---|---|---|---|
| `heave` | "Grab on!" then "HEAVE!" | hands on the rope or cart | the pull | a rope or cart with a hand per hero | carts, ropes, wagons, gates |
| `hum` | "Hum..." then "Let it go" | your voice joins the note | the note ends | a wavy line per hero, lining up | humming, singing, holding a note |
| `tiptoe` | "Hold still..." then "Over!" | you're crouched, holding your breath | the hop over | footprints per hero, tiptoe | climbing quietly, sneaking past |

`push`, `row` and `steady` were considered and folded into `heave`. A fourth move
is a client change and a schema enum entry, never a content-only change.

### 2.2 Why it is "a field on the check, never a new outcome path"

- **The branches don't change.** `together` adds no branch, no effect, no gate and no flag.
  `onSuccess` and `onFailure` are untouched, so `content:validate`, `content:graph` and
  `content:pacing` see the same graph.
- **The engine reads it in one place.** `openScenePrompt`'s `roller === "all"` case
  copies it onto the prompt: `...(scene.together ? { together: scene.together } : {})`.
  `doGroupRoll`, `doRoll`, `resolveCheck` and `takeBranch` never look at it.
- **Taking the field off leaves the same check.** Removing `together` from a chapter
  gives a check that plays identically, with a plain Roll! button.

### 2.3 Validation (`schemas/chapter.schema.json`, `tools/content/validate.mjs`)

- **Schema.** `$defs.checkScene` has `additionalProperties: false` (:1014), so it gains
  `"together": { "enum": ["heave", "hum", "tiptoe"] }`.
- **Validator error: `together` requires `roller: "all"`.** A single-roller check has one die
  and one tapper, so the other kids' presses would be theatre (see Decision 1).
- **Validator warning: no chapter over-uses it.** More than two `together` checks on any one
  path through a chapter is a warning, because the gesture should stay special.
- **Hints that say "tap Roll" are wrong** on an opted-in check (`first-steps-01`'s `check_climb`
  says exactly that). A `hint` that says "Roll" on a `together` check is a validator error.
  - This is a plain substring test on the hint's text.
  - The fix is in the prose: "Press and hold the big button, then let go."

## 3. What it looks like

### 3.1 The phone (Party Mode), `heave`

Before anyone presses:

```
┌──────────────────────────────┐
│ 🎲 Push a sausage cart out   │
│    of marsh mud              │
│ 💪 might · Tricky            │
│ 👥 Everyone heaves! Half or  │
│    more need to make it.     │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │      ✋  Grab on!       │  │   the pad: full width, at least
│  │                        │  │   2 × --kad-touch-min tall,
│  │  press and hold, then  │  │   under the thumb
│  │       let go           │  │
│  └────────────────────────┘  │
│  ✋ Mia  ✋ Theo  ·  Posy     │   who is holding on right now
└──────────────────────────────┘
```

While this kid's finger is down:

```
│  ┌────────────────────────┐  │
│  │ ░░░░░░░░░░░░░░░░░░░░░░ │  │   the pad fills (static under
│  │      💪  HEAVE!         │  │   reduced motion); one short
│  │     let go to pull     │  │   buzz on press
│  └────────────────────────┘  │
│  ✋ Mia  ✋ Theo  ✋ you      │
```

After this kid's roll has landed, while others are still to go:

```
│  ✅ You heaved! (14)          │
│  Waiting for Posy's hands... │
│  ✋ Mia ✅  ✋ Theo ✅  · Posy │
```

The pad is the Roll! button, re-dressed.

- **It is still a `<button>`.** Its `onClick` sends the same `dispatch({ type: "ROLL" })`.
- **Press and release are layered on top:**
  - `pointerdown` sends `preview({ kind: "grip" })`;
  - `pointercancel`, or the finger sliding off the pad, sends `preview(null)` and does not roll;
  - the click on release rolls.
- **Nothing is required.** A quick tap is a press and a release, so it rolls exactly as Roll! does today.
  Holding longer only shows the hand on the TV for longer.

### 3.2 The TV

```
┌──────────────────────────────────────────────────────────────┐
│                    [ scene art: the marsh ]                  │
│                                                              │
│      ════════════════════════════════════╗  🛒 (cart)       │
│        ✋Mia        ✋Theo        ◌ Posy  ║                   │
│                                                              │
│   🎲 Push a sausage cart out of marsh mud                    │
│      "Everybody grab on!"   Mia and Theo are holding on.     │
└──────────────────────────────────────────────────────────────┘
```

- **One hand slot per hero in `group.pending`, plus those already rolled.**
  - Outline: not holding.
  - Filled: holding (a live `grip` preview whose context matches).
  - Solid with a die face: rolled (from `group.rolls` in state).
- **When the last hero has gripped**, the TV reads "One, two, three..." (the existing
  `speak()` seam, if read-aloud is on). The rope draws taut.
- **Each release plays today's `ROLL` presentation unchanged:** the die tumbles, lands and is read out.
  On the last one, the `group` line ("2 of 3 made it") and the branch narration play as now.

The rope and hands are CSS over the scene art, built from existing `Icon`s and the
heroes' own portrait chips. A `heave` with no new art is the v1. Painted
rope/cart/note overlays are an art-pipeline follow-up and are not on this design's
critical path.

### 3.3 Travel Mode (no TV)

Each phone shows the pad on its You surface, the hands row under it, and the
world pane takes over for each roll exactly as today (`TravelLayout.tsx:103-109`).
The rope picture goes on the world pane, which every phone already shows during a
roll.

## 4. The hard cases

### 4.1 One player

- **One slot.** A group check of one is one pending hero, so the pad shows one hand and
  the TV one slot. The release is the one die, as a solo `roller: "all"` check is today.
- **Copy that doesn't count heads.** "Everyone heaves!" becomes "Heave!" and the hands row
  is hidden. The phone already does this kind of thing: no helper line for a party of one
  (`PlayerPanel.tsx:1186-1191`).
- **The cue.** "One, two, three..." is still read, because one kid counting to three and
  heaving is still the moment.

### 4.2 A kid who doesn't press

There is no timer, and that does not change (spec §11: "No timers on decisions").

- **Present but not pressing.**
  - The check waits, exactly as a `roller: "all"` check waits today.
  - The TV makes that visible and kind: an outline hand with the kid's name, and "Waiting
    for Posy's hands..." on the other phones.
  - Their friends can see whose hands are missing, so they can nudge them.
  - The pad on the waiting kid's phone is already in front of them: a new prompt pulls the
    controls forward (`useMyTurnKey`).
- **Stepped away (phone gone, `connected: false`).** Nothing new.
  - `rollerPool` leaves them out of `pending` when the prompt opens.
  - If they drop mid-check, `rollerAway` lets anyone seated roll the last slot as themselves
    once every pending hero is away (`engine.ts:1701-1711`, spec §8.5).
  - The TV draws a stand-in's release as their hand on the slot they filled.
- **Pressed and never let go** (the phone was put down with a thumb on it). The grip preview
  stays lit and nothing rolls. Two things clear it:
  - the finger lifting or the browser cancelling;
  - the page hiding. The build adds a `preview(null)` beside the "leaving" beat that
    the `pagehide` handler already sends (`sync/presence-beat.ts`).

  A grip is a highlight, never a hold on the game.

**Not proposed: a "heave for them" button for a present kid who won't press.** Today a
present non-roller holds up a group check too, and grown-ups handle it at the table.
Adding a stand-in for present players would change what a group check is for every
`roller: "all"` check, opted in or not. See Decision 3.

### 4.3 No phones: the TV alone

- **There is no TV-only play mode.** The TV is a pure display client with no player and no
  session, and it "cannot act" (architecture §4.5, "The TV, which is nobody").
  - Every hero has a seat on some device: their own phone, or a kid picked on the family
    tablet (`handlers/shared-device.ts`).
  - A table with no phones has no checks to make at all, so group actions add no new TV-only
    case.
- **What the TV must still do right:**
  - **A TV refreshed mid-moment** recovers the slots from state (`group.pending`, `group.rolls`).
    Grip previews are live-only and are lost, so a refreshed TV shows "not holding" until the
    next press. This is the same loss as a refreshed TV dropping a half-made choice highlight
    today.
  - **A TV that is not there** (the laptop died, or Travel Mode) loses only the picture. The
    pads on the phones still work, because the roll is the release and the release is a normal
    intent.
- **A tablet seating more than one kid** (if hot-seat seating lands later) still works:
  - each hero's slot is filled by a release from whichever session holds that hero;
  - a kid passing the tablet round heaves in turn.

  That is less "together", but correct.

### 4.4 Accessibility

| Need | What happens | Why it holds |
|---|---|---|
| **Switch access / keyboard** | The pad is a native `<button>`. Enter or Space activates it and sends `ROLL`, with no hold required. No grip preview is sent for keyboard activation, so the TV shows the hand when the die lands. | Activation goes through `onClick`. The press-and-hold part is added by pointer listeners and is never required. |
| **Reduced motion** (`data-motion="reduced"` or the OS setting) | No pad fill, no rope tension, no buzz. Hands switch between outline and solid with no tween. The die is as reduced as it is today. | CSS durations already flatten to 1 ms (`theme.css:346-361`). The buzz is behind `reducedMotion()`, as in `PhoneMagic`. |
| **One-handed** (`data-hand`) | The pad is the full-width thumb target that the one-handed layout already makes of the commit button (`theme.css:496-514`). The hands row sits above it, not beside it. | Same rule as Do it! and Roll!. |
| **Motor: can't hold, or holds by accident** | A tap rolls. A long hold is not a long-press-for-help, because the pad never carries `helpAttrs`. It has a visible "?" beside it instead, which is how every other hold has its equivalent (`accessibility.md:47-61`). | `help/longpress.ts` only acts on `[data-help-kind]`. The pad also sets `user-select: none` and `-webkit-touch-callout: none`, so iOS does not pop a selection or callout on a hold. |
| **Motor: tremor, finger slides** | A slide off the pad cancels, with no roll, and you press again. There is no penalty and no lost turn. | A cancel only clears the preview. |
| **Text size up to 1.5×** | The pad's label wraps and the pad grows. The hands row wraps to two lines. | It is tested in `e2e/accessibility.spec.ts` at 360×640 like every other prompt (new case). |
| **Colour** | Holding, rolled and waiting are told apart by shape and icon (outline hand, filled hand, die face), never by colour alone. | Spec §11. |
| **Read-aloud** | The TV says the move's cue line, and then the roll as today. A phone with read-aloud reads its own pad label. | Through `speak()`/`hear()`, as `docs/read-aloud.md` describes. |
| **No vibration hardware** (iOS) | Nothing happens, and nothing depends on it. | `PhoneMagic`'s existing try/catch pattern. |

No gesture is ever the only way: press-and-release is always also a click. There is no
swipe, tilt or shake in v1. Each would need a non-gesture equivalent and would bring
motion permissions (iOS asks before DeviceMotion), for little gain over a hold.

## 5. Dice, seq and RNG: untouched, and why the Gemfall digests cannot move

**Statement.** Group actions do not touch dice seq or the RNG.

- **No new intent.** No new intent is committed, and the existing `ROLL` intent gains no field.
- **No new draw.** No draw is added or reordered.
- **No new state on the attempt row.**

How the dice work today:

- Every intent's RNG is a fresh mulberry32 seeded from `diceSecret:runId:seq` (`handlers/action.ts:358`, `:1039-1041`).
- `seq` is the run's event counter, and it moves only on a committed intent (`engine.ts:359-363`).
- A roll is the d20 first, then a help die only if there is a helper (`dice.ts:125-143`).

So a die changes only if:

1. **an extra committed event lands before the `ROLL`**, which shifts the seed;
2. **the draw order inside `ROLL` changes**; or
3. **a different player's `ROLL` lands on a given seq.**

Taking each in turn:

1. **The grip is a preview.** Previews go through `/api/preview`, which never calls
   `applyAction`, never logs, and never bumps the seq (`handlers/preview.ts:1-11`,
   architecture §4.2). A kid pressing, sliding off and pressing again commits nothing.
2. **`ROLL` and `doGroupRoll` are not edited.** The only engine change is the spread that
   copies `together` onto the prompt in `openScenePrompt`, which draws nothing.
3. **Who releases first is who taps first today.** Each kid's die is seeded by the seq their
   `ROLL` lands on, exactly as now. The order is the table's, as it always was.

**Why the four Gemfall gameplay digests cannot move**
(`packages/server/src/handlers/gemfall-compat.test.ts`):

| Digest | What it hashes | Why group actions cannot reach it |
|---|---|---|
| `endings` (:168-196) | The attempt row and settlement for all 48 endings, reached by `PLAYTEST_GOTO` warps | No check is entered or rolled on the way (`gemfall-compat-probe.ts:156-189`). No key is added to the attempt row. |
| `roads` (:198-225) | Three road choices in chapters 2 and 6 | They go through choices and warps, never a check scene. |
| `setbacks` (:227-235) | Warp to a setback ending | No check. |
| `resumed` (:279-325) | A mid-fight save played on, with seq-keyed combat dice, every presentation since the save, HP, flags and XP | Only `COMBAT_SEQUENCE` beats. No `ROLL` is sent anywhere in the probe. Combat intents, draws and presentations are not edited. |

The probe never sends `ROLL` at all. Its tables throw no dice outside the one fight. So
even a change to check resolution could not move these digests, and this design does not
change check resolution.

**The file hashes are different, and that is expected.** Opting a Gemfall check in is a byte
change to a Gemfall chapter, so the file-hash test (:103-132) fails, by design.

- **Rollout order:**
  1. The feature PR touches no content, so it leaves the hashes alone.
  2. Opting in Gemfall checks is its own content commit. It re-takes those hashes and says why,
     as CLAUDE.md requires: "presentation only: `together` on N checks; no branch, effect or
     roller changed".
- **The gameplay digests stay put in that commit too.** Its PR must show them green and
  unmoved.

**Guards the build PR adds, so this stays true:**

- **A seed-equivalence test** (`packages/shared/src/group-action.test.ts`). It plays the same
  `roller: "all"` check twice from the same seed and intents, once with `together` and once
  without. It asserts:
  - identical `DiceRoll`s, `lastRoll`, branch and event count;
  - that the two states differ only by `prompt.together`.
- **A preview test.** A `grip` relayed during a group check leaves `state.seq` and the event
  log unchanged (alongside the existing preview tests).
- **The `gemfall-playthrough` seeds still pass unedited.** The driver sends `{ type: "ROLL" }`
  from `ownerOf(prompt.characterId)` (`playthrough-driver.ts:467-470`), which is the same
  intent from the same player. Its dice-dependent expectations ("seed 5 loses the race check")
  therefore cannot flip.

## 6. First paint

- **The budget.** It is 315 KB of first-paint JS, weighed by `tools/perf/bundle-budget.ts`
  over the static import graph from the entry. Last measured at about 296 KB (#318).
- **Expected cost: about 0.1 KB.**

| Piece | Where it lands | First-paint cost |
|---|---|---|
| The pad, the hands row, the per-move copy | `PlayerPanel.tsx`, inside the lazy room layouts | 0 |
| The TV rope and hands overlay | `WorldView`/`NarrationPanel`, inside the lazy room layouts | 0 |
| `TogetherMove` and the new `IntentPreview` member | type-only | 0 (erased) |
| `previewContext()`'s new `roll` branch | `@kad/shared`, which the store imports (`store/index.ts:33`), so it **is** in the entry graph | about 100 bytes minified |
| `preview()` in the store | unchanged. It already relays any `IntentPreview`. | 0 |
| Server-side shape check for `grip` | `handlers/preview.ts` | 0 (server) |

- **Keeping it out of first paint.** Nothing new is imported from `App`, `main.tsx`,
  `HomeScreen`, `store/` or `sync/`.
- **If it grows.** If the pad's pointer handling outgrows a few lines, it moves to a `lazyChunk`
  beside `RankUpMoment` (`PlayerPanel.tsx:107`).
- **Proof.** The build PR runs `npm run build && npm run perf:bundle` and puts the before/after
  numbers in its body.

## 7. The first three checks

None of the strong candidates is on a chapter's strict spine. Every physical
check in shipped content sits beside an ungated alternative, as the authoring
rules want. These three are the most-walked ones that already roll as a whole party,
so opting in changes no mechanics.

1. **`gemfall-03b` › `check_cart_push`, `heave`** (might 12, already `roller: "all"`).
   - **Prompt:** "Push a sausage cart out of marsh mud".
   - **Why it fits:** its success narration already opens "One, two, three, HEAVE." It is
     the last beat before the chapter's ending, so the shared moment closes the sitting.
   - **What changes:** one field.
2. **`gemfall-03b` › `check_gate_hum`, `hum`** (heart 12, already `roller: "all"`).
   - **Prompt:** "Hum the Gate's note back to it, all on the same note".
   - **Why it fits:** "all on the same note" is the together moment written into the prompt.
     It shows the hum move on a heart check, so group actions are not only for the strong kid.
   - **What changes:** one field.
3. **`first-steps-01` › `check_climb`, `tiptoe`** (quick 8, already `roller: "all"`).
   - **Prompt:** "Climb over without a squeak".
   - **Why it fits:**
     - It is in the tutorial campaign, so a new family meets the pad on their very first check.
     - It is on about half of all walks, not pinned, and an easy target.
   - **What changes:**
     - its `hint` ("When your phone says Roll, tap it") is rewritten for the pad;
     - it is the natural home for the build PR's e2e test.

Runners-up, all `roller: "all"`:

- `gemfall-07r` `check_downhill_cart` (heave, "One, two, three, heave!");
- `gemfall-07l` `check_returning_cart` (heave). 07l is also being rewritten under #354, so wait for that.
- `gemfall-03b` `check_ford_song` (hum, "keep time").

Bramblewood's `check_gate` ("Heave the root-knotted gate open") reads perfectly, but it is
`roller: "party"`, so it waits on Decision 1.

## 8. Build order, once approved

1. **Shared and server.** The type, schema enum, validator rules, the engine's one-line copy,
   the `grip` preview kind and the roll `previewContext` branch, with the seed-equivalence and
   preview tests. No content.
2. **Client.**
   - The pad and hands row on the phone, and the TV and Travel overlays.
   - The a11y cases in `e2e/accessibility.spec.ts`.
   - `perf:bundle` before/after.
   - Dev-only: a `together` check added to a test fixture, not shipped content.
3. **Content.**
   - `first-steps-01` `check_climb`.
   - The two Gemfall checks, in their own commit with the hash re-pin and its reason.
   - `content:pacing`'s "physical spine checks" count (#354 piece 5) may count a `together`
     check as physical. That is #354's call, not this brief's.

## Decisions for the owner

1. **Only `roller: "all"`, or also single-roller checks?**
   - **Recommended: only `"all"` in v1.** There, every release is a real die, so every kid's
     press matters.
   - On a single-roller check, the non-rollers' presses would be pure theatre, unless they
     became Help. That changes Help's once-per-rest rule and adds a die, so it is a mechanics
     change and out of scope.
   - **The cost of saying yes:** Bramblewood's `check_gate` and Gemfall's `roller: "party"`
     heaves (`check_wagon`, `check_unmire`) would have to switch to `"all"` to opt in. That is
     a gameplay change (who rolls, and how success is counted) and would move the
     playthrough dice.
2. **Moves as a fixed set (`heave`, `hum`, `tiptoe`), or a per-check authored cue line as well?**
   - **Recommended: the fixed set**, with copy in the client.
   - A per-check `cue` ("Everybody grab the cart!") reads better but is one more string per
     check for authors to write and the voice rules to police.
3. **A present kid who doesn't press.** Keep today's rule? **Recommended: yes.**
   - Under today's rule, the check waits with no timer, and a stand-in can roll only when
     every pending hero is away.
   - The alternative is a "heave for them" button after everyone else has gone. It would apply
     to every group check and soften "no timers" into "a friend can push past you".
4. **Haptics.**
   - **Recommended:** a short buzz on press and a stronger one on release, both off under
     reduced motion.
   - **Say if you'd rather keep phones to today's single 8 ms tick.**
5. **Art.**
   - **Recommended:** v1 draws the rope, notes and footprints from icons and portrait chips in
     CSS.
   - **Say if you want painted overlays first.** That puts an art-pipeline brief in front of
     the build.
6. **Gemfall opt-in timing.**
   - **Recommended:** opt in `first-steps-01` first.
   - Then the two Gemfall checks in a separate re-pin commit, once the client has been played
     at a real table.
