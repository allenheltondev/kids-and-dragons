# Grown-up guide paintings (#573)

Art delivery only; page integration follows separately. Import these files through the client asset pipeline rather than embedding data URLs. Keep guide art lazy-loaded, decorative, and hidden in print/high-contrast views as appropriate to the guide design.

| File | Canvas | Transparency |
| --- | --- | --- |
| guide-banner-play.webp | 1920 × 480 | Opaque |
| guide-banner-setup.webp | 1920 × 480 | Opaque |
| guide-part-keeping.webp | 256 × 256 | Transparent |
| guide-part-groups.webp | 256 × 256 | Transparent |

All four embed an sRGB profile. The emblems follow the brief's explicit transparent-background instructions, which take precedence over its general opaque-delivery wording.

## Generation prompts and art direction

Created with OpenAI image generation, October 2026. Shared direction: warm storybook gouache, old brass (#6b5430, #b08a3e, #f5c86c), plum leather (#2a1f45 to #110c22), deep violet (#1a1730), restrained teal. No writing, digits, watermarks, or red trim. Match the existing friendly purple dragon's character and palette. Preserve brush texture and warm lantern light.

- **Play:** Cozy lamplit reading nook at night. An open blank glowing book on a low table, a brass lantern, and a small friendly purple dragon curled on a plum cushion watching a tablet and two phones propped against the book. Keep the entire scene compact in the rightmost 40%; the left 55% is calm dark plum for heading and paragraph text. Keep every subject within the shallow banner crop.
- **Setup:** The same nook later, with a brass key, plum ledger, shelf of small faintly glowing keepsake jars, and a lit brass lantern. Group the complete still life on the right; leave a quiet dark text area on the left. Match the play banner's painting style and palette.
- **Keeping:** Isolated brass key with a leaf-shaped bow resting on a plum cushion. Transparent background, generous clear perimeter, readable at small size, no surrounding scene or text.
- **Groups:** Isolated brass lantern with its door ajar beside a second smaller lantern. Warm light, plum and subtle teal accents, transparent background, generous clear perimeter, no surrounding scene or text.

Banner refinement prompts preserved the subjects' scale and placement while fitting the shallow crop. The play banner received a lighting-only refinement: keep the rightmost scene unchanged; make the entire left 60%, including the floor, very dark plum with faint brush texture so paragraph contrast remains consistent.

## Rebuild and integration

PNG masters and the mechanical packaging script live in `art/source/guide-573/`. With Pillow and NumPy installed, run `python art/source/guide-573/package.py` from the repository root. This crops/resizes, embeds sRGB, encodes WebP, and rebuilds the review sheet and measurements.

Desktop: reserve the left 55% for text. Mobile: the rightmost 40% yields a complete scene at 390 × 220; use a separate text area or an accessible overlay treatment. The mobile artwork contains bright subjects, so desktop contrast measurements do not establish mobile overlay contrast. Check actual rendered text after wiring.

See `docs/reviews/guide-573/` for the night-background contact sheet, mobile crops, and measured contrast.
