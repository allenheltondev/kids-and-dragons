# Continental Rift — design index

**Status:** Creative design in progress, not yet playable campaign data. **Timeline:** follows Gemfall, but **does not require it**. The opening stands on its own: it works after every valid Gemfall ending, loss endings included, without asserting that all parties defeated the titan, and a household that never played Gemfall misses nothing. Only the late reveal refers to Gemfall's events, in terms a newcomer can follow.

This folder is the source of truth for Continental Rift **design** decisions. It is not the source of world canon: `canon/*.yaml` is ([canon-contract.md](../../canon-contract.md)). Once a faction, individual, place or the campaign itself is approved here, register it in `canon/` (`factions.yaml`, `individuals.yaml`, `campaigns.yaml`; secrets as creator-only) before any content references it. The campaign is a **nonlinear story graph**, unlike Gemfall's mostly ordered chapter progression.

## Documents
- [story.md](story.md) — player-facing dramatic structure and secret author-only truth.
- [graph.md](graph.md) — planned nodes, directional edges, outcomes, revisits and open topology decisions.
- [mechanics.md](mechanics.md) — rift magic, Riftlight, failure-forward and player progression.
- [characters.md](characters.md) — recurring campaign-only Riftseekers, the hidden antagonist, and relationships.
- [nodes/](nodes/) — implementation-oriented playable node designs, starting with the Glacierflow washout.

## Authoring workflow
1. Discuss a scene or mechanic; distinguish **agreed** facts from **proposals** and **TBD**.
2. Record decisions in these docs, keeping cross-references consistent.
3. Draft a node spec with entry, scenes, roll checks, flags, exits and changed revisits.
4. Translate approved specs into `content/campaigns/continental-rift.json` and `content/chapters/continental-rift-*.json` once the related infrastructure is ready.
5. Check all IDs, flags and graph transitions against [graph-campaigns.md](../graph-campaigns.md) and the current TypeScript schema. Validate with `npm run content:validate` and dedicated graph/playtest tests.

**Rules:** Never invent missing canon to make an implementation convenient. Never expose endgame spoilers in early player-facing narration. Preserve protected mysteries of the Expanse, Hollow Gate and Legend Dragon. Do not change Gemfall's existing campaign data or ongoing saves.

## Implementation boundary
Engine epic: [#191](https://github.com/allenheltondev/kids-and-dragons/issues/191), issues #192–#203. These are engine prerequisites, not story authoring. Existing graph spec supports static node/edge IDs, conditional edges, once-only traversals, persistent journey flags, and variants; specialized rift behavior and within-node multi-stage roll checks must be verified against runtime support when implemented.

## Open items
- Campaign's final public title (Continental Rift is the working choice).
- Canon registration of the Riftseekers, Orin Vale, Lady Olivia and the campaign once approved.
- Complete geography and node IDs/routes beyond the opening.
- Emperor name, ancient empire details, final confrontation and outcomes.
- Exact rift spectrum beyond the agreed green behavior; destination disclosure and how non-Starweaver parties interpret colors.
- Numeric check TNs, chapter schema details, river rescue region and hidden rift destination.
