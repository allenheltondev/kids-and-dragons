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
| Auth | **Cognito user pool** (household owners) + **device-bound tokens** (players) | Free at this scale, AWS-native. Custom UI, not the hosted one. See §4.5. |
| Realtime | **AWS AppSync Events** | Managed pub/sub. Room = channel. No connection table to maintain. |
| Data | **DynamoDB, single table** | |
| Assets & hosting | **S3 + CloudFront** | |
| LLM | **Claude on Claude Platform on AWS** | Anthropic-operated, SigV4 auth, IAM, Marketplace billing, same-day feature parity. |
| Art assets | **Commissioned from a coding agent** | We own the contract ([asset-brief.md](./asset-brief.md)) and the CI gate, not a generation pipeline. |
| IaC | **AWS SAM or CDK** | Author's preference; either is fine. |

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

```
                          ┌──────────────┐
   TV browser ────────────│              │
                          │  CloudFront  │──── S3 (SPA bundle + art assets)
   Phone browsers ────────│              │
                          └──────┬───────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
            ┌───────▼────────┐      ┌─────────▼─────────┐
            │  API Gateway   │      │  AppSync Events   │
            │  (HTTP API)    │      │  (realtime)       │
            └───────┬────────┘      └─────────▲─────────┘
                    │                         │ publish
            ┌───────▼─────────────────────────┴───────┐
            │        Lambda: game-action              │
            │  validate → apply → persist → broadcast │
            └───────┬─────────────────────────────────┘
                    │
        ┌───────────┼───────────────┐
        │           │               │
  ┌─────▼─────┐ ┌───▼──────────┐ ┌──▼──────────────┐
  │ DynamoDB  │ │ Lambda: llm  │ │ Lambda: room    │
  │ (1 table) │ │ (proxy)      │ │ (create/join)   │
  └───────────┘ └───┬──────────┘ └─────────────────┘
                    │
              Claude Platform on AWS
```

**The Anthropic credential never leaves Lambda.** The browser has no path to it.

---

## 3. Data model

Single DynamoDB table, `kad`. Composite key `PK` / `SK`, one GSI (`GSI1PK` / `GSI1SK`).

| Entity | PK | SK | Notes |
|---|---|---|---|
| Account → household | `ACCT#<cognitoSub>` | `HH#<hhId>` | Lookup on sign-in. An adult may own/belong to more than one. |
| Household | `HH#<hhId>` | `META` | The family. Owner sub, display name, created date. |
| Player profile | `HH#<hhId>` | `PLAYER#<playerId>` | Display name, color, avatar, `role: adult \| child`. |
| Device binding | `HH#<hhId>` | `DEVICE#<deviceId>` | → playerId, token hash, last seen, user agent. Revocable. |
| Character | `HH#<hhId>` | `CHAR#<charId>` | Owned by a playerId. Persistent across campaigns. See §3.1. |
| Campaign run | `HH#<hhId>` | `RUN#<runId>` | One playthrough of one campaign. |
| Chapter progress | `RUN#<runId>` | `CHAPTER#<n>` | Status, branch taken, XP earned. |
| Game state | `RUN#<runId>` | `STATE` | Current authoritative snapshot. Single item. |
| Event log | `RUN#<runId>` | `EVT#<seq>` | Append-only. Enables replay and reconnect. |
| Room | `ROOM#<code>` | `META` | 4-letter code → runId, mode (`party` \| `travel`). **TTL 6 hours.** |

GSI1 indexes devices by device ID (`GSI1PK = DEVICE#<deviceId>`, `GSI1SK = HH#<hhId>`) so a returning
phone resolves straight to its household and player without a scan.

Note that **characters hang off the household, not off a run.** That was already true and is what makes
persistence across sessions fall out for free — the only thing that was ever session-scoped is the room.

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
    "action": "attack",
    "targetTile": { "x": 4, "y": 6 }
  }
}
```

**Server → clients** (published to AppSync Events channel `room/<code>`):

```jsonc
{
  "seq": 42,
  "runId": "r_88c",
  "patch": [                    // RFC 6902 JSON Patch against client state
    { "op": "replace", "path": "/combat/actors/e_2/hp", "value": 3 },
    { "op": "replace", "path": "/combat/turnIndex", "value": 2 }
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

### 4.3 Reconnect

Every client tracks the last `seq` it applied. On reconnect it calls `GET /state?runId&sinceSeq=N`,
which returns either the missed events or a full snapshot if the gap is too large. The TV can be
hard-refreshed mid-encounter and recover in under a second.

### 4.4 Transport seam

```ts
interface RoomChannel {
  publish(roomCode: string, message: ServerMessage): Promise<void>;
  subscribe(roomCode: string, onMessage: (m: ServerMessage) => void): Unsubscribe;
}
```

`AppSyncEventsChannel` is the v1 implementation. Swapping to Momento Topics or API Gateway
WebSockets means writing one new class.

### 4.5 Accounts, devices, and joining

Two layers of identity, deliberately separated:

| Layer | Lifetime | Auth |
|---|---|---|
| **Household account** | Permanent | Cognito user pool — email + passkey. Adults only. |
| **Player profile** | Permanent | A device-bound long-lived token. **No password, ever.** |
| **Room session** | ≤ 6 hours | Short-lived token scoped to a run. |

#### First run — household setup

1. An adult signs up (email → passkey). Cognito issues a sub; we create `HH#<hhId>` and an `ACCT#<sub>` pointer.
2. They add player profiles for everyone: name, color, avatar, `role: adult | child`.
3. Each other device is bound by scanning a **pairing QR** from the owner's device. Binding creates a `DEVICE#<deviceId>` item and issues that device a **long-lived signed token** naming its `playerId`.

#### Every run after

A bound device opens the app and **it is already that player.** No login screen, no avatar picker with a password behind it — her phone knows it's her phone. Tap "play."

The device token is a JWT signed with a KMS-held key, rotated on every use with a 30-day sliding
expiry. Stored in `localStorage`; if it's missing or expired, the device falls back to re-pairing.

#### Recovery and revocation

- **Lost phone** → the household owner revokes `DEVICE#<deviceId>` from their own device. That token is dead immediately.
- **New phone** → re-pair via QR from an already-bound *adult* device, or by the owner signing in.
- **A child device can never bind another device.** `role: child` tokens cannot issue pairing codes. She cannot sign herself out of existence or add a stranger.

#### Joining a session

1. Host device calls `POST /room` with `{ runId, mode: "party" | "travel" }` → 4-letter code (unambiguous alphabet: no I/O/0/1).
2. In **Party Mode** the TV renders the code + QR; in **Travel Mode** the host's phone does.
3. Other devices scan → `POST /room/ABCD/join`, presenting their **device token**. The server resolves device → player → household, verifies the household owns the run, and issues a room-scoped session token.
4. Because identity is resolved from the device, **there is no "who are you?" step.** You scan, and your character is already on the board.

Room items carry a **6-hour TTL** so abandoned rooms clean themselves up. Revoking a device does not
touch any character — characters belong to the household.

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
```

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
  "biome": "bramblewood",
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
      "map": "maps/bramblewood/thicket",
      "enemies": [
        { "id": "wisp", "count": 3, "hp": 6, "guard": 11, "steps": 5, "attack": 3 }
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

`requiresSpecies` is what produces "only my griffin can do this" moments. Choices whose
requirements aren't met by anyone in the party are **hidden**, not greyed out — no one feels
locked out of something they can see.

`grantItem.to` accepts `"roller"` (whoever made the check), `"party"` (a prompt to choose a holder),
or a specific `playerId`. If the recipient's six slots are full, the client prompts to swap or leave —
the grant never silently fails and never silently overflows.

Items themselves live in a separate catalog, `content/items.json`, so a chapter references
`itemId` and never redefines an item:

```jsonc
{
  "sunbloom_draught": {
    "kind": "consumable", "icon": "icons/items/sunbloom.svg",
    "name": "Sunbloom Draught", "text": "Heal 4 HP.",
    "effect": { "type": "heal", "amount": 4 }
  },
  "river_charm": {
    "kind": "trinket", "icon": "icons/items/river-charm.svg",
    "name": "River Charm", "text": "+1 step.",
    "passive": { "type": "statBonus", "stat": "steps", "amount": 1 }
  },
  "rusted_key": {
    "kind": "quest", "icon": "icons/items/rusted-key.svg",
    "name": "Rusted Key", "text": "It opens something, somewhere."
  }
}
```

JSON Schemas for both formats live in `schemas/` and are validated in CI. A chapter that references
an unknown `itemId`, or an invalid scene graph, **fails the build** — not the play session.

---

## 6. LLM integration

### 6.1 Model assignment

| Job | Model | Where |
|---|---|---|
| Chapter generation, encounter design | `claude-opus-5` | Local CLI, authoring time |
| Live flavor text, NPC lines, recaps | `claude-haiku-4-5` | Lambda, table time |

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
system  [cached] : tone rules, vocabulary constraints, forbidden topics, output format, few-shots
system  [cached] : party composition (species/class/level/appearance)   ← changes ~once/session
messages[cached] : chapter context + scene text                        ← changes per scene
messages         : the specific moment being narrated                  ← changes every call
```

Never interpolate a timestamp, UUID, or request ID into the system prompt. It sits at the front of
the prefix and invalidates everything after it.

### 6.4 Latency — speculative prefetch

Two-second pauses at a table with an 8-year-old are fatal to momentum. The fix exploits the fact
that turn-based games always know the small set of things that can happen next:

> When the party enters a scene, immediately fire off generation for the 3–4 likely reactions
> **during the transition animation.** By the time she taps, the text is already in hand.

Prefetched results go into a per-run cache keyed by `(sceneId, choiceId)`. A hit renders instantly;
a miss streams; a failure falls through to authored text. In practice the player should never
observe a wait.

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
CI runs the integration suite with the live layer stubbed out — this invariant is tested, not hoped for.

---

## 7. Environments

| Env | Purpose |
|---|---|
| `dev` | Local Vite + SAM local + DynamoDB Local. Live LLM off by default. |
| `prod` | The real thing. One stack, one region. |

No staging. It's a family game; `dev` and a careful deploy is enough.

**Local multi-device testing:** Vite dev server bound to `0.0.0.0`, phones on the same LAN hitting
the laptop's IP. This is how nearly all development happens — you need three real devices in the
loop constantly.
