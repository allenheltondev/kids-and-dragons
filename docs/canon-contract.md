# Kids & Dragons — Canon Contract

**Status: §1–§6 built (2026-07-31). D1, D2, D3, D6, D11 and D12 ruled and
applied; `packages/canon` ships all **eleven** schemas, the parser, the registry
and `npm run canon:check` in CI. §7 (DynamoDB) and §8 (agent tools) proposed;
D9 and D10 built; D5, D7, D8 and D13 open.** `canon/*.yaml` is the truth. Everything else — the wiki,
`content/`, the DynamoDB projection, agent tools — is a *derivation*, and this
document is the schema that makes derivation mechanical instead of manual.

Written to be settled **before** the canon elaboration pass, not after: adding
a field to 87 entities is cheap while you are already editing them and
expensive once you are done.

> **One concern, stated once.** At 115KB / ~30k tokens the entire corpus fits
> in a Lambda bundle, and `GetItem` on a table is slower and more moving parts
> than a property access on a frozen object. The reasons to project into
> DynamoDB anyway are real — selective fetch for agent tools without shipping
> the corpus into every context, reverse-relationship queries that don't load
> everything, and a place to hang derived or per-household data later — so §7
> specifies it. But §6's registry is the load-bearing part and works standalone;
> build behind `CanonRepository` so the in-memory and DynamoDB readers are the
> same swap the game store already makes (`memory-repository.ts` /
> `dynamo-repository.ts`). Design for both, ship the bundle first.

---

## 1. Where it lives

A new workspace package, `packages/canon` — **built**:

```
packages/canon/
  src/
    ids.ts             Slug, CanonId, the taxonomy→prefix table, canonRef/edge
    envelope.ts        the shared envelope + the cross-file enums
    taxonomies.ts      all thirteen schemas
    parse.ts           YAML → validated entities  (+ controlled_values checks)
    registry.ts        entities, edges, both indexes, referential integrity
    canon.test.ts      16 tests, run against the real corpus
    index.ts           loadCanon()
tools/canon/check.ts   the CI gate
```

Not yet built: `repository.ts` (the `CanonRepository` interface §7 needs) and
the sync job.

**Not `@kad/shared`.** The client depends on shared, the client does not need
canon, and Zod would land in the game bundle for nothing. `packages/server`,
`tools/`, and the sync job depend on `@kad/canon`; the client never does.

Zod is a new dependency (the repo currently validates with ajv + hand-written
`schemas/*.json`). That is the point of the exercise: **one definition, many
consumers** — TS types via `z.infer`, YAML validation, DynamoDB item shape,
agent tool `input_schema`, and — via `zod-to-json-schema` — the `schemas/*.json`
files that `tools/content/validate.mjs` already consumes, which become
generated rather than hand-maintained.

## 2. The envelope

Every canon entity, in every taxonomy, satisfies this. It is the base every
schema in §3 extends, and the reason a generic registry, a generic DynamoDB
row, and a generic `canon_get` tool are possible at all.

```ts
export const Envelope = z.object({
  id:            CanonId,                    // "creature.glassback_crab" — see §5
  title:         z.string().min(1),          // display name
  asset_id:      Slug.optional(),            // the ONE join key — §9 D3
  canon_status:  CanonStatus,                // §9 D1
  tags:          z.array(Slug).default([]),
  featured:      z.boolean().default(false),

  short_description: z.string().min(1),
  visual_identity:   z.string().optional(),  // art brief input
  standard_behavior: z.string().optional(),  // how it normally acts
  canon_constraints: z.string().optional(),  // the "never do this" line
  common_story_uses: z.string().optional(),  // authoring/generation hint
  notes:             z.array(z.string()).default([]),
});
```

`visual_identity` feeds `docs/asset-brief.md`; `canon_constraints` is the
single most load-bearing field for generated content and today is prose (§9 D9).

## 3. Taxonomies

Eleven, across ten files. Was thirteen until D6 merged `region` into `biome` and
`site` into `location`.

| Taxonomy | File | Id prefix | Count | Adds to the envelope |
|---|---|---|---|---|
| `biome` | biomes.yaml | `biome.` | 13 | `map_label`, `climate`, `environment_type`, `danger_level`, `inhabitants`, and the map fields absorbed from `region` |
| `species` | characters.yaml | `character.` | 6 | `bipedal`, `signature_part`, `scale` |
| `creature` | creatures.yaml | `creature.` | 17 | `classification`, `sapience`, `scale`, `danger_level`, **`encounter`** (D9) |
| `people` | npcs.yaml | `npc.` | 10 | `classification`, `sapience`, `scale`, `speech_register` (D8) |
| `faction` | factions.yaml | `faction.` | 2 | `faction_type`, `alignment` |
| `item` | items.yaml | `item.` | 3 | `category`, `rarity`, `acquisition`, **`mechanics`** (D7) |
| `location` | locations.yaml | `location.` | 10 | `location_type`, `parent_biome`, optional `inhabitants`, and the map fields absorbed from `site` |
| `quest` | quests.yaml | `quest.` | 2 | `quest_type`, `difficulty`, `objectives`, `rewards` |
| `campaign` | campaigns.yaml | `campaign.` | 2 | `campaign_type`, `chapter_count` |
| `feature` | geography.yaml | `feature.` | 4 | `kind`, `map_anchor`, `flow_direction`, `mouth` |
| `route` | geography.yaml | `route.` | 4 | `kind`, `map_anchor`, `travel_modes`, `constraints` |

`biome` and `location` share a `Place` base (map provenance, anchor, access).
`geography.yaml` now owns only what is neither an ecological region nor a place
inside one: rivers and roads.

Each is `Envelope.extend({...})`. The file → taxonomy mapping is data
(`FILES` in `parse.ts`), so a new taxonomy is a schema plus a table row.

## 4. Edges are declared in the schema, not discovered by a parser

Today the relationship type system is a private constant:
`RELATIONSHIP_KEY_TO_PREFIX` in `tools/wiki/canon-parser.ts` maps ~35 field
names (`primary_locations` → `biome.`, `dropped_by` → `creature.`, …) to target
prefixes. That map *is* the schema, sitting in a tool that only the wiki runs.

Move it into the schemas. An edge field declares its target taxonomy:

```ts
const edge = (...to: Taxonomy[]) => z.array(CanonRef(to)).default([]);

export const Biome = Envelope.extend({
  inhabitants: z.object({
    primary_peoples:            edge("species", "people"),
    supporting_peoples:         edge("species", "people"),
    cultural_orders:            edge("faction"),
    ambient_creatures:          edge("creature"),
    dangerous_creatures:        edge("creature"),
    legendary_beings:           edge("creature"),
    supernatural_manifestations:edge("creature"),
  }),
  relationships: z.object({
    locations: edge("location", "site", "feature"),
    factions:  edge("faction"),
    items:     edge("item"),
  }),
});
```

Two payoffs. Referential integrity becomes a `superRefine` against the registry
rather than a bespoke pass, and the reverse index (§7) is derivable for every
field without anyone maintaining a list.

Geography expresses edges as **top-level typed fields** (`borders`, `connects`,
`crosses`, `contained_by`, `adjacent_to`, `access_from`) rather than inside a
`relationships` object. Keep that — those are semantically distinct edge kinds
and read better — and declare them as edges in the schema. The parser stops
special-casing anything.

## 5. Id form and normalization

**Canonical form is `<prefix>.<slug>`** — `creature.glassback_crab`. Two
reasons beyond consistency: taxonomy is derivable from an id alone (so
`canon_get("creature.x")` needs no second argument, and a DynamoDB key can be
computed without a lookup), and it is already the majority form.

The corpus **was** mixed and has been migrated: every reference is now prefixed
in the files themselves, so the schema requires prefixed form and the parser
holds no resolution logic. `CanonRef` is a string check against the registry,
nothing more.

Getting there needed the §4 edge declarations first. Ninety references were
ambiguous on their bare form alone, because nearly every place exists as both a
`biome.*` (ecology and art) and a `geography.*` (map) — `enchanted_woods` is
both. The field decides: `primary_locations` on a creature means ecology and
resolves to `biome`, while `borders` on a region means the map graph and
resolves to `geography`. Eight references resolved to nothing and are listed in
D11.

`Slug` is `/^[a-z0-9]+(_[a-z0-9]+)*$/`. Note `tags` currently use **kebab**-case
(`ancient-forest`, `living-magic`) while ids use snake — pick one (§9 D12).

**Field names stay `snake_case`.** No camelCase transform layer: the agent
reading a `canon_get` result should see the field names the canon files and
`agent_instructions` use, and a rename layer is a second place for drift.

## 6. The pipeline

```
canon/*.yaml
   │  parse.ts    zod per taxonomy → typed entities, ids normalized
   │  registry.ts forward + reverse edge index, referential integrity
   ▼
CanonRegistry ──┬──► npm run canon:check      CI gate (fails the build)
                ├──► npm run canon:index      content/canon-index.json (legal ids)
                ├──► zod-to-json-schema        schemas/*.json, generated
                ├──► tools/wiki/generate.ts    replaces canon-parser.ts wholesale
                ├──► npm run canon:sync        → DynamoDB (§7)
                └──► CanonRepository            server validation + agent tools (§8)
```

`tools/wiki/canon-parser.ts` and `canon-validator.ts` are **superseded**, not
duplicated: the wiki generator becomes a consumer of the registry. Its
`validateCanon()` logic (id format, uniqueness, broken references) is the
starting point for the zod refinements — it is already written and already has
tests under `tools/wiki/__tests__/`.

`canon:check` **runs in CI**, between typecheck and `content:validate`. Before
it, nothing read canon on any build: `ci.yml` ran `content:validate` (which
checks a chapter's biome against `assets/manifest.json` and has no concept of a
creature id) and `art:verify`, while `validateCanon()` only executed inside the
manual `wiki:generate`. It reports 87 entities and 310 edges.

Two things the build taught us that are worth writing down:

**Reference checking belongs in the registry, not the schema.** The first cut
put a prefix regex on `canonRef`, which made one bad reference fail the whole
*entity* — it then dropped out of the registry, and every entity pointing at it
looked broken too. A single unresolvable id in `biome.enchanted_woods` produced
twenty errors in files nobody had touched. Moving the check to the built
registry gives exactly one error per bad reference, and checks something a
prefix cannot: that the target is really a biome, not merely a string beginning
`biome.`. `canonRef` is now a plain `z.string()` carrying a `ref:` marker.

**`controlled_values` is enforced.** Open vocabularies (`kind`,
`environment_type`, `relative_position`) are `Slug` in the schema and checked
against the *file's own* `controlled_values` block instead. Those grow with
every elaboration pass, and this way adding a `kind` means defining it, in the
file, where the next author will read it — the block stops being decoration.

## 7. The DynamoDB projection

Same table (`kad-<stage>`, PK/SK + GSI1 — `infra/template.yaml`). Canon rows are
global rather than household-scoped, which the single-table design already
tolerates; they carry **no `ttl`**, and the sweeper only queries the
`GSI1_GUEST` partition, so it cannot touch them.

| Item | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Entity | `CANON#<taxonomy>` | `<id>` | — | — |
| Edge | `CANON#EDGE#<sourceId>` | `<field>#<targetId>` | `CANONREF#<targetId>` | `<field>#<sourceId>` |
| Manifest | `CANON#META` | `MANIFEST` | — | — |

Access patterns, all single queries:

- **get by id** — taxonomy from the id prefix, `GetItem`
- **list a taxonomy** — `Query PK = CANON#creature`
- **forward edges** — `Query PK = CANON#EDGE#biome.enchanted_woods`
- **reverse edges** — `Query GSI1 PK = CANONREF#biome.enchanted_woods`
  ("what lives here", "what drops this") — the encounter-generation query
- **tag search** — client-side over a listed taxonomy; 87 entities does not
  justify an index

**Sync is one-way and idempotent.** `npm run canon:sync` (invoked from
`scripts/deploy.sh` after the stack update, and runnable against DynamoDB Local
in dev) parses, validates, and diffs by per-entity `content_hash`, writing only
what changed. Deletion is handled by sweep: after upsert, query each taxonomy
partition and delete ids absent from the parse. No tombstones — canon files are
truth, so absence is deletion. Every row carries `content_hash`, `schema_version`,
and `synced_at`; the `CANON#META` manifest carries the corpus hash and git SHA,
so drift is one `GetItem` to detect. A `--dry-run` prints the diff.

**DynamoDB is never written by gameplay.** If a canon row is wrong, the fix is a
YAML edit and a re-sync. Nothing else may write these partitions.

## 8. Agent tool surface

The payoff of zod-throughout: the same schema that validates the YAML *is* the
tool contract, via `zod-to-json-schema`.

| Tool | Input | Returns |
|---|---|---|
| `canon_get` | `{ id }` | one entity |
| `canon_list` | `{ taxonomy, tags?, danger_level?, canon_status? }` | envelope fields only, no prose |
| `canon_related` | `{ id, field?, direction: "out" \| "in" }` | ids + titles |
| `canon_search` | `{ query, taxonomy? }` | ids + titles |

`canon_list` returning the envelope rather than full entries is deliberate: an
agent listing 17 creatures wants to *choose*, then fetch. Full prose for all 17
is ~8k tokens spent to pick one.

Two rules, both enforced server-side rather than prompted:

1. **Read-only.** No tool writes canon.
2. **`agent_instructions` ride along.** Each taxonomy's `agent_instructions`
   block is returned with every `canon_list` and `canon_get` for that taxonomy.
   Those instructions are the guardrails — *"Empty relationship lists are
   deliberate; they do not authorize an agent to fill the gap"* — and an agent
   that fetches an entity without them has lost the thing that makes the fetch
   safe.

---

## 9. Decisions required before the schema can be final

These are the gaps. Each one blocks a field definition; each has a recommended
resolution, and the recommendation is what I would implement absent a ruling.

**D1 — RULED, applied. `canon_status` is not one enum.** Nine values across two families:
`confirmed | newly_defined | intentionally_undefined` (nine files) and
`map_canonical | map_canonical_and_biome_matched | map_visible_name_pending |
map_implied | visible_unlabeled_feature` (geography only).
*Recommend:* a shared `CanonStatus` for all taxonomies, plus a separate
geography-only `map_provenance` field. Those five values answer "how do we know
this place exists," which is a different question from "is this canon."

**D2 — RULED, applied, and stronger than proposed. id form is mixed.** Bare in `inhabitants` and
`relationships.primary_locations`, prefixed in `borders` / `biome_id` /
`geography_id`. Allen's ruling: rewrite the *files* to prefixed form rather than
normalizing on read, so the schema can **require** prefixed and the parser
carries no resolution logic at all. Applied: 195 references across ten files.

**D3 — RULED, applied. Five aliasing fields.** `asset_id`, `canonical_creature_id`,
`canonical_location_id`, `species_manifest_id`, `geography_id` all mean "this
thing's other name." *Recommend:* keep `asset_id` only (it already matches
`assets/<kind>/<id>/`, and is the join to `content/`); `geography_id` becomes an
edge; the rest are dropped as derivable.

**D4 — two relationship representations.** *Recommend:* §4 — keep both shapes,
declare both in the schema.

**D5 — `barriers` values are not ids.** `barriers: {south: northern_escarpment,
east: upper_great_river}` — neither resolves; the closest entity is
`feature.great_river`. *Recommend:* promote them to `feature.*` entities and
make `barriers` an edge map, or declare the values free text. Currently they
look like references and are not.

**D6 — RULED and applied. Place ownership.** It was not an overlap, it was a
duplication: `biomes.yaml` and `geography.yaml` described the same seventeen
places twice, once from ecology and once from the map. Every biome carried a
`geography_id`; every region and site was claimed by exactly one biome; **12
paired with regions, 5 with sites, no orphans in either direction.**

Allen's rule sorted them — *a biome is an ecological region, a location is a
place inside one* — so the 12 absorbed their region and the 5 became locations,
joining the ones `locations.yaml` already had. Thirteen taxonomies became
eleven, and `contained_by` / `borders` / `adjacent_to` now point at biomes and
locations rather than at a third kind of thing that was really the same things.

Two site parents were inferred rather than authored, because the sites carried
no `contained_by`: **The Exchange → `biome.sunward_fields`** (coastal, adjacent
to it, nearest by map anchor) and **Skullwater Cave → `biome.open_sea`** (its
entrance is offshore). `location.crystal_font`, which sits inside the cave,
follows it. One field each if either is wrong.

**D7 — item ownership, now decided by canon-as-truth.** `canon/items.yaml` (3,
lore-only) and `content/items.json` (15, mechanical) are disjoint — no shared
id. Since canon is truth, the item's `mechanics` block (`kind`, `icon`,
`effect`) belongs **in canon**, and `content/items.json` becomes a generated
projection. Every mechanical item needs a canon entry; that is 12 new entries.

**D8 — named individuals.** `npcs.yaml` holds *peoples* (centaur, faun,
frogfolk), and `agent_instructions` says named individuals are not canon. Yet
`bramblewood-01.json` has Pib, a wisp, and an embarrassed door, characterised
entirely in that chapter's `llmHints.npcVoices` and discarded afterward.
*Recommend:* add `speech_register` to `people` (so any member of that people can
be voiced consistently), and formally bless chapter-scoped individuals as
non-canon with a documented shape. Do not open a `individual.` taxonomy yet.

**D9 — RULED and BUILT. The encounter block.** `danger_level: moderate`
is prose; `EnemySpec` needs five integers. Under canon-as-truth the stat block
is a field group on the creature, and `content/bestiary.json` becomes a
generated projection — this supersedes `docs/briefs/generated-content.md` §2,
which put it in `content/`.

Everything below is anchored to numbers already in the engine, not invented:
`ATTACK_DAMAGE = 3` for every plain swing (`encounter.ts`), heroes at
`baseMaxHp` 10 / `baseGuard` 11 / `baseSteps` 4 (`rules.json`), attacks resolved
as d20 + mod vs Guard (`dice.ts` `resolveAttack`), initiative as d20 + `quick`,
three players on a 10×8 board (spec §7.1).

```yaml
encounter:
  band: skirmisher
  stats: { hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 }
  behavior: null           # see below — almost always null
```

**Bands, not free integers.** A generator picks a band; it never picks an `hp`.
The four are derived from the one shipped stat block — the Bramblewisp, at
hp 6 / guard 11 / quick 3 / steps 5 / attack 3, three of them — read against
the round budget:

| band | hp | guard | attack | steps | quick | usual count |
|---|---:|---:|---:|---:|---:|---|
| `skirmisher` | 6 | 11 | 3 | 5 | 3 | 3 |
| `lurker` | 9 | 13 | 3 | 4 | 4 | 2 |
| `brute` | 14 | 12 | 4 | 3 | 1 | 1–2 |
| `sentinel` | 20 | 14 | 4 | 3 | 0 | 1 |
| `legend` | — | — | — | — | — | bespoke, signed off per creature |

The arithmetic that fixes them: a level-1 hero swings at d20 + 2..4 against
Guard 11 — about 65% — for 3 damage, so ~2 damage a round each, ~6 for a party
of three. Spec §7.1 tunes for about four rounds, so **total encounter HP wants
to land in 18–30**, and three wisps at 6 HP is exactly 18. That total is the
invariant worth validating, not the individual numbers.

`danger_level` gates which bands are legal, so the two fields cannot drift:
`none` → no encounter block at all (it is not a fight), `low` → `skirmisher`,
`moderate` → `skirmisher` | `lurker` | `brute`, `high` → `brute` | `sentinel`,
`legendary` → `legend`.

**Three fields I had proposed dropping, and where they actually live** (Allen
kept all three):

- **`xp` — no engine change needed.** The `Effect` union already has
  `{ type: "grantXp", amount }` and encounter scenes already have
  `onVictory.effects`, so a creature's XP is what an author or generator sums
  into a `grantXp` on victory. `grantXp` pays the *whole party*, so this adds
  encounter-scale reward without touching spec §8.2's uniform award — the
  chapter's `xpAward` stays the main event. Defaults come from the band
  (skirmisher 5 → sentinel 20 → legend 50), so three wisps are 15 against
  Bramblewood's 100: flavour, not the point.
- **`footprint` — canon records it now, the grid honours it later.** It is a
  true fact about the creature, so it belongs in canon whatever the renderer can
  do today. Until `EnemySpec` and `grid.ts` grow multi-tile actors it is
  advisory: an encounter generator uses it to cap `count` and to keep something
  colossal out of a three-wide corridor. Only `legend_dragon` sets it (4).
- **`ai` profiles.** `enemy-ai.ts` is deliberately *one sentence* — "a monster
  walks at the nearest hero it can reach and hits them" — and its header argues
  at length that an AI a child cannot predict turns positioning from a decision
  into a guess. It names exactly one extension: a `behavior` field on
  `EnemySpec` selecting a **second sentence** for a specific creature ("the
  sentinel never leaves the bridge"). So the field is `behavior`, it is
  optional, it should be null on nearly every creature, and each value costs a
  reviewed sentence in that module — which is its own constraint on growth. It
  is not a profile list. Two creatures use one: `frost_wyrm` and
  `legend_dragon` both `holds_ground`, `restless_remains` `guards_its_cause`.
  Spelled the American way, like `standard_behavior` beside it.

**D10 — RULED and BUILT. Non-combat resolutions.** `creatures.yaml`
`agent_instructions` requires that encounters "usually permit more than
combat — observation, conversation, bargaining, rescue, distraction, escape,
environmental problem-solving, restoring a damaged habitat," and no field can
express one. The glassback crab's *"stops pursuing once intruder leaves
territory"* is a mechanic written in English.

```yaml
resolutions:
  - kind: conversation
    stat: heart
    difficulty: normal
    text: "Nobody has ever said please to a bramblewisp before."
  - kind: escape
    stat: quick
    difficulty: normal
```

`kind` is exactly the eight verbs `agent_instructions` already lists — the
vocabulary is canon's, not mine.

**`difficulty`, not `tn`.** `easy | normal | hard` resolves through
`rules.json` `difficultyTn` (8 / 12 / 16). `tools/content/validate.mjs` already
rejects a `check` scene whose `tn` is outside that table, so writing raw numbers
in canon would create a second place to retune difficulty and a way to author an
unreachable one.

Each entry maps onto a `CheckScene` with no translation: `stat` → `stat`,
`difficulty` → `tn`, `text` → the author's hint for `prompt`. What *happens* on
success stays with the chapter, because that is scene-specific — canon says what
a creature responds to, content says what that gets you.

Every one of the twenty authored resolutions is traceable to a line that was
already in that creature's `canon_constraints` or `standard_behavior`. The
glassback crab's *"stops pursuing once intruder leaves territory"* became an
`escape` check; the echo hunter's *"retreats from overwhelming layered noise"*
became a `distraction`; the wisp's is the "say please" that
`bramblewood-01.json` has been doing by hand since before canon could express
it. The prose was already the design — it just had nowhere to go.

Enforced, not requested: a `superRefine` on `Creature` fails the build if a
dangerous creature has no encounter block, if an ambient one has one, if the
band and `danger_level` disagree, or if `resolutions` is empty.

**`content/bestiary.json` is the projection** — generated by
`npm run canon:bestiary`, never edited, keyed by `asset_id` because that is the
join `assets/entities/<id>/` and a chapter's `EnemySpec.art` already use. Each
entry carries its `canon_id`, so the projection is never the only record of
where a stat line came from.

**And the chapter names the creature.** `EnemySpec` gained a `creature` field —
the canon `asset_id` — because before it, the only thread from a chapter's
`"wisp"` back to `creature.will_o_wisp` was the art path, by convention, and the
two could disagree about HP indefinitely with nothing to notice.

The numbers stay written out in the chapter rather than being resolved from the
bestiary at load time: a chapter should still read and review on its own, and
the engine should not need canon at runtime. `tools/content/validate.mjs` fails
the build when a chapter's `hp` / `guard` / `quick` / `steps` / `attack` / `art`
disagrees with the bestiary, or names a creature that has no encounter block —
which is what makes the duplication safe rather than merely conventional. An
enemy with no `creature` at all is a warning, so the link becomes universal by
attrition rather than by a flag day.

`canon:check` also verifies that every `asset_id` claiming art has a directory
to point at. The corpus is exactly 1:1 with `assets/entities/` — 27 and 27 —
which is worth keeping true rather than rediscovering.

The projection is also the proof. `bramblewood-01.json` has shipped a
Bramblewisp at hp 6 / guard 11 / quick 3 / steps 5 / attack 3 since long before
any of this; the `skirmisher` row was derived from it, and the generated
bestiary reproduces it exactly. A test pins that, so if it ever stops being
true, either the band table moved or the chapter did.

**D11 — RULED and mostly applied. Nine dangling references.** Allen's rule:
a **biome is an ecological region**; a **location is a place inside one**. So
`open_sea` is a biome (with no `geography_id` — it surrounds the illustrated map
rather than appearing on it, and inventing a region with a map anchor would be
worse than admitting it has none) and `the_whirlpool` is a location inside it.
Both are now entities and all seven references resolve.

`bramblewood` is unresolved because the ruling and the corpus disagree: it was
called a location of the plains, but canon files it under
`biome.enchanted_woods` and `content/chapters/bramblewood-01.json` renders it
with `biome: enchanted_woods`. Needs one word — which parent.

The original list:

| Source | Field | Target |
|---|---|---|
| `biome.sky_islands`, `exchange`, `skullwater_cave`, `mermaid_cove`, `bone_yard` | `relationships.locations` | `open_sea` |
| `biome.mermaid_cove`, `bone_yard` | `relationships.locations` | `the_whirlpool` |
| `biome.enchanted_woods` | `relationships.locations` | `bramblewood` |
| `biome.exchange` | `inhabitants.population_rule` | *(prose in an edge object)* |

`bramblewood` is the setting of the only shipped chapter and is not an entity.
`open_sea` and `the_whirlpool` are named in seven places and exist nowhere.
Either promote all three, or drop the references. The last row is a schema bug,
not a data bug: `population_rule` is prose living inside `inhabitants`, whose
other seven keys are all edge arrays — move it up to the envelope.

**D12 — RULED, applied. `tags` were kebab-case, ids snake_case.** Everything is
snake now; one `Slug` regex covers the corpus.

**D13 — `schema_version` is declared and unenforced.** Every file says `"2.0"`;
nothing reads it. *Recommend:* the parser asserts it and fails loudly on
mismatch, and this document gets a "changes in 2.1" section the day a field
changes shape.

**D14 — one correction to a claim in the earlier brief.** I wrote that canon has
no biome → creature index. It does: `biomes.yaml` `inhabitants` carries seven
edge arrays including `ambient_creatures` and `dangerous_creatures`. Encounter
generation can already ask "what lives here" — that field just needs D2's
normalization and D9's stats to be *usable*.

---

## 10. Order

1. `packages/canon` with the envelope + one taxonomy (`creature`), parse,
   registry, and `canon:check` **in CI**. Proves the shape end to end.
2. Settle D1–D3 and D12 — they change every schema, so they are cheapest first.
3. The remaining twelve taxonomies; delete `tools/wiki/canon-parser.ts` and
   point the wiki at the registry.
4. Generate `schemas/*.json` from zod; `content:validate` starts checking
   chapters against real canon ids.
5. D9/D10 fields, during the elaboration pass.
6. `CanonRepository` + `canon:sync` + the DynamoDB projection.
7. Agent tools on top of the repository.

Steps 1–4 are pure infrastructure and change no canon prose. Step 5 is the one
that has to happen *while* the elaboration is underway.
