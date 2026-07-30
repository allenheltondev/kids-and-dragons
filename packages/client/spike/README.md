# Chapter 0 spike — Rive rigs in a Pixi scene

`docs/art-pipeline.md` §7 leaves one decision open, and it gates all the rigging work:

> stand up 7 concurrent Rive rigs composited into a Pixi scene and measure frame time on the
> actual TV-connected hardware. If it doesn't hold 60fps, the fallback is a custom transform rig
> […] Decide this before any rigging work starts, because it determines the authoring tool.

This directory is that measurement. It is a spike, not app code: it lives outside `src/`, is not
in the production bundle (`vite build` only takes `index.html`), and it is in the typecheck so it
cannot rot silently.

```bash
npm run spike:rive          # then open the printed LAN URL on the TV-connected machine
```

## What it measures, and why it's shaped this way

Seven rigs is 3 players + 4 enemies — the worst party/encounter spec §7.1 allows. Each rig gets
its own offscreen canvas and Rive renderer; every frame the canvas is uploaded as a Pixi texture
and drawn as a sprite. Sprites are sized from `world/scene.ts`'s real numbers (1600×900 design
space, character at 46% of design height), so this is the size a character is in play.

The loop is split into three timed phases, because "it's slow" and "the *seam* is slow" are
different findings with different fixes:

| Phase | What it is | If this is the cost |
|---|---|---|
| `rive` | advance + draw every artboard | The runtime itself is too expensive → the §7 fallback |
| `upload` | canvas → GPU texture, per rig | The seam is the problem → smaller offscreen buffers first |
| `pixi` | compositing the scene | Not a Rive question at all |

Two deliberate choices that make the number harsher than it could be, both so a pass means
something:

- **Every rig uploads every frame.** §7 says "only dirty rigs re-upload", which is the right
  production optimisation — but every figure on a board plays `idle`, and `idle` is a 24-tick
  loop, so in the state the game is in most of the time *every rig is dirty every frame*. The
  checkbox exists to show the size of that saving, not to improve the headline.
- **The verdict is frame time, never displayed fps.** A run capped at 60fps by vsync looks
  identical to one with 10× headroom. `p95 frame time ≤ 16.67ms` is the pass line.

## Results

Fill a row in per machine. **The dev box does not decide this** — §7 names the TV-connected
hardware specifically, and it is the only row that settles the question.

| Machine | Rigs | Offscreen | p95 frame | rive / upload / pixi | Verdict |
|---|---|---|---|---|---|
| Dev box — Win11, Chrome 150, 3440×1440 @ dpr 1 | 7 | 512px | **2.20 ms** | 1.15 / 0.10 / 0.09 ms | holds (0/361 frames over budget) |
| **TV-connected machine** | 7 | 512px | — | — | **not yet run** |

Read the dev-box row as "the approach is not obviously doomed", nothing more. It has ~7× headroom
on hardware that is not the constraint; the TV is.

## Caveat worth keeping in mind

The rig this loads (`art/rig/unicorn_fledgling_idle.riv`) has **one clip**. A finished rig has
eleven, plus a state machine with real transitions — more objects to advance per frame, though
still only one animation playing at a time. Re-run this once a full rig exists; if the TV row is
close to the line, that difference matters.
