# Kids & Dragons

A family tabletop adventure for kids around eight and the grown-ups at the table with them. The
story plays on a TV, everyone holds a phone as a controller, and an adult reads the scene aloud.
One chapter is one sitting of 30 to 45 minutes. Campaigns are played in chapters, and the party
keeps its heroes from one evening to the next.

The design rules are short. Kids tap; they never type. Nobody dies: a hero at zero is knocked down,
and a lost fight changes the story, never ends it. Everything at the table is written ahead of
time by people. No AI or model runs while a family plays.

The full design is [docs/spec.md](docs/spec.md).

## How a table plays

- **Party Mode.** The TV (any browser, or a tablet as a small TV) shows the shared world: the
  scene, the figures, the fight board, the room code and a QR to join. Each phone shows that
  player's choices, hero and bag.
- **Travel Mode.** No TV. Each phone switches between World, Map and You from a tray, for the car
  or a restaurant.
- The mode is picked per room and can change mid-session. Any screen can be refreshed without
  losing the game.
- **Read-aloud.** The text is written to be read off the TV by an adult. A per-device switch also
  speaks narration and choices with the browser's voice ([docs/read-aloud.md](docs/read-aloud.md)).
- **Heroes.** Each player builds a hero from six species (Unicorn, Dragonling, Griffin, Bigfoot,
  Kitsune, Manticore) and four classes (Thornguard, Duskrunner, Starweaver, Songkeeper). Checks
  are a d20 plus one of four stats: Might, Quick, Clever, Heart. Fights are on a small tactical
  grid.
- **Every chapter has a goal on screen**, a sentence and two to four steps that tick as the party
  does them. The TV and every phone show it with nothing to tap.
- **Between games** each kid has an adventure book at `/journal` and a Field Guide of what they
  found. Grown-ups get a guide in the app at `/guide`.

A table seats one to four players. Nobody signs up to play: a game starts anonymously, and a
grown-up can sign in later (email code, then an optional passkey) to keep what the household
played.

## Campaigns

| Campaign | Status | What it is |
|---|---|---|
| **First Steps** | Shipped, 1 chapter | The practice: a meadow, a faun with a clipboard and a wisp who loves tag. Teaches the controls. No XP or items. |
| **Gemfall** | Shipped, 16 chapter files | The main campaign. Mount Red Sky erupts and gemstones rain across the realm. Eight story beats, with branching roads in the middle (chapters 3, 4, 5 and 7 each come in three versions). See [docs/campaigns/gemfall.md](docs/campaigns/gemfall.md). |
| **The Hollow Crown** | Reference, 1 chapter | `bramblewood-01`. It exists to prove the loader, schema and renderer end to end and pins the e2e suite. It is also the voice the other chapters are matched against. |
| **Riftlight** | Draft, not shipped | The sequel to Gemfall, a nonlinear "graph" campaign. Its opening lives in [content/drafts/riftlight/](content/drafts/riftlight/README.md) and plays only in a local preview (`npm run riftlight:preview`). Design bible: [docs/campaigns/continental-rift/](docs/campaigns/continental-rift/). |

Class mastery is partly built: heroes earn Apprentice, Expert and Master distinctions by doing
their class's deeds, swap class once for free at the Exchange's fitting stall, and otherwise change
class only at that class's own place. The four class places are written for the Riftlight draft so
far. See [docs/class-mastery.md](docs/class-mastery.md).

## Privacy

- **No AI at the table.** No model call happens while a table plays, nothing a kid picks or does is
  sent to one, and nothing in the repo calls a model or a generation API
  ([architecture §6](docs/architecture.md#6-no-model-at-play-time)). Chapters, art and sound are
  made by people and committed like code.
- **Data minimization by design.** A kid's profile has a nickname and nothing else personal: no
  real name, email, birthday or contact detail. A grown-up is the account holder. Guest households
  nobody claims are deleted after 7 days.
- **What we store.** The app's "What we store, and for how long" page lists every row the game keeps
  and how long it lives (`packages/client/src/screens/what-we-store.ts`; a test fails if a stored
  field is not described there). The engineering version is in
  [architecture, "Her own record"](docs/architecture.md#her-own-record-283).
- **COPPA.** The design aims at it, but whether and how children's-privacy law applies is reserved
  for a privacy review before the game is offered beyond our own tables. That review starts from
  what the system actually collects.

## Quick start

Needs Node 22.18 or newer. Python 3 is only needed for the art gate.

```bash
./scripts/setup.sh     # npm install, plus Pillow, numpy and cfn-lint for the art and infra checks
npm run dev            # dev server on :8787, Vite on :5173
```

Open http://localhost:5173, start a game, and pick **Party** or **Travel**. In Party Mode, open
`/tv/<code>` on the TV and join from phones with the four-letter code or the QR. Vite binds
`0.0.0.0`, so real phones on the same Wi-Fi use the laptop's LAN address
(`http://192.168.x.x:5173`). That is how most development happens.

**Playtest drawer.** The dev server, and only the dev server, has a Playtest drawer at the bottom
of each phone pane: jump to any scene in the chapter, or choose the next d20's face. Deployed
servers refuse both, and the drawer is compiled out of production builds
([packages/shared/src/playtest.ts](packages/shared/src/playtest.ts)).

**Playwright.** `npm run e2e` boots `npm run dev` (or reuses one already running) and plays
against it in Chromium. If Playwright's own browser is not installed, point `KAD_CHROMIUM` at a
Chromium binary, for example `KAD_CHROMIUM=/opt/pw-browsers/chromium npm run e2e`. Other configs:
`playwright.prod.config.ts` (`npm run e2e:prod`, the production build and service worker),
`playwright.wiki.config.ts` (the built wiki) and `playwright.cast-review.config.ts`.

**DynamoDB.** `npm test` runs the storage contract suite against the in-memory store. With Docker,
`npm run ddb:local` and then `npm run test:ddb` run the same suite against DynamoDB Local.

## Repository layout

```
packages/shared    the contract and the engine: types, rules, dice, characters,
                   inventory, the chapter graph, the state machine
packages/server    rooms, event log, JSON Patch sync; one set of handlers behind
                   the local dev server and the Lambdas
packages/client    React + Vite + PixiJS: the TV's WorldView and the phone's PlayerView
packages/canon     schemas, parser and registry for canon/
canon/             the world's source of truth in YAML: places, creatures, items, people
content/           rules, items, abilities, maps, campaigns and chapters, as JSON
content/drafts/    unshipped campaigns (Riftlight)
schemas/           JSON Schema for everything in content/
assets/            the art, with manifest.json as its machine-readable contract
art/               art sources and review sheets
tools/             content, canon, art, audio, perf, wiki and load tools
infra/             the AWS SAM template and the Lambda bundler
wiki/              the Hugo wiki: player guide and world encyclopedia
e2e/               Playwright specs
docs/              design, architecture, pipelines and authoring guides
```

Each seam has a local and an AWS implementation, and one test suite holds both to the same
behavior:

| Seam | Local | AWS |
|---|---|---|
| `GameRepository` | `MemoryRepository` | `DynamoRepository` |
| `RoomChannel` (publish) | `LocalSseChannel` | `AppSyncEventsChannel` |
| `EventSourceLike` (subscribe) | `EventSource` over SSE | `sync/appsync-socket.ts` |
| `IdentityService` | `DevIdentity` (unsigned, never deployed) | `TokenIdentity` |
| Entry point | `dev-server.ts` | `lambda/http.ts` |

Characters, people and monsters are finished static illustrations with a subtle procedural
breathing loop; there is no animation rig runtime ([docs/art-pipeline.md](docs/art-pipeline.md)).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server and Vite together |
| `npm run build` | The client bundle |
| `npm run typecheck` | `tsc` across shared, canon, server, client and tools |
| `npm test` | Vitest, including the `tools/**` content suites |
| `npm run test:coverage` | The same, with coverage |
| `npm run e2e` / `npm run e2e:prod` | Playwright against the dev server / the production build |
| `npm run content:validate` | Schemas and scene graphs. A malformed chapter fails here. |
| `npm run content:continuity` | Names a scene uses that some way in never introduced |
| `npm run content:pacing` | Shortest and typical path per chapter, minutes, reading runs and doing checks. Reports only. |
| `npm run content:graph` | Draws each chapter's scene graph to `.graph/*.html` |
| `npm run content:balance` | Plays out each authored fight and reports rounds and damage. Reports only. |
| `npm run content:journey` | Explores a graph campaign's journeys |
| `npm run riftlight:preview` | Plays the Riftlight draft locally |
| `npm run canon:check` | Validates `canon/` |
| `npm run canon:bestiary`, `canon:items`, `canon:world`, `canon:field-guide` | Regenerate the content projections from canon |
| `npm run art:verify` | The art contract against `assets/manifest.json` |
| `npm run art:sheet` | Contact sheets for art review |
| `npm run art:inventory` | What is left to draw. Reports only. |
| `npm run audio:verify` / `audio:import` | Check sounds / bring a sound in by hand |
| `npm run perf:bundle` | The bundle budget |
| `npm run load` | A load test against a running server |
| `npm run wiki:generate` / `wiki:build` | Wiki pages from canon / the full Hugo and Pagefind build |
| `npm run infra:lint` / `infra:build` | Lint the SAM template / bundle the Lambdas |
| `npm run infra:deploy` | `scripts/deploy.sh`: checks, bundle, stack, upload, invalidate |

`package.json` has a few more single-purpose scripts (atlas, portraits, guide pictures, audio
previews).

## Writing a chapter

Chapters are written by people, working with a coding agent, straight into
`content/chapters/` as JSON. Read these first:

- [CLAUDE.md](CLAUDE.md): the house rules in short (story shape, interactivity, continuity, voice)
- [content/README.md](content/README.md): the format, including the chapter's goal, interactivity
  and priority scenes
- [docs/campaigns/gemfall-authoring.md](docs/campaigns/gemfall-authoring.md): the rules as worked
  out on Gemfall
- [docs/campaigns/graph-campaigns-authoring.md](docs/campaigns/graph-campaigns-authoring.md): for a
  nonlinear campaign like Riftlight
- [.claude/skills/chapter-cohesion/SKILL.md](.claude/skills/chapter-cohesion/SKILL.md): a six-check
  review (nothing unannounced, the opening states the goal, doing over talking, and more) with the
  commands that verify each

Then run `content:validate`, `content:continuity`, `content:pacing` and `content:graph`, and the
read-only helpers in `node tools/content/cohesion.mjs` (`opening`, `merges`, `setbacks`, `idioms`,
`concept`), and play it with the Playtest drawer. A chapter goes live when its campaign's
`chapters` array lists it.

## Tests and gates

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on every push to main and every
pull request, and skips jobs a change cannot affect. Its build job runs:

- `typecheck`, then the tests with coverage, including the storage contract against DynamoDB Local
- `infra:lint` and `infra:build`
- `canon:check`, and a diff that fails if a generated projection is stale
- `content:validate`, `art:verify` and `audio:verify`
- the client build and `perf:bundle`: 315 KB uncompressed for first paint, 1400 KB in total

`content:continuity` gates through its vitest suite: a finding not in
`tools/content/continuity-allow.json` fails. `content:pacing` and `cohesion.mjs` report and never
gate.

End to end runs in six Playwright shards plus a production-build job, and a short load smoke runs
four tables against the dev server.

**Gemfall is pinned.** `packages/server/src/handlers/gemfall-compat.test.ts` hashes every Gemfall
file and digests its gameplay (every ending, road and legacy save). A deliberate wording edit
re-takes the file hashes and says why in the commit; the gameplay digests must not move.

## Deploy

- **Staging.** Every pull request deploys to one shared staging stack and comments the commit it
  is serving ([deploy.yml](.github/workflows/deploy.yml)).
- **Production.** When CI passes on main, [prod-deploy.yml](.github/workflows/prod-deploy.yml)
  ships CI's build artifact to the prod stack. Rollback is a manual dispatch with a ref.
- Both run the same `scripts/deploy.sh` a laptop runs, with short-lived GitHub OIDC credentials
  and no stored AWS keys. Content ships inside the Lambda, so a new chapter needs a deploy.
- **Wiki.** [wiki-deploy.yml](.github/workflows/wiki-deploy.yml) builds the Hugo wiki from canon
  and content on pushes to main and publishes it to GitHub Pages.

Details: [docs/deploy.md](docs/deploy.md).

## In progress

Open pull requests: a "Last time…" preface before a chapter's first scene (#378); the rest of the
Gemfall cohesion fixes from the #368 audit (#372, #373, #376, #381); and the remaining Riftlight
regions, Convergence and the finale (#374, #375, #377, #379, #380, #382). Group actions on phones
are designed ([docs/briefs/group-actions.md](docs/briefs/group-actions.md)) but not yet built.

## Further reading

- [docs/spec.md](docs/spec.md): the game design
- [docs/architecture.md](docs/architecture.md): stack, data model, sync protocol, accounts
- [docs/roadmap.md](docs/roadmap.md): the build order
- [docs/deploy.md](docs/deploy.md) and [docs/hardware.md](docs/hardware.md): AWS and the TV
- [docs/art-pipeline.md](docs/art-pipeline.md), [docs/asset-brief.md](docs/asset-brief.md),
  [docs/audio-pipeline.md](docs/audio-pipeline.md): art and sound
- [docs/canon-contract.md](docs/canon-contract.md): canon and what is derived from it
- [docs/accessibility.md](docs/accessibility.md) and [docs/read-aloud.md](docs/read-aloud.md)
- [docs/guide/README.md](docs/guide/README.md): the grown-up's guide

Lockfile maintenance: run `npx npm@10.9.4 install --package-lock-only` to match CI.
