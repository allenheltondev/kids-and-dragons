# Brief: group actions on phones (everyone heaves together)

**Status: design, decided.** This is the design for #360, part of #354. The owner settled all six
open questions on #361, and the decisions are recorded in the last section. Nothing is
built yet. File and line references are to `main` at c847b1b.

**The idea.** Some checks become a short shared physical moment.

- Every phone shows a big pad.
- Each kid presses it to grab hold, and the TV shows them holding on. Each kid lets go
  to heave.
- The release *is* that kid's roll.
- The dice, the outcome and the narration are exactly what they are today.

**The design.**

- **Opting in.** A check with `roller: "all"` may add `"together": { "move": "heave" | "hum" |
  "tiptoe", "cue"?: "..." }`.
- **The pad.** The phone swaps its Roll! button for a press-and-release pad.
- **The press** travels as a live-only preview that never touches the state, the seq or the
  dice.
- **The release** is the same `ROLL` as today.
- **A friend who won't press.** After 30 seconds without a press from a present friend, the
  phones that have already rolled may *heave for them*. That is one `ROLL` for that hero, with
  that hero's stat.
- **Art comes first.** A move is offered only once its painted overlays have passed
  `art:verify`.

---

## 1. What the controls support today

The phones only take taps.

| Capability | Today | Where |
|---|---|---|
| Tap a button | Everything: choices, Do it!, Roll!, Help, combat | `screens/PlayerPanel.tsx` |
| Press and hold | Only to *show help* on a card, buff or item (500 ms). It never sends an intent. | `help/longpress.ts:24-29`, opt-in through `helpAttrs()` |
| Swipe | None. Drag and pinch are only on the world canvas, for pan and zoom. | `world/scene.ts:916-974` |
| Device motion / tilt | None anywhere in `packages/client/src` | |
| Vibration | An 8 ms tick on any tap. It is skipped under reduced motion, and iOS Safari has none. | `ui/PhoneMagic.tsx:28-34` |
| Timers on decisions | None, by rule: "There is no timer anywhere in this file, and there never will be." | `PlayerPanel.tsx:8-15`, spec §11 |

**How a check runs today.**

- **The scene.** A check is a whole scene (`CheckScene`, `packages/shared/src/types/chapter.ts:275-307`).
  `roller` picks who rolls: `party` (fewest checks so far), `active`, `best`, or `all`.
- **The prompt.** Entering the scene opens a `kind: "roll"` prompt (`engine.ts:836-862`).
- **The roll.** The nominee's phone shows **Roll!** and sends `{ type: "ROLL" }` (`PlayerPanel.tsx:1232-1239`).
  The server rolls d20 + stat against `tn` (`engine.ts:1964-2022`).
- **The TV.** It animates the die from the `ROLL` presentation (`screens/DiceOverlay.tsx`).
- **Group checks already exist** (`roller: "all"`).
  - Every standing, connected hero is in `prompt.group.pending` (`engine.ts:837-847`).
  - Each of them taps their own Roll!. That is one `ROLL` intent and one die each (`doGroupRoll`, `engine.ts:1876-1934`).
  - The party makes it if half or more succeed.
  - Help is refused on a group check (`engine.ts:1949`).
- **Today's stand-in rule.**
  - A pending hero whose phone has gone (`connected: false`) can be rolled for only once
    *every* pending hero is away.
  - Then any seated player rolls the slot *as themselves*, and it counts toward their own
    turn tally (`rollerAway`, `engine.ts:1701-1711`; `doGroupRoll` :1886-1893; spec §8.5).
- **The TV never acts.** A display client "sends nothing, ever" (`client/src/store/index.ts:1123`).
- **There is a live-only lane for things that are not state.**
  - **What it carries.** A preview (`IntentPreview`, `protocol.ts:355-399`) is posted to
    `/api/preview` and relayed straight to the room (`handlers/preview.ts`). The TV uses it
    to light up a half-made choice, tile or ability.
  - **What it never does.** It is never logged, never replayed, and never moves the seq.
  - **How a stale one fades.** `previewContext()` (`shared/src/preview.ts:106-129`) names the
    decision a preview belongs to, and a preview for a passed decision fades by itself. Today
    it knows fights and choice prompts, and returns `null` for a roll prompt.

So the mechanics a group action needs are already here:

- **One roll per kid:** `roller: "all"`.
- **Showing the table what I'm doing right now, without committing it:** the preview lane.

What is missing:

- a gesture;
- a TV picture;
- one preview kind;
- the heave-for-them rule.

## 2. How a check opts in

### 2.1 The data shape

One optional field on the check scene:

```jsonc
// content/chapters/first-steps-01.json, scenes
"check_climb": {
  "type": "check",
  "stat": "quick",
  "tn": 8,
  "prompt": "Climb over without a squeak",
  "roller": "all",
  "together": {                                    // new, optional
    "move": "tiptoe",
    "cue": "Over the gate, and not one squeak!"    // optional, ≤ 60 characters
  },
  "hint": "Press and hold the big button, then let go.",
  "onSuccess": { ... },                            // unchanged
  "onFailure": { ... }                             // unchanged
}
```

```ts
// packages/shared/src/types/chapter.ts (the contract)
export type TogetherMove = "heave" | "hum" | "tiptoe";

/**
 * How the party makes this check on the phones: press to grab hold, release
 * to do it. Presentation only: the roll, the branches and who rolls are as if
 * it were absent. Only on `roller: "all"`, where every release is a die.
 */
export interface TogetherSpec {
  move: TogetherMove;
  /** Said and shown as the moment opens. Authored, ≤ 60 characters, tokens filled like `prompt`. */
  cue?: string;
}

export interface CheckScene {
  // ...every field as today...
  together?: TogetherSpec;
}
```

```ts
// packages/shared/src/types/state.ts, Prompt kind "roll"
  /** The scene's `together`, `cue` already token-filled, copied when the prompt opens. */
  together?: TogetherSpec;
  /**
   * When this together check last saw progress: the prompt opening, or a die
   * landing (ctx.now, ISO). Heave-for-them unlocks 30 s after it (§4.2).
   * Only on a together prompt.
   */
  waitingSince?: string;
```

```ts
// packages/shared/src/types/protocol.ts
  | { kind: "grip" }                                    // new IntentPreview member: this player's finger is on the pad
  | { type: "ROLL"; spendBuff?: string; for?: string }  // `for`: heave for this hero (§4.2)
```

```ts
// packages/shared/src/preview.ts, previewContext() gains one branch
if (prompt?.kind === "roll" && prompt.together) {
  return ["roll", state.chapterId ?? "-", state.visited?.length ?? 0, prompt.sceneId].join(":");
}
```

The preview context leaves out `group.rolls.length` on purpose. One kid's roll landing
must not blank the grips of the kids still holding on.

### 2.2 Moves, and why they are a closed set

**What a move is.** Each move is a gesture, a painted overlay (§7) and a line of default
copy, and all three are built.

- **What the author does:** picks one, and may add a cue.
- **Where the copy lives:** the default copy is in the client, next to "Everyone rolls!".
  It is authored once, under the no-AI rule (#347).

| `move` | Pad label, pressed then held | Default cue (when `cue` is absent) | Good for |
|---|---|---|---|
| `heave` | "Grab on!" then "HEAVE!" | "Everybody grab on!" | carts, ropes, wagons, gates |
| `hum` | "Hum..." then "Let it go" | "Find the note together!" | humming, singing, holding a note |
| `tiptoe` | "Hold still..." then "Over!" | "Quiet as mice, everybody!" | climbing quietly, sneaking past |

**Moves considered and not added.** `push`, `row` and `steady` were folded into `heave`.
A fourth move needs three things, so it is never a content-only change:

- a client change;
- a schema enum entry;
- its own overlay set.

### 2.3 The cue line

`cue` is the one line an author writes for the moment, for example "Pull before the cart
rolls back!".

- **Where it shows.**
  - **TV:** under the check's prompt, in place of the default cue.
  - **Phone:** under the pad's label.
- **Length: at most 60 characters**, enforced by the schema (`maxLength: 60`).
  - **On the TV**, that keeps it to one line at 1.5× text size, beside a prompt that is
    already up to about 55 characters.
  - **Read aloud**, it takes about three seconds. That is short enough to say before the
    first die lands.
- **Tokens.** `{party}` and the other tokens are filled with `fillTokens`, the same way as
  `prompt` (`engine.ts:844`). They are filled once, when the prompt opens.
- **Voice rules**, from CLAUDE.md and the authoring docs. The cue is player-facing text, so
  every rule for narration applies:
  - **Never count the party.** "All three of you, pull!" is wrong at most tables. Say
    "everybody" or write `{party}`.
    - `validate.mjs` applies the party-count patterns that `gemfall-flow.test.mjs:82-88` and
      `first-steps.test.mjs:115-116` already use to every `cue`, in every campaign.
    - It is an error, not a warning, because a cue is short enough that there is no excuse.
  - **US spelling.** `spelling.test.mjs` adds `cue` to the player-facing keys it walks.
  - **No em or en dashes in Gemfall.** `gemfall-flow.test.mjs:69` already scans raw Gemfall
    lines, so a dash in a Gemfall cue fails with no change.
  - **House voice.** Short, warm, one concrete funny detail if it fits, never scary. It is
    an urging line, not narration: it says what to do *now*.
  - **Never decides anything.** The cue says nothing about success, because it is shown
    before the dice.
- **Read-aloud.**
  - The TV speaks the cue once, through `speak()`, right after the check's prompt. If `cue`
    is absent, it speaks the move's default cue.
  - When every pending hero is gripping, the TV adds "One, two, three..." on its own line.
  - A phone with read-aloud on reads its own pad label through `hear()`, not the cue, so the
    cue is not spoken twice in one room (`docs/read-aloud.md`: the TV reads, a phone reads
    only its own controls).
- **Fallback.** When `cue` is absent, the default cue in the table above shows and is read.
  An author never has to write one.

### 2.4 Why this is "a field on the check, never a new outcome path"

- **No new paths.** `together` adds no branch, effect, gate or flag. `onSuccess` and
  `onFailure` are untouched, so `content:validate`, `content:graph` and `content:pacing`
  see the same graph.
- **The engine reads it in two places:**
  - `openScenePrompt` copies it onto the prompt with `waitingSince`;
  - `doGroupRoll` accepts `ROLL.for` only on a prompt that has it (§4.2).

  `resolveCheck`, `roll()` and `takeBranch` never see it.
- **Removable.** Taking `together` off a chapter gives a check that plays identically with
  a plain Roll! button.

### 2.5 Validation (`schemas/chapter.schema.json`, `tools/content/validate.mjs`)

- **Schema.**
  - `$defs.checkScene` has `additionalProperties: false` (:1014). It gains
    `together: { type: object, additionalProperties: false, required: [move],
    properties: { move: { enum: [...] }, cue: { type: string, minLength: 1, maxLength: 60 } } }`.
  - `tools/content/generate.ts:142` embeds the schema, so it picks this up with no change.
- **`together` requires `roller: "all"`** (validator error).
- **A move needs its art** (validator error).
  - `together.move` must have a complete overlay set in `assets/manifest.json`
    `togetherOverlays`, with every file present on disk (§7).
  - This is how the rule "a move is not offered until its art has passed" is enforced: the
    content cannot opt in before the art lands.
- **The cue follows the voice rules** in §2.3 (validator error).
- **Hints must not say "Roll"** on a `together` check (validator error), because the phone
  shows no Roll! button there. `first-steps-01`'s `check_climb` hint says "When your phone
  says Roll, tap it", so it is rewritten when that check opts in.
- **Two at most** (validator warning). More than two `together` checks on any one path
  through a chapter is a warning, so the moment stays special.

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
│  │    ◯ (rope-loop token)  │  │   the pad: full width, at least
│  │       Grab on!         │  │   2 × --kad-touch-min tall,
│  │  Push before the       │  │   under the thumb
│  │  sausages get cold!    │  │   ← the cue
│  └────────────────────────┘  │
│  ◉ Mia  ◉ Theo  ◯ Posy       │   who is holding on right now
└──────────────────────────────┘
```

While this kid's finger is down:

```
│  ┌────────────────────────┐  │
│  │ ░░░░░░░░░░░░░░░░░░░░░░ │  │   the pad fills (static under
│  │    ◉   HEAVE!          │  │   reduced motion); a short buzz
│  │     let go to pull     │  │   on press
│  └────────────────────────┘  │
```

After this kid's roll has landed:

```
│  ✅ You heaved! (14)          │   a stronger buzz on release
│  Waiting for Posy...         │
│  ★ Mia  ★ Theo  ◯ Posy        │
```

After Posy has been quiet for 30 seconds, on the phones of kids who have already rolled
(§4.2):

```
│  ★ Mia  ★ you  ◯ Posy         │
│  ┌────────────────────────┐  │
│  │  🤝 Heave for Posy      │  │   secondary button, full width
│  └────────────────────────┘  │
```

The pad is the Roll! button, re-dressed.

- **It is still a `<button>`.** Its `onClick` sends the same `dispatch({ type: "ROLL" })`.
- **Press and release are added on top:**
  - `pointerdown` sends `preview({ kind: "grip" })`;
  - `pointercancel`, or the finger sliding off the pad, sends `preview(null)` and does not roll;
  - the click on release rolls.
- **A quick tap is a press and a release**, so it rolls exactly as Roll! does today.

### 3.2 The TV

```
┌──────────────────────────────────────────────────────────────┐
│                    [ scene art: the marsh ]                  │
│                                                              │
│ ~~~~ painted rope band (heave/band-slack.png) ~~~~~~~ 🛞     │
│      [Mia ◉]        [Theo ◉]        [Posy ◯]                 │
│                                                              │
│   🎲 Push a sausage cart out of marsh mud                    │
│      Push before the sausages get cold!                      │
└──────────────────────────────────────────────────────────────┘
```

- **The band.** The painted band runs along the bottom of the scene, over the art and under
  the dice overlay.
- **One token per hero**, in `group.pending` and `group.rolls`. The hero's own portrait chip
  sits inside it. The token's state (§7) shows where that hero is:
  - `empty`: not holding;
  - `holding`: a live `grip` preview with a matching context;
  - `done`: rolled;
  - `helped`: a friend heaved for them.
- **When every pending hero is gripping**, the band swaps to its second state (`taut`,
  `together`, `over`), and the TV reads "One, two, three...".
- **Each release plays today's `ROLL` presentation unchanged.** On the last one, the
  `group` line and the branch narration play as they do now.
- **A heave-for-them roll** is shown kindly (§4.2).

### 3.3 Travel Mode (no TV)

- **The phone.** It shows the pad and token row on its You surface.
- **The world pane.** It takes over for each roll, as it does today (`TravelLayout.tsx:103-109`),
  and draws the band and tokens.

## 4. The hard cases

### 4.1 One player

- **The picture.** A group check of one has one pending hero, so there is one token and the
  release is the one die.
- **The words.**
  - "Everyone heaves!" becomes "Heave!" and the token row is hidden, the same way the phone
    already drops the helper line for a party of one (`PlayerPanel.tsx:1186-1191`).
  - The default cues say "everybody", which reads fine to one kid as an urge, and an
    authored cue must not count the party (§2.3).
- **No heave-for-them.** Nobody else is there to see the button.

### 4.2 A kid who doesn't press: heave for them

The owner chose a "heave for them" button that appears after a timeout.

**The timeout is 30 seconds without progress.** The clock is the prompt's `waitingSince`:
the later of the prompt opening and the last die landing. It is stamped by the server from
`ctx.now`.

- **The clock restarts on every die.** A kid watching their friends' dice (about 3.6 s each:
  `ROLL_TUMBLE_MS` 1000 + `ROLL_READ_MS` 2600, `world/presentation.ts:26-37`) is never
  counted as slow.
- **30 s is long at a table.** It is about eight die reads with nothing happening, long
  enough that the button never feels like a race. A kid reading the prompt, or finding the
  phone in a cushion, has plenty of time.
- **Well under the 120 s away mark.** It is far below `AWAY_AFTER_MS` (120 s,
  `handlers/presence.ts:148-151`), after which the phone counts as gone and today's away
  rule takes over. That leaves the gap this fills: phone awake, kid elsewhere, for up to two
  minutes.
- **One clock, so no skew.** The server stamps `waitingSince` and checks it with its own
  `ctx.now`.
  - Each phone starts its own 30 s from the patch that moved `waitingSince`, so a phone's
    button never appears before the server would accept it.
  - The engine still reads no clock of its own: `ctx.now` is injected, as it already is for
    `updatedAt`.

**Who sees the button: every other seated phone whose own hero is no longer pending** (it
has already rolled this check).

- **Why those phones.** They are the friends who are waiting, and the ones with a free thumb.
- **Why not the host only.** The host's own kid may be the one who isn't pressing.
- **Why not phones still pending.** A phone whose hero is still pending sees its own pad,
  not this button, so nobody can skip their own roll by rolling for someone else.
- **One button per hold-out.** "Heave for Posy" (or "Hum for Posy", "Tiptoe for Posy").
  With two hold-outs there are two buttons.
- **Hidden while the hold-out is gripping.** The button is hidden while the hold-out's
  `grip` preview is live, so a kid mid-press is never overtaken. This is a client courtesy;
  the server cannot see grips and does not need to (see "the same moment" below).

**What it does.** It sends `{ type: "ROLL", for: "<hero id>" }`. The engine accepts it only if:

- the prompt has `together`;
- `for` is in `group.pending`;
- the sender's own hero is not pending;
- at least 30 s have passed since `waitingSince`.

Then it rolls **for that hero, exactly as that hero's own `ROLL` would:**

- **The stat.** `mod` is the hero's stat, and `characterId` is the hero.
- **The draws.** It is one intent, so one seq and one d20 draw, through the same
  `resolveCheck(ctx.rng, ...)`.
- **The turn tally.** It counts in `checkRolls` for the hero, not the thrower.
- **Buffs.** An `auto` buff applies as it would have. A `choose` buff is left unspent,
  because a friend does not spend the party's buff on someone else's roll.
- **The record.** The `DiceRoll` gains `by: "<thrower's character id>"`, so the TV can say
  who helped.

There are no extra draws and no extra intents: one slot is filled by one `ROLL`, whoever
sends it. §5 has the proof.

**How the TV says it kindly.**

- **The words.** The hold-out's token goes to `helped`: their own portrait, with a friend's
  loop tied on beside it. The line is "Mia gives Posy a hand!", and it is read aloud.
- **The die.** It lands under Posy's name, because it is Posy's roll with Posy's stat.
- **Posy's phone** says "Mia heaved for you! You rolled 14." Posy's roll still counts, and
  nobody is "too slow".
- **Words never used:** skipped, missed, late, slow, timeout.

**The same moment.** Posy releases just as Mia taps Heave for Posy.

- Both `ROLL`s carry seq N, and the server applies whichever arrives first.
- The second gets `STALE_SEQ`. The store resyncs and re-sends it
  (`store/index.ts:1141-1165`). The engine then refuses it, because Posy is no longer
  pending, so it is `ILLEGAL` ("already rolled").
- The losing phone simply shows the state that arrived: the die is already there. It shows
  no error toast.
- Either way the slot gets exactly one die, on one seq.
- The build PR tests both orders.

**What changes from today's stand-in rule.**

| | Today (any group check, hero away) | New (together check only, hero present) |
|---|---|---|
| When | Only once *every* pending hero is away (about 120 s of silence each) | 30 s after the last progress |
| Who | Any seated player | A seated player whose own hero has already rolled |
| Whose stat | The thrower's ("rolls as themselves") | The hero's |
| Whose turn tally | The thrower's | The hero's |
| Intent | `ROLL` | `ROLL` with `for` |

- **The old rule is unchanged** for away heroes, and plain group checks keep only the old rule.
- **Spec §11 ("No timers on decisions") gains its first, narrow exception.** The 30 s
  decides nothing and forfeits nothing: the hero is still rolled for with their own stat, so
  the odds are theirs.
- **Spec §8.5's table** gains a row for it.
- **The rule in `PlayerPanel.tsx:8-15`** becomes "no timer except heave-for-them, which only
  reveals a friend's button". Both edits land with the build PR.

**Pressed and never let go** (the phone was put down with a thumb on it).

- The grip stays lit and nothing rolls. That also hides the button for that hero.
- It clears when:
  - the finger lifts;
  - the browser cancels the pointer;
  - the page hides (the build adds `preview(null)` beside the "leaving" beat that the
    `pagehide` handler already sends, `sync/presence-beat.ts`).
- A phone face-down on a cushion with a stuck pointer shows the button again when the grip
  clears.

### 4.3 No phones: the TV alone

- **There is no TV-only play.** The TV is a pure display client. It has no player and no
  session, and it "cannot act" (architecture §4.5, "The TV, which is nobody").
  - Every hero has a seat on some device: their own phone, or a kid picked on the family
    tablet (`handlers/shared-device.ts`).
  - A table with no phones has no checks to make at all. Group actions add no new TV-only
    case.
- **A TV refreshed mid-moment** recovers the tokens from state (`group.pending`,
  `group.rolls`, `by`).
  - Grips are live-only and are lost, so they show as `empty` until the next press.
  - The heave-for-them clock is server state, so it survives the refresh.
- **A TV that is not there** (the laptop died, or Travel Mode) loses only the picture. The
  phones' pads and buttons work without it.

### 4.4 Accessibility

| Need | What happens | Why it holds |
|---|---|---|
| **Switch access / keyboard** | The pad is a native `<button>`: Enter or Space sends `ROLL`, with no hold needed. No grip preview is sent for a keyboard activation. "Heave for X" is an ordinary button. | Activation is through `onClick`. The press-and-hold is pointer listeners layered on top, never required. |
| **Reduced motion** (`data-motion="reduced"` or the OS setting) | No pad fill and no buzz on press or release. Overlay states swap with no tween. The die is as reduced as today. | CSS durations already flatten to 1 ms (`theme.css:346-361`). The buzz is behind `reducedMotion()`, as in `PhoneMagic`. |
| **Haptics** | A short buzz on press (`navigator.vibrate(15)`) and a stronger one on release (`[30, 40, 30]`). Both are off under reduced motion. iOS has none, and nothing depends on them. | The same guarded, try/catch pattern as `PhoneMagic.tsx:28-34`. |
| **One-handed** (`data-hand`) | The pad is the full-width thumb target the one-handed layout already makes of the commit button. The token row sits above it, and "Heave for X" sits below. | `theme.css:496-514`. |
| **Motor: can't hold, or holds by accident** | A tap rolls. A long hold never opens help, because the pad never carries `helpAttrs`. A visible "?" sits beside it, as every hold has (`accessibility.md:47-61`). | `help/longpress.ts` acts only on `[data-help-kind]`. The pad sets `user-select: none` and `-webkit-touch-callout: none`. |
| **Motor: tremor, finger slides** | A slide off the pad cancels, with no roll, and you press again. Nothing is lost. | A cancel only clears the preview. |
| **Motor or attention: can't press at all** | After 30 s a friend can heave for them, with their own stat (§4.2). | |
| **Text size up to 1.5×** | Labels and the cue wrap, and the pad grows. The token row wraps. | Tested in `e2e/accessibility.spec.ts` at 360×640 (new cases). |
| **Colour** | `empty`, `holding`, `done` and `helped` differ in shape: a loose loop, a tight loop, a star, a second loop. Never colour alone. | Spec §11. The overlays are briefed for it (§7). |
| **Read-aloud** | The TV speaks the cue, "One, two, three...", each roll, and "Mia gives Posy a hand!". A phone reads its own pad label. | Through `speak()`/`hear()` (`docs/read-aloud.md`). |

There is no swipe, tilt or shake. Each would need a non-gesture equivalent and a motion
permission prompt on iOS, for little over a hold.

## 5. Dice, seq and RNG: untouched, and why the Gemfall digests cannot move

**Statement.** Group actions do not touch dice seq or the RNG.

- **No new kind of committed intent.** Every committed intent is a `ROLL`.
- **No added or reordered draws.**
- **Nothing new on the attempt row.**

How the dice work today:

- **Seeding.** Every intent's RNG is a fresh mulberry32 seeded from `diceSecret:runId:seq`
  (`handlers/action.ts:358`, `:1039-1041`).
- **The seq** is the run's event counter, and it moves only on a committed intent
  (`engine.ts:359-363`).
- **Draws.** A roll is the d20 first, then a help die only if there is a helper
  (`dice.ts:125-143`). A group check has no helper.

So a die changes only if one of three things happens:

1. an extra committed event lands before a `ROLL`;
2. the draw order inside a `ROLL` changes;
3. a different `ROLL` lands on a given seq.

Against each:

1. **No extra committed events.**
   - **The grip is a preview.** It goes through `/api/preview`, which never calls
     `applyAction`, never logs and never bumps the seq (`handlers/preview.ts:1-11`,
     architecture §4.2).
   - **The 30 s clock commits nothing.** `waitingSince` is written inside the
     prompt-opening and die-landing intents that already happen. No timer event exists.
2. **The draw order is unchanged.** `resolveCheck` and `roll()` are not edited. A
   heave-for-them `ROLL` makes the same single d20 draw through the same call. Only `mod`
   and `characterId` name the hero rather than the thrower, and neither feeds the seed.
3. **Same count, same order.** A group check of N heroes commits exactly N `ROLL`s, as
   today. The order is whoever releases or heaves first, which is the table's order, as it
   always was.

**The four Gemfall gameplay digests** (`packages/server/src/handlers/gemfall-compat.test.ts`):

| Digest | What it hashes | Why group actions cannot reach it |
|---|---|---|
| `endings` (:168-196) | The attempt row and settlement for all 48 endings, reached by `PLAYTEST_GOTO` warps | No check is entered or rolled on the way (`gemfall-compat-probe.ts:156-189`). No key is added to the attempt row: `together`, `waitingSince` and `by` live on the prompt and on `DiceRoll`, not on the attempt. |
| `roads` (:198-225) | Three road choices in chapters 2 and 6 | Choices and warps only, never a check scene. |
| `setbacks` (:227-235) | A warp to a setback ending | No check. |
| `resumed` (:279-325) | A mid-fight save played on: seq-keyed combat dice, every presentation since the save, HP, flags, XP | Only `COMBAT_SEQUENCE` beats. Combat intents, draws and presentations are not edited. |

- **The probe never sends `ROLL`.** Its tables throw no dice outside the one fight, so even
  a change to check resolution could not move these digests, and this design does not make
  one.
- **The new fields never appear on a Gemfall check** until one opts in. When one does, the
  probe still never enters it.

**The file hashes.** Opting a Gemfall check in is a byte change to a Gemfall chapter, so the
file-hash test (:103-132) fails, by design.

- **Not in the feature PR.** It touches no Gemfall content.
- **The opt-in commit is separate** (Decision 6). It re-takes those hashes and says why,
  as CLAUDE.md requires: "presentation only: `together` on 2 checks; no branch, effect or
  roller changed".
- **That PR must show the gameplay digests green and unmoved.**

**Guards the build PR adds:**

- **Seed equivalence** (`packages/shared/src/group-action.test.ts`). It plays the same
  `roller: "all"` check twice, from the same seed and the same intents, once with `together`
  and once without. It asserts:
  - identical `DiceRoll` dice and totals;
  - the same branch and event count;
  - states that differ only by `prompt.together` and `prompt.waitingSince`.
- **Heave-for-them equivalence.** At the same seq, `ROLL { for: posy }` from Mia and a plain
  `ROLL` from Posy produce the same `die`, `mod`, `total` and branch. Only `by` differs.
- **Heave-for-them legality.** It is refused:
  - before 30 s;
  - from a pending hero;
  - for a hero not pending;
  - on a plain group check.

  The "same moment" race is tested in both orders.
- **Previews.** A `grip` relayed during a group check leaves `state.seq` and the event log
  unchanged.
- **Playthroughs.** `gemfall-playthrough` passes unedited. Its driver sends a plain
  `{ type: "ROLL" }` from `ownerOf(prompt.characterId)` (`playthrough-driver.ts:467-470`),
  which is unchanged, and it never waits 30 s. So its dice-dependent expectations cannot
  flip.

## 6. First paint

The budget is 315 KB of first-paint JS. `tools/perf/bundle-budget.ts` weighs it over the
static import graph from the entry. It was last measured at about 296 KB (#318).

**Expected cost: about 0.1 KB.**

| Piece | Where it lands | First-paint cost |
|---|---|---|
| The pad, the token row, Heave for X, the default copy, the buzz | `PlayerPanel.tsx`, inside the lazy room layouts | 0 |
| The TV band and token overlay | `WorldView`/`NarrationPanel`, inside the lazy room layouts | 0 |
| `TogetherSpec`, `ROLL.for`, `grip` | type-only | 0 (erased) |
| The overlay paths (`togetherBand()`, `togetherToken()`) | `world/art-paths.ts`, imported only by room code | 0 |
| `previewContext()`'s `roll` branch | `@kad/shared`, which the store imports (`store/index.ts:33`), so it **is** in the entry graph | about 100 bytes minified |
| The engine and server changes | server | 0 |

- **The painted overlays are images, not JS.** They are fetched only when a together
  prompt opens. They are budgeted in §7.
- **Keeping it out of first paint.** Nothing new is imported from `App`, `main.tsx`,
  `HomeScreen`, `store/` or `sync/`.
- **Proof.** The build PR puts `npm run build && npm run perf:bundle` before/after numbers in
  its body.

## 7. Art brief: the together overlays

The owner chose painted overlays first. **A move is not offered until its overlay set has
passed `art:verify`.**

- **The gate.** The content validator refuses `together.move` unless the manifest declares
  that move's full set and every file is on disk (§2.5).
- **Until then, the check plays as today.** No content can opt in, so the check has a plain
  Roll! button, the plain group copy and no heave-for-them.
- **The code can merge before the art.** It ships dormant, exercised only by a test fixture.

### 7.1 What each move needs

Each move needs two things:

- **A band.** A wide strip painted along the bottom of the scene, in two states.
- **A token.** A ring that sits around each hero's portrait chip, in four states.

The tokens deliberately draw **no hands or feet**. The heroes are unicorns, griffins,
bigfoots and more, so "a hand on the rope" would be wrong for half the party. Instead each
token is a loop, a ring or a set of prints that the hero's own portrait sits inside.

| Move | Band subject | Band states | Token subject | Token states |
|---|---|---|---|---|
| `heave` | A thick braided rope running left to right across the strip. It ends at the right in a wooden cart wheel half sunk in mud, with a little mud splash. | `slack`: the rope sags in a soft curve and the wheel sits deep. `taut`: the rope is straight with two or three strain marks, the wheel is lifted a hair, and puffs of dust come off it. | A loop of the same braided rope, a ring with an empty middle | `empty`: a loose, grey-brown dotted loop. `holding`: the loop pulled tight, warm color, a small glow. `done`: tight, with a small gold star knotted on at the top. `helped`: tight, with a second smaller loop tied on at the side. |
| `hum` | A soft ribbon of sound running left to right, with a few round motes like dust in sunlight | `wobble`: three or four thin wavy lines out of step, crossing. `together`: the lines merged into one glowing ribbon, with the motes lined up along it. | A ring of sound waves, a circle of short curved strokes | `empty`: faint dotted strokes. `holding`: strokes rippling outward, warm color. `done`: steady strokes, with a small gold star at the top. `helped`: steady, with a second smaller ring overlapping at the side. |
| `tiptoe` | A low, round-topped wooden rail across the strip, with a line of soft round prints (bean-shaped, species-neutral) walking up to it, and a small "shh" crescent moon above | `hush`: the prints faint, the moon a sliver. `over`: the prints bright and hopping over the rail in an arc, with a tiny clover patch on the far side. | A ring of five soft round prints | `empty`: dotted print outlines. `holding`: prints filled, a hint of a wobble line. `done`: filled, with a small gold star at the top. `helped`: filled, with a second, smaller ring of prints beside it. |

**Style.** The house painterly style of the scene art (`asset-brief.md`), warm and a little
spooky, never scary.

- **Color.** Each set reads against both a bright biome (meadow) and a dark one (marsh at
  dusk). Each piece has a 2 px soft dark rim so it holds up on either.
- **No text.** Nothing written is ever painted in. The client draws all words.

### 7.2 Framing, size, transparency

**Band: 1600×360 PNG, RGBA.**

- **Placement.** It sits bottom-anchored on the 1600×900 TV design rect, over the scene art
  and under the dice overlay and narration panel.
- **The subject.** It lives in the lower 75% (rows 90–359).
- **Transparency.**
  - The top 90 rows are fully transparent, so the scene shows through.
  - The left and right 48 px fade to transparent.
  - There are no opaque rectangles anywhere.
- **States share the frame.** Both states are registered to the same frame, with the wheel,
  rail or ribbon end in the same place, so a swap does not jump.

**Token: 192×192 PNG, RGBA.**

- **The middle is empty.** The ring is centred, and a centre disc of radius 62 px
  (0.32 × size) is fully transparent: the client draws the hero's portrait chip there.
- **Edges.** The outer 8 px are transparent (`tolerance.edgeMarginPx`).
- **Size on screen.** The TV draws tokens at 128–160 px, and the phone at 72–96 px in the
  token row and on the pad. The 192 px source is enough for both.
- **States share the frame.** All four states are registered to one frame. The `helped`
  extra loop or ring stays inside the canvas margin.

**Weight.** About 250 KB per band and 30 KB per token at most. That is 8 files per move and
24 in total, roughly 1.7 MB for all three moves if every file hit its cap. Nothing loads
before a together prompt opens. When it opens, the client fetches the band states and token
states for that move only.

### 7.3 Files and manifest

```
assets/together/
  heave/   band-slack.png  band-taut.png
           token-empty.png token-holding.png token-done.png token-helped.png
  hum/     band-wobble.png band-together.png
           token-empty.png token-holding.png token-done.png token-helped.png
  tiptoe/  band-hush.png   band-over.png
           token-empty.png token-holding.png token-done.png token-helped.png
```

```jsonc
// assets/manifest.json, new key beside "effects" and "castFigures"
"$togetherOverlaysComment": "Painted overlays for group-action checks (docs/briefs/group-actions.md §7). Every move here must have every file below on disk, and every file under assets/together/ must be declared here; verify.py checks both directions. content:validate refuses a check's together.move until its set is complete.",
"togetherOverlays": [
  {
    "move": "heave",
    "band":  { "width": 1600, "height": 360, "clearTopPx": 90, "fadeSidePx": 48, "states": ["slack", "taut"] },
    "token": { "size": 192, "holeRadius": 62, "states": ["empty", "holding", "done", "helped"] }
  },
  {
    "move": "hum",
    "band":  { "width": 1600, "height": 360, "clearTopPx": 90, "fadeSidePx": 48, "states": ["wobble", "together"] },
    "token": { "size": 192, "holeRadius": 62, "states": ["empty", "holding", "done", "helped"] }
  },
  {
    "move": "tiptoe",
    "band":  { "width": 1600, "height": 360, "clearTopPx": 90, "fadeSidePx": 48, "states": ["hush", "over"] },
    "token": { "size": 192, "holeRadius": 62, "states": ["empty", "holding", "done", "helped"] }
  }
]
```

The client builds the paths in `packages/client/src/world/art-paths.ts`:

- `togetherBand(move, state)` gives `together/<move>/band-<state>.png`;
- `togetherToken(move, state)` gives `together/<move>/token-<state>.png`.

Per art-pipeline §5, nothing else derives an asset filename.

### 7.4 How `art:verify` checks them

A new `check_together_overlays(rep, mf)` in `tools/art/verify.py`, called from `main()` beside
`check_effects`, modelled on it:

1. **Both directions.**
   - Every declared move has every `band-<state>.png` and `token-<state>.png` on disk.
   - Every PNG under `assets/together/` is declared.
   - A missing file is a runtime 404; an undeclared one is dead weight.
2. **Format.**
   - Each file is RGBA PNG at exactly the declared size: `width×height` for a band, `size`
     square for a token.
3. **Transparency.**
   - **Band:** every pixel in the top `clearTopPx` rows is below `tolerance.alphaThreshold`.
     The outer `fadeSidePx` columns hold no pixel at full alpha.
   - **Token:** the outer `edgeMarginPx` ring is transparent. Every pixel inside the
     `holeRadius` disc is transparent, so the portrait is never painted over.
4. **Not blank.**
   - The subject area of every file has visible pixels (`opaque_mask(...).any()`).
5. **States differ.**
   - The two band states, and each pair of token states, are not pixel-identical. A copy
     pasted under a second name would pass every other check.
6. **States register.**
   - **Bands:** the alpha centroids of the two states sit within `tolerance.edgeMarginPx` of
     each other, so a swap does not jump.
   - **Tokens:** the ring's centroid is within that distance of the canvas centre.
7. **Human gate.**
   - `npm run art:sheet` gains a `together` page in `art/review/`.
   - Each move's band states are composited over two real scenes, one bright and one dark
     (`scenes/entry/home-market` and `scenes/gemfall/hollow-gate`).
   - Tokens are composited around a sample portrait chip at TV and phone sizes.
   - Style and color are judged there, by eye, as art-pipeline §3.2 says the verifier
     cannot judge them.

### 7.5 What ships while the art is missing

- **In content: nothing.** `content:validate` refuses the opt-in, so the check plays as
  today: the plain Roll! button, the plain group copy, no cue and no heave-for-them.
- **At runtime: the overlays degrade.** Art deploys separately and can 404 against a good
  build. Per art-pipeline §5, "a missing file degrades, never blanks":
  - **The band** is simply absent.
  - **Each token** falls back to the bare portrait chip with an icon badge for its state:
    outline, filled, ★, 🤝.
  - **The pad, the cue and heave-for-them** all still work, because no control depends on a
    picture.

## 8. The first three checks

None of the strong candidates is on a chapter's strict spine. Every physical check in
shipped content sits beside an ungated alternative, as the authoring rules want. These three
are among the most-walked of those that already roll as a whole party, so opting in changes
no mechanics (Decision 1). Each cue below is a draft for review.

1. **`first-steps-01` › `check_climb`, `tiptoe`**, quick 8, `roller: "all"`. **This one
   goes first** (Decision 6).
   - **The prompt:** "Climb over without a squeak".
   - **The cue:** "Over the gate, and not one squeak!" (34 characters).
   - **Why it fits:**
     - It is the tutorial campaign, so a new family meets the pad on their very first check.
     - It is on about half of all walks, it is not pinned, and its target is easy.
   - **What has to change:** its hint, "When your phone says Roll, tap it", becomes "Press
     and hold the big button, then let go."
2. **`gemfall-03b` › `check_cart_push`, `heave`**, might 12, `roller: "all"`.
   - **The prompt:** "Push a sausage cart out of marsh mud".
   - **The cue:** "Push before the sausages get cold!" (34 characters).
   - **Why it fits:** its success narration already opens "One, two, three, HEAVE." It is
     the last beat before the chapter's ending, so the shared moment closes the sitting.
3. **`gemfall-03b` › `check_gate_hum`, `hum`**, heart 12, `roller: "all"`.
   - **The prompt:** "Hum the Gate's note back to it, all on the same note".
   - **The cue:** "Find the Gate's note and hold it!" (33 characters).
   - **Why it fits:** the prompt already says "all on the same note". It also puts a
     together moment on a heart check, so not every one is about strength.

The two Gemfall checks opt in together, in one re-pin commit, after `first-steps-01` has
been played at a real table.

**Runners-up**, all `roller: "all"`:

- `gemfall-07r` `check_downhill_cart` (heave);
- `gemfall-07l` `check_returning_cart` (heave), but 07l is being rewritten under #354, so it waits;
- `gemfall-03b` `check_ford_song` (hum).

Bramblewood's `check_gate` is `roller: "party"`, so it stays as it is (Decision 1).

## 9. Build order

1. **Art.**
   - The 24 overlays (§7), through `art:verify` and the contact-sheet review.
   - The manifest entry.
   - Nothing else depends on it, so it can start now.
2. **Shared and server.**
   - The types, the schema object and `maxLength`, and the validator rules (including the
     art gate and the cue voice rules).
   - The engine's prompt copy and `waitingSince`, `ROLL.for` with its four legality checks,
     and `DiceRoll.by`.
   - The `grip` preview kind and the roll `previewContext` branch.
   - The tests in §5.
   - No shipped content.
3. **Client.**
   - The pad, the token row and Heave for X on the phone, and the TV and Travel overlays.
   - Read-aloud lines and haptics.
   - The a11y cases in `e2e/accessibility.spec.ts`.
   - `perf:bundle` before/after.
   - The spec §8.5 and §11 edits, and the `PlayerPanel.tsx` header line.
4. **Content, once 1 to 3 have merged.**
   - `first-steps-01` `check_climb`, with its hint rewritten.
   - Later, the two Gemfall checks, in their own hash re-pin commit.

## Decisions for the owner

All six were decided by the owner on #361. They are recorded here so the build follows them.

1. **Which checks can opt in: only `roller: "all"`.** *Decided: (a).*
   - Every release is a real die.
   - `together` on any other roller is a validator error.
   - Single-roller heaves (Bramblewood `check_gate`, Gemfall `check_wagon`, `check_unmire`)
     stay as they are.
2. **The moves: the fixed set `heave`, `hum`, `tiptoe`, plus an optional authored `cue`.**
   *Decided: (b).*
   - The cue is at most 60 characters.
   - The voice rules are enforced by the validator and the existing spelling and Gemfall-flow
     tests.
   - Read-aloud speaks the cue once, from the TV.
   - Without a cue, the move's default line is used (§2.3).
3. **A present kid who doesn't press: a "heave for them" button after a timeout.**
   *Decided: (b).*
   - **The timeout:** 30 s since the last progress.
   - **Who sees it:** the phones whose heroes have already rolled.
   - **What it does:** it rolls for that hero exactly as their `ROLL` would, with their stat,
     one intent and one draw.
   - **How the TV shows it:** "Mia gives Posy a hand!"
   - **The race:** one die per slot, guaranteed by the seq and the pending check.
   - **What changes from today:** the stand-in rule and spec §11 change for together checks
     only. §4.2 lists the changes.
4. **Haptics: a short buzz on press and a stronger one on release, both off under reduced
   motion.** *Decided: (a).*
5. **Art: painted overlays first.** *Decided: (b).*
   - §7 is the art brief: bands and tokens for each move, sizes, states, transparency,
     `assets/together/` paths, the manifest entry and the `art:verify` checks.
   - Until the art passes, no check can opt in, and every check plays as today.
6. **Rollout: `first-steps-01` first.** *Decided: (a).*
   - The Gemfall checks follow in a separate commit that re-takes the file hashes, after a
     real table has played it.
