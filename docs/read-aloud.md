# Read-aloud (#261)

Spec §11: all narration and choice text flows through `speak()` (`packages/shared/src/speak.ts`).
This is how it reaches a voice.

## What it does

- A switch (speech-bubble icon, top right, left of sound) turns read-aloud on or off **for this
  device**. It is remembered in `localStorage` (`kad.readaloud`) and is **off by default**. A browser
  without `SpeechSynthesis` gets no switch.
- Off means no speaker is installed: `speak()` is the no-op it always was, and no speaker icons are
  drawn. Nothing else about the game changes.
- A new line cancels the old one. Scene narration, roll prompts and spoken taps use
  `interrupt: true`; the phone's choice list and hand-off asides queue instead.

## Who speaks what

Each device decides for itself, and speaks only when its own switch is on.

| Surface | Reads |
| --- | --- |
| Party Mode display (TV) | narration, "X's turn", roll prompts, hand-offs |
| Party Mode phone | its own player's choices (once per question) |
| Travel Mode phone | both, narration first, then its choices |

The TV does not read the option list. Phones are the ones that choose, and a TV reading every
list would talk over a phone reading its own. The options are on the TV screen as always.

## Hearing a choice before picking it

With read-aloud on, each choice on the phone gets a speaker button beside it. We chose a separate
icon over tap-once-to-hear because the phone already has a deliberate two-step (tap to pick, then
"Do it!"), and a tap that sometimes only speaks would make that step ambiguous. The icon is its own
big target (spec §11) and never picks anything.

## For help text and the tutorial (#255, #256)

```ts
import { hear, useReadAloud } from "../speech";
hear("Tap the glowing card.", { source: "ui" });
```

- `hear(text, opts)` is for a button that says "read this to me". It interrupts, and works even with
  the device switch off, because the tap is the request.
- `speak(text, opts)` (from `@kad/shared`) is for text that should be read to a device that has
  read-aloud on, without being asked. A silent no-op otherwise.
- `stopSpeaking()` cuts off the current line.

## Swapping the voice

The engine is `packages/client/src/speech/synth-speaker.ts`, loaded on demand so the entry chunk
doesn't pay for it. A better voice is another `Speaker` (a function with an optional `cancel`)
returned from `loadEngine()` in `read-aloud.ts`.
