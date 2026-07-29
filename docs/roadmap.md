# Kids & Dragons — Build Roadmap

Nine chapters. Each has a **done** condition you can demo, and an explicit split between
**Allen** (art direction, content, playtesting) and **Claude** (engine, systems, tooling).

The ordering optimizes for one thing: **getting a real 20-minute session in front of your daughter
as early as possible.** Chapter 3 is the first playable. Everything before it exists to make
Chapter 3 possible; everything after it is informed by watching her play.

---

## Chapter 0 — Foundation & spikes

Prove the three things that could invalidate the whole design, before building on them.

**Claude**
- Repo scaffolding: Vite + React + TS, Pixi, **SAM stack** (`infra/template.yaml`), DynamoDB Local, CI
- CloudFront + S3 deploy pipeline, one command to prod (`./scripts/deploy.sh`), and
  the same command from CI — staging on every pull request, prod on merge to main
- **`assets/manifest.json` + `npm run art:verify`** — the contract and the gate, written *before* any asset is commissioned ([art-pipeline.md §3](./art-pipeline.md#3-division-of-labor))
- `npm run art:sheet` contact sheet generator
- **Spike A — the brief:** commission `unicorn/fledgling` from Codex against [asset-brief.md](./asset-brief.md). Does it pass `art:verify` without hand-fixing? Every correction becomes a brief edit.
- **Spike B — Rive in Pixi:** 7 concurrent rigs composited, frame time on real TV hardware
- **Spike C — AppSync Events:** TV + 2 phones, room code join, sub-200ms round trip on LAN and over the internet

**Allen**
- Resolve the four open questions in [asset-brief.md §7](./asset-brief.md#7-open-questions-to-resolve-before-starting) — palette, face style, line weight, aura handling
- Review the first unicorn against the register in §2.1 until the look is right. This gates everything visual.
- Decide TV hardware and confirm the browser situation
- AWS account, Claude Platform on AWS workspace

**Done when:** a static "hello world" page with one animated unicorn is live on CloudFront, two
phones and the TV are in a synced room, and all three spikes have a written verdict.

> **The real deliverable of Spike A is the brief, not the unicorn.** If the agent needed hand-holding
> to hit spec, the brief has a gap — fix the document, not just the asset. That's the difference
> between commissioning one character and commissioning twenty-four.
>
> Spike B has a documented fallback ([art-pipeline.md §7](./art-pipeline.md)). A "no" changes
> tooling, not the design.

---

## Chapter 1 — Accounts & character creation

> **Amended.** Accounts turned out to be the wrong default. Anonymous play is now
> the entry path — a household exists the moment somebody starts a game — and
> signing in is an *optional* later step that claims the household they are
> already in. See [architecture §4.5](./architecture.md#45-accounts-devices-and-joining).

**Claude**
- Cognito user pool, custom sign-in UI (emailed code, then a passkey). No hosted UI.
  The browser talks to Cognito directly, so no credential reaches our Lambda.
- **The keepsake flow** — offered at the end of a chapter, never before. It leads
  with the party rather than with a form (`KeepsakeLantern`, asset-brief §8).
- Anonymous households with a 7-day expiry, and the single write that claims one
- Household creation, player profiles, `role: adult | child`
- Device pairing via QR, long-lived signed device tokens, sliding expiry, revocation
- Creation flow: species → class → stats → appearance → name
- Character data model, `resolveCharacter()`, persistence to DynamoDB
- Live WorldView preview driven by phone selections
- Palette slots wired to Rive color properties
- Species/class/stat rules as data, not code (`content/rules.json`)

**Allen**
- Commission Fledgling tier for the remaining 5 species; review each against the contact sheet
- **Rig all 6 in Rive** — one skeleton per species, reused across tiers. This stays hands-on; it's the step the agent doesn't own.
- Commission the icon set: 4 stats, 6 species, 4 classes
- Class descriptions and species flavor text

**Done when:** all three of you build a character, and **the next day each phone opens straight
into its own player with the character still there.** No login screen for her, ever.

> This is the first thing worth showing her. Do it before there's a game to play — character
> creation is genuinely fun on its own, and her reaction to the six species tells you a lot.
>
> Test the revocation path here while it's cheap: revoke a device, confirm it re-pairs cleanly and
> the character is untouched. It's a five-minute test now and a bad evening later.

---

## Chapter 2 — Rooms, sync, and both modes

**Claude**
- Room lifecycle: create with `mode`, code + QR, join via device token, TTL cleanup
- Server-authoritative state, JSON Patch broadcast, event log
- Reconnect from `sinceSeq`, hard-refresh recovery on any surface
- **`WorldView` / `PlayerView` split** — neither knows the mode; container-relative sizing throughout
- **Travel Mode layout first**, Party Mode second (see note)
- Mid-session mode switch (laptop dies → a phone absorbs WorldView)
- Lobby: three characters standing in a scene, idle animations, ready-up

**Allen**
- One biome backdrop (Bramblewood) + prop set
- Party lineup composition and camera framing at both scales

**Done when:** the same session plays correctly on a TV + two phones **and** on three phones with
no TV, and you can hard-refresh anything without losing state.

> **Build the Travel layout before the TV layout.** It's the constrained case — anything that fits
> a phone fits on a TV, and the reverse is not true. Doing it the other way around means reworking
> the grid, the dice, and the action bar later.

---

## Chapter 3 — First playable ⭐

The milestone that matters. Story, choices, and dice — no combat yet.

**Claude**
- Chapter JSON loader + JSON Schema validation in CI
- Scene renderer: story, check, choice point, rest
- Choice UI on phones, narration and art on the TV
- The dice roll — big, slow, animated, the centerpiece of the screen
- Species-gated choices (hidden when unavailable)
- Chapter completion, XP award, provisional progress

**Allen**
- **Hand-write one full chapter.** No LLM yet — write it yourself to learn what the format needs.
- Narration voice and vocabulary calibration

**Done when:** the three of you play a 20-minute chapter end to end, make choices, roll dice,
and finish it.

> **Playtest here and take notes.** Everything after this chapter should be shaped by what you
> watch her do — where she hesitates, what she reads vs. skips, what she taps twice.

---

## Chapter 4 — Tactical combat

The largest chapter. Budget accordingly.

**Claude**
- 10×8 grid, tile system, pathfinding, reachable-tile highlighting
- **Focus camera** — auto-frames the active actor, pinch-zoom and pan override. Unconditional on every surface; this is what makes the grid legible in Travel Mode.
- Turn order (Quick-based, rerolled per encounter), round loop
- Actions: Attack, class signature, species action, Use item, Help Up, Ready
- Enemy AI — simple and readable. She should be able to predict it. Deliberately not clever.
- Knocked-down state, revive, party-wipe → story branch (never a game over)
- Phone combat UI: only legal actions shown, target confirm step
- Damage numbers, hit/miss feedback, impact effect sync

**Allen**
- Combat animations for all 4 classes (attack, cast, hurt, down, revive)
- Effect sprite sheets: attacks, heals, impacts
- Enemy designs for Bramblewood (3–4 creatures)
- One tile set

**Done when:** a 6-minute encounter plays cleanly, someone goes down, someone else picks them up.

---

## Chapter 5 — Progression, inventory & the transformation

**Claude**
- XP → level, stat point spend, action unlocks. `CharacterProgress.unspentPoints`, inside the
  provisional/committed pair so a failed campaign reverts earned *and* spent points together
- **Chapter outcomes** (spec §8.2): a terminal scene declares `success` or `setback`; a setback
  pays half XP and branches rather than retrying. This is what makes campaign failure — and
  therefore the whole souvenir system — reachable at all; today `completeChapter()` is the engine's
  only exit
- **Bonus objectives** — optional, party-wide or nobody, capped at 25% of `xpAward`
- Campaign setback counter, defaulting to failure at three
- **Joining a party already underway** (spec §8.4): `startingLevel` of 1 or a tier floor, starting
  XP set to that level's threshold, validated server-side against the party's committed level
- **Inventory**: 6 slots, three item kinds, `content/items.json` catalog + schema validation
- Item grants from chapters, full-slot swap-or-leave prompt, quest items outside the slot budget
- Consumables usable in combat; trinket passives folded into `resolveCharacter()`
- **Trading at Rest scenes** — drag on your phone, tap to accept on theirs
- Provisional/committed state machine covering level, stats, **and inventory** together
- Souvenir generation on failure, tier-flavored when the run reached a new tier before failing;
  quest-item clearing at campaign end
- **The transformation cutscene** — party stops, camera pushes in, tier swap, full-screen moment
- Character sheet with tier history

**Allen**
- Commission Sworn, Radiant, and Mythic tiers for all 6 species — the cross-tier consistency test at full scale, and the bulk of remaining art
- Commission gear overlays for all 4 classes; item icons (~25); souvenir icons
- **Bind the new tiers to the existing rigs** — same skeleton, skin swap. If cross-tier joint registration was right, this is fast; if it wasn't, you'll find out here.
- Transformation effect and its sound

**Done when:** she hits level 4, everything stops, her unicorn visibly grows up — and the potion
she picked up two sessions ago is still in her bag.

> Inventory lands here rather than earlier because it shares the commitment machinery with levels.
> Building both against one state machine is meaningfully less work than retrofitting items into it.

> This is the emotional payload of the entire project. Give it more polish than it seems to deserve.

> The XP curve and the one-tier-per-campaign frame (spec §8.1) are already in `content/rules.json`.
> Author chapter awards against the **campaign total** — roughly 700, 1900, 3700 — rather than a
> per-chapter number, since campaigns run 4–8 chapters.

---

## Chapter 6 — Authoring tools

**Claude**
- CLI chapter generator using `claude-opus-5`: prompt → chapter JSON → schema validation
- Local chapter editor: visual scene graph, branch inspection, dead-end and orphan-scene detection
- Encounter balance checker (estimated rounds, expected damage)
- Playtest mode: jump to any scene, force any roll result

**Allen**
- Generate and hand-edit a full 6-chapter campaign
- Refine generation prompts against what the tool actually produces

**Done when:** you can go from an idea to a validated, playable chapter in under an hour.

---

## Chapter 7 — The live AI layer

**Claude**
- Lambda LLM proxy on Claude Platform on AWS, `claude-haiku-4-5`
- Prompt cache prefix design, with a dev-mode assertion that it's actually hitting (>4096 token minimum)
- Speculative prefetch during scene transitions
- `validateNarration()` + silent fallback to authored text
- `LIVE_LLM_ENABLED` kill switch, CI suite running with the layer stubbed
- Session recap generation

**Allen**
- Tone rules and few-shot examples for the cached prefix
- Per-chapter `llmHints` for existing content
- Judge the output at the table — is it adding anything?

**Done when:** unexpected action combinations get a reaction, and turning the whole layer off
changes nothing about whether the game works.

---

## Chapter 8 — Polish

**Claude**
- Sound: music per biome, UI feedback, impacts, the dice
- Scene transitions, camera work, screen shake
- Victory sequences and end-of-chapter summary
- Loading states, error recovery, offline handling
- Performance pass on the actual TV hardware

**Allen**
- Music and sound selection
- Realm of Red Sky environment review: 17 destination backdrops across 12 terrain families
- Full campaign content pass

**Done when:** it feels like a product instead of a prototype.

---

## Cross-cutting, from Chapter 0 onward

| Concern | Rule |
|---|---|
| **Content as data** | Rules, species, classes, chapters, and biomes are JSON. Adding content never requires a deploy of game code. |
| **Schema validation in CI** | A malformed chapter fails the build, never the play session. |
| **`speak()` seam** | All narration flows through it. No-op in v1, TTS-ready without touching game code. |
| **Icons before text** | No interactive element ships without an icon. |
| **Server-authoritative** | Dice roll in Lambda. Always. |
| **AI-optional invariant** | Tested in CI, not assumed. |
| **Mode-agnostic surfaces** | `WorldView` and `PlayerView` never read the room mode. Container-relative sizing only — no viewport units inside either. |
| **Travel layout first** | Any new screen is designed for a phone before it's designed for a TV. |
| **No password for a child** | `role: child` devices authenticate by binding only, can never pair another device, and can never claim a household. |
| **Play before signing in** | Nothing requires an account. Sign-in only ever *keeps* what anonymous play already created — it is never a gate in front of it. |
| **One suite, both stores** | `MemoryRepository` and `DynamoRepository` pass the same contract test. A bug found at the table has to be reproducible on a laptop. |
| **Three-device dev loop** | If a change hasn't been seen on a TV **and** in three-phone Travel Mode, it isn't done. |

---

## Sequencing notes

- **Chapter 1 now carries the auth work**, so it's heavier than it looks and 1→2 is a hard sequence: rooms join by device token, so device binding has to exist first.
- **Chapter 5's art is the long pole.** Start generating tier art during Chapter 4 so it's ready when the systems are.
- **Chapters 6 and 7 are independent of each other.** Do whichever you want first; 6 unblocks content velocity, 7 adds richness.
- **Chapter 8 never really finishes.** Ship after 5, keep polishing.

The honest first milestone is **Chapter 3** — that's when this stops being a project and starts
being a thing you do on Tuesday nights.

---

## Open items

Not blocking, but decide before they bite:

1. **TV hardware** — confirm what you're actually running the display client on. Laptop over HDMI is assumed.
2. **Sound source** — licensed pack, AI-generated, or commissioned. Affects Chapter 8 scope.
3. **Her device** — does she have her own phone, or does she borrow one? If she borrows, device binding needs a "switch player" affordance on adult devices, which is a small Chapter 1 addition rather than a later retrofit.
4. **Multiple households** — the model supports an adult belonging to more than one (a cousin's game, a school friend). Not building it now, but the `ACCT#<sub>` → `HH#<hhId>` mapping is one-to-many so it stays open. `linkAccount` currently picks the first; a picker is the missing piece.
5. ~~**When to offer the sign-in**~~ — decided and built: the end-of-chapter summary, with the characters they just played on screen. Offering it up front would undo the point of anonymous play. What is *not* decided is whether the TV should show the same beat; it currently cannot, because `RunState` carries no household-level flag and the claim happens outside any run.
6. **The guest window is 7 days** — long enough for "again next weekend", short enough that the table is not a graveyard of one-off sessions. It is one constant (`GUEST_HOUSEHOLD_TTL_MS`) if watching real use says otherwise.
