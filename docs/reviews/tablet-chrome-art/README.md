# Painted chrome delivery

All **38 named assets** from the [brief](../../briefs/tablet-chrome-art.md) are delivered,
including optional Part A and Part D art. The PR summary's count of 42 differs from the
38 filenames actually enumerated in the tables.

Runtime files: [`packages/client/src/assets/chrome/`](../../../packages/client/src/assets/chrome/).
Prompts and slicing are in that folder's README; exact generation/revision prompts and the
reproducible packager are in [`art/source/tablet-chrome/`](../../../art/source/tablet-chrome/).
All artwork was generated with the built-in imagegen tool.

## Review sheets

- [Every asset on #0d0b1a](https://assets.kd.readysetcloud.io/sha256/c2/c2c49385a38e604c717cb9ffde3b6397034bf7055065fa5ca26fdee2c121708f.webp)
- [Every asset over the enchanted woods biome](https://assets.kd.readysetcloud.io/sha256/25/2513cf342b8eee7c6c33b94c69dd4121f9c2569139b6d15130a8294e614d70fa.webp)
- [Four-repeat tile summary](https://assets.kd.readysetcloud.io/sha256/17/17ca0a2c957382d091dc39be4aa27bb1bd84e24d88e5661dfccec47fca5cd267.webp); individual `tile-*-4x.webp` images retain delivery resolution
- [Three-times stretchable regions, fixed corners/caps](https://assets.kd.readysetcloud.io/sha256/3b/3bd5ced9a3a50a088669d35d1d94dec1cb60b9b3befbb754e8ebbb56fb43ff9e.webp)
- [Matched ink checkboxes on their parchment](https://assets.kd.readysetcloud.io/sha256/16/16fc76ee3668176f2aba4417b47f3f672690909b94c6309e6000445886fb0679.webp)

## Validation

The machine-readable [validation report](validation.json) records all dimensions, alpha
ranges, byte sizes, tile-edge diagnostics, background luminance range, and vignette center alpha.
The final set is **132,680 bytes**, under the 160,000-byte total target; every file is below
8,000 bytes. All sizes match the brief's 2x delivery pixels. The controls texture is below
6% luminance variation and the vignette center is fully transparent. Tile edge differences
are diagnostics, not a claim that generation yields mathematically identical opposing pixels.
Repeated tiles and stretched regions are supplied for visual review.

The stretch preview exposes two integration constraints in the brief: choice sockets occupy
the left edge's vertical stretch region, and the divider's star occupies its horizontal middle.
Keep those motifs fixed at native size and stretch the plain plate/arms separately; blindly
stretching every slice makes the socket oval and the star wider. The asset README records this
for the CSS pass. The plain panel edges and fixed corners/caps remain suitable for slicing.

Checks: packager `--strict`, Python syntax compilation, and `git diff --check`.
No application code changed or assets were imported. CSS wiring, high-contrast fallbacks,
before/after device screenshots, and layout-fit checks remain the integration phase described
in the brief. This delivery adds no start-screen asset downloads.
