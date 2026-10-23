# Me page badge medals (#426)

Nine paintings generated with the built-in imagegen tool on 2026-10-23.
Runtime files: `packages/client/src/assets/badges/<id>.webp`, 256×256 RGBA.
The full prompt set and source/output hashes are recorded in `prompts.json`.

Each achievement has a distinct silhouette and emblem, visible in `review.png`
on the Me page plum background and a light paper background at 120px.

| Badge | Silhouette and emblem |
| --- | --- |
| finished:<campaignId> | Round medal, scroll and winding trail to a star |
| finished-3 | Scalloped medal, three storybooks |
| guest-star | Star medal, clasped hands |
| kept-going | Heart medal, sprout breaking through stone |
| level-3 | Leaf medal, young sapling |
| level-5 | Shield medal, crown |
| finds-1 | Oval medal, open eye |
| finds-5 | Hexagon medal, bootprints on a trail |
| finds-15 | Open book medal, compass rose |

`BadgeArt` keeps every medal decorative, preserves the exact `data-badge`
value and custom class, shares completion art across campaigns, and falls back
to the plain SVG for unknown ids. Vite imports emit hashed files in `/bundle/`;
the existing service worker precaches all bundle files during installation.

The manifest declares `badgeArt`; `art:inventory` reports its deliveries and
`art:verify` checks format, dimensions, nonempty alpha and transparent padding.

Validation: client TypeScript check and production build passed; 35 tests across
badge art, profile pane and service worker passed. Inventory reports 9/9 medals.
The badge pixel verifier passes all nine (15–34px clear margins). The emitted
service worker install list contains every one of the nine hashed WebP files.
Total runtime artwork is 183,368 bytes (about 179 KiB).
