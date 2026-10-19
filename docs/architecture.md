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
| Household | `HH#<hhId>` | `META` | The family. `ownerSub` (null while anonymous), `guest`, `expiresAt`, display name, and `retentionDays` when an owner set one (#252). |
| Player profile | `HH#<hhId>` | `PLAYER#<playerId>` | Display name, color, avatar, and `retired` once an owner takes the kid off the pickers (#248). No role (#265): rows written before still carry `role`, and nothing reads it. `data.flair`: what she picked for her own page (#299, "Her page" in §4.5), versioned like any stored shape (§3.2). Beside `data`, never in it: `lastPlayedAt`, her `IDLE` index entry while her household keeps a retention window, and `sweeping` once she is being deleted (#252). |
| Device binding | `HH#<hhId>` | `DEVICE#<deviceId>` | → playerId, token hash, last seen, user agent. Revocable. |
| Owner | `HH#<hhId>` | `OWNER#<cognitoSub>` | One grown-up who may manage the household (#248), with the email they signed in with. Written in one transaction with that account's `ACCT#` pointer, and removed with it. |
| Character | `HH#<hhId>` | `CHAR#<charId>` | Owned by a playerId, and stored under that kid's **home** household wherever she plays (§4.5, "Who owns what"), a visitor's included (#249, "Visitors"). Persistent across campaigns. See §3.1. |
| Campaign run | `HH#<hhId>` | `RUN#<runId>` | One playthrough of one campaign. |
| Campaign attempt | `HH#<hhId>` | `CAMPAIGN#<campaignId>` | The household's attempt at one campaign across evenings: status, setbacks, route flags, coins, a graph campaign's journey (`CampaignProgressRecord`). |
| Field Guide | `HH#<hhId>` | `FIELDGUIDE` | The household's permanent record of discoveries: `entries` keyed by canon id → `{ firstFoundBy, foundAt, runId? }`. One item, written with per-key `if_not_exists` so the first finder always wins and concurrent writers merge. Versioned (`FIELD_GUIDE_VERSION`). |
| Chapter progress | `RUN#<runId>` | `CHAPTER#<n>` | Status, branch taken, XP earned. |
| Game state | `RUN#<runId>` | `STATE` | Current authoritative snapshot. Single item. |
| Event log | `RUN#<runId>` | `EVT#<seq>` | Append-only. Enables replay and reconnect. |
| Presence | `RUN#<runId>` | `PRESENCE` | When each seated phone last said it was here (#258). **TTL 6 hours**, renewed by every beat. |
| Room | `ROOM#<code>` | `META` | 4-letter code → runId, mode (`party` \| `travel`). **TTL 6 hours.** A room open to visitors (#249) keeps this row; its longer code lives on the run (`RunState.visitorCode`). |
| Code misses | `GUESS#<client>` | `WINDOW#<n>` | Wrong room codes from one client in one 15-minute window (§4.5, "Joining a session"). Wrong organizer codes are counted the same way, per account. **TTL one window past its own.** Crash reports (#317, §4.6) are counted in the same row shape, under a `report#` key of their own. |
| Organizer invite | `INVITE#<code>` | `META` | A single-use code that makes whoever signs in with it an owner of one household (§4.5, "Groups"). Spent by a conditional delete. **TTL 3 days.** |
| Transfer code | `TRANSFER#<code>` | `META` | A single-use code that moves one kid to another home (§4.5, "Moving a kid"): → source household, playerId. Spent in the move's own transaction. **TTL 1 day.** |
| Moved device | `HH#<hhId>` | `MOVED#<deviceId>` | Left in the household a kid moved out of, naming the one her phone's binding moved into, so a token minted before the move still finds it by primary key. Not under `DEVICE#`, so no device list sees it. **TTL 31 days**, past any token it could forward. |
| Pairing code | `PAIR#<code>` | `META` | A single-use code that makes whoever redeems it a device bound to one kid (§4.5, "Pairing a new device"). Spent by a conditional delete. **TTL 10 minutes.** |
| Visit | `VISIT#<playerId>` | `HH#<tableHhId>` | A table that is not her home that a kid sat down at (#249), written by the join. Keyed by the kid, so a move (#251) never carries it. Only so that deleting her can find the saves that name her (§4.5, "Deleting and keeping"). Deleted with her or her home. |
| Forget job | `FORGET#<playerId>` | `META` | A kid being deleted (#252): her nicknames, her heroes' names, the tables still to clean, and how to finish the delete that wrote it. Written before any of her rows go, rewritten with the tables a scrub could not clean, removed when none are left. In GSI1's `FORGET` partition, so the sweeper finishes what is owed. |

GSI1 does five jobs, all of them lookups that would otherwise be scans:

| `GSI1PK` | `GSI1SK` | On | Answers |
|---|---|---|---|
| `DEVICE#<deviceId>` | `HH#<hhId>` | device items | a returning phone → its household and player |
| `RUN#<runId>` | `HH#<hhId>` | run items | a runId alone → the household that owns it |
| `GUEST` | `<expiresAt>#<hhId>` | **guest** household items only | which anonymous households may be swept |
| `IDLE` | `<keepUntil>#<hhId>#<playerId>` | player items, while their household keeps a retention window | which kids have not played for that window (#252) |
| `FORGET` | `<createdAt>#<playerId>` | forget job items | which deletes still owe another table its scrub (#252) |

Note that **characters hang off the household, not off a run.** That was already true and is what makes
persistence across sessions fall out for free — the only thing that was ever session-scoped is the room.

A run still belongs to one household (its campaign progress, journey and lobby are that household's),
but its party need not (#249). A party member from another household names its hero's home
(`PartyMember.homeHouseholdId`, absent for the room's own), and every character read and write for
that member goes there: the engine's create and seat, a chapter's XP and items, the campaign's commit
or fail, a stat point. So a hero is never copied into the room's household, and goes home with
everything it earned. The household stays the unit (#266 is open); this names a hero's home without
deepening it.

### A kid's own record, where it lives (for deletion, #252)

Everything #283 writes about a kid is keyed by her **home household id** and
her **player id**, and needs no index or scan to find:

| What | Where | Found by |
|---|---|---|
| Her finished campaigns (`finished`: campaign, outcome, when, which table) | On each of her heroes: `HH#<home>` / `CHAR#<charId>`, `data.finished` | Her heroes are the `CHAR#` rows under `HH#<home>` whose `ownerPlayerId` is her. Deleting the hero deletes the record; there is no copy elsewhere |
| Whether she has played the practice (`practiced: true`, #255) | On each of her heroes: `HH#<home>` / `CHAR#<charId>`, `data.practiced` | As `finished` above: deleting the hero deletes it |
| Her finds in her own book, including the ones made visiting | `HH#<home>` / `FIELDGUIDE`, `entries[canonId].firstFoundBy = <playerId>` | The one book row of her home; her entries are those naming her player id |
| What she picked for her own page (`flair`: a color, a frame per hero, a title) | On her profile: `HH#<home>` / `PLAYER#<playerId>`, `data.flair` | Her profile row. Nothing else holds a copy, so deleting her, or her household, deletes it; a move (#251) carries the row as it is |
| Her finds in a table's book, where she was first finder there | `HH#<table>` / `FIELDGUIDE`, `firstFoundBy = <playerId>` | Through her `VISIT#<playerId>` rows (#252), one per table she sat down at, and `finished[].table` for the tables she finished a campaign at. Deleting her re-credits these to `FORGOTTEN_FINDER` (§4.5, "Deleting and keeping"). This copy predates #283 (#106, #249) |

`finished[].table` names another household's id, not a person, and is the
kid's own data: it goes when her hero does.

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

  // Her own record of finished campaigns (#283, §4.5 "Her own record"). One
  // line per campaign, the latest completion kept. Absent until she finishes one.
  "finished": [
    { "campaignId": "gemfall", "outcome": "setback", "at": "2026-07-30T19:12:00.000Z", "table": "h_rue" }
  ],

  // She has played the practice (#255, §4.5 "The practice"), so the lobby
  // stops offering it for her. Absent until then. Only ever true.
  "practiced": true,

  "appearance": {
    "palette": "meadow",
    "accent": "#7FD4C1",
    "hornStyle": "spiral",
    "markings": "dapple"
  }
}
```

- **Campaign success** → `provisional` is copied over `committed`, `provisional` cleared, `questItems` cleared, and the campaign goes on `finished`.
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
| Transfer code, moved-device forward | 1 day, 31 days (TTL) | **No** — a code is used or dead within a day, and a forward outlives only the tokens it serves |
| Guest household and its contents | 7 days since last played, sliding | **No** — the sweeper handles it |
| Device binding | 30 days, sliding | **No** — an unused phone re-pairs by QR |
| `RunState`, events, chapter progress | one campaign | **Yes**, but only while it is in flight |
| Character, household, player profile | until an owner deletes it or its retention window passes (#252) | **Yes**, permanently |
| Field Guide | as long as its household | **Yes**, permanently — `migrateFieldGuide()` |
| Visit | as long as the kid | **No**: one fixed shape, read only by a delete |

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

#### Stepping away: absence is `connected: false`

A player who is not at the table is a party member with `connected: false`
(spec §8.5): presence sets it (`handlers/presence.ts`, below), Remove sets it
with `removed` (§4.5), and the join or the heartbeat that brings them back
clears it. The member, the hero and its place in the fight all stay, so a
returning phone needs nothing put back.

Every wait in the engine reads it (shared `engine.ts`, and `away.ts` for the rules the screens read too), and none of them read
anything else, so a table with everybody present plays exactly as it always
did and the Gemfall digests do not move:

- **Opened on someone here.** A story turn skips an away holder
  (`storyTurnHolder`); a check never nominates one (`rollerPool`).
- **Open to anyone once the one it names is away.** A held story choice
  (`turnHolderAway`), a check (`rollerAway`), a combat turn (`combatTurnAway`:
  END_TURN only, never a move or an action), and a full bag's swap prompt
  (`swapOwnerAway`: "leave it" only).
- **Not waited on.** A vote's outstanding voters, the ready-up before a fight,
  the lobby's Begin (`readyWithoutAway`) and the chapter's end.

A gate the engine only counts when a tap lands (a vote, the pre-fight ready)
cannot close itself when the last one it waited on drops: presence does not
run the engine (it has no chapter, map or dice), and an automatic pass would
also fire for a phone that is merely asleep. So the phones offer the tap that
closes it (`voteWaitsOnlyOnAway`; a READY sent again), and the chapter's end,
which needs no engine context, is settled by presence itself
(`settleChapterEndVote`). The combat pass is offered rather than automatic for
the sleeping-phone reason too.

What the screens draw from it: the TV names who stepped away in the narration
header and fades their figure on the board and in the lineup (never the
knocked-down pose), and a phone that opens on a chapter in progress, or whose
channel came back after the story moved, shows a one-line catch-up
(`screens/CatchUp.tsx`).

**How the server learns a phone has gone: heartbeats.** AppSync Events tells
the Lambda nothing when a socket opens or closes, so every seated phone says
"still here" itself: `POST /api/presence` with its session token, every 20
seconds while its page is on screen and once more the moment it comes back on
screen (`client/src/sync/presence-beat.ts`). A page that closes says
`{ leaving: true }` (sent `keepalive`), which marks it away at once. A phone
that dies, loses signal or is put away simply goes quiet, and the next beat
from anyone at the table finds it: a friend whose last beat is older than
`AWAY_AFTER_MS` (two minutes) is marked away. No timer runs on the server,
and none is needed, since a table with nobody beating has nobody to stall.

The beats live in one row per run (`RUN#<id>` / `PRESENCE`, a map of player
to time, with the room's TTL), written by one nested `SET` per beat
(`touchPresence`), so phones beating at once never lose one another's times,
and a beat that changes nothing burns no seq. A friend with no beat on record
is never swept: there is no evidence their phone was ever here.

The timeout is long on purpose. A phone set down on the sofa sleeps and stops
beating, and it beats again as soon as it wakes; reading it as away for a
while costs a "stepped away" line on the TV and a tap the table does not have
to take, never a turn, because nothing is skipped automatically.

The dev server also keeps the stream-based presence it always had (an SSE
stream opening or closing); the two agree and heal one another.
`KAD_STREAM_PRESENCE=off` turns the stream half off and `KAD_PRESENCE_AWAY_MS`
shortens the timeout, which is how the e2e suite runs: presence exactly as
production has it, in a test that can wait for it.

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
| **Player profile** | As long as its household, or its owner's retention window (#252) | A device-bound long-lived token. **No password, ever.** |
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
the keeper, and only that phone is shown the offer to keep the party.

**The host can hand the keeper role to a phone in the room (#272).** The
device that opened the room already holds its low-stakes controls, and
"whose game is this" is answered by who is sitting in it, so the roster has a
"Make keeper" beside Remove (`POST /api/room/:code/keeper`, `handKeeper`). It
moves `founderDeviceId` to the chosen player's own phone, so it mends a stranger who beat the family to a TV's code, a founder taken out,
and a founding phone that was lost. Conservatively: only the room's host; only
a phone that is in the room, in its own household, not taken out (never a
visitor, never a family tablet, which is nobody); nothing is claimed by it,
the new keeper still signs in on that phone to keep the game; and a household
an account already keeps is refused. The run records it
(`RunState.keeperPlayerId`), so every screen hears it at once: the old
keeper's offer goes, the new one's comes, and a phone restored from storage
(which has only what its join said) draws the right one without joining
again. **The founder and the run's record are one transaction**
(`CommitInput.founder`, in the same `TransactWriteItems` as the state and the
event, under the claim's own conditions on the household: a guest nobody has
kept, not being swept), gated by the run's seq. So two hand-overs that overlap
land whole or not at all and the later commit wins both places together; a
room that closes or a race that is lost leaves the household as it was; and
there is no rollback to get wrong. The alternative of committing the run
first and then setting the founder would need a reconciler for the gap
between them. The target is
checked again on the run as it stands at every attempt, so a Remove that lands
mid-flight refuses the hand-over rather than giving the game to someone taken
out; and a Remove clears `keeperPlayerId` when it names the removed player.
The same Remove also drops that phone as the founder in its own commit
(`CommitInput.unfound`, conditional on it still being the founder, read again
on every attempt), so a removed keeper's phone stops being able to claim in the
same step the room stops naming them, whichever of the two lands first. Deleting a player (#252) takes her id out of it. Left as it is on
purpose: the founder is still a device and not a person. A guest game is a
table's save (see "Who owns what", below), a kid's hero is hers and is not lost
with it, and a family tablet exists only in a household an account already
keeps, so none can found a guest game for every kid who uses it.

Guest households from before founders were recorded keep the old rule (any
device playing in one may claim it). #265 shipped it on 2026-10-17 and a guest
household expires a week after it was last played, but a game still being
played keeps renewing, so the rule goes only once none is left to find: delete
the `legacy` branches in `mayClaim`, the memory store's `claimHousehold` and
the DynamoDB claim condition then (#272).

The device that opened a room may take a
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
- **A tablet can be the TV** (#274). "Show the game on this screen" opens a
  Party Mode room with `display: true` on the shared token alone. The room is
  the tablet's own household's, so it is never claimable; the tablet is its
  `hostDeviceId`, `RoomRecord.display` marks that nobody is seated, and no kid
  is picked, no session minted, no device token handed back. `/watch` takes the
  shared token as proof of host, and only for a room in the tablet's household
  that this very tablet opened; its answer is still a viewer token. Remove,
  lock, quiet and close take the shared token **alone** there, as a TV's device
  token does (`tabletHost`); on a room the tablet opened to *play*, they still
  need the seated kid's session, so a token cannot become a TV after the fact.
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
prerequisites (#221) read her own finished-campaign record as well as the
table's. The table keeps its shared Field Guide, and her finds also go to her
own. Built in #283: "Her own record" below.

##### Her own record (#283)

Two pieces of hers used to live only on the table: which campaigns she has
finished, and her Field Guide finds. Both are now hers.

- **Finished campaigns live on her hero.** `Character.finished` (character
  schema v3, §3.2): one line per campaign, `{ campaignId, outcome, at, table }`,
  the latest completion kept. It is written by `commitCampaign`'s caller
  (`finish` in `progression.ts`), so it lands in the **same write** that
  commits her provisional state and releases her claim, inside the run's
  commit, at her home whichever table she finished at. Only a completed
  campaign counts, a loss ending included (spec §8.3); a failed one leaves a
  souvenir and no line. A hero another adventure holds is not settled by this
  table (`settleParty`), so she gets no line from it either. The table's save
  (`CampaignProgressRecord`) is written as before and stays the table's.
- **Prerequisites read the party as well as the table.** A campaign's
  `requires` is met when the table's household has completed it (#221, as
  before) **or when any hero seated at the table has it in her own record**
  (`unmetPrerequisites`'s `finished`, read by `partyFinished` from each
  member's home). *Any*, not every: a prerequisite says the story has
  happened, and one hero who was there carries it for the party, the way the
  household's record already carries every kid at its table. Requiring every
  hero would lock a family's own new kid out of the campaign the family
  finished. (The owner confirmed "any hero in the party" for #283; a mixed
  party where only one hero finished it is tested in `hero-record.test.ts`.)
  Keeping the household's record beside hers is the conservative
  half: no record was backfilled, so a household that finished Gemfall before
  heroes kept one plays exactly as it did. The server's refusal at a chapter
  start or a Begin reads the party seated then; the lobby's lock is recomputed
  whenever the party in the lobby changes (`relockLobby`), and a vote for a
  campaign that locks again is dropped. A hero who has been **taken out**
  (a host's Remove, or a grown-up retiring her: `RunState.removed`) counts for
  nothing (`seatedParty`), at the start and in the lobby, which a removal
  relocks; she stays in `party` disconnected, so reading `party` alone would
  let her record hold a campaign open for the table she left. A hero who is
  only disconnected still counts: a dropped phone is not leaving. None of this reads anything for a campaign without `requires`, so Gemfall's
  lobby and starts are untouched.
- **Her finds go to her home book too.** When the finder of a step
  (`firstFinder`) is a visitor, everything her step revealed is also recorded in
  her home household's book, credited to her, first finder wins; the table's
  book is written as before. Only the finder's: a find another hero made at
  the table is not hers and goes to no visitor's book. (#249 first wrote every
  find to every visiting household; this narrows it.)
- **It moves with her.** The record is on her `CHAR#` row and her finds are
  credited to her in her home book, so #251's move carries both with no new
  code: her heroes move as stored, and the finds she was first to are added to
  her new home's book.
- **Her adventure book shows it.** `GET /api/journal` answers `finished`, her
  heroes' lines with each campaign's title, and the hero page lists them under
  the sheet ("Adventures finished"). Her finds are already in the Field Guide
  the journal opens, since it reads her home book.

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

##### Pairing a new device (#281)

`handlers/pairing.ts`. Three routes, and the first two make the same code:

| Route | Who | Needs |
|---|---|---|
| `POST /api/pair/code` | Her own phone ("Play as me on another device") | A **personal** device token. The profile is the one the device already is; the request cannot name another. |
| `POST /api/organizer/players/pair` | A signed-in owner of her household ("Pair a device" on her row of the organizer panel) | The sign-in, through `organizerRoute` like every other organizer route. |
| `POST /api/pair/redeem` | The new device | **Nothing.** The code is the credential. |

- **The code.** Eight letters from the room-code alphabet (about 37 bits),
  shown `ABCD-EFGH`, naming one profile. Stored as `PAIR#<code>` with a
  10-minute `expiresAt` and TTL, written by `putPairingCodeIfAbsent` (a
  collision is re-rolled, never overwritten). A QR carries
  `/?pair=<code>`, which opens the home screen with the code filled in. It is
  **not** spent on load: a link preview or prefetcher fetches URLs nobody
  tapped, and a spent code is a code the kid never gets to use. Spending is a
  tap ("That's me").
- **Spent once.** `redeemPairingCode` is a conditional delete that returns the
  row it deleted, with the expiry in the condition because TTL deletion is
  eventual. Of two devices holding one code exactly one is bound. A used, expired or never-issued
  code all answer the same "didn't work".
- **Spending and binding are not one transaction**, unlike an organizer invite
  (which writes rows in the table beside the code). The binding is a device
  token the identity service signs and stores, so the code is spent first and
  the binding issued second. If issuing fails the code is gone and the kid
  asks for another: the safe way to lose, since the reverse would leave a code
  that could be redeemed twice.
- **Who may make one.** A device bound to that profile, or an owner of her
  household. A shared tablet is nobody: `resolveDevice` refuses its token, and
  the route says so (403) rather than treating it as unbound. A retired
  profile cannot be paired at the making (`ILLEGAL`) **or the redeeming**: the
  profile is re-read when the code is spent, so a kid retired in the minutes
  between is refused and the code is spent with nothing bound.
- **Wrong codes** are counted like wrong room codes, per client address
  (`code-guard.ts`, key `pair:<client>`), with the reservation-then-refund
  shape: a right code costs nothing, and a client out of budget gets a 429
  before any lookup. The address is the key rather than the account because
  redeeming has no account.
- **The binding.** The new device gets what `adoptDevice` gives: a personal
  30-day sliding device token, a `DEVICE#` row under her household, and it
  lands on her hero (`/journal`). It is a binding like any other: an owner
  revokes it the way they revoke a lost phone. Her own phone is untouched,
  and she can have several devices.
- **A binding the device already held is revoked**, once the new one exists.
  The client replaces its stored token with the new one anyway, so the old
  token would stay valid on the server with nobody holding it, a working
  credential on an owner's list for a kid who is not using it. The device
  proves it holds it by sending it with the redeem, so only a device can
  retire its own binding this way. A shared tablet's binding is not touched.
  If the revoke fails the pairing still succeeds (logged).
- **Not built here:** an in-app camera scanner. A phone's own camera reads the
  QR and opens the link; typing the code is the fallback. A list of a kid's
  paired devices for the organizer panel waits on the device screen that
  does not exist yet (#250's "forget this device" is by device id).

**What is collected about a kid, and for how long.** Kept current as features
land. The app's own "what we store" page (`screens/WhatWeStore.tsx`, words
in `what-we-store.ts`) says the same in plain words, and its test fails when
a row is added to §3 or written by a store without being described there. It
opens inside the sign-in panel, from its first step (so before anybody signs
in) and from the organizer screen; that panel is loaded on demand, so the
page costs first paint nothing.

| Data | Where | Kept |
|---|---|---|
| Nickname, color, avatar, when she last played | `PLAYER#` row | With the household: 7 days after last play while a guest, until deleted once kept, or the owner's retention window (#252) |
| Hero: name, appearance, progression, items, souvenirs, finished campaigns (each naming the household whose table it was) | `CHAR#` row | Same |
| Gameplay: choices, rolls, the event log | `RUN#` partition | Same |
| Field Guide finds, credited to a profile | `FIELDGUIDE` row | Same |
| Device binding: device id, user agent, last seen, token hash | `DEVICE#` row | Same, revocable |
| A moved kid's device id → her new household | `MOVED#` row, in the household she left | 31 days (TTL) |
| The other tables she played at | `VISIT#` rows | Until she or her home is deleted; only so deleting her can find them |
| While she is being deleted: her names and the tables still to clean | `FORGET#` row | Until every table is clean; the daily sweep retries a failed one |
| When her phone last said it was at the table | `PRESENCE` row of a run | 6 hours (TTL) |
| Long-lived device token, room session token | The device's own storage | Until it expires (30-day sliding, room's 6 hours) or is cleared |
| Address (IPv4, or the IPv6 /64) as a wrong-code counter key | `GUESS#` row | About two 15-minute windows (TTL) |
| Request logs (address, path, errors) | CloudWatch | Account-wide retention, set outside this repo (`infra/template.yaml`, "Logs") |
| Hero and player names, inside narration prompts | Sent to the model provider | Only while live narration is on (§6, #254) |

The grown-up's email lives in Cognito, never in the table.

**One game at a time per hero: the claim.** A character carries one
`provisional` snapshot, stamped with one `runId` (§3.1). That stamp is the
hero's **claim**, and it is both the one-game rule and the authority for a
visiting table to write to a hero it does not own. #282 builds it
(`handlers/claim.ts`). These are its invariants and failure semantics:

- **What it names.** The table's campaign attempt, not one evening's room. A
  campaign spans evenings and every evening is a new run, so
  `provisional.runId` has always held the campaign id (`campaignKey` in
  `progression.ts`): scoping it to the room threw away Tuesday's levels on
  Saturday. The claim keeps exactly that value at home, so no stored row
  changes. At a table that is not her home (a visitor, whose party member
  carries `homeHouseholdId`, #249) it is `<campaignId>@<tableHouseholdId>`,
  so two tables playing the same campaign hold different claims. The hero is
  always read and written at her home; the table only names the claim.
  `claimFor`/`parseClaim` live in `@kad/shared` (`claim.ts`). "The run"
  below means that attempt.
- **Where it lives.** On the character row, in the hero's home partition
  (`HH#<home>`/`CHAR#<id>`), next to a monotonic `version` on the row
  (`Character.version`, character schema v2; rows without it are version 0).
  Every decision about the hero is made against that one row, whichever table
  is playing.
- **Acquire.** When a run first writes the hero, it is one conditional write
  on the character, in the commit of the turn that seats her in a started
  campaign: the chapter start for everybody at the table, or the seat itself
  for a hero who joins a chapter under way. It succeeds if there is no claim,
  if the claim already names this run (an idempotent retry: a retry re-reads
  and finds itself), or if the claimed run is terminal: its attempt is
  complete or failed, or gone (no attempt, or a campaign the content no longer
  ships). In that last case the write is conditioned on the old `runId` and
  `version`, so two runs reclaiming one stale hero cannot both win. Otherwise
  the seat or the start is refused (`HERO_BUSY`, "Sparklehoof is in the middle
  of another adventure"), and nothing is written. A lobby seat is refused only
  for another table's claim, since which of this table's campaigns is next is
  not decided until the start.
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
  commit. Her own grown-up can also **leave that adventure** from the
  organizer screen (`POST /api/organizer/heroes/leave`), which discards that
  run's provisional gains and clears the claim, conditioned on its `runId`.
  The phone at a table that refused her offers "Make a new hero for this one"
  instead; a kid-side leave is not built.
- **A host closing the room does not release.** Closing (#263) ends the
  evening, not the attempt: "closing costs the table this evening's room and
  nothing else" (`host.ts`), and the next evening continues the campaign. Were
  it terminal, every Gemfall evening that ended with Close would throw away
  the gains it was meant to keep.
- **Disconnects never release.** A dropped phone, a closed tab or an expired
  room is not leaving. The claim holds, so the table can resume (#259). A run
  abandoned without a release stays claimed until it becomes terminal or she
  leaves it. Nothing times a claim out behind a family's back, because that
  would discard gains they meant to keep.
- **Stopping for today keeps the claims, deliberately (#259).** A stopped
  table's heroes still hold their adventure, exactly as after a Close. The
  claim is what carries every chapter's gains so far, and releasing it would
  discard them, so "nothing lost" and "released" cannot both be true. It is
  never hidden: her own screen (the "who are you bringing?" list,
  `GET /api/heroes` `saved`) and the organizer view (`OrganizerHero.saved`) say
  where she is, e.g. "Ada is saved in a game at Rue's" (`heroSaved`). A held
  hero refused elsewhere still reads "in the middle of another adventure".
  **There is no automatic timeout.** Two people can **release** her, and
  either frees her at once and drops her unfinished gains from that
  adventure, exactly as "end this adventure" always did (`releaseClaim`):
  - **an owner of her home household**, from the organizer screen
    (`POST /api/organizer/heroes/leave`), whoever hosted the game; and
  - **the stopped table's host**, the device that stopped the game
    (`RunRecord.stoppedBy`, kept because the room's code and host go with the
    room): `POST /api/save/release` `{ characterId, homeHouseholdId? }` with
    its device token, only for a hero that game's party holds
    (`releaseSavedHero`). The stopping screen offers it as "Let a hero go",
    after one "are you sure?" that says what is lost. A shared tablet's host
    (#250) has no device token of its own to prove this with, so a tablet's
    stopped game is released by an owner instead.

  If the game resumes after that, she is not in it: a resume leaves out any
  saved hero who no longer holds the adventure, and she is in it again only by
  sitting down as she is now, like anyone joining mid-chapter. Stopped runs
  stay under the household's own keys (`RUN#`), as every run is, so a
  household's deletion (#252) takes them with it.
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
How, and what each delete keeps: "Deleting and keeping" below.

**Staged, so nothing is rewritten up front.**
1. **Now.** Heroes stay in their home household's partition. A visiting
   member carries `homeHouseholdId` (#249), and every character read and write
   uses it. Pairing and the one-game rule land as their own issues.
2. **Moving a kid (#251)** is changing her home household: her profile, her
   heroes and her finds move under the new one, ids unchanged, in one
   transaction, behind a single-use code like an organizer invite. Built:
   "Moving a kid" below.
3. **Later, when two homes are real** (two households, grandparents who host):
   the profile and its heroes move to their own `PROFILE#<id>` partition, with
   a guardian link per grown-up who keeps her, and households become the
   tables she plays at. Ids do not change, so this is a mechanical migration
   (§3.2), not a re-model. Not built until a family needs it.

New work keeps to this split: a hero's own record is named by the kid's home,
never by the room's household, and nothing new is added that only makes sense
if the household owns the kid.

##### Her page (#299)

The payoff for all that record: a page in the adventure book (the journal's
"Me" tab, lazy-loaded) that shows it back to her as hers, and lets her make it
a little her own.

- **Everything on it is derived.** Her heroes with their level and stats, her
  finished campaigns (`finished`, #283), the Field Guide finds her home book
  credits to her (`firstFoundBy`), and her badges. A badge is a pure function
  of those rows (`deriveBadges`, `packages/shared/src/kid-profile.ts`): a
  finisher badge per campaign (a loss ending counts, spec §8.3), Guest Star for
  one finished at another household's table, Story Collector, Kept Going for a
  keepsake, level and find milestones. A level counts at its **committed** value
  only, since a failed campaign discards the rest. There is no counter, event or
  row for a badge, so nothing to drift or migrate, and one earned at another
  table is there because that table wrote it to her heroes. "Chapters played"
  has no per-kid record (chapter progress hangs off a table's run), so there is
  no badge for it.
- **What she picks is presets only**, in one small versioned field on her
  profile, `PlayerProfile.flair` (`{ v, color?, frames?, title? }`): a color from
  eight, a frame from five for each hero, and a title that is the id of a badge
  she has earned. No photo and no free text, so no safe-name filter is needed. It
  is read through `readFlair`, which drops what is no longer there (an id from a
  build with more presets, a hero since gone, a title no longer earned) and reads
  a newer `v` as unchosen, so an old page is plain, never broken. It is saved by
  `POST /api/profile/flair`, which replaces the whole choice and **refuses**
  (`ILLEGAL`) a request naming something that is not a preset, not her hero or
  not a badge she has earned. It is written with `updatePlayer`, so it can never
  bring back a profile being deleted (#252).
- **Only she can see or change it, and the server enforces that.** The
  journal's `profile` and the flair route are authorised by one of two things,
  and nothing else: her **personal device token**, or the **room session she
  holds once seated** (`resolveKid`). The second is how a family tablet knows
  which kid was picked (#250): a session is minted for one kid, at her home,
  and never for a shared tablet's own token. No request names a kid: the
  credential's player is the only page there is to read or write, so a
  sibling's seat is the sibling's. A TV's viewer token, a grown-up's sign-in
  and a shared tablet's own token resolve to nobody. A visiting table's other
  players hold sessions of their own, for their own pages. The flair is never in a
  run's state, a seat, a room payload, the picker or the organizer's lists
  (`LinkAccountResult` strips it), so a table sees her hero name and her
  profile color as before. There is no public page, link or way to browse kids.
  A tablet's kid may edit as well as read: the picker already trusts whoever
  taps a face with that kid's seat (§4.5, "Shared devices"), and the choices
  are presets. The tablet keeps nothing of her page after the room. A phone
  kid finds her book on the home screen; a tablet kid, who has no home screen
  of her own, finds it on the room's tray (`layout/BookTab.tsx`, a "Book"
  object shown only to a seat with no device token), which opens the same lazy
  `/journal` with her seat, and its Play tab returns her to her room.

- **It follows her.** It lives on her profile row under her home, so it is on
  every device bound to her (#281), moves with her (#251, which carries the
  row's `data` as it is), and is deleted with her (#252): `deleteProfile`
  removes the row, and the household delete removes every profile. The "what we
  store" page names it (`flair` on the profile's described fields, which its test
  reads from the type, so a new profile field that is not described fails the
  build).

#### Moving a kid: take your hero home (#251)

A hero made at a club, a friend's house or a cousin's goes home with the kid
who plays her. Moving a kid **changes her home household**, as staged above,
and it is a move, never a copy, so there is never a question of which hero is
the real one (`handlers/transfer.ts`).

- **A single-use code, like an organizer invite.** A signed-in owner of her
  home taps "Move home" on her row (`POST /api/organizer/transfer`): ten
  letters from the room-code alphabet, shown as text and as a QR of
  `/?move=<code>`, which opens "Run a group" with the code typed in. It works
  once and lives a day. Making one refuses a hero mid-adventure (below).
- **Redeeming needs a sign-in too** (`POST /api/organizer/transfer/accept`),
  and wrong codes are counted against the account (`code-guard.ts`). From the
  picker it takes her into a **brand-new home** owned by that account; from a
  household the account owns, into that one. A name already on that
  household's picker is refused ("rename one of them first"), and so is her
  own home.
- **What moves**, with every id unchanged: her `PLAYER#` row (back on the
  pickers if a group had taken her off), every `CHAR#` row she owns, her
  **live personal** device bindings, and the entries in the Field Guide she
  found first, added to the new home's book with first-finder-wins. Rows move
  as stored, `v` and all, so an old row migrates on its next read as any
  other does (§3.2).
- **What stays**: runs, chapter progress and `CAMPAIGN#` rows, because a save
  is its table's; the old home's own Field Guide, because it is the table's
  book too (her finds there stay credited to her, by an id it no longer
  lists); its shared tablets; and her revoked bindings, which are dropped.
- **One transaction.** `readProfileMove` reads her rows strongly
  consistent, and `moveProfile` sends one TransactWriteItems
  (`store/profile-move.ts` builds the plan both stores carry out): the code's
  delete, conditioned on it being unexpired and naming her; a delete of each
  of her rows conditioned on its `data` being **exactly the map read**, so a
  level, a stat point or a claim landing in between cancels the move rather
  than being flattened; a put of each under the new home, conditioned on the
  key being free; a forward per moved phone; the new home's three rows when
  she is going to a new one (`META`, `OWNER#`, `ACCT#`); and her finds. A
  cancellation on the code is "used up or too old"; on anything else the
  handler reads again and retries, up to three times. A move that fails
  spends nothing, and trying again is the whole recovery.
- **The 100-item limit.** That is 1 for the code, 2 for her profile, 2 per
  hero, 3 per live phone, 1 per revoked one, 1 for her finds, and 1 for the
  new home's check or 3 for its rows: room for well over 40 heroes, against
  the handful a kid has. Past it, `planMove` refuses before writing anything
  and she does not move ("more heroes and phones than one move can carry").
  Splitting the move would break the guarantee that she is always in exactly
  one home, so the answer past the limit is a bespoke migration (§3.2), not a
  partial move.
- **Her phone moves with her, and keeps working.** A personal binding is
  hers, not the household's: it lands on her face with no picker, so the
  phone that went to the club with her goes home with her. Revoking it would
  leave her own phone a stranger in the home she just moved into, with
  nothing gained, since whoever held it was already her. Its token still
  names the old household, so the move leaves a `MOVED#` forward there, and
  `resolveDevice` follows it **only on a miss**, by primary key, up to four
  hops (`movedBinding` in identity.ts): the revocation check still reads the
  binding itself, strongly consistent, never an index copy. Her new home can
  revoke it like any other. The next sliding rotation mints a token naming the
  new home; until then every resolve takes the forward, which lives longer
  than any token minted before the move. A **shared tablet** is the
  household's and stays.
- **Not mid-campaign.** A hero whose `provisional` names an adventure still
  in flight is that table's until it ends (the claim, above). Moving her would
  strand the gains its last chapter commits or reverts. So making the code
  and redeeming it both refuse while her claim is live (`claimIsLive`): a
  bare campaign id names her home's attempt, and `<campaignId>@<table>`
  names that visiting table's, which is the one read. The conditional delete
  covers a claim taken between that check and the move, and a table's write
  to her old row afterwards fails the claim's version condition on a row
  that is gone, so it cannot bring her back there.
- **Rooms she was seated in let her go.** A session or seat minted before
  the move still names the home she left, and her profile is no longer
  there. Every room door treats that as out (`isOut`, and the action door's
  own profile read), the way a retired profile is: the profile is the
  record. That holds at a visiting table in a household she never belonged
  to, too, which nothing on her side could list. Redeeming also puts her on
  the `removed` list of every room her old home has open
  (`takeOutEverywhere`), so its screens show her gone; that is tidy-up only,
  and a room it cannot write is logged, not retried.
- **A pairing code her old home made is dead.** A pairing code (#281) names
  her household and is re-read at redeem; after the move she is not there, so
  it is refused rather than binding a device into either home. Her new home
  pairs her anew.

#### Deleting and keeping (#252)

An owner can delete one kid, or the whole household, and choose how long a
kid who stops playing is kept (`handlers/retention.ts`, on the organizer
panel). Data minimization stays the default it already was (above): the
profile never held anything personal, so what there is to delete is the
game's own record.

**One delete path, the sweeper's.** `deleteHousehold` is `deleteGuestHousehold`
with a different gate: the same `sweeping` mark first (which claiming,
renewing, founding and, now, redeeming an organizer invite all refuse), runs
and their partitions next, `META` last, so a delete that dies part-way is
found and finished by the next one. The guest sweep checks expiry in the
marking write; an owner's delete checks only that the household is there,
because the caller already proved a signed-in owner. `deleteProfile` is the
same shape for one kid: her `PLAYER#` row is marked, a marked profile reads
as gone to `getPlayer` and `listPlayers` (so every room door already treats
her as out, `isOut`), then her heroes, her own phones and her visits go, and
the profile row last.

| Deleting | Removed | Kept, and why |
|---|---|---|
| **A kid** | Her `PLAYER#` row, every `CHAR#` she owns, her personal `DEVICE#` bindings (revoked or not), her `VISIT#` rows. Her names everywhere they were copied (below) | The saves of the tables she played at, which are the tables'. Before play begins she is taken out of the party; after, her party member stays as "A friend", on `removed` and away, because an encounter's turn order and the table's votes point at it (as with Remove). Field Guide entries she found first, which are the table's book: they now credit `FORGOTTEN_FINDER`, shown as "a friend" |
| **A household** | Every row under `HH#<id>`: kids whose home it is, their heroes and phones, shared tablets, the Field Guide, campaign attempts, `MOVED#` forwards; every run with its state, event log, chapter progress and presence, a game stopped for today (#259) included; rooms still pointing at those runs; every owner's `ACCT#` pointer; its kids' `VISIT#` rows. Its kids' names everywhere they were copied, as for one kid | A **visiting** kid's hero, which lives at her own home (§3) and is not touched. Her claim on this table's attempt is released by the attempt going with it (`claimIsLive` reads no attempt as over). Codes already handed out (`INVITE#`, `TRANSFER#`, `PAIR#`) expire on their own TTL, and each now finds nothing to act on: an invite's redemption checks the household is there and not being deleted |

**Where a kid's names and ids are copied outside her home.** The list
`forgetEverywhere` works through, at every table in her `VISIT#` rows, the
tables her heroes' claims name, and her home (when only she is deleted):

| Copy | Holds | On delete |
|---|---|---|
| `RunState.seats[playerId]` | Her nickname, color | Removed |
| `RunState.party[]` | Her player id, a snapshot of her hero (its name) | Out of the party in the lobby or making heroes; after, kept as "A friend", away |
| `RunState.removed` | Her player id | Added: she is out of that room |
| Any other string in the run state (narration, recaps) | Her hero's name, where the story said it | Replaced with "A friend" |
| `EVT#` rows (the event log) | Patches carrying all of the above; `playerId` naming the author of a turn | Each event that names her is put back, same seq, with her names replaced (`rewriteEvent`). The author id stays |
| Trades, votes, turn order, `firstFoundBy` in a run | Her player id | Ids stay: an id that names nobody once her profile is gone |
| `FIELDGUIDE` of each of those tables | Her player id as `firstFoundBy` | Replaced with `FORGOTTEN_FINDER` (`forgetFinder`) |
| A visitor's room session or seat token on a phone | Her player id and home | Turned away at every door: no profile (`isOut`) |

**Why a visit record, and why keyed by her.** A table's copies cannot be
reached from her ids alone: nothing under her home says where she played
besides the last table each hero's claim names. Two ways out were weighed:
(a) write down the tables she plays at, and visit each on delete; (b) have
other households store only her ids and resolve her name at render time.
(b) would still need a sweep of every event log written before it, and a
save has to carry a hero's name to replay without her home, so (a) it is.
The record is a `VISIT#<playerId>` row per table rather than a list on her
character, so a kid with no hero yet is covered, a move (#251) carries
nothing, and two tables seating her at once never contend on her hero's row.
A table one of her heroes is claimed by, or finished a campaign at
(`finished[].table`, #283), is visited too, which covers visits from before
the record existed.

Her player id is a random id, never anything about her, so where a save
needs it to stay well formed (a turn order, a vote, a trade, an event's
author) it stays, and names nobody. Her nickname is replaced only in fields
that hold a name, since a nickname can be an ordinary word the story uses;
her heroes' names are replaced in every sentence. An id-shaped string (lower
case, no spaces) is never rewritten, so a hero who shares a word with a
scene id cannot break a save.

- **Delete wins** (the owner's decision). A hero mid-adventure at another
  table (`claimIsLive`) is deleted all the same, and her name is taken out
  of that table's save. The table plays on: her profile is gone, so every
  room door turns her phone away, and a chapter's settlement skips a party
  member whose hero row is gone (`progression.ts`), so nothing waits on her.
  Deleting a household is the same for its kids' heroes at other tables.
- **Only the last owner deletes a household** (the owner's decision). A
  household with another owner (an `OWNER#` row or the founding `ownerSub`)
  is refused by the server. The others leave first, or the founder takes
  them off (#248), which they see on their own screen. Any owner may delete
  one kid.
- **Forgetting at other tables runs after the delete, and always finishes.**
  After, never before: before it, a guest family signing in at the last
  moment would keep their household and find their kids gone from a friend's
  game. But her visits go with the delete, so a scrub that failed then
  could never find those tables again. So every delete first writes a
  **forget job** (`FORGET#<playerId>`, `ForgetJob`): her names, the tables to
  clean, and what deleted her. The scrub rewrites it with the tables it
  could not clean, and removes it when none are left. The daily sweep
  (`retryForgets`) reads GSI1's `FORGET` partition and first finishes the
  delete that wrote the job, in case it died before or during its rows
  going: an owner's delete is completed, since it was asked for and
  authorized, and a sweep's is asked again under its own gate. Then, if she
  is gone, it cleans the tables still owed. A kid who is still there (the
  guest family kept their household in time, or she played inside her
  window) is forgotten nowhere, and her job is dropped. A delete whose scrub
  is still owed does not answer a plain success: the organizer route says
  `cleanupPending`, and the panel says the cleanup finishes on its own. Each run's state
  change is one committed turn of its own, published to the run's room if
  that room still points at it.
- **A change never brings her back.** `putPlayer` makes a profile and never
  writes over one being deleted. A rename, a retire or a bring-back goes
  through `updatePlayer`, which writes only a profile that is there and not
  marked. So a change an owner read before the delete fails after it, rather
  than making a new row with no mark on it that nothing would delete again. Visits from before visits were written down are found
  through her heroes' claims, which name the last table each played at.
- **Keeping.** `Household.retentionDays` is null by default, which is the
  behavior from before: a kept household keeps every kid until an owner
  deletes one. An owner may pick 30, 90, 180 or 365 days
  (`RETENTION_CHOICES`). Every join notes `lastPlayedAt` on the kid's home
  profile (`notePlayed`), a visitor's included, and while her household has a
  window it files her in GSI1's `IDLE` partition at `lastPlayedAt + window`.
  Choosing a window starts the clock now for a kid with no `lastPlayedAt`, so
  it never deletes anybody on the spot. The daily sweeper reads the `IDLE`
  partition after the `GUEST` one, re-reads each household's window (the index
  is only a candidate list: a lengthened or cleared window re-files her), and
  deletes through `deleteProfile` gated on `lastPlayedAt` being at or before
  the cutoff, so a kid who joins a room while it runs is spared. A live claim
  does not spare an idle kid, as it does not stop any delete.
- **Why not DynamoDB TTL.** TTL deletes one row. A kid is a profile, heroes,
  bindings and visits, and a household spans the `RUN#` partitions besides,
  so a per-row TTL would leave the rest orphaned with nothing pointing at it,
  the argument §3.0 makes for guests. TTL stays on what is one row that
  nothing points at: rooms, codes, code-miss windows, presence, moved-device
  forwards.

The guest sweep also takes a swept household's kids out of the saves at the
tables they visited, and their `VISIT#` rows with it.

#### Recovery and revocation

- **Lost phone** → the household owner revokes `DEVICE#<deviceId>` from their own device. That token is dead immediately.
- **New phone** → join the room, which makes it a new player, or the owner signs in on it and binds it to an existing player (`POST /api/auth/device`) to bring that player's heroes back.
- **Nobody who only plays can manage anything.** Without a sign-in a phone cannot claim the household, bind another phone to a player, or revoke one.

#### The practice (#255)

A short chapter that teaches by doing (`content/chapters/first-steps-01.json`,
campaign `first-steps`): pick a choice, roll a check, take a story turn, move on
the board, use a card, help a knocked-down friend, rest. Each step has one
`hint` on its scene, shown under the narration and read aloud after it, and on
the phone with a "hear it" button. The content contract is in
[content/README.md](../content/README.md#the-practice).

The Help Up step is the real card on a real friend: the Bun fight is marked
`friendDown`, so with two or more heroes seated, the one after the story-turn
holder walks onto the board knocked down (the fight's placement only; the run's
HP is untouched) and somebody has to stand beside them and play Help Up. A
table of one has nobody to help and nobody goes down; Bun, a captive with no
deadline, is the lesson there.

**Who gets it.** A hero is a *newcomer* (`isNewcomer`, shared `practice.ts`)
while she has played nothing: not `practiced`, no campaign under way, no XP, no
souvenir. While any seated hero is one, the lobby offers **Play the practice**
above Begin, and Begin reads **Skip the practice and begin the adventure**. One
tap either way, for the whole table: skipping is simply starting the adventure,
and a hero who has started one is no newcomer after it. A late joiner seated at
a party's tier floor (spec §8.4) has XP she did not play for and reads as a
veteran; she is sitting down with people who know the game.

**A mixed party plays it together.** The practice is one short sitting
(about 15 minutes, three tiny fights against wisps that go down to one tag),
and the veterans play it beside the newcomer rather than waiting for her. That
is the decision because the table shares one screen and one story: a practice
for one kid while the rest watch is slower than one everybody plays, and the
veterans are who she would otherwise ask. Anybody who would rather not taps
Skip.

**It is never a campaign.** `START_PRACTICE` is answered by the server
(`handlers/practice.ts`): it starts the practice's chapter only while a seated
hero is a newcomer, and a direct `START_CHAPTER` for it asks the same question
(`roadTo`). The start creates no campaign attempt and acquires no hero's claim,
so a hero halfway through Gemfall can play it beside her friend; seating a hero
into it claims nobody either. Finishing it folds no XP and no bag (the
chapter's award is 0, it grants nothing, and items used in it come back), keeps
no chapter record, and writes one thing: `practiced: true` on every seated
hero, under the version read, re-resolved onto the same patch so the lobby's
offer goes away. A rest in it spends no stat point, and Stop for today saves
nothing: it starts over next time. The lobby's campaign is untouched, so the
next Begin plays the adventure the room was opened for.

**Stored, versioned and deleted.** `practiced` lives on the hero row (character
schema v4, §3.2), is named on the "what we store" page under *Each hero*, and is
deleted with her hero, like `finished`.

#### Joining a session

1. Host device calls `POST /room` with `{ mode: "party" | "travel" }` → 4-letter code (unambiguous alphabet: no I/O/0/1). In **Party Mode** the host device *is* the TV: it sends `display: true`, the room opens with nobody seated, and it lands on `/tv/ABCD`. The room opens **claimable**, under the TV's own household as a placeholder.
2. In **Party Mode** the TV renders the code + QR; in **Travel Mode** the host's phone does.
3. Other devices scan → `POST /room/ABCD/join`, presenting their **device token**. The server resolves device → player → household, verifies the household owns the run, and issues a room-scoped session token.
4. Because identity is resolved from the device, **there is no "who are you?" step.** You scan, and your character is already on the board.
5. **The first phone to join a claimable room decides whose room it is.** A phone that already belongs to a household takes the room into that household. The `ROOM#` item and the run's `HH#…/RUN#` row move together in one conditional transaction (`claimRoom`), and the lobby is re-read for that household's campaigns. A phone with no binding settles the room on the TV's household first, and is then created in it. Either way the room stops being claimable, and from then on a phone from another household is refused as before. This is what lets any screen host the evening. A new TV, or one whose storage was cleared, no longer starts a fresh guest household that locks the family's phones out of their own campaigns and heroes. A phone from a second household joins only a room open to visitors ("Visitors", below).

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
on the run's event log. Opening a room to visitors (#249, below) and forgetting a
device (#273) need a signed-in owner and are not host controls.

**Stop for today, and pick it up another day** (#259, `handlers/save.ts`). A
chapter is one sitting and a room lasts six hours, but evenings end early.
The host's **Stop for today** (`POST /api/room/:code/stop`, a host control like
the rest, so the TV or a kid's phone may hold it) saves the chapter and closes
the room: it marks the run `RunRecord.stoppedAt`, then closes it (`closed` and
`stopped`, so the leaving screens say "your game is saved" rather than "closed")
and deletes the code. Nothing is copied: a run's `STATE` carries no TTL, so the
stopped run *is* the save and lasts as long as its household (seven days past
the last play for a guest household, which every play extends; for good once a
grown-up keeps it). It is legal at any point a campaign chapter is under way. A
roll is settled whole in the action that rolls it, so the run never holds one
half done, and the host's screen simply waits out the dice animation on its own.
The host's panel always has it; a **Rest** scene also offers "stop here for
today?" without opening anything. Between chapters there is nothing to save (the
campaign attempt already holds where the party got to), so it is refused with a
line saying so.

Only a stop saves. A plain **Close**, an idle close and a room that simply
expires do not, and still mean "done for now; the chapter starts fresh".

The household's next room, whoever opens it and on whichever device, **offers
"keep going"**: `savedGame` finds the newest stopped run that can still be
picked up and the lobby carries a `RunState.saved` view (campaign, chapter, the
heroes who were playing, and a one-line recap taken from the scene's first
sentence). It is offered only while the chapter is still the household's next
one: the run is closed, its campaign attempt is still active and the same one
it began under (`campaignAttemptId`), and the attempt is still at that beat
(that visit, for a graph campaign). Another room finishing the chapter, or
replaying the campaign, retires the offer without touching the run.
**Keep going** (`POST /api/resume`, any seated player's room session) takes the
saved game into the lobby in one committed change: the scene, narration,
prompt, flags, purse, trail, fight and story turn are the saved run's; the
code, roster, lock, quiet mode, visitor code and lobby stay the new room's. The
party comes back as the household's party, with the hp it stopped with. A
player whose phone has not joined this room yet is *away* until it does (the
rules of #258 carry the table meanwhile), and a seat belongs to a player, never
to a device, so a different phone resumes seamlessly. A hero already seated in
the new room who was not in the game joins it, claiming the adventure in the
same transaction as a hero who sits down mid-chapter does. The save is spent
once taken up, one save is kept per campaign, and a chapter finished or stopped
again just replaces it. The chapter then settles against the same attempt as
ever.

Room items carry a **6-hour TTL** so abandoned rooms clean themselves up, and a
room open to visitors closes sooner (below). Revoking a device does not touch
any character — characters belong to the household.

#### Visitors: a room open to more than one household

A kid who brings their own phone to a friend's game, or two families sharing an
adventure (#249). **One room-level switch**, not an approval for each visitor,
and only a signed-in owner of the room's household may turn it on
(`POST /api/room/:code/visitors`, `{ open }`, `handlers/visitors.ts`): it lowers
the barrier to joining, so a TV or a kid's phone that opened the room cannot do
it alone. The switch sits in the host's view, which opens the sign-in for it and
leaves nobody signed in afterwards. A TV's room must be settled by a phone first.

- **A longer code.** Opening the room gives it a visitor code, the room's four
  letters and two more (`RunState.visitorCode`). Every screen in the room shows
  it in place of the short one, QR included. The short code still works for
  phones already bound to the room's own household, and a phone from anywhere
  else needs the long one. The join route takes either (`findRoom`). A six-letter code
  names the room only while it is open with exactly that code, so a wrong
  ending is an unknown code and spends the wrong-code budget, and guessing
  one is a search of 24⁶. Everything after the join (the session, the channel,
  the state read, the phone's path) names the room's own four letters, so
  opening a room re-keys nothing and every phone already in it stays.
- **Who a visitor is.** The join writes the visitor's home on their seat
  (`RoomSeat.homeHouseholdId`), and the engine's create or seat puts it on their
  party member. Their room session names **their own household**, never the
  room's. It reaches their own heroes (`GET /api/heroes`) and this one room, and
  nothing in the host household: claiming, binding and revoking all take a
  device token or a sign-in, and an action is accepted from another household
  only for a player the run has seated from it. A visitor is never the keeper.
- **A phone nobody has seen before** is admitted *before* anything is bound to
  it (`admitNewPhone`), so a refused one leaves no membership behind. In a room
  that has ever been open to visitors (`RunState.visitorsOpened`, which never
  clears), the room's four letters prove nothing: every visitor was shown them,
  inside the long code, in the room's path and on every screen. There, a new
  phone comes in only as a visitor: on the visitor code, while the room is
  open, with a guest household of its own that it founds (`bindNewPhone`). Any
  other way in is refused, while open and after the switch is off. A family's
  own new phone does the same, and can be moved home later (#251). In a room
  never opened, a new phone is bound into the room's household as before,
  unless the room is locked, which now refuses it unbound.
- **Closing it again** takes the long code away: no new visitor can join. The
  visitors already on the roster stay in the game and can come back to it, as
  anybody on a locked room's roster can. The join checks this against every
  state it writes its seat on top of, as it does a lock, so a visitor whose
  join races the switch going off is refused. The host's Remove works on a
  visitor like anybody else: it finds their profile through the roster.
- **Idle close.** An open room that has seen nothing happen for 30 minutes
  (`OPEN_ROOM_IDLE_MS`, read off `RunState.updatedAt`) closes itself, as the
  host's Close does, well inside the six hours a closed room keeps. It happens
  lazily: the next join, watch, state read, action or turn of the switch finds
  the room idle, closes it and is refused. A code nobody uses again is harmless, and every way
  of using one closes it first.
- **What a visitor takes home.** XP, items and every character change go to the
  hero's own household (§3; "Who owns what", above, is the rule this is stage
  one of). The room's Field Guide is the host household's,
  and it is the one every screen shows; each step's finds are also written to
  every visiting household's own book, credited to one of their own
  (`StepFinds.visitors`), first finder wins. A finished chapter renews each
  visiting guest household's week too.
- **No trades across households** in v1. The engine refuses an offer between
  heroes from different households (`sameHome`), and the give list leaves them
  out. Trades within a household, visitors' included, work as before.

#### The TV, which is nobody

A display client has no player and no session, because a screen does not sign
in (spec §2.1). The realtime channel is authorised per subscriber, so it needs
*something* to present: `POST /room/ABCD/watch` returns a **viewer token**
naming that room and nothing else, valid until the room expires.

Only the screen that opened the room gets one (#267). It presents the device
binding it was given when it opened the room, which survives a hard refresh; a
family tablet acting as the TV presents its shared token instead (#274).
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

#### Help on every screen (#256)

Every phone in a room has one "?" in the corner row (`help/HelpControl`), never one per surface, so it
cannot cover a surface's own controls or be covered by them at any text size. Which screen it names is
`useHelpSurface()` (`help/focus.ts`): the layout shell says which pane is up, a surface that is mounted
only while it shows (the character sheet) claims itself, and the rest is read off the run (no hero yet,
a fight, the bag, a question). Press and hold is one document-level listener (`help/longpress.ts`) that
finds anything wearing `helpAttrs(...)`; it never prevents a pointer or touch event, so taps and
scrolling are untouched, and the click after a hold is swallowed once so showing a card never plays it.
The words are `content/help.json` (fetched on first use, saved by the service worker with the rest of
the content), and the whole control is a lazy chunk. Nothing is stored. The shared screen's join line
under the code and QR is `help.join`; it never counts letters, because a visitor room's code is six and
a family room's is four.

#### Crash reports, with no kid in them (#317)

A crash on a phone or the TV reaches us as one log line, and nothing else. The first paint carries only
`report/listen.ts`: a `window` `error` and `unhandledrejection` listener (React 19 re-raises an error no
boundary caught as a window `error`, so a render crash arrives the same way) that loads `report/report.ts`
on the first throw. That chunk builds the report, scrubs it and `POST`s it to `/api/client-error`.

A report is exactly `ClientErrorReport` (`shared/src/error-report.ts`): the message, a stack cut to frames
in our own bundle (`file:line:col`), the build, the route's shape (`/p/:code`), the layout (phone, tablet
or TV), the browser family, and a random id per page load. Nothing else the sender includes is read.

`scrubText` removes emails, room codes (four letters, or a visitor's six), `kaddev.` and JWT-shaped
tokens and any long opaque run, query strings, anything quoted (an engine quotes back the value it
choked on, and a kid's typing would land there) and every name the page knows (the party's hero names,
the roster, the device's own name). The server runs the same functions again, so it holds without the
client's help. What it cannot know is a name in bare prose; that is why quoted text goes wholesale.

The endpoint is rate-limited by the code guard's budget (limit, window, client key and row), under its
own key so a page stuck in an error loop never spends a school's join budget. It stores nothing: the
counter is the only write, and the "what we store" page lists the reports as logged, not stored.

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

#### The display beyond a laptop (#264)

A smart TV, a stick or a tablet may lack things a laptop has, so the display (`/tv/:code`) asks for
none of them. [docs/hardware.md](./hardware.md) has the table and the tested list.

- **WebGL.** The stage asks Pixi for WebGL only (`preference: ["webgl"]`). Left to itself Pixi falls
  back to WebGPU and then to a 2D-canvas renderer, and the scene was never tuned for the CPU. When
  WebGL is missing, `init` rejects and `RendererBoundary` shows `world/StaticStage`, a lazy chunk
  that draws the backdrop and a plain row of figures from the same state the board reads. Rive's
  absence is already handled below that: `createRig` returns null and the scene keeps the PNG.
- **Wake lock** (`display/wake-lock.ts`). Held for as long as the display is open, asked for again
  on every `visibilitychange`, quiet where the API is missing or refuses.
- **Waking up** (`display/wake.ts`). A `visibilitychange` back to visible, a `pageshow`, or a timer
  that did not fire for twenty seconds all call the store's `reconnect()`. That closes the stream
  and opens a new one from the sequencer's seq (`Channel.reconnect`), whose `onopen` fetches
  `GET /state?sinceSeq=N`: the §4.3 path, unchanged. A stream the network killed silently while the
  TV slept is the case it exists for.
- **Sound.** `AudioEngine.state()` is `unsupported`, `locked`, `suspended` or `running`. On the
  display, `locked` and `suspended` show one "Tap for sound" button; `unsupported` shows nothing.
- **The report** (`display/DisplayExtras`, "About this screen", open at once on `?perf`) is the
  only caller of the probes in `display/capabilities.ts`. It, the wake lock and the wake-up
  handler live in one lazy chunk that only a display loads.

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
