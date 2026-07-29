# Kids & Dragons

A tabletop-style adventure for three players — two adults and an 8-year-old — played on a TV with
phones as controllers, or phone-only on the road. ~30 minutes a sitting, campaigns played in
chapters.

She taps, she doesn't type. Nobody dies. The party is persistent.

The design lives in [`docs/spec.md`](docs/spec.md); the stack and protocol in
[`docs/architecture.md`](docs/architecture.md); the build order in [`docs/roadmap.md`](docs/roadmap.md);
how it gets to AWS in [`docs/deploy.md`](docs/deploy.md).

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
packages/server     rooms, event log, JSON Patch broadcast. One set of
                    transport-free handlers behind two entry points: the
                    local dev server, and the Lambdas in src/lambda/.
packages/client     React + Pixi. WorldView and PlayerView, composed by a
                    layout shell that is the only thing that knows the mode.
infra/              the SAM template and the Lambda bundler
content/            rules, items, campaigns, chapters — the game as data
schemas/            JSON Schema for all of the above, enforced in CI
assets/             commissioned character art + manifest.json, the contract
art/                art source, review sheets, and the split scripts
tools/              the art gate and the content validator
```

Each seam has a dev implementation and a prod one, and one test suite holds them
to the same behaviour:

| Seam | Local | AWS |
|---|---|---|
| `GameRepository` | `MemoryRepository` | `DynamoRepository` |
| `RoomChannel` (publish) | `LocalSseChannel` | `AppSyncEventsChannel` |
| `EventSourceLike` (subscribe) | `EventSource` over SSE | `sync/appsync-socket.ts` |
| `IdentityService` | `DevIdentity` *(unsigned — never deployed)* | `KmsIdentity` |
| entry point | `dev-server.ts` | `lambda/http.ts` |

## Checks

| Command | What it holds |
|---|---|
| `npm run typecheck` | all three packages |
| `npm test` | unit tests |
| `npm run content:validate` | schemas, plus unresolved `goto`, unreachable scenes, unknown `itemId` |
| `npm run art:verify` | the mechanical art contract ([docs/art-pipeline.md](docs/art-pipeline.md)) |
| `npm run art:sheet` | regenerates the review contact sheets |
| `npm run e2e` | three browser contexts playing a chapter against the real stack |
| `npm run infra:lint` | the SAM template, with the transform applied |
| `npm run infra:build` | bundles the Lambdas — a deploy that would fail, failing here |
| `npm run build` | the client bundle |

`npm test` runs the repository contract suite against the in-memory store. Point
`KAD_DDB_ENDPOINT` at a DynamoDB (`npm run ddb:local`, then `npm run test:ddb`)
and the same suite runs against `DynamoRepository` too. CI always does both.

All of them run in CI on every push. The e2e suite is its own job — minutes
rather than seconds, and a red e2e means something different from a red unit
test. Locally it needs a Chromium; point `KAD_CHROMIUM` at one if Playwright's
own download isn't there.

---

## What's built

Roadmap **Chapter 0 through Chapter 3** — the first playable — running locally, plus the
infrastructure and persistence it deploys onto:

- accounts and character creation
- rooms, server-authoritative state, JSON Patch sync, reconnect, both presentation modes
- the chapter loader, scene renderer, choices, species gating, and the dice roll
- the AWS stack in SAM: DynamoDB, AppSync Events, Cognito, KMS, S3 + CloudFront, `./scripts/deploy.sh`
- **anonymous play by default**, with optional sign-in that claims the household you are
  already playing in. Nobody signs up to play; signing in is how you keep what you played.
  Unclaimed households are swept after 7 days.
- the keepsake flow — offered at the end of a chapter, with the characters you just played
  drawn as lights in a lantern. Emailed code, then an optional passkey. No password anywhere.

**Not built yet:** tactical combat (Chapter 4) — an encounter scene currently resolves through its
`onVictory` branch as a marked placeholder so a chapter stays walkable end to end. Also outstanding:
Rive rigs (the client composites static tier PNGs with procedural motion in the meantime),
progression and inventory commitment at the campaign boundary, the authoring tools, and the live
LLM layer.

The art contract is real and enforced: all six species are approved across all four tiers, 382
mechanical checks green. Anything that fails to load still draws a clearly-placeholder silhouette
rather than a broken image.
