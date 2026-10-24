# What the display runs on

The shared screen (`/tv/ABCD`) is a web page. Most tables will put it on a laptop over HDMI, but
a smart TV's own browser, a streaming stick, or a tablet propped up on the table all work, as far
as a browser can promise. This page records what has been tried and what each device did.

## What the display needs, and what it does without

| Needs | If the screen has it | If it does not |
|---|---|---|
| **WebGL** | The animated board (Pixi). | A still board: the scene's backdrop, the party in a row, and during a fight the enemies and everyone's hit points. Every word and every control is still on screen, so a chapter plays end to end. |
| **Screen Wake Lock** | The screen is asked to stay awake for as long as the display is open, and asked again whenever the tab comes back, since browsers let go of it when the tab hides. | Nothing happens. Turn off the TV's sleep timer, screensaver and Energy Saving instead: on most sets those are the thing that dims a chapter, not the browser. |
| **Full screen** | A **Full screen** button in the corner row drops the TV browser's address bar, which otherwise sits over the top of the painted scene and costs real height at the largest text. A screen that has been full asks again by itself on the first remote press of the next load, so it is set up once, not every chapter. Leaving full screen on purpose stops it asking. | The button never appears, and the browser's own furniture stays. |
| **Audio** | Music and sound effects. | A browser that holds sound back until a tap shows one **Tap for sound** button on the display. Until it is tapped, and for a browser with no audio at all, the game plays silent and never waits. |
| **Service worker** | The adventure book and the game's art open without a signal. | Everything works online; nothing is saved for offline. |

If a screen sleeps anyway (a TV that ignores the wake lock, or a stick that freezes the page),
the display notices when it wakes, opens a fresh connection and fetches everything it missed from
the last event it had, the same recovery as a hard refresh
([architecture §4.3](architecture.md#43-reconnect)). Nobody has to touch it.

## How old the browser is, and why it matters more than the panel

A TV's browser is years behind the TV. A 2024 Samsung is Tizen 8, whose browser is Chromium
around 108; a 2023 set is nearer 94. The year on the box says nothing about it, and the number is
the only fact that decides whether the display draws correctly, because CSS does not degrade
politely: a declaration the browser cannot parse is dropped whole, so one colour function too new
takes the scrim out from behind the narration and leaves the words on painted art.

So the display is written to a floor, and the floor is written down twice:

- [`packages/client/vite.config.ts`](../packages/client/vite.config.ts) — `build.target`, which
  lowers JavaScript syntax to it. Vite's own default is newer than any TV in a living room.
- [`packages/client/src/styles/baseline.test.ts`](../packages/client/src/styles/baseline.test.ts) —
  the same number for CSS, which the build does **not** lower. Anything newer needs a plain
  fallback declaration before it, and the test fails when one is missing.

The floor is Chromium 108, the 2024 Samsung above. Raising it is a deliberate act: change both,
and only once a row below proves a newer browser on a real screen.

## Seeing what a screen supports

Open the display and choose **About this screen** (top left), or add `?perf` to its address
(`/tv/ABCD?perf`), which opens the same panel and also shows the frame meter. It lists WebGL,
the wake lock, full screen, audio and the service worker, each as Yes or No with a line saying
why, and the screen size and the browser's own name. Photograph it or copy it into the table
below. **The browser's name is the useful part**: it carries the Chromium version the section
above turns on.

On a TV where typing an address is hard, the button can be reached with the remote.

## Tested hardware

"Proves" means a person or CI has seen this on that device. A blank row has not been tried.
Please fill a row in after trying a device, and note the date and the browser version.

### What CI proves

| Device | Browser | WebGL | Wake lock | Audio | Service worker | Chapter plays to the end | Notes |
|---|---|---|---|---|---|---|---|
| CI runner (headless Chromium 141, Linux) | Chromium | Yes, WebGL 2 through SwiftShader (software) | Yes, held | Yes (headless lets sound start) | Production build only; [`e2e/offline.spec.ts`](../e2e/offline.spec.ts) | Yes, [`e2e/first-playable.spec.ts`](../e2e/first-playable.spec.ts) | CI has no real screen, speaker or GPU. |
| Same, with WebGL, WebAssembly, wake lock and audio taken away | Chromium | No | No | No | n/a | Plays from the lobby to the first check on still art and a plain board, [`e2e/display-hardware.spec.ts`](../e2e/display-hardware.spec.ts) | What a bare smart-TV browser should look like. It is a simulation, not a TV. |

### On real hardware (to fill in)

| Device | Browser and version | WebGL | Wake lock | Audio | Service worker | Chapter plays to the end | Frame rate (`?perf`) | Date | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Samsung smart TV, 2024 | Tizen 8 (Chromium ~108) — confirm from **About this screen** | | Expected No (no Wake Lock API in the TV browser; turn off Energy Saving) | | | | | | The browser app draws straight to the panel, so there is no overscan to pad for; that is an HDMI-input picture mode, not this. The display is written to this browser's floor (above). |
| Smart TV (make, model, year) | | | | | | | | | |
| Casting or streaming stick (make, model) | | | | | | | | | |
| Tablet used as the display (make, model) | | | | | | | | | |

[Issue #264](https://github.com/allenheltondev/kids-and-dragons/issues/264) stays open until at
least one of the real rows shows a chapter played end to end.

## Notes for whoever fills this in

- Open the display, choose **About this screen**, and copy what it says into the row.
- Join with a phone, make a hero, and play to the end of a chapter. Say in the notes if anything
  stuttered, looked wrong, or needed a tap you did not expect.
- Let the screen sit untouched for a few minutes mid-chapter, then see whether it carried on or
  caught up on its own.
- A stick that shows the page by casting a tab from a phone or laptop is the sending device's
  browser, not the stick's. Record both.
