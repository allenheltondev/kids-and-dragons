# Riftlight (Continental Rift) — design index

**Status:** All 24 Riftlight story nodes are authored in the [isolated story preview](../../../content/drafts/riftlight/README.md), including strand endings, convergence, the late reveal and all three glacier endings. No development pause nodes remain. The full route graph is checked, but this is not a published campaign: timed family play and full-route XP acceptance remain production gates. **Public title:** ***Riftlight***; the production campaign id remains `riftlight`.

**Timeline and prerequisite — agreed:** follows Gemfall and **requires it**. Gemfall is the prerequisite campaign for every later campaign. Riftlight unlocks once the household has a **completed** Gemfall attempt, or once any hero at the table has finished Gemfall herself, at any table (her own record, #283). Every ending reached counts, loss endings such as The Last Ring included, because the engine marks those attempts `complete` and commits the characters. An attempt that failed at the setback limit, or was abandoned, does not count. Characters carry over with what they found, and are treated as **at least the Sworn tier floor** (level 4, 700 XP), as spec §8.4 does for late joiners: a Gemfall run with setbacks can finish below 700 (#221). They carry over ([spec.md §8.3](../../spec.md#83-carryover--the-commitment-rule)); anyone joining later starts at the tier floor (§8.4). The opening still works after **every** valid Gemfall ending without asserting that all parties defeated the titan. Graph guards cannot read another campaign, so nothing may depend on *which* ending a party reached.

This folder is the source of truth for Continental Rift **design** decisions. It is not the source of world canon: `canon/*.yaml` is ([canon-contract.md](../../canon-contract.md)). Once a faction, individual, place or the campaign itself is approved here, register it in `canon/` (`factions.yaml`, `individuals.yaml`, `campaigns.yaml`; secrets as creator-only) before any content references it. The campaign is a **nonlinear story graph**, unlike Gemfall's mostly ordered chapter progression.

## Documents
- [finale-review.md](finale-review.md) — full story graph, late reveal, board outcomes, endings, return-route proof and production limits.
- [convergence-review.md](convergence-review.md) — two-key guards, Olivia and Pip outcomes, and Manipulate.
- [squall-temple-review.md](squall-temple-review.md) — island landing alternatives and storm repairs.
- [wyrm-nest-review.md](wyrm-nest-review.md) — glacier neighbors, relocated readers and the wyrm ally.
- [bone-yard-review.md](bone-yard-review.md) — crawler objectives and leaving found objects behind.
- [stuttering-flats-review.md](stuttering-flats-review.md) — unstable-opening goat rescue and fail-forward costs.
- [island-continuity-review.md](island-continuity-review.md) — returning island, mooring-stone clue, persistent rescue and evidence consequences, and engine-played routes.
- [memory-paths-continuity-review.md](memory-paths-continuity-review.md) — changed-river crossing, memory-ice clue, callbacks and return-route review.
- [regional-pacing-gate.md](regional-pacing-gate.md) — expanded regional investigations, shortest-path pacing estimates and family measurements required before production integration.
- [story.md](story.md) — player-facing dramatic structure and secret author-only truth.
- [graph.md](graph.md) — planned nodes, directional edges, outcomes, revisits and open topology decisions.
- [mechanics.md](mechanics.md) — rift magic, Riftlight, failure-forward and player progression.
- [characters.md](characters.md) — recurring campaign-only Riftseekers, the hidden antagonist, and relationships.
- [nodes/](nodes/) — implementation-oriented playable node designs, the [headwaters washout](nodes/headwaters-washout.md) and the [Exchange rift](nodes/exchange-rift.md) (draft).

## Authoring workflow
1. Discuss a scene or mechanic; distinguish **agreed** facts from **proposals** and **TBD**.
2. Record decisions in these docs, keeping cross-references consistent.
3. Draft a node spec with entry, scenes, roll checks, flags, exits and changed revisits.
4. Translate approved specs into `content/campaigns/riftlight.json` and `content/chapters/riftlight-*.json` once the related infrastructure is ready.
5. Check all IDs, flags and graph transitions against [graph-campaigns.md](../graph-campaigns.md) and the current TypeScript schema. Validate with `npm run content:validate` and dedicated graph/playtest tests.

**Rules:** Never invent missing canon to make an implementation convenient. Never expose endgame spoilers in early player-facing narration. Preserve protected mysteries of the Expanse, Hollow Gate and Legend Dragon. Do not change Gemfall's existing campaign data or ongoing saves.

## Implementation boundary
Engine epic: [#191](https://github.com/allenheltondev/kids-and-dragons/issues/191). **The groundwork #192–#203 has landed** on `main`: graph schema and validation, journey runtime, navigation and revisits, rifts and rift actions, world state, class rift interaction, buffs, environmental combat, inspection tooling and a vertical slice. Author against [graph-campaigns.md](../graph-campaigns.md) as it stands. Multi-stage checks inside a node are ordinary chapter scenes.

**Still needed from the engine** for Riftlight:
- [#221](https://github.com/allenheltondev/kids-and-dragons/issues/221): the campaign prerequisite (locked until the household has a completed Gemfall attempt). **Built:** declare `"requires": ["gemfall"]` in `content/campaigns/riftlight.json`; the loader and `content:validate` refuse an unknown campaign or a cycle, the lobby shows "Finish Gemfall first", and the server refuses the start.
- [#222](https://github.com/allenheltondev/kids-and-dragons/issues/222): buffs on story checks, for Riftspark.
- [#226](https://github.com/allenheltondev/kids-and-dragons/issues/226): per-chapter music, for the theme and the finale.
- [#227](https://github.com/allenheltondev/kids-and-dragons/issues/227): enemy hits that slow, for the Skuppers' sting.
- A class gate on **chapter choices**, for the Starweaver's in-chapter *Read the Riftlight* ([mechanics.md](mechanics.md)): [#228](https://github.com/allenheltondev/kids-and-dragons/issues/228).
- [#220](https://github.com/allenheltondev/kids-and-dragons/issues/220): environment effects deferred after #201.

## Open items
- **Canon registered:** the campaign `campaign.riftlight` (with its Gemfall prerequisite, Corvane and Pangea as creator-only constraints), `faction.riftseekers`, Ashspan Bridge (the title of `route.northern_river_bridge`), `route.cairnstep`, and the glacier-prison and rift-silt hidden truths in `biomes.yaml`. The named characters are deliberately not in `individuals.yaml` ([characters.md](characters.md#supporting-riftseekers--agreed)); the Listening Chime goes in a chapter's `props`, as Gemfall's quest items do.
- Node-by-node specs (entry, scenes, checks, flags, exits, revisits) for every node, as the washout has.
- Chapter schema details.
