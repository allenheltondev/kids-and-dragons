# Kids & Dragons

A tabletop-style adventure for three players — two adults and an 8-year-old — played on a TV with
phones as controllers, or phone-only on the road. ~30 minutes a sitting, campaigns played in
chapters.

She taps, she doesn't type. Nobody dies. The party is persistent.

The design lives in [`docs/spec.md`](docs/spec.md); the stack and protocol in
[`docs/architecture.md`](docs/architecture.md); the build order in [`docs/roadmap.md`](docs/roadmap.md).

---

## Getting it running

```bash
./scripts/setup.sh     # node deps + the Pillow/numpy the art gate needs
npm run dev            # dev server on :8787, Vite on :5173
```

Then open **http://localhost:5173**.

The Vite server binds `0.0.0.0`, so testing with real devices is the laptop's LAN address —
`http://192.168.x.x:5173` — on all three phones. That is how nearly all development happens
([architecture §7](docs/architecture.md#7-environments)); a change that hasn't been seen on a TV
*and* in three-phone Travel Mode isn't done.

### Playing a session locally

1. One device opens `/` and starts a game, choosing **Party** (TV + phones) or **Travel** (phones only).
2. Party Mode puts the WorldView on `/tv/<code>` — open that on the TV browser.
3. Everyone else joins with the 4-letter code, or by scanning the QR.
4. Build a character each, ready up, play the chapter.

Any surface can be hard-refreshed at any time without losing the session.

---

## Layout

```
packages/shared     the contract and the engine — types, rules, dice,
                    resolveCharacter, inventory, chapter graph, state machine
packages/server     the local dev server: rooms, event log, JSON Patch
                    broadcast over SSE, handlers shaped like the Lambdas
                    they become
packages/client     React + Pixi. WorldView and PlayerView, composed by a
                    layout shell that is the only thing that knows the mode.
content/            rules, items, campaigns, chapters — the game as data
schemas/            JSON Schema for all of the above, enforced in CI
assets/             commissioned character art + manifest.json, the contract
art/                art source, review sheets, and the split scripts
tools/              the art gate and the content validator
```

## Checks

| Command | What it holds |
|---|---|
| `npm run typecheck` | all three packages |
| `npm test` | unit tests |
| `npm run content:validate` | schemas, plus unresolved `goto`, unreachable scenes, unknown `itemId` |
| `npm run art:verify` | the mechanical art contract ([docs/art-pipeline.md](docs/art-pipeline.md)) |
| `npm run art:sheet` | regenerates the review contact sheets |
| `npm run build` | the client bundle |

All of them run in CI on every push.

---

## What's built

Roadmap **Chapter 0 through Chapter 3** — the first playable — running locally:

- accounts and character creation (a local identity stand-in, not yet Cognito)
- rooms, server-authoritative state, JSON Patch sync, reconnect, both presentation modes
- the chapter loader, scene renderer, choices, species gating, and the dice roll

**Not built yet:** tactical combat (Chapter 4) — an encounter scene currently resolves through its
`onVictory` branch as a marked placeholder so a chapter stays walkable end to end. Also outstanding:
AWS deployment, Cognito and device tokens, Rive rigs (the client composites static tier PNGs with
procedural motion in the meantime), progression and inventory commitment at the campaign boundary,
the authoring tools, and the live LLM layer.

The art contract is real and enforced: only the unicorn is approved so far, in all four tiers. The
other five species render as clearly-placeholder silhouettes rather than pretending.
