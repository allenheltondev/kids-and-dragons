# Brief: canon as a content source, and generated situations

**Status: open.** Two questions, one answer. *"Can an agent invent situations on
the fly?"* and *"what is canon missing?"* are the same question, because the
only safe way to generate a situation is to **select** from canon rather than
invent against it — and canon currently cannot be selected from. It is prose
for a website, not data for an engine.

Nothing here needs an LLM to be worth doing. Every step below makes the
hand-authored path better on its own, which is the test each one had to pass.

---

## 0. The structural finding

`canon/` is not in the game's validation loop, at all.

- `tools/content/validate.mjs` (the CI gate) validates a chapter's biome
  against **`assets/manifest.json`**, never `canon/biomes.yaml`. It has no
  concept of a creature id.
- `canon/` is read by exactly one consumer: `tools/wiki/generate.ts`.
- `validateCanon()` (`tools/wiki/canon-validator.ts`) does check id format,
  uniqueness, and broken relationship references — genuinely good work — but it
  runs inside `wiki:generate`, and **CI never calls it** (`ci.yml` runs
  `content:validate` and `art:verify`; wiki generation is manual).

So `content/` and `canon/` are two worlds with no join, and the shipped chapter
proves it: `bramblewood-01.json` fights a **Bramblewisp** — spec id `wisp`,
art `enemies/will_o_wisp`, display name "Bramblewisp". Creature canon has
`creature.will_o_wisp`. Four names for one monster, and no file relates them.

`canon/creatures.yaml` instructs agents that "Creature ids must not be invented
outside this file." Nothing can enforce that today, because nothing on the
content side has ever heard of a creature id.

---

## 1. What canon is missing

Judged against "could an agent build a playable encounter from this," not
against "is it good lore." The lore is good. Three of these gaps are the
reason the elaboration pass matters more than its page count suggests.

### 1.1 There are no numbers anywhere

`danger_level: moderate` means *"Can harm unprepared travelers."* That is a
sentence, not a stat block. `EnemySpec` needs `hp`, `guard`, `quick`, `steps`,
`attack` — every one of which is authored inline, per chapter, per fight, today.
An agent asked for an encounter will invent five integers with nothing to check
them against. **This is the single highest-leverage gap** and §2 is entirely
about closing it.

`scale: medium_to_large` has the same problem in a sharper form: the board is
10×8 tiles (spec §7.1) and `EnemySpec` has no footprint field, so every monster
is exactly one tile. That is fine until a `cloud_whale` is an encounter.

### 1.2 Canon asks for non-combat resolutions and gives no way to write one

From `creatures.yaml` `agent_instructions`:

> Encounters should usually permit more than combat. Appropriate alternatives
> include observation, conversation, bargaining, rescue, distraction, escape,
> environmental problem-solving, and restoring a damaged habitat.

There is no field for any of that. The glassback crab's `canon_constraints`
says *"Threatens before charging, usually stops pursuing once intruder leaves
territory"* — that is a **mechanic written in English**, and it is the exact
information a `check` scene needs (`stat`, `tn`, `onSuccess`). The instruction
and the schema are pulling in opposite directions; the schema is losing.

### 1.3 Two id namespaces, no mapping

Canon ids are prefixed and tripled (`id: creature.glassback_crab`,
`asset_id: glassback_crab`, `canonical_creature_id: glassback_crab`). Content
uses bare, ad-hoc ids (`wisp`, `sunbloom_draught`). Assets use directory names.
Nothing declares which of the three canon fields the engine should key on.

Pick one — I'd make `asset_id` the join key, since it already matches
`assets/entities/<id>/` — and say so in `agent_instructions`.

### 1.4 Per-file notes

- **creatures.yaml** (17) — needs §2's encounter block. Also missing "what
  makes it *stop*": every creature's exit condition is currently prose in
  `canon_constraints`, which is the most valuable and least machine-readable
  field in the file.
- **items.yaml** (3) vs **content/items.json** (15) — near-total disjunction.
  Canon has `crimson_shard`, `crystal_heart`, `marsh_lantern`; the game has
  `sunbloom_draught`, `honeycake`, `luckstone`. Neither mentions the other.
  Canon items have no `kind`/`effect`; game items have no lore. Decide which
  file owns an item and have the other reference it by id.
- **npcs.yaml** (10) — these are *peoples* (centaur, faun, frogfolk), not
  individuals. Meanwhile the shipped chapter has Pib, a wisp, and an
  embarrassed door, whose entire characterisation lives in that chapter's
  `llmHints.npcVoices`. So voice is authored per chapter and thrown away.
  Missing: a speech-register field on each people, and a decision on whether
  named individuals ever get canon ids (`agent_instructions` currently says
  no, which is a legitimate answer — but then chapter-scoped NPCs need a
  documented home).
- **locations.yaml** (3) vs **geography.yaml** (12 regions + 5 sites + 4
  features + 4 routes) — overlapping ownership. geography.yaml states "A named
  place appears once in this canon and is referenced elsewhere by id," and
  locations.yaml then names three more places. One of these files owns places.
- **biomes.yaml** (17) — the strongest file; matches the art 1:1. Missing a
  reverse index: creature → location exists, location → creature does not, and
  "what could plausibly be here" is the query an encounter generator makes.
  Also no link to `content/maps/` (which has exactly one map, `thicket`).
- **characters.yaml** (6) — duplicates `assets/manifest.json` (`bipedal`,
  `signature_part`) and omits what `rules.json` holds (`worldAbility`,
  `passive`). Three files describe a unicorn; none references another.
- **quests / campaigns / factions** (2 each) — all explicitly "placeholder
  designs pending explicit canon approval," which is fine. When they firm up,
  `quests.objectives` should map onto `ChapterObjective` (`flag` + `xp`),
  which is the only representation the engine can pay out.

### 1.5 What not to change

`agent_instructions`, `controlled_values` with per-value definitions,
`canon_status: intentionally_undefined`, and especially *"Empty relationship
lists are deliberate; they do not authorize an agent to fill the gap"* are
better than most production prompt scaffolding. Keep all of it. Every field
proposed below is additive.

---

## 2. `content/bestiary.json`

Mechanical stats for a creature, keyed by canon `asset_id`, schema-validated
like every other content file, and cross-checked against canon in CI. Canon
keeps owning what a creature *is*; the bestiary owns what it *does in a fight*.

```jsonc
"will_o_wisp": {
  "name": "Bramblewisp",          // display name; canon owns the species title
  "art": "enemies/will_o_wisp",
  "band": "skirmisher",           // → the stat band, not free integers
  "stats": { "hp": 6, "guard": 11, "quick": 3, "steps": 5, "attack": 3 },
  "ai": "harrier",                // a profile enemy-ai.ts already implements
  "xp": 15,
  "footprint": 1,
  "resolutions": [                // §1.2, finally expressible
    { "kind": "talk",  "stat": "heart",  "tn": 12, "text": "Say please." },
    { "kind": "evade", "stat": "quick",  "tn": 12 }
  ]
}
```

Two rules make this safe to generate against:

1. **Bands, not integers.** A small table maps `danger_level` → legal stat
   ranges. A generator picks a band; it never picks an `hp`. `validate.mjs`
   already refuses a `check` whose `tn` is not one of `rules.difficultyTn` —
   same principle, same enforcement point.
2. **Every bestiary key must exist in canon, and every `dangerous_creature` in
   canon should eventually have a bestiary entry.** Both directions, checked in
   CI, exactly as `checkAbilities()` already does for abilities ↔ rules.

Landing this alone deletes the inline stat blocks from chapters and gives the
Bramblewisp one name instead of four.

## 3. `content/canon-index.json` (generated)

`npm run canon:index` walks `canon/*.yaml` and emits every legal id by kind —
creatures, biomes, locations, items, peoples. Committed, like the art
portraits, so nothing needs a YAML parser at runtime.

It has three consumers, and the third is the point:

- `validate.mjs` gains real cross-file checks (a chapter naming a creature that
  isn't canon fails the build).
- `wiki:generate` stops being the only thing that reads canon; move
  `validateCanon()` into CI while you're here — it is already written and
  already tested.
- The runtime validator in §4 checks generated content against the same file
  CI uses. One list of legal ids, three readers.

## 4. Generated situations

With §2 and §3 in place, the contract is small:

- **The model emits a `Scene`, never an outcome.** Structured output against
  the existing `Scene` union (`output_config.format` with a json_schema, or a
  strict tool) — never prose parsed into JSON. Mechanics stay deterministic
  because the model produces *data the engine already executes*: dice, TNs,
  damage, HP, and XP are `engine.ts`'s, always.
- **Validate with `validateChapter()`** — the same function CI runs
  (`chapter-graph.ts`), not a second implementation. Ids against the index,
  `tn` against `rules.difficultyTn`, enemies against the bestiary, `goto`
  targets against the scenes that exist.
- **Reject and fall back; never repair.** A failed validation drops to authored
  content, silently, like `validateNarration()` in architecture §6.5.
- **Persist on acceptance, before display.** A generated scene must be written
  into run state and mirrored like any other patch. A scene that exists only in
  the generating client's memory means a reconnecting phone and the TV disagree
  about what is happening — the one failure the mirrored-state design exists to
  prevent.
- **`LIVE_LLM_ENABLED=false` still plays.** Unchanged from architecture §6.6,
  and the reason generated scenes are additive side content rather than the
  campaign spine.

On retrieval: **no vector store.** The whole authoritative corpus (`canon/` at
~30k tokens plus rules and items) fits in a cached prompt prefix, where a read
costs ~0.1× input rate; retrieved chunks vary per call, so they land *after*
the cache breakpoint at full rate and cost about the same as sending
everything. Retrieval would also reintroduce the prefix variance that
architecture §6.3's latency design depends on. Selection by structured key
(biome, creature ids present) is exact, testable, and already expressible from
`relationships` — revisit embeddings only if canon grows 10–20×, or when
per-household session history becomes a corpus.

---

## Order

1. `canon-index.json` + `validateCanon()` in CI. Pure win, no new content.
2. Pick the join key (§1.3) and the creature/item ownership split (§1.4).
3. `bestiary.json` for the `dangerous_creature` entries, and delete the inline
   stat blocks from `bramblewood-01.json`.
4. Encounter + `resolutions` fields in `creatures.yaml` — during the
   elaboration pass, not after it.
5. Only then, generated scenes.
