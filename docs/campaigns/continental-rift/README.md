# Riftlight (Continental Rift) — design index

**Status:** Creative design in progress, not yet playable campaign data. **Public title:** ***Riftlight*** (agreed). "Continental Rift" stays the working name of this folder and of epic #191; the campaign id is `riftlight`.

**Timeline and prerequisite — agreed:** follows Gemfall and **requires it**. Gemfall is the prerequisite campaign for every later campaign. Riftlight unlocks once the household has a **completed** Gemfall attempt. Every ending reached counts, loss endings such as The Last Ring included, because the engine marks those attempts `complete` and commits the characters. An attempt that failed at the setback limit, or was abandoned, does not count. Characters carry over at Sworn (level 4) with what they found ([spec.md §8.3](../../spec.md#83-carryover--the-commitment-rule)); anyone joining later starts at the tier floor (§8.4). The opening still works after **every** valid Gemfall ending without asserting that all parties defeated the titan. Graph guards cannot read another campaign, so nothing may depend on *which* ending a party reached.

This folder is the source of truth for Continental Rift **design** decisions. It is not the source of world canon: `canon/*.yaml` is ([canon-contract.md](../../canon-contract.md)). Once a faction, individual, place or the campaign itself is approved here, register it in `canon/` (`factions.yaml`, `individuals.yaml`, `campaigns.yaml`; secrets as creator-only) before any content references it. The campaign is a **nonlinear story graph**, unlike Gemfall's mostly ordered chapter progression.

## Documents
- [story.md](story.md) — player-facing dramatic structure and secret author-only truth.
- [graph.md](graph.md) — planned nodes, directional edges, outcomes, revisits and open topology decisions.
- [mechanics.md](mechanics.md) — rift magic, Riftlight, failure-forward and player progression.
- [characters.md](characters.md) — recurring campaign-only Riftseekers, the hidden antagonist, and relationships.
- [nodes/](nodes/) — implementation-oriented playable node designs, starting with the [headwaters washout](nodes/headwaters-washout.md).

## Authoring workflow
1. Discuss a scene or mechanic; distinguish **agreed** facts from **proposals** and **TBD**.
2. Record decisions in these docs, keeping cross-references consistent.
3. Draft a node spec with entry, scenes, roll checks, flags, exits and changed revisits.
4. Translate approved specs into `content/campaigns/riftlight.json` and `content/chapters/riftlight-*.json` once the related infrastructure is ready.
5. Check all IDs, flags and graph transitions against [graph-campaigns.md](../graph-campaigns.md) and the current TypeScript schema. Validate with `npm run content:validate` and dedicated graph/playtest tests.

**Rules:** Never invent missing canon to make an implementation convenient. Never expose endgame spoilers in early player-facing narration. Preserve protected mysteries of the Expanse, Hollow Gate and Legend Dragon. Do not change Gemfall's existing campaign data or ongoing saves.

## Implementation boundary
Engine epic: [#191](https://github.com/allenheltondev/kids-and-dragons/issues/191), issues #192–#203. These are engine prerequisites, not story authoring. The Gemfall prerequisite needs one more engine piece outside #192–#203: a campaign-level prerequisite (Riftlight locked in the lobby until the household has a completed Gemfall attempt). Nothing like it exists today. Existing graph spec supports static node/edge IDs, conditional edges, once-only traversals, persistent journey flags, and variants; specialized rift behavior and within-node multi-stage roll checks must be verified against runtime support when implemented.

## Open items
- **Canon registered:** the campaign `campaign.riftlight` (with its Gemfall prerequisite, Corvane and Pangea as creator-only constraints), `faction.riftseekers`, Ashspan Bridge (the title of `route.northern_river_bridge`), `route.cairnstep`, and the glacier-prison and rift-silt hidden truths in `biomes.yaml`. **Still to register:** the six named characters in `individuals.yaml`, which needs a canon `home` location and pronouns for each (and Corvane must stay out of the player-facing field guide); the Listening Chime goes in a chapter's `props`, as Gemfall's quest items do.
- Complete geography and node IDs/routes beyond the opening, one regional strand at a time.
- Destination disclosure.
- Chapter schema details.
