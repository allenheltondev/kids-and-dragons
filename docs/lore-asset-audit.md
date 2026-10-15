# Lore and canon asset audit

Audited 2026-10-15 against origin/main at `1f95445f` (PR #185). Read all 11 canon YAML files, including embedded lore (95 entities), checked image files under assets, inspected client icon aliases and wiki image resolution, and ran `node tools/art/inventory.ts`. This is a coverage audit, not visual or animation quality approval. Prose mentions do not automatically require separate commissioned images.

## Wave progress

- Wave 1 complete: dedicated Supper Bundle icon wired into the client; Open Sea and Whirlpool backdrops and derived previews saved. Both backdrops declared as optional story illustrations in the manifest, without claiming full tactical environment kits. Built-in generation prompts: [lore-assets-wave-1.md](briefs/lore-assets-wave-1.md).
- Validation: 54 existing icon and art-path tests passed; inventory reports 72/72 scene illustrations; git diff whitespace check passed.
- Wave 2 complete: 19 canon entries now resolve their delivered wiki artwork (including both new ocean backdrops). Cast previews are derived by the standard portrait tool. Wiki generation no longer emits false missing-directory warnings for delivered convention assets. Tile galleries display their own image, and regeneration preserves Windows body spacing.
- Gameplay: existing cast, entity and chapter-biome conventions already work. Story scenes can now select `biomes/open_sea/bg` or `biomes/the_whirlpool/bg` as `art` without changing combat terrain. No existing chapter was moved to an ocean setting.
- Wave 2 validation: 232 wiki/icon/cast/art-path tests passed, tools typecheck passed, Hugo and client production builds passed; rendered HTML image links checked for individuals, locations, items, factions and Open Sea.
- Wave 3 complete: five background-only environments declared separately from tactical kits; inventory reports 5/5 story environments and 23/23 canon place coverage, including missing or undeclared backdrop detection. Scene illustrations remain 70/70 after moving the two ocean backgrounds into the dedicated environment declaration. Asset inventory prose refreshed.
- Final validation for waves 1–3: 235 focused tests, full workspace typecheck, all 55 content checks, and whitespace checks passed. Wiki and client production builds passed in wave 2.
- Wave 4a: five Bigfoot rigs packaged from unchanged recut anatomy: Starweaver Radiant/Mythic and Songkeeper Sworn/Radiant/Mythic, with pinned builds and gameplay selectors. Remaining class variants: 25.
- The old Unicorn mask workflow was rejected after walk/attack review showed duplicated limbs; no Unicorn candidate is declared or enabled. Other species require base-mask review before repeating that workflow.

## Original findings: missing or borrowed artwork

| Subject | Evidence | Suggested deliverable |
|---|---|---|
| Open Sea (`biome.open_sea`) | Defined in canon/biomes.yaml; no matching asset directory, backdrop, or dedicated atlas region. Not in manifest.biomes. The realm map depicts surrounding water, but is not a dedicated scene backdrop. | Open-water backdrop; add tiles/boat or ocean props only when encounter design needs them. |
| The Whirlpool (`location.the_whirlpool`) | Canon describes a standing offshore spiral; no dedicated matching illustration or environment directory. Eastern Maelstrom is also mapped in geography.yaml, without a separate scene image. | Whirlpool backdrop. Establish whether these two canon records describe one hazard before commissioning two images. |
| Supper Bundle (`item.supper_bundle`) | content/items.json requests icon `supper`; packages/client/src/screens/icons.tsx explicitly aliases it to `cake` until its own painting exists. | Painted bread/cheese/sausage bundle, registered in artwork.ts; remove temporary alias. |

## Existing backdrops with incomplete environment kits

Sallow Wastelands, Bramblewood, and Redspire Citadel each have `assets/biomes/<id>/bg.webp` and portrait.webp, but no tiles.png or prop PNGs. They are absent from manifest.biomes, so the inventory's 51/51 environment result does not cover them. They are usable as story backgrounds today; tiles and props are additional work only if they need the same tactical/environment support as the 17 declared destinations. Redspire Citadel remains intentionally undefined: any expansion should preserve its canon constraints.

Hollow Gate already has `assets/scenes/gemfall/hollow-gate.webp`. Its missing underscored biome directory is not evidence that its illustration needs drawing again.

## Existing art that wiki lookup misses

The active convention resolver in tools/wiki/page-generator.ts supports only character, creature, npc, and biome. Canon entries have no explicit `assets` overrides. Consequently these subjects have images on disk but do not receive them through that resolver:

- All three named individuals: Pib, Marda Thorn, Old Ossley in assets/cast/<id>/assembled.png (Pib also has an entities copy).
- Nine of ten locations: MossHome, Mount Red Sky, Exchange, Stone Crossing, Skullwater Cave, Redspire Citadel, Bone Yard, Bramblewood have biome backgrounds; Hollow Gate has its Gemfall scene image. The remaining location is the Whirlpool gap above.
- Three lore items: Crimson Shard, Crystal Heart, Marsh Lantern in assets/items/<id>/assembled.png.
- Skywardens: assets/entities/skywardens/assembled.png exists, but faction is not a supported resolver type.
- Stone Crossing Route can reuse the existing Stone Crossing backdrop if desired.

These need mapping or discovery support, not replacement artwork.

## Items and geographic features: optional expansion

Thirteen usable canon items have no dedicated assets/items/<id> illustration: Sunbloom Draught, Honeycake, Supper Bundle, Mosslight Jar, Brave Whistle, Thunder Acorn, River Charm, Thistle Pin, Owlfeather Clasp, Songbird Ribbon, Quickfoot Lace, Hearthstone Bead, Luckstone. All have working client icon coverage through painted art or aliases. Supper Bundle is the explicit temporary substitution called out above; Sunbloom uses the generic consumable painting. Dedicated full-size item illustrations would improve a lore gallery, but these are not thirteen broken inventory images.

Source of the Great River, Great River, Western Branch, Exchange–Sunward Road, and Exchange–Marsh Approach have no dedicated images matched by canon ID. Realm/region atlas art supplies map context. Northern River Bridge has related Gemfall scenes (`northern-bridge-foot`, `cracked-bridge-span`, `bridge-engineers-tent`, `bridge-pillar-shallows`); western river travel has `west-branch-ford` and related scenes. Separate pictures for every route or river segment are optional, not established missing deliverables.

Deep Hollow Cult, Shard of the Hollow Crown, the two placeholder campaigns, and the two placeholder quests lack dedicated matching artwork and are intentionally undefined. Do not treat them as an approved art brief. Gemfall already contains chapter-scoped cult figures; those do not establish a faction-wide design.

## Confirmed coverage and remaining production

- All six playable species, all 18 creature entries, and all 13 NPC peoples/orders have assembled character/entity artwork. Loftmire and Sheeple are covered despite lacking explicit asset_id fields.
- All three canon individuals have cast artwork.
- All 1,001 explicit chapter figure references and 501 scene-art references resolve to files, using the character fledgling convention for characters/<species> references.
- Inventory: 224/224 character parts, 24/24 base rigs, 72/72 gear portraits, 17/17 effects, 70/70 scene illustrations, 30/30 declared entity cutouts, 9/9 combat part-sets.
- Class rig variants: 42/72 complete, 30 outstanding: Starweaver Radiant and Mythic (12 combinations), Songkeeper Sworn/Radiant/Mythic (18 combinations). Existing gear paintings are complete; these require exact-pose part splitting and rigs.

The prose snapshot in docs/asset-inventory.md is stale: it says 6/72 class variants, 27 cutouts, and five Gemfall illustrations. The executable inventory reports the current counts above, but only checks manifest-declared requirements. Extend its canon coverage to make newly defined places visible before they enter the manifest.

## Recommended order

1. Paint the Supper Bundle icon; decide the Open Sea and Whirlpool scene briefs.
2. Wire existing location, individual, item, and faction images into wiki discovery.
3. Declare the three background-only environments explicitly and decide which need tactical kits.
4. Complete the remaining 25 class rig variants after base-mask review; inventory prose and canon coverage reporting are now updated.
