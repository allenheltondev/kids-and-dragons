# SVG artwork audit

Audited `packages/client/src` for inline SVG, SVG imports/files, CSS image references, shared `Icon` aliases and direct component drawing. No standalone SVG assets occur in the client tree; the remaining SVGs are inline.

## Paintings added

| Surface | New artwork |
| --- | --- |
| You, other character sheets, old gear, rank-up | Thorn bracer, dusk hood, star circlet, song bell; shared `TokenGlyph` now routes through `Icon` |
| Inventory | Dedicated Bag painting from #481; party purse receives a distinct painted coin |
| Tray and mode switch | Enchanted phone, television, open storybook |
| Choice/check icons | Ear, leaf, d20, six-sided die |
| Status and progression | Hourglass, numbed drop, puffed creature, level-up crown, knocked-down boot, ready shield, ballot box, rest campfire |
| Family keepsakes | Envelope, passkey |
| Riftlight | Neutral lens indicator |
| Duskrunner rank-up | Crow |

The existing class badges (shield, dagger, hat, lyre) continue to describe classes in class selection. The new class paintings describe the actual worn gear named on You: bracer, hood, circlet, bell. Inventory uses the existing `bag`/`inventory`/`item` mapping.

## Remaining inline SVG reviewed

| Source | Disposition |
| --- | --- |
| `screens/icons.tsx` | Back/forward, check/close, plus/minus, shuffle, play, sound/mute and QR remain geometric controls; unknown names retain a neutral fallback. Object icons resolve to paintings. |
| `screens/ClassToken.tsx` | Rank notch diamonds/dashes stay as countable geometric marks alongside painted gear. |
| `screens/ChapterMapPanel.tsx` | Map connectors depend on node layout; retain SVG geometry. |
| `screens/WorldMapPanel.tsx` | Trail and route paths depend on map coordinates; retain SVG geometry. |
| `ui/Collapsible.tsx` | Rotating disclosure chevron; retain vector geometry. |
| `speech/ReadAloudControl.tsx` | On/off text-and-sound control with a diagonal off stroke; retain geometric state distinction. |
| `a11y/A11yControl.tsx` | Conventional display-settings gear; retain familiar control. |
| `screens/BadgeArt.tsx` | All nine declared badges have paintings; SVG is an unknown-id fallback. |
| `world/RendererFallback.tsx` | Failure/retry control; retain simple geometry. |
| `screens/TrayObjects.tsx` | Every supported tray object has painted art. |
| `screens/RankUpMoment.tsx` | Crow replaced by painting through `Icon`. |

Generated using the built-in imagegen tool. Transparent lossless 256px WebP with a minimum 16px canvas margin. Exact prompts and source output paths: `prompts.json`. Runtime assets: `packages/client/src/assets/painted/`, declared in `assets/manifest.json` and bundled through `artwork.ts`.

The audit also walked every `icon` field in committed content JSON and every literal `Icon name` in production TSX. With the new deliveries, all authored names resolve. The sole deliberately unknown literal is `CreationPreview`'s `unknown` fallback for an unfinished choice.

Riftlight's final WebP is neutral grayscale with alpha preserved, so its decorative highlights cannot suggest one of the authored rift-reading colours. Live d20 results remain text with a dark outline for contrast over the painted facet.

## Review and validation

- [Class gear, choices and tray objects](https://assets.kd.readysetcloud.io/sha256/55/55414b18ec1006818f290e4209dcb882a4922c20c116b7c19caa3bdf20ae48c7.png)
- [Statuses, keepsakes, coin and crow](https://assets.kd.readysetcloud.io/sha256/0d/0d67f8c51b78e5d5b4add68b991ce52e60e3e5917aa857a3c2a8fe6aefd52d5b.png)
- [Inventory and Stats](https://assets.kd.readysetcloud.io/sha256/d9/d9e55d08d6fcd8f5d446baa9be9b3593fbd64c31c5c185c03321fe9802e9f5e8.png)
- Art verifier: 1,014 checks passed.
- Contact-sheet generator: 30 species/tier sheets generated, plus the three issue-specific sheets above. Reviewed at 128, 48 and 24px on light and dark backgrounds.
- Targeted UI tests: 300 passed across 10 files (shared icons, class tokens/rank-up, statuses, dice, Riftlight, You/character sheets, layouts and journal).
- Client typecheck, production build and bundle budget passed.

Art scripts use the installed `python` interpreter because this Windows host's `python3` alias cannot execute. A component screenshot was attempted with Playwright, but Windows denied browser/profile access; it is not counted as completed visual validation. Contact-sheet review and component render tests completed successfully.
