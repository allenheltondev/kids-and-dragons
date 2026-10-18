# Kids & Dragons — Technical Architecture

Companion to [spec.md](./spec.md). Covers stack, AWS topology, data model, sync protocol,
chapter schema, and LLM integration.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + Vite + TypeScript** | One bundle serves both TV and phone clients; the client role is a route. |
| Scene rendering | **PixiJS (WebGL)** | Grid, characters, effects, camera. Predictable perf on modest TV-connected hardware. |
| Character animation | **Rive** | Raster cutout rigs with state machines. Rendered to texture, composited into the Pixi scene. |
| UI chrome | **React + CSS** | Menus, character sheets, choice buttons. Never inside the canvas. |
| State | **Zustand** | Small, no boilerplate, easy to mirror server state into. |
| Backend | **AWS Lambda (Node 22, TypeScript)** | |
| Auth | **Anonymous by default**; optional **Cognito user pool** + **device-bound tokens** | Nobody signs up to play. Signing in is how you *keep* what you played. Custom UI, not the hosted one. See §4.5. |
| Realtime | **AWS AppSync Events** | Managed pub/sub. Room = channel. No connection table to maintain. |
| Data | **DynamoDB, single table** | |
| Assets & hosting | **S3 + CloudFront** | |
| LLM | **Claude in Amazon Bedrock** | Same AWS account the rest of the stack deploys into. SigV4 off the Lambda's execution role, so the server holds no key. |
| Art assets | **Commissioned from a coding agent** | We own the contract ([asset-brief.md](./asset-brief.md)) and the CI gate, not a generation pipeline. |
| IaC | **AWS SAM** — [`infra/template.yaml`](../infra/template.yaml) | One template, one region, two long-lived stacks (staging, prod) plus an optional dev stack. See [deploy.md](./deploy.md). |

### 1.1 Why AppSync Events over API Gateway WebSockets

API Gateway WebSockets requires you to own a connection table, handle `$connect`/`$disconnect`,
track stale connections, and fan out manually. AppSync Events gives managed channels with
subscribe/publish semantics and roughly a third of the code for this shape of problem.

If you'd rather use Momento Topics, it's a single-file swap — the transport is isolated behind
a `RoomChannel` interface (§4.4) precisely so this choice is reversible.

### 1.2 Why Claude Platform on AWS, not Bedrock

Bedrock is partner-operated: feature availability lags and model IDs carry an `anthropic.` prefix.
Claude Platform on AWS is Anthropic-operated with same-day API parity, while still giving you
SigV4 auth, AWS IAM access control, and AWS Marketplace billing. Model IDs are bare
(`claude-haiku-4-5`, `claude-opus-5`).

Requires `AWS_REGION` and `ANTHROPIC_AWS_WORKSPACE_ID`; neither has a default.

---

## 2. AWS topology

Everything below is [`infra/template.yaml`](../infra/template.yaml). CloudFront is
the only front door: it serves the SPA, the art, and the chapter JSON from S3, and
proxies `/api/*` to the HTTP API. One origin means the browser never makes a
cross-origin request, which is why the stack configures no CORS policy at all.

```
                          ┌──────────────┐
   TV browser ────────────│              │──── S3   /            SPA bundle
                          │  CloudFront  │         /assets/*     art
   Phone browsers ────────│              │         /content/*    chapters, rules
                          └──────┬───────┘
                                 │ /api/*
                    ┌────────────┴────────────┐
                    │                         │
            ┌───────▼────────┐      ┌─────────▼─────────┐
            │  HTTP API      │      │  AppSync Events   │
            │                │      │  room/<code>      │
            └───────┬────────┘      └────▲────────▲─────┘
                    │              IAM   │        │  AWS_LAMBDA
                    │            publish │        │  connect + subscribe
            ┌───────▼─────────────────────┴───┐ ┌─┴──────────────────────┐
            │  Lambda: api                    │ │ Lambda: channel-       │
            │  rooms · actions · state · auth │ │ authorizer             │
            │  validate → apply → persist →   │ │ is this token for      │
            │  broadcast                      │ │ this room?             │
            └───────┬─────────────────────────┘ └────────────────────────┘
                    │
        ┌───────────┼──────────────┬────────────────────┐
        │           │              │                    │
  ┌─────▼─────┐ ┌───▼───────┐ ┌────▼─────────┐ ┌────────▼────────┐
  │ DynamoDB  │ │ SSM       │ │ Cognito      │ │ Lambda: sweep   │
  │ (1 table) │ │ (Secure-  │ │ (optional    │ │ (scheduled —    │
  │           │ │  String:  │ │  sign-in)    │ │  guest expiry)  │
  │           │ │  token    │ │              │ │                 │
  │           │ │  key)     │ │              │ │                 │
  └─────▲─────┘ └───────────┘ └──────────────┘ └────────┬────────┘
        └────────────────────────────────────────────────┘
```

Three functions rather than one per route. The split that matters is **blast
radius**, not URL: every HTTP route needs the same three permissions (table, key,
publish), so splitting them further would buy nothing and cost cold starts on a
game where a two-second pause is fatal to momentum. The other two are genuinely
different — the authorizer can only read and verify, the sweeper can only delete
— and each carries the smallest policy that lets it work.

The LLM proxy (§6) is roadmap Chapter 7 and is not in the stack yet. When it
lands, **the Anthropic credential never leaves Lambda** — the browser has no path
to it.

---

## 3. Data model

Single DynamoDB table, `kad`. Composite key `PK` / `SK`, one GSI (`GSI1PK` / `GSI1SK`).

| Entity | PK | SK | Notes |
|---|---|---|---|
| Account → household | `ACCT#<cognitoSub>` | `HH#<hhId>` | Written only when somebody signs in. An adult may own more than one. **This pointer is the authority**: every "may this account manage it?" reads it. |
| Household | `HH#<hhId>` | `META` | The family. `ownerSub` (null while anonymous), `guest`, `expiresAt`, display name. |
| Player profile | `HH#<hhId>` | `PLAYER#<playerId>` | Display name, color, avatar, and `retired` once an owner takes the kid off the pickers (#248). No role (#265): rows written before still carry `role`, and nothing reads it. |
| Device binding | `HH#<hhId>` | `DEVICE#<deviceId>` | → playerId, token hash, last seen, user agent. Revocable. |
| Owner | `HH#<hhId>` | `OWNER#<cognitoSub>` | One grown-up who may manage the household (#248), with the email they signed in with. Written in one transaction with that account's `ACCT#` pointer, and removed with it. |
| Character | `HH#<hhId>` | `CHAR#<charId>` | Owned by a playerId, and stored under that kid's **home** household wherever she plays (§4.5, "Who owns what"). Persistent across campaigns. See §3.1. |
| Campaign run | `HH#<hhId>` | `RUN#<runId>` | One playthrough of one campaign. |
| Field Guide | `HH#<hhId>` | `FIELDGUIDE` | The household's permanent record of discoveries: `entries` keyed by canon id → `{ firstFoundBy, foundAt, runId? }`. One item, written with per-key `if_not_exists` so the first finder always wins and concurrent writers merge. Versioned (`FIELD_GUIDE_VERSION`). |
| Chapter progress | `RUN#<runId>` | `CHAPTER#<n>` | Status, branch taken, XP earned. |
| Game state | `RUN#<runId>` | `STATE` | Current authoritative snapshot. Single item. |
| Event log | `RUN#<runId>` | `EVT#<seq>` | Append-only. Enables replay and reconnect. |
| Room | `ROOM#<code>` | `META` | 4-letter code → runId, mode (`party` \| `travel`). **TTL 6 hours.** |
| Code misses | `GUESS#<client>` | `WINDOW#<n>` | Wrong room codes from one client in one 15-minute window (§4.5, "Joining a session"). Wrong organizer codes are counted the same way, per account. **TTL one window past its own.** |
| Organizer invite | `INVITE#<code>` | `META` | A single-use code that makes whoever signs in with it an owner of one household (§4.5, "Groups"). Spent by a conditional delete. **TTL 3 days.** |

GSI1 does three jobs, all of them lookups that would otherwise be scans:

| `GSI1PK` | `GSI1SK` | On | Answers |
|---|---|---|---|
| `DEVICE#<deviceId>` | `HH#<hhId>` | device items | a returning phone → its household and player |
| `RUN#<runId>` | `HH#<hhId>` | run items | a runId alone → the household that owns it |
| `GUEST` | `<expiresAt>#<hhId>` | **guest** household items only | which anonymous households may be swept |

Note that **characters hang off the household, not off a run.** That was already true and is what makes
persistence across sessions fall out for free — the only thing that was ever session-scoped is the room.

### 3.0 Anonymous households and how they expire

An anonymous household is an ordinary household with `guest: true` and an
`expiresAt`. Everything below the auth layer reads it as a household and cannot
tell the difference — which is the point, because it means anonymous play is not
a second code path that can rot.

Expiry is deliberately **not** a `ttl` attribute on each item. DynamoDB TTL is
per item, but a household's rows span partitions it does not know about at write
time — `RUN#<runId>` is a different partition from `HH#<hhId>` — so every writer
would have to be told whether the household it is writing under is still a guest.
Worse, a warm Lambda would *cache* that answer, and a stale "yes, guest" after
somebody signed in would quietly re-arm deletion of a household they had just
claimed.

So expiry is one row's problem instead. Only the household `META` item carries a
`GUEST` index entry; a scheduled Lambda queries that partition for entries whose
sort key has passed and deletes the household and its runs. Claiming a household
is then a **single conditional write** that removes the index entry — and a
claimed household is not merely skipped by the sweeper, it is invisible to it.

Rooms keep their own per-item `ttl`, because a room genuinely is one row.

### 3.1 Character item — the commitment rule in data

The carryover rule from [spec §8.2](./spec.md#82-carryover--the-commitment-rule) is encoded directly:

```jsonc
{
  "PK": "HH#h_4k2", "SK": "CHAR#c_9x1",
  "ownerPlayerId": "p_1",
  "name": "Sparklehoof",
  "species": "unicorn",
  "class": "songkeeper",

  // Committed: the last successfully completed campaign's end state.
  "committed": {
    "level": 4,
    "xp": 1200,
    "stats": { "might": 2, "quick": 3, "clever": 3, "heart": 7 },
    "tier": "sworn",
    "unlockedActions": ["rally", "soothe"],
    "inventory": [                                 // max 6; quest items excluded
      { "itemId": "sunbloom_draught", "kind": "consumable" },
      { "itemId": "river_charm",      "kind": "trinket" }
    ]
  },

  // Provisional: gains during the in-flight campaign. Discarded on failure.
  "provisional": {
    "runId": "r_88c",
    "level": 6,
    "xp": 2100,
    "stats": { "might": 2, "quick": 4, "clever": 3, "heart": 8 },
    "tier": "sworn",
    "unlockedActions": ["rally", "soothe", "chorus"],
    "inventory": [
      { "itemId": "sunbloom_draught", "kind": "consumable" },
      { "itemId": "river_charm",      "kind": "trinket" },
      { "itemId": "emberglass_shard", "kind": "trinket" }   // found this campaign
    ]
  },

  // Campaign-scoped. Never counts against slots, always cleared at campaign end.
  "questItems": ["rusted_key", "torn_map_east"],

  // Permanent, cosmetic-only. Grows on campaign failure. Never mechanical.
  "souvenirs": [
    { "id": "cracked_pendant", "fromRun": "r_51a", "earnedAt": "2026-07-14" }
  ],

  "appearance": {
    "palette": "meadow",
    "accent": "#7FD4C1",
    "hornStyle": "spiral",
    "markings": "dapple"
  }
}
```

- **Campaign success** → `provisional` is copied over `committed`, `provisional` cleared, `questItems` cleared.
- **Campaign failure** → `provisional` cleared, `questItems` cleared, souvenir appended. `committed` untouched.
- **Effective character** = `provisional ?? committed`. Resolved in one place, `resolveCharacter()`.

This makes the rule impossible to get subtly wrong: there is no code path that partially applies
a failed campaign's gains, and inventory rides along with levels for free because it lives inside
the same two objects.

### 3.2 Stored shapes change — how they migrate

Every item is an envelope — `PK`, `SK`, optional GSI keys, optional `ttl`, `entity`, `data` — with
the domain object inside `data`. Characters are versioned and migrated on read:
`migrateCharacter()` (`packages/shared/src/migrate.ts`) runs a ladder of small steps from whatever
`v` the row carries up to `CHARACTER_VERSION`, then narrows the result with `assertCharacter()`.
Both repositories call it — `getCharacter()` directly, `listCharacters()` through the shared
`character-io.ts` — and every write stamps the current version onto the envelope.
`CharacterProgress.unspentPoints` is optional because of the rows that predate it: a required field
would have TypeScript promising a number where an older row returns `undefined`, and
`undefined + 1` corrupts a stat block at the first Rest scene — so the v0 step defaults it and the
type stays honest about history.

The failure mode is worth naming precisely, because it changes the solution. **Nothing but our own
Lambda ever writes these items.** There is no hostile input to defend against and no third-party
producer to disagree with. What actually breaks is *our own schema changes landing on rows written
by an older version* — a migration problem wearing a validation costume.

#### Lifetime decides the burden

Not every record needs a migration path, because most of them expire on their own:

| Record | Lives for | Needs migration? |
|---|---|---|
| Room | 6 hours (TTL) | **No** — wait a day and every row is new |
| Code misses | ≤ 30 minutes (TTL) | **No** — a counter nobody reads after its window |
| Guest household and its contents | 7 days since last played, sliding | **No** — the sweeper handles it |
| Device binding | 30 days, sliding | **No** — an unused phone re-pairs by QR |
| `RunState`, events, chapter progress | one campaign | **Yes**, but only while it is in flight |
| Character, household, player profile | forever | **Yes**, permanently |
| Field Guide | forever (deleted only with a guest household) | **Yes**, permanently — `migrateFieldGuide()` |

So the permanent burden is four record types, and only one of them — the character — is under
active development. That is a small enough surface to do this by hand and keep it readable.

#### The shape of it

**A `v` on the envelope, not on the domain type.** It sits next to `entity`, where the storage
concerns already live. `Character` does not learn that it is stored, and nothing above the
repository can branch on a version — which is the property that keeps migration from leaking into
the engine.

**Migrate lazily, on read.** A chain of small steps, each one taking a row from `v: n` to `v: n+1`,
run from whatever the row says up to current. No batch job, no maintenance window, no scan over
live data. For a table this size a scan would work, but it is a machine that has to be written,
tested and then operated on the evening it fails — where read-time migration is a function with
unit tests.

**Write back on the next natural write, never on read.** A read-triggered write doubles the cost of
every load and can thrash when several phones resolve the same character at once. Characters are
already written at chapter completion, so a row self-heals within one session of play; until then it
is migrated in memory on every read, which is correct if slightly wasteful.

**Two tiers of failure, because they are not alike.** A merely *missing* field gets a default — that
is our own debt and the player should not feel it. A *structurally impossible* row — no `committed`,
`stats` missing a stat — throws, because playing on would produce silently wrong numbers, which is
worse than stopping. `listCharacters()` skips and logs a broken row rather than failing the whole
list, matching the rule `resolveCharacter()` already follows: a stale save must not take the table
down mid-session.

**Hand-written, no schema library.** `assertRulesContent()` in `rules.ts` is the precedent and the
reason still holds — no ajv in a bundle that ships to a phone. `assertCharacter()` sits beside the
ladder in `migrate.ts`, called at the repository boundary in **both** stores so the contract suite
covers it once and tests both.

#### Retiring a step

A migration step can only be deleted once no row at that version remains, and with `v` on the
envelope that is a question you can actually answer rather than guess. In practice they are ten
lines each and the file will stay short for years, so the honest default is to keep them — the cost
of an unnecessary step is a function nobody calls, and the cost of deleting one too early is a
character that silently loads wrong.

---

## 4. Sync protocol

### 4.1 Authority

**The server is authoritative for everything that matters.** Dice are rolled in Lambda, never in
the browser. Clients send *intents*; the server validates, applies, persists, and broadcasts.

This gives fair rolls, deterministic replay from the event log, and no way for a refreshed TV or a
phone that fell behind the couch to desync.

### 4.2 Message shapes

**Client → server** (HTTP POST to `/action`):

```jsonc
{
  "runId": "r_88c",
  "playerId": "p_1",
  "seq": 41,                    // client's last-seen server seq; server rejects if stale
  "intent": {
    "type": "COMBAT_ACTION",
    "abilityId": "attack",
    "targetId": "e_2"             // or "targetTile": { "x": 4, "y": 6 } for tile-targeted abilities
  }
}
```

**Server → clients** (published to AppSync Events channel `room/<code>`):

```jsonc
{
  "seq": 42,
  "runId": "r_88c",
  "patch": [                    // RFC 6902 JSON Patch against client state
    { "op": "replace", "path": "/encounter/combatants/3/hp", "value": 3 },
    { "op": "replace", "path": "/encounter/turnIndex", "value": 2 }
  ],
  "presentation": {             // how the TV should animate this transition
    "kind": "ATTACK",
    "sourceId": "c_9x1",
    "targetId": "e_2",
    "roll": { "die": 17, "mod": 3, "total": 20, "tn": 14, "result": "hit" },
    "damage": 4
  }
}
```

Splitting **state patch** from **presentation** is the key move. Phones apply the patch and ignore
presentation. The TV applies the patch *after* playing the animation. State and spectacle stay
decoupled, so animation timing never blocks game logic.

**Previews** (`POST /api/preview`, `{ "preview": IntentPreview | null }`) are the one thing on the
channel that is not state. A phone sends one whenever its player has tapped a choice but not confirmed it, or an ability
that is still being aimed (a target or a tile picked, more still to pick), and `null` when they
back out; the server checks the shape
and the seat and publishes `{ "kind": "preview", playerId, preview }` straight to the room. Nothing is
committed and the seq does not move — a preview that went through `applyAction` would make every
exploratory tap a STALE_SEQ for whoever confirms next. They are live-only (never logged, never
replayed, sent over SSE with no `id:`), so each names the decision it was made for:
`previewContext(state)` (shared/src/preview.ts) — the combat turn as it stands (which fight, by
`EncounterState.startedAt`, then whose turn, round, slot, steps left, action spent) or the story question (chapter, scenes entered, scene, story turn).
The phone stamps it from its own mirror, the server refuses a pick whose decision has moved on, and
the TV draws one only while its own state names the same decision (`client/src/world/previews.ts`).
A late pick, or one whose clearing `null` was lost with a dropped phone, therefore never surfaces on
a later turn or a later question — a lost or stale preview costs a highlight, never a turn.

### 4.3 Reconnect

Every client tracks the last `seq` it applied. On reconnect it calls `GET /state?runId&sinceSeq=N`,
which returns either the missed events or a full snapshot if the gap is too large. The TV can be
hard-refreshed mid-encounter and recover in under a second.

#### The Field Guide: the book on the state, the news on the wire

The household's Field Guide (`HH#…/FIELDGUIDE`, §3) is household data, not run data, but every
screen in the room shows it. It travels the way `campaignOptions` already does — **as a mirror on
`RunState`** (`fieldGuide`: canon id → `{ firstFoundBy, foundAt, runId }`) — so the join, the TV's
`/watch`, a snapshot and a replayed gap all deliver the same book through the one sync path, with
no second fetch and no second sequencer.

- **Filled** when a room opens for a settled household, or at the first join of a TV's claimable
  room (whose household is only a placeholder until a phone settles it, §4.5 — such a room carries
  no book and records nothing until then). **Re-read** from the store at every chapter start, which
  heals the copy when a second room of the same household has found things in the meantime.
- **Grown** by `applyAction`: the handler compares the state before and after the step (the
  engine stays pure), asks shared `discoveries.ts` what the chapter start and every scene entered
  reveal (a chapter's biome; an encounter's creatures; a scene's `discovers` tags), credits the
  player whose tap caused it (else the story-turn holder, else the first seat), and folds what is
  not already in the book into this step's patch. After the commit — the book is not part of the
  run's transaction — `recordDiscoveries` writes them, first finder wins.
- **New** is a separate, live-only signal: the store's answer ("these ids were added just now")
  rides the broadcast as `ServerMessage.discovered` and is **never written to the event log**.
  Replaying patches on a reconnect rebuilds the book without re-announcing anything, which a
  signal derived from the patch could not promise. A client that misses the live message keeps
  the page, and loses only the fanfare. In the client, the book is projected into
  `store/field-guide-discoveries.ts` and the news queued in `store/field-guide-news.ts`, both
  outside the game store's mirror.

### 4.4 Transport seam

```ts
interface RoomChannel {
  publish(roomCode: string, message: ServerMessage): Promise<void>;
  subscribe(roomCode: string, onMessage: (m: ServerMessage) => void): Unsubscribe;
}
```

`AppSyncEventsChannel` is the v1 implementation; `LocalSseChannel` is the dev one.
Swapping to Momento Topics or API Gateway WebSockets means writing one new class.

**There is a matching seam in the browser**, and it has to move at the same time.
`sync/channel.ts` owns ordering, backoff and resync against an `EventSourceLike`;
`sync/appsync-socket.ts` and a plain `EventSource` are the two implementations,
chosen from whether `/api/config` reports a realtime endpoint. Changing the
server's publisher without changing the client's subscriber produces a
deployment where every check passes and no client ever receives a patch — the
publish succeeds, and nobody is listening.

The two directions are authorised differently, and that split *is* the security
model: **IAM** for publish, so only the API Lambda's execution role can say
anything on a channel, and a **Lambda authorizer** for connect and subscribe, so
a phone or a TV can listen to its own room and nothing else. `AppSyncEventsChannel`
therefore implements `publish` and throws on `subscribe` — browsers subscribe over
AppSync's WebSocket directly, no server-side caller has ever needed to listen, and
a plausible no-op would hide that until updates silently stopped arriving.

The authorizer's load-bearing rule is that a subscribe must name the room its
token was issued for. Without it any valid session token would be a licence to
watch every family's game, since the four-letter code is the only thing
separating them.

### 4.5 Accounts, devices, and joining

**Nobody signs up to play.** Somebody taps "start a game" and a household exists,
with real characters in it. The only thing it lacks is an owner, and the only
consequence is an expiry date. Signing in is optional, comes later, and is how
you *keep* what you already played — never a gate in front of it.

Four layers of identity, deliberately separated:

| Layer | Lifetime | Auth |
|---|---|---|
| **Household** | 7 days after last play while anonymous → permanent when claimed | None, then a Cognito sub. |
| **Account** *(optional)* | Permanent | Cognito user pool — emailed code, then a passkey. For whoever keeps and manages the game; nobody needs one to play. |
| **Player profile** | As long as its household | A device-bound long-lived token. **No password, ever.** |
| **Room session** | ≤ 6 hours | Short-lived token scoped to one run. |

#### Anonymous play, which is the default

1. A device nobody has seen before calls `POST /api/room`. The server creates
   `HH#<hhId>` with `guest: true` and an `expiresAt` seven days out, one
   player profile, and one `DEVICE#<deviceId>` binding.
2. It gets a **device token** back and stores it in `localStorage`. It is that
   player from then on.
3. Everyone else joins by scanning the code. An unbound phone gets a profile and
   a token of its own on the spot.

Seven days rather than the room's six hours on purpose: the room ending is not
the session being forgotten. A family that plays on Tuesday can still decide on
Saturday that they want to keep the unicorn.

#### Signing in, which is optional

The browser talks to Cognito directly — no hosted UI, no credential through our
Lambda. First time: an eight-digit code by email, so there is no password to invent
and none to forget between Tuesday nights. Then the browser may register a
**passkey** on that device for one tap after.

It then calls `POST /api/auth/link` with the resulting ID token. The server
verifies it against the pool's JWKS and **claims the household the party is
already playing in**: `ownerSub` set, `guest` cleared, the `GUEST` index entry
dropped. Nothing is copied and no id changes, so every client's state stays
valid and a character created ten minutes ago is the same row afterwards.

Three cases, and they are genuinely different:

| Situation | What happens |
|---|---|
| Playing anonymously right now | That household becomes theirs. *This is the case the design is for.* |
| Existing account, fresh phone | Their household and its players come back; `POST /api/auth/device` binds this phone to whichever player they say they are. |
| New account, no game yet | A permanent household is created and this device becomes its first player. |

A guest household already owned by **somebody else** is not claimable, so signing
in on a borrowed phone never hands you that family's game.

**Authority comes from signing in, not from a profile (#265).** There are no kid
or adult profiles: a profile is a player, and nothing more. Managing a household
(claiming it, binding a phone to an existing player, and whatever is added
later: profiles, devices, deletion) needs a signed-in owner, and an anonymous
household has nothing to manage; it expires. A guest household is claimed by
signing in on the device that started it (`Household.founderDeviceId`), and on
no other: a room code is an invitation to play, and every phone that joins with
it is bound into the household, so being in it proves nothing about whose it
is. A phone that opens a room founds its household then; a TV's placeholder
household is founded by the first phone to join, the one that decides whose
evening it is. A host taking out the founding phone leaves the household with no
founder, and it can no longer be claimed. The join tells the founding phone it is
the keeper, and only that phone is shown the offer to keep the party. Guest
households from before founders were recorded keep the old rule (any device
playing in one may claim it) until they expire, within a week of shipping. The device that opened a room may take a
player out of that room, a low-stakes control that a TV or a kid's phone may
hold. Playing needs nothing. Tokens issued before #265 carry a `role` claim, and
nothing reads it, so no phone had to re-pair.

#### If nobody signs in

The scheduled sweeper deletes the household and everything under it once
`expiresAt` passes. It runs **daily**, which is deliberately unhurried: the
7-day TTL is what makes the promise true, and the schedule only decides how long
a household sits deleted-in-principle before it is deleted in fact. Nobody is
watching for their characters to vanish on the seventh evening.

The seven days run from the last time the household **played**, not from when it
was created: creating a room and finishing a chapter both push `expiresAt` out
again (`keepGuestHousehold`, `repo.extendGuestHousehold`). A campaign is eight
evenings over several weeks, and a window fixed at creation would sweep a
family's party out from under them halfway through it. The extension is one
conditional write that moves the expiry forward only, and refuses once the
sweeper has marked the household — the same `sweeping` interlock a claim
honours — so it can rescue a household that has expired but not yet been swept,
and can never resurrect one that is being deleted.

The delete is gated on a **conditional write**, not on a re-read. An earlier
version read each household back immediately before deleting and skipped the
claimed ones, which reads like a guard and is not one — a sign-in landing
between that read and the delete still lost the characters, and that is the
exact window a family hits by signing in the moment they are reminded the game
is about to forget them. `deleteGuestHousehold` marks the household first and
refuses if the claim got there ahead of it; `claimHousehold` refuses in the
other direction. Whichever arrives second loses, and the family keeps their
characters either way.

#### The device token

An HS256 JWT with a **30-day sliding expiry**: past halfway, a resolve mints a
fresh one and returns it in the `x-kad-device-token` response header. Both
signing and verification are local arithmetic — the secret is fetched once per
container — because verification happens on every request from every phone, and
a network round trip there would sit in front of every tap at the table.

The key is 32 random bytes the API function mints the first time it needs one,
parked in a Parameter Store **SecureString** at `/kad/<stage>/token-signing-key`
and encrypted under the Amazon-managed `aws/ssm` key. **This stack creates no KMS
key of its own**, and that constraint is what picks the algorithm: signing
requires an asymmetric key, and every `aws/*` managed key is symmetric and
encryption-only.

Why the application mints it rather than the template: CloudFormation cannot
declare a SecureString at all — `AWS::SSM::Parameter` takes `String` and
`StringList` and never grew the third. The write uses `Overwrite: false`, so
three phones opening the app at once on a fresh stack converge on one key
instead of each container signing with its own.

The version of this that used an asymmetric KMS key was strictly more
capability, so it is worth naming what was given up: with a public half, a
verifier could check a token without being able to mint one. Nothing does. Both
the signer and the verifier are Lambdas in this stack, so the shared secret draws
the same boundary, and the only cost is that a future outside verifier — an API
Gateway JWT authorizer was the one candidate ever considered — would have to be
trusted with the secret rather than handed a public key.

Deliberately *not* rotated on every single use. Rotation only helps if the
predecessor is invalidated, and invalidating it means a phone whose response was
lost to dropped Wi-Fi is locked out of the game it is holding. Revocation — the
property that actually matters when a phone goes missing — is immediate either
way, because it is a flag on the device item checked on every resolve.

#### Every run after

A bound device opens the app and **it is already that player.** No login screen,
no avatar picker with a password behind it — her phone knows it's her phone. Tap
"play."

#### Shared devices: a family tablet

A device more than one kid uses (a family tablet, a borrowed phone, a pool of
tablets) cannot be one player: it would be whoever used it last, or, once its
storage was cleared, nobody. So a device binding comes in two kinds (#250):

| Kind | Bound to | Its token | Where it lands |
|---|---|---|---|
| **personal** (the default) | one player | `aud: "device"`, 30-day sliding | already that player |
| **shared** | the household, nobody in it | `aud: "shared"`, 30-day sliding | a "who's playing?" picker |

- **Only a signed-in owner makes a device shared** (`POST /api/auth/shared-device`).
  Whatever binding the device held is revoked on the way, so a kid's month-long
  token never lingers on a device everybody picks up. Nobody stays signed in on
  it, and it is never offered a passkey.
- **Kids pick freely.** The tablet opens on the household's profiles as big
  faces (`GET /api/household/players`); tapping one (or "Someone new", which adds a
  profile with no device) sends the tablet's `x-kad-shared-token` and that
  `playerId` with the join or create. The answer is a **room session token and
  never a device token**, and the client keeps that session in the tab
  (`sessionStorage`), so the next kid, or the room's QR opened fresh, gets the
  picker again. When the room ends, the tablet is back at the picker.
- **The shared principal is its own type** (`SharedDeviceIdentity`), not a
  `DeviceIdentity` with the player left blank, for the reason the TV's
  `ViewerIdentity` is: with no player it cannot satisfy a code path that
  expects one. `resolveDevice` refuses a shared token, and `resolveSharedDevice`
  a personal one. A seat exists only for the one request that picked it.
- **A tablet that opens a room is its host** (#267), like a phone. Remove
  takes the tablet's token plus the seated kid's session for that room, so
  the device is proved by its binding and the host still cannot take
  themselves out.
- **Forget this device** (`POST /api/auth/forget-device`): a signed-in owner
  revokes a shared binding. Heroes are untouched, because characters belong to
  the household. A forgotten tablet is told so (401) and goes back to an
  ordinary start; it is never quietly bound to whoever is holding it.

#### Groups: one household, several grown-ups

A club leader, a teacher, a grandparent with a gaggle of cousins: one adult,
or several, running games for kids who are not all their family (#248). **A
group is an ordinary household with more than one owner.** Its players,
devices, characters and runs are a household's, and nothing below the auth
layer can tell a group from a family, the same way nothing can tell a guest
from a claimed household (§3.0). There is no group type and no second code
path, which keeps it thin enough that the household can become just the
table a kid plays at (#266, "Who owns what" below) with nothing extra to undo.

- **An owner is an `ACCT#` pointer**, the same row every guard already read,
  plus an `OWNER#` row in the household so it can list who runs it. The two are
  written and removed together. `Household.ownerSub` stays the founding owner,
  the one who claimed or created it; nobody can remove them, which is also what
  keeps every group with at least one owner. An owner from before #248 has a
  pointer and no row until they first open the organizer panel.
- **A second grown-up joins with an organizer code.** Any owner makes one
  (`POST /api/organizer/invite`): ten letters from the room-code alphabet,
  single use, three days. The other adult signs in, taps "Run a group", and
  types it (`POST /api/organizer/invite/accept`). Redeeming needs a verified
  sign-in, and wrong codes are counted against the account. Spending the code
  and writing the new owner's two rows are **one transaction**, so a failed
  write never spends a code without the membership it pays for; trying again
  is the whole recovery.
- **Owners manage profiles** (`/api/organizer/*`, `handlers/organizer.ts`):
  start a group, rename it, add a kid ahead of the first game, rename one, see
  each kid's heroes, and retire a kid who stopped coming. A retired profile is
  off every picker, cannot be seated or adopted, and its own phone's binding is
  revoked. A room session already issued would outlive all of that, so every
  door a room has (action, join, state read, preview, presence, the realtime
  channel's authorizer) reads the profile's `retired` beside the run's
  `removed` list, and the profile is the record: a retired kid is refused even
  if the tidy-up has not reached the run. That tidy-up puts them on every open
  room's `removed` list, as a host's Remove does; if it fails, retiring again
  finishes it. Its heroes stay, and an owner can bring it back.
- **Kids never sign in.** They reach their profiles through the group's shared
  tablet or their own phone, exactly as before.
- **An account with more than one household is asked which**, never guessed
  for: signing in (`linkAccount` answers `householdId: null` with the list in
  `households` unless the phone already plays in one of them, and takes a
  `householdId` on the second ask) and making a tablet shared (`shareDevice`
  takes a `householdId`, and refuses to pick when there is more than one).
  Keeping tonight's guest game from the end-of-chapter offer is unaffected: it
  names its household by the phone that started it.
- **The organizer panel keeps nobody signed in.** The id token lives in memory
  while it is open, and closing it drops the token, because the device is often
  one the kids pick up next.

#### Who owns what: the kid, her hero, and the table (#266)

The household was built as the one box everything hangs off: profiles,
heroes, devices, runs, the Field Guide, expiry. That fits one family at one
table, and it strains when a kid plays anywhere else. Ada brings her unicorn
to Rue's house, Ada plays from a hospital bed with her brother at home, or a
club kid goes home at the end of term. Decided (#266): **a kid's gameplay is
three different things, and each has its own owner.**

| | What it is | Owned by |
|---|---|---|
| **The kid** | A player profile: nickname, color, avatar. No email, password, birthday, or real name | Herself, kept by the grown-up who keeps her household |
| **Her hero's record** | Level, XP, stats, items, souvenirs, her Field Guide finds, the campaigns she has finished | The kid. It goes wherever she plays |
| **A table's save** | Where a party is in a campaign: chapter, journey, route flags, setbacks (`CampaignProgressRecord`, runs) | The household or group playing it |

**A save stays with its table.** It is the group's story, and two tables'
saves cannot be merged into one hero. Ada at chapter 4 at Rue's and chapter 1
at home is two stories. She continues the first next time she is at Rue's,
and plays the second at home with a stronger, better-equipped hero. Nothing
that is hers is lost when she leaves.

**Everything that is hers comes with her.** When she plays at a table that
is not her home, her XP, items and finds are written back to her home, never
to the host's (#249, `homeHouseholdId` on the party member). Campaign
prerequisites (#221) read her own finished-campaign record, not the table's.
The table keeps its shared Field Guide, and her finds also go to her own.

**Kid "accounts" are profiles, thin by design, and nobody logs in as one.**
- Every kid already has one: a profile is made the moment they play. Making
  it portable means the profile, not the household, owns the hero. It does
  not mean a sign-up.
- **Data minimization by design.** The profile asks for no real name, email,
  birthday or contact detail. Names are nicknames, filtered (#253). A grown-up
  is the account holder, and the kid is a record they keep. This is a design
  intent, not a legal conclusion. Whether and how children's-privacy law
  (COPPA in the US, and its equivalents elsewhere) applies is reserved for a
  privacy review before the game is offered beyond our own tables. That review
  starts from what the system actually collects, below.
- **A new device becomes her by pairing, never by something she types.** Her
  own phone, or a grown-up's signed-in phone, shows a one-time code or QR. It
  is single use, lives for minutes, and the device that scans it is bound to
  her. A hospital tablet, a borrowed phone, or a wiped one is her again in one
  scan, and losing it loses nothing. Whoever sees a code can, at worst, play as
  her on one device, which a grown-up can revoke.
- A grown-up's sign-in (`adoptDevice`) remains the other way in.

**What is collected about a kid, and for how long.** Kept current as features
land, and the source for #252's "what we store" page.

| Data | Where | Kept |
|---|---|---|
| Nickname, color, avatar | `PLAYER#` row | With the household: 7 days after last play while a guest, until deleted once kept |
| Hero: name, appearance, progression, items, souvenirs | `CHAR#` row | Same |
| Gameplay: choices, rolls, the event log | `RUN#` partition | Same |
| Field Guide finds, credited to a profile | `FIELDGUIDE` row | Same |
| Device binding: device id, user agent, last seen, token hash | `DEVICE#` row | Same, revocable |
| Long-lived device token, room session token | The device's own storage | Until it expires (30-day sliding, room's 6 hours) or is cleared |
| Address (IPv4, or the IPv6 /64) as a wrong-code counter key | `GUESS#` row | About two 15-minute windows (TTL) |
| Request logs (address, path, errors) | CloudWatch | Account-wide retention, set outside this repo (`infra/template.yaml`, "Logs") |
| Hero and player names, inside narration prompts | Sent to the model provider | Only while live narration is on (§6, #254) |

The grown-up's email lives in Cognito, never in the table.

**One game at a time per hero: the claim.** A character carries one
`provisional` snapshot, stamped with one `runId` (§3.1). That stamp is the
hero's **claim**, and it is both the one-game rule and the authority for a
visiting table to write to a hero it does not own. #282 builds it. These are
its invariants and failure semantics:

- **Where it lives.** On the character row, in the hero's home partition
  (`HH#<home>`/`CHAR#<id>`), next to a monotonic `version` on the row. Every
  decision about the hero is made against that one row, whichever table is
  playing.
- **Acquire.** When a run first writes the hero (seating her in a started
  campaign), it is one conditional write on the character. It succeeds if
  there is no claim, if the claim already names this run (an idempotent
  retry), or if the claimed run is terminal (complete, failed or closed). In
  that last case the write is conditioned on the old `runId` and `version`, so
  two runs reclaiming one stale hero cannot both win. Otherwise the seat is
  refused ("Sparklehoof is in the middle of another adventure"), and nothing
  is written.
- **Write.** Every progression write from a run to a hero (XP, items, finds,
  the provisional snapshot) rides in the run's commit transaction (§4.1)
  with two extra conditions on the character row: `provisional.runId` is this
  run, and `version` is the one read. The run's own seq condition is still
  there. A different table, a run that lost its claim, or a stale worker
  holding an old read fails the transaction and re-reads, exactly as a lost
  seq race does today. A visiting table needs no other permission to write a
  hero. The claim *is* the permission, and it names one run.
- **Release.** Completing the campaign commits `provisional` into `committed`
  and clears the claim. Failing it discards `provisional` and clears the
  claim. Either way it happens in the same transaction as the run's final
  commit. A host closing the room (#263) makes the run terminal. Her own
  grown-up, or the kid on her own device, can also **leave that adventure**,
  which discards that run's provisional gains and clears the claim,
  conditioned on its `runId`.
- **Disconnects never release.** A dropped phone, a closed tab or an expired
  room is not leaving. The claim holds, so the table can resume (#259). A run
  abandoned without a release stays claimed until it becomes terminal or she
  leaves it. Nothing times a claim out behind a family's back, because that
  would discard gains they meant to keep.
- **Gemfall at home** runs through exactly the same path, with home equal to
  the table, so nothing about a one-household game changes.

**A hero who outranks the party.** A newcomer joins at the party's tier floor
([spec §8.4](./spec.md)). The reverse, a strong visiting hero at a young
table, plays at her own level. The party's challenge does not rescale for
one guest, so a table may prefer to start a new hero for the evening. Revisit
this with real tables.

**Expiry and deletion.** An unkept kid expires with her guest household, as
today (§3.0). A kept one lives as long as a grown-up keeps her. Retiring her
from a group (#248) takes her off that table only. Deleting her (#252) is her
grown-up's call and removes her everywhere, her hero's record included.

**Staged, so nothing is rewritten up front.**
1. **Now.** Heroes stay in their home household's partition. A visiting
   member carries `homeHouseholdId` (#249), and every character read and write
   uses it. Pairing and the one-game rule land as their own issues.
2. **Moving a kid (#251)** is changing her home household: her profile, her
   heroes and her finds move under the new one, ids unchanged, in one
   transaction, behind a single-use code like an organizer invite.
3. **Later, when two homes are real** (two households, grandparents who host):
   the profile and its heroes move to their own `PROFILE#<id>` partition, with
   a guardian link per grown-up who keeps her, and households become the
   tables she plays at. Ids do not change, so this is a mechanical migration
   (§3.2), not a re-model. Not built until a family needs it.

New work keeps to this split: a hero's own record is named by the kid's home,
never by the room's household, and nothing new is added that only makes sense
if the household owns the kid.

#### Recovery and revocation

- **Lost phone** → the household owner revokes `DEVICE#<deviceId>` from their own device. That token is dead immediately.
- **New phone** → join the room, which makes it a new player, or the owner signs in on it and binds it to an existing player (`POST /api/auth/device`) to bring that player's heroes back.
- **Nobody who only plays can manage anything.** Without a sign-in a phone cannot claim the household, bind another phone to a player, or revoke one.

#### Joining a session

1. Host device calls `POST /room` with `{ mode: "party" | "travel" }` → 4-letter code (unambiguous alphabet: no I/O/0/1). In **Party Mode** the host device *is* the TV: it sends `display: true`, the room opens with nobody seated, and it lands on `/tv/ABCD`. The room opens **claimable**, under the TV's own household as a placeholder.
2. In **Party Mode** the TV renders the code + QR; in **Travel Mode** the host's phone does.
3. Other devices scan → `POST /room/ABCD/join`, presenting their **device token**. The server resolves device → player → household, verifies the household owns the run, and issues a room-scoped session token.
4. Because identity is resolved from the device, **there is no "who are you?" step.** You scan, and your character is already on the board.
5. **The first phone to join a claimable room decides whose room it is.** A phone that already belongs to a household takes the room into that household. The `ROOM#` item and the run's `HH#…/RUN#` row move together in one conditional transaction (`claimRoom`), and the lobby is re-read for that household's campaigns. A phone with no binding settles the room on the TV's household first, and is then created in it. Either way the room stops being claimable, and from then on a phone from another household is refused as before. This is what lets any screen host the evening. A new TV, or one whose storage was cleared, no longer starts a fresh guest household that locks the family's phones out of their own campaigns and heroes. Visiting phones from a second household are still refused (deferred).

**The code is the boundary, so guessing it is rationed.** Any phone that names a
live code can watch the room, read its state or join it, and 24⁴ codes is a
small space. So every route that looks a room up by code (join, watch, and
state read by code) counts the codes a client asks for that have no open room
behind them, and refuses that client, for whatever it asks next, once it has
missed `CODE_MISS_LIMIT` times in a 15-minute window (`handlers/code-guard.ts`).
It refuses *before* the lookup, so a right code tells a refused guesser nothing,
and the lookup is reserved by one conditional write and given back on a hit, so
a burst of parallel guesses cannot all slip in under the limit together.
Misses, not attempts, because a family's joins and reconnects are most of the
traffic; and a state read carrying a token for that room is never counted,
so a game in progress is never cut off by strangers on the same network. A
client is its IPv4 address or its IPv6 /64, and behind CloudFront that comes
from a header CloudFront sets and vouches for (deploy.md, "The origin secret").

**The room sees who arrives, and its host can take one out.** Every join is
announced on the room's channel (`ArrivalMessage`), live only like a preview,
so a stranger with the code shows up the moment they are in, not after they
have made a hero. The shared display shows it, and so does the device that
opened the room (`RoomRecord.hostDeviceId`: the TV in Party Mode, the host's
phone in Travel Mode). On the host's device the notice carries a Remove button
(`handlers/remove.ts`). A removed player stays in `party` with
`connected: false`, which every turn, vote, roll and ready-gate already reads
as away, so taking somebody out mid-fight strands nothing, and goes on
`RunState.removed`, which the join, every action, the preview relay, presence
and the channel authorizer all refuse. The authorizer holds a player's "yes"
for a minute rather than five, so a removed phone that reconnects is turned
away soon. Nor can a removed phone go on watching: only the screen that opened
the room may watch it, and reading its state takes a token for it ("The TV,
which is nobody", below). What removal cannot do is stop a phone that clears
its storage: it comes back as a new player, is announced again, and can be
removed again. Locking the room to new joins stops that (below).

**The host runs the room** (#263, `handlers/host.ts`). Besides Remove, the
device that opened the room (the TV, the host's phone, or a family tablet with
its seated kid's session) may **lock** the room to new joins and unlock it,
and **close** it for everyone. Its view lists everybody in the room from
`RunState.seats`, which each join writes (who, and on their own phone or the
family tablet), so it shows a kid still making a hero and survives a refresh,
where the arrival notices do not. Locked, a join is refused unless the player
is already on that roster, so a dropped phone is never locked out of its own
game. Closing marks the run `closed` (every screen leaves; actions, previews,
presence and the channel refuse it) and then deletes the room's code. Each
control is one committed patch with the host as its author, so all of it is
on the run's event log. Opening a room to visitors (#249) and forgetting a
device (#273) need a signed-in owner and are not host controls.

Room items carry a **6-hour TTL** so abandoned rooms clean themselves up. Revoking a device does not
touch any character — characters belong to the household.

#### The TV, which is nobody

A display client has no player and no session, because a screen does not sign
in (spec §2.1). The realtime channel is authorised per subscriber, so it needs
*something* to present: `POST /room/ABCD/watch` returns a **viewer token**
naming that room and nothing else, valid until the room expires.

Only the screen that opened the room gets one (#267). It presents the device
binding it was given when it opened the room, which survives a hard refresh.
Anyone else with the code would otherwise watch the party unannounced, out of
reach of Remove; to see a room, a stranger has to join it, and be seen doing so.
For the same reason `GET /state` answers only a session or viewer token for
that room, and answers anything else as if the room did not exist. The price is
that a TV whose storage is cleared cannot reattach to its own room: it opens a
new one.

It is a separate type from a session token rather than a session token with the
fields blanked out, so that a display credential can never satisfy a code path
expecting a player. A viewer is not in `party`, is not counted for presence, and
cannot act.

### 4.6 Client surfaces and modes

The client renders two surfaces, `WorldView` and `PlayerView` ([spec §2](./spec.md#2-presentation-modes)).
Mode selects composition only:

```ts
type RoomMode = "party" | "travel";

// Party Mode: role comes from the route
//   /tv/:code    → <WorldView />
//   /p/:code     → <PlayerView />
//
// Travel Mode: every device gets both, one at a time behind a toggle
//   /p/:code     → <TravelLayout><WorldView /><PlayerView /></TravelLayout>
//
// Between games: no room, so no code and no mode
//   /journal     → <JournalScreen />   (spec §2.3)
```

`/journal` is the one surface with no room behind it. It reads `GET /api/journal`, authorised by
the **device token** (`x-kad-device-token`) rather than a room session, which between games does
not exist: the player's own heroes, the household's Field Guide, a player-id → name map for "found
by", and the biome of the household's most recent run that left the lobby. It is read-only. The
client keeps the last answer in `localStorage`, keyed by the device token, and shows it (marked as
last time's) when the request fails for want of a network; a 4xx means the binding is gone and
discards it. A browser whose binding came from opening a Party Mode room on itself is marked
`screenOnly` and is never offered the book, until it is seated or adopted as a player.

#### The service worker: offline, and never twice

A service worker (`packages/client/src/sw/`, served as `/sw.js`) does two jobs. It makes the
adventure book open with no signal, on a reload too: the saved journal is only half of that, since
the page, its code, the content and the map painting also have to be on the phone. And it makes
sure nothing a phone already has is downloaded twice. It is registered only by a production build,
after `load`, and touches nothing the game needs live:

| Request | Answered by |
|---|---|
| `/api/*`, `/events/*`, anything cross-origin, non-GET or ranged | the browser, as if there were no worker |
| a page load (any route) | the network (started by navigation preload); the saved app when there is none |
| `/bundle/*` (hashed) | the saved copy; the network the first time |
| `/assets/*`, `/content/*.json`, `public/` files | the saved copy **if its fingerprint matches this build's**; else the network, kept if the bytes match |
| anything else not fingerprinted | content: network first; pictures: saved copy, refreshed behind; otherwise untouched |

**Fingerprints.** Art, rigs, audio and content keep the same URL across deploys, so a cache cannot
tell from the URL whether a copy is current. Each build therefore fingerprints every file under
`assets/`, `content/` and the client's `public/` (the first 16 hex digits of SHA-256) into a hashed
`/bundle/files-*.json`, and writes its URL into `sw.js` (`sw-build.ts`). A saved copy whose
fingerprint still matches is served without asking the network at all. A deploy that changes a
file changes its fingerprint, so that file alone is fetched again, past the HTTP cache. The new
worker drops replaced copies when it takes over. Every download is checked against its
fingerprint before it is kept, so a CDN edge still serving the old bytes is served but never saved.

**Budget.** Fingerprinted art, rigs and audio are capped at 200 MB, least recently used first.
Content is never evicted: it is small, and it is what the offline book reads. Lookups ignore
`Vary`: servers send `Vary: Origin`, module scripts send an `Origin` header, and without
`ignoreVary` every saved script quietly missed and went back to the network.

**What is saved when.**
- **Install:** the app, every hashed file but the Rive runtime, and the content the book reads
  (including every campaign file), about 2.4 MB. Install fails unless every one of those content
  files is saved as this build's verified bytes, so a CDN edge still serving the previous deploy
  cannot let a worker take over without them. The old worker stays in charge with its copies,
  and the browser tries again later.
- **When the page is idle:** it tells the worker (`kad:idle`, `sw/register.ts`), which then
  fetches the Rive runtime (about 2 MB).
- **When the book opens with a signal:** the map painting, every atlas level and the art of
  everything found (`sw/warm.ts`).
- **During play:** whatever the screen draws. The scenes two steps ahead (backdrops, enemies, the
  biome's tiles, the party's rigs) are fetched at idle priority before the party reaches them
  (`sw/prefetch.ts`, from `WorldView`) — only while the world is on screen: a phone keeps its world
  pane mounted behind its controls and map, and the layout tells `WorldView` when it is hidden, so a
  Party Mode phone (whose world is the TV's job) spends nothing on it. Prefetching is skipped when the phone asks to save data;
  the book's offline art is not, since it is what makes the book open in the car at all.

**Updates.** Each build's `sw.js` names its own files, so every deploy is a new worker. It takes
over at once, including pages that are already open. Those pages were built against the previous
build and import its chunks the first time they open the book or a room, and the deploy has deleted
those chunks from the bucket. So the worker keeps the previous build's code as well as its own
(`/__kad/bundle-list` records which), and drops only what neither uses. A tab left open across two
deploys gets the "Try again" a missing chunk always gets, which reloads it. Pictures an earlier
worker kept under an old cache name (#224's `kad-image-v1`) are moved into the fingerprinted cache,
verified, before that cache is dropped. **To turn it off**, ship
a `sw.js` whose `activate` deletes every cache and calls `self.registration.unregister()`. Phones
pick it up on their next page load.

**Proof.** Both specs below run against a real production build (`playwright.prod.config.ts`,
`npm run e2e:prod`, also run by CI).
- `e2e/offline.spec.ts`. "No signal" there means the page offline *and* the server unreachable:
  Playwright's offline switch does not reliably cut a service worker's own fetches.
  - **Offline:** play a little, open the book once, drop the network, then reload and open a fresh
    tab. The hero, the map's painting and an opened Field Guide entry must all be there.
  - **First visit:** the book opens before any worker controls the page, and its art is still
    saved once one does.
  - **Upgrade:** a tab left open across a staged deploy (a new `sw.js`, the old chunks gone from the
    server) can still open the book.
  - **Stale edge:** a deploy whose index gives the Field Guide a new fingerprint while the server
    still sends the old bytes never takes over, and the book still opens offline with its guide.
  - **From #224:** pictures in `kad-image-v1` survive the upgrade, and the offline map shows.
  - **Data Saver:** the book still saves its painting.
- `e2e/perf.spec.ts` counts every byte through a proxy, the worker's own fetches included. Before
  the fingerprinted cache, the next evening re-downloaded about 3.8 MB in 41 round trips; now
  13 KB in 10 (the page, live game traffic and the favicon, which browsers fetch outside any
  worker). It also checks that:
  - mismatched bytes are never saved;
  - the Rive runtime arrives while idle;
  - a scene's art is saved before the party reaches it.

Three rules keep this from forking into two apps:

1. **`WorldView` and `PlayerView` never know the mode.** They read game state and render. A layout shell composes them.
2. **All sizing is container-relative.** No viewport units inside either surface — they must render correctly at full screen *and* at 60% of a phone.
3. **The focus camera is unconditional.** Combat always auto-frames the active actor, on every surface. Party Mode simply has more room to breathe.

Practically: **build Travel Mode's layout first.** It's the constrained case. Anything that fits
there fits on a TV; the reverse is not true, and discovering that late means reworking the grid,
the dice, and the action bar.

The shell owns three things the surfaces are not allowed to know: which surface is showing, that a
turn should bring your controls forward, and that a roll belongs to the world for its moment. Both
surfaces stay **mounted** while hidden — unmounting the world would tear down the Pixi context on
every toggle and drop the presentation gate it registers, which is what animates the dice at all.

---

## 5. Chapter schema

A chapter is one JSON file, authored by the LLM tool and hand-edited, committed to the repo,
and served as a static asset from CloudFront.

```jsonc
{
  "id": "bramblewood-01",
  "campaignId": "the-hollow-crown",
  "index": 1,
  "title": "The Rustling Path",
  "biome": "enchanted_woods",
  "estimatedMinutes": 28,
  "xpAward": 300,

  "entry": "scene_clearing",

  "scenes": {
    "scene_clearing": {
      "type": "story",
      "art": "bg/bramblewood/clearing",
      "narration": "The path ends at a wall of thorns twice your height. Something is humming on the other side.",
      "choices": [
        { "id": "smash",  "label": "Force through",  "icon": "fist",
          "requiresSpecies": "bigfoot",  "goto": "scene_beyond_fast" },
        { "id": "glide",  "label": "Go over it",     "icon": "wing",
          "requiresSpecies": ["dragonling", "griffin"], "goto": "scene_beyond_fast" },
        { "id": "squeeze","label": "Look for a gap", "icon": "eye",
          "goto": "check_squeeze" },
        { "id": "listen", "label": "Listen first",   "icon": "ear",
          "goto": "scene_humming" }
      ]
    },

    "check_squeeze": {
      "type": "check",
      "stat": "quick",
      "tn": 12,
      "prompt": "Wriggle through the brambles",
      "onSuccess": {
        "goto": "scene_beyond_fast",
        "effects": [{ "type": "grantItem", "itemId": "sunbloom_draught", "to": "roller" }]
      },
      "onFailure": { "goto": "scene_beyond_scratched", "effects": [{ "type": "damage", "amount": 1 }] }
    },

    "scene_shrine": {
      "type": "story",
      "art": "bg/bramblewood/shrine",
      "narration": "A small stone shrine, half-swallowed by roots. Something glints in the moss.",
      "onEnter": [{ "type": "grantQuestItem", "itemId": "rusted_key" }],
      "choices": [{ "id": "onward", "label": "Take the path east", "icon": "arrow", "goto": "scene_ridge" }]
    },

    "encounter_bramblewisps": {
      "type": "encounter",
      "map": "thicket",
      "enemies": [
        { "id": "wisp", "name": "Bramblewisp", "creature": "will_o_wisp" }   // stats come from canon
      ],
      "onVictory": { "goto": "scene_shrine" },
      "onDefeat":  { "goto": "scene_captured" }        // never a game over
    }
  },

  "llmHints": {
    "tone": "warm, playful, a little spooky but never scary",
    "vocabulary": "age-8",
    "forbidden": ["death", "blood", "permanent loss"],
    "npcVoices": { "wisp": "curious, speaks in rhyme, easily distracted" }
  }
}
```

`map` is a bare id, resolved to `content/maps/<id>.json` — an encounter board is content too,
a grid of rows plus spawn points, living beside the chapters and validated the same way.

`requiresSpecies` is what produces "only my griffin can do this" moments. Choices whose
requirements aren't met by anyone in the party are **hidden**, not greyed out — no one feels
locked out of something they can see.

`requiresClass` is the same gate for class (`"starweaver"` or a list): offered when anyone
seated has one of them, hidden otherwise, with no hint. It is judged against the seated party
each time and never stored, so a class moment that matters later sets a flag and guards read
the flag. No class is ever mandatory: a scene whose every choice is class-gated fails the
build (`CLASS_GATED_ONLY_EXIT`).

`grantItem.to` accepts `"roller"` (whoever made the check), `"party"` (a prompt to choose a holder),
or a specific `playerId`. If the recipient's six slots are full, the client prompts to swap or leave —
the grant never silently fails and never silently overflows.

What a choice costs is an effect too, so a story that says the party paid or shared actually
takes something. `takeItem` removes one copy of an item from whoever holds it (a list means "the
first of these anybody has"). `grantCoins` and `spendCoins` change the party's shared purse
(`RunState.coins`), which the campaign attempt carries from one chapter to the next. A choice with
a cost is gated on the party having it, through `requiresItem` or `when` (`item`, `count`,
`coins`), so a party that can't pay never sees that choice. `content:validate` enforces the gate.

An enemy names the canon creature it is one of and inherits everything else — `count`, `name`, `art`
and all five stats — from `content/bestiary.json`, the generated projection of `canon/creatures.yaml`
([canon contract](canon-contract.md) D9). A stat written in the chapter is an override; retuning a
whole band is an edit to `content/rules.json` and to nothing else.

Items themselves live in a separate catalog, `content/items.json`, so a chapter references
`itemId` and never redefines an item. That file is **generated** from `canon/items.yaml` and from
each chapter's own `props` block (D7) — the world owns a honeycake, one chapter owns the key to its
own door — and both land in one namespace, because a quest item outlives the chapter that granted
it:

```jsonc
// content/items.json — GENERATED. `npm run canon:items`.
{
  "$comment": "…generated from canon/items.yaml and every chapter's props…",
  "sunbloom_draught": {                    // from canon: the world has these
    "kind": "consumable", "icon": "potion",
    "name": "Sunbloom Draught", "text": "Heal 4 HP.",
    "effect": { "type": "heal", "amount": 4 }
  },
  "river_charm": {
    "kind": "trinket", "icon": "charm",
    "name": "River Charm", "text": "+1 step.",
    "passive": { "type": "stepBonus", "amount": 1 }
  },
  "rusted_key": {                          // from bramblewood-01's `props`
    "kind": "quest", "icon": "key",
    "name": "Rusted Key", "text": "It opens something, somewhere."
  }
}
```

Icons are short slugs, never file paths — one slug namespace across rules, choices, and items,
resolved by the client to inline SVG so there is exactly one icon lookup (spec §11).

### 5.1 The ability catalog

Combat abilities are split across two files on purpose, and the split is worth stating because it
looks like duplication until you know why.

`content/rules.json` owns an ability's **name, icon and the sentence a child reads** — "Brace: take
a hit that was meant for a friend standing next to you" — because that is part of what a class *is*,
and it is read at a Rest scene by somebody choosing a level-3 unlock.

`content/abilities.json` owns **what it does on the board**: who you may point it at, how far it
reaches, and a list of effects.

```jsonc
{
  "version": 1,
  "abilities": {
    "shove": {
      "id": "shove", "name": "Shove", "icon": "fist", "timing": "action",
      "target": { "kind": "enemy", "range": "adjacent" },
      "effects": [
        { "effect": { "type": "shove", "steps": 2 } },
        { "effect": { "type": "moveSelf" } }
      ]
    }
  },
  "$deferred": {
    "bramble_wall": "Needs a verb that changes the terrain. Every one of the ten acts on a figure."
  }
}
```

An ability is data; an *effect verb* is code. There are ten verbs (`packages/shared/src/encounter.ts`),
chosen by writing out all four class signatures and all six species actions and taking the union — so a
fifth species is a catalog entry, and a fifth *kind of thing an ability can do* is a code change.

`$deferred` is the other half of that boundary made honest. Eight of the twenty-two abilities
`rules.json` promises cannot be expressed faithfully by the ten verbs — Tanglelight's "it cannot move"
is not `skipTurn`, which costs a whole turn and is a different, better effect. They are **listed with
the verb they are waiting on** rather than approximated, because an approximation is a lie a child
catches: read the card, watch the board, learn not to trust the cards.

The engine is deliberately tolerant of the gap. `legalActions` skips an ability it cannot look up, so a
deferred ability is a card that is never offered rather than a crash mid-fight. Which makes the failure
mode silent, and that is what `content:validate` exists to prevent: every ability `rules.json` grants
must be in **exactly one** of `abilities` or `$deferred`, names and icons must agree across the two
files, and an ability whose effects can provably land on nobody fails the build.

JSON Schemas for every format live in `schemas/` and are validated in CI. A chapter that references
an unknown `itemId`, an invalid scene graph, or an ability nobody defined **fails the build** — not
the play session.

---

## 6. LLM integration

### 6.1 Model assignment

| Job | Model | Where |
|---|---|---|
| Chapter generation, encounter design | `anthropic.claude-opus-5` | Local CLI, authoring time |
| Live flavor text, NPC lines, recaps | `anthropic.claude-haiku-4-5` | Lambda, table time |

Both go through **Claude in Amazon Bedrock** — the Messages API at
`bedrock-mantle.{region}.api.aws/anthropic`, hence the `anthropic.` prefix on the model ids.
Neither surface holds an API key: the CLI signs with whatever credentials `aws sts
get-caller-identity` would use, and the Lambda signs with its execution role.

### 6.2 Cost

Roughly 40 live calls per 30-minute session with a cached prefix:

| Model | Per session | Per year @ 3 sessions/week |
|---|---|---|
| `claude-haiku-4-5` | **~$0.07** | **~$11** |
| `claude-sonnet-5` | ~$0.14 | ~$22 |

Cost is not a design constraint here. **Optimize for latency instead.**

### 6.3 Prompt caching — the one real gotcha

Claude's prompt cache is a **prefix match**, and the minimum cacheable prefix is
**4096 tokens on Haiku 4.5** (Sonnet 5 is 1024, Opus 5 is 512).

If the cached prefix lands under 4K there is **no error** — caching silently does nothing and you
pay full input price on every call. Two mitigations:

1. **Design the prefix to clear 4K comfortably**: tone rules + party sheet + chapter context + the current scene's authored text + few-shot examples.
2. **Assert on it in dev.** Log `usage.cache_read_input_tokens` and fail loudly in development if it's zero across repeated calls.

Prefix layout, in render order (`tools` → `system` → `messages`) — most stable first:

```
system  [cached] : writing rules + few-shots, the cast, chapter tone, chapter scenes
system           : party composition, including who is hurt            ← changes every fight
messages         : chapter context + scene text                        ← changes per scene
messages         : the specific moment being narrated                  ← changes every call
```

**This is a correction to the three-breakpoint layout this section used to describe**, made after
building it and measuring (`packages/server/src/llm/prompt.ts`). Two of those three breakpoints do
not survive contact with the floor:

1. **The tone block does not reach 4096 tokens on its own** — tone rules plus a generous set of
   few-shots comes to roughly 1300. A breakpoint there is not a smaller saving, it is *no* saving.
   The prefix reaches the floor only once the cast (`content/rules.json`'s species and class
   blurbs) and the chapter's own scenes are in front of it — all of which is real context that
   improves the writing, not padding bought to clear a threshold.
2. **The party block cannot sit inside the cached prefix**, because it says who is hurt. "Changes
   ~once/session" is true of names and levels and false of hit points, and hit points are the half
   a narrator actually needs. A block that changes every fight, placed in front of the scene text,
   invalidates the scene text on every fight.

So: **one breakpoint**, at the end of everything stable for a whole session. A unit test measures
the real prefix against the floor with a 15% margin, because the estimate is a heuristic and the
floor is a cliff with no warning on the far side.

Never interpolate a timestamp, UUID, or request ID into the system prompt. It sits at the front of
the prefix and invalidates everything after it.

### 6.4 Latency — speculative prefetch

Two-second pauses at a table with an 8-year-old are fatal to momentum. The fix exploits the fact
that turn-based games always know the small set of things that can happen next:

> When the party enters a scene, immediately fire off generation for the 3–4 likely reactions
> **during the transition animation.** By the time she taps, the text is already in hand.

Prefetched results go into a per-run cache keyed by `(runId, sceneId, choiceId)` — the run id is
explicit because one process serves many households, and without it one family's prefetched line
reaches another's television.

A hit renders instantly; **a miss is the authored text**. Nothing streams and nothing waits: the
take is a synchronous map read, so there is no code path from a player's tap to a network call and
therefore none from a slow model to a stalled television. "Should never observe a wait" is kept by
removing the ability to wait rather than by keeping one short.

One exit per *destination*, not one per button. Three species-gated choices that all arrive in the
same clearing are one line, because the arrival cannot tell them apart — and warming all three
filled the window and pushed the scene's only ungated choice out of it.

### 6.5 Safety validator

Every live generation passes through `validateNarration()` before it reaches a screen:

- Length cap (≤ 240 characters for flavor, ≤ 400 for recaps)
- Banned-topic keyword screen from the chapter's `llmHints.forbidden`
- Must reference an entity present in the current scene
- No second-person imperatives that imply an action the game can't perform

**Anything that fails is discarded and the authored text is used.** Silently. No error surface,
no retry loop, no waiting.

### 6.6 The kill switch

`LIVE_LLM_ENABLED=false` disables the entire live layer. The game remains fully playable.

Read as an **exact match on the string `"true"`**, so anything else — including `"false"`, which is
a non-empty string every `if (process.env.X)` would treat as on — leaves the layer off. The default
falls that way because the two mistakes do not cost the same: a layer wrongly off is one evening of
plainer narration and announces itself immediately; a layer wrongly on is unreviewed text on a
television in a child's living room, plus a bill, and announces itself to nobody.

CI runs the integration suite with the live layer stubbed out — this invariant is tested, not hoped
for. It is also **structural**: `HandlerDeps.narrator` is optional, absence and `silentNarrator`
behave identically, so every test that does not name a narrator is running the off path for free.
`handlers/live-layer.test.ts` plays the same opening twice, with and without, and asserts the two
runs differ in the narration and in nothing else — not "the game still works", but the same seq,
flags, party, prompt and dice.

---

## 7. Environments

| Env | Purpose | Deployed by |
|---|---|---|
| local | Vite + the dev server + DynamoDB Local. Live LLM off by default. | `npm run dev` |
| `staging` | A real stack, on real AWS, from every pull request. | the `Staging` GitHub environment |
| `prod` | The real thing. One stack, one region. | the `Production` environment, once CI passes on `main` |
| `dev` | An optional fourth stack for driving by hand. | `./scripts/deploy.sh dev` |

> Revised. This section previously said "no staging — it's a family game, `dev`
> and a careful deploy is enough". That held while deploying was a command
> somebody typed. Once deploys happen from CI, the thing that stops a bad one
> reaching a Tuesday night is having somewhere it lands first, and a pull
> request is exactly the moment to look at it.

Both automated stacks are deployed by the *same* `scripts/deploy.sh` a laptop
runs. The workflow's job is only to be that laptop — assume a role, install the
CLIs, hand over — because a deploy path that exists only in YAML is one nobody
can reproduce when it breaks.

**Credentials.** GitHub trades a short-lived OIDC token for an IAM role; no AWS
keys are stored. The roles trust one repository *and one environment*
(`infra/github-oidc.yaml`), so a pull-request deploy cannot reach prod even
though the workflow file is editable from within that pull request.

**Local multi-device testing:** Vite dev server bound to `0.0.0.0`, phones on the same LAN hitting
the laptop's IP. This is how nearly all development happens — you need three real devices in the
loop constantly.
