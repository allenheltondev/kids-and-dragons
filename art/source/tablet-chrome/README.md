# Tablet chrome art packaging

`manifest.json` records all 38 asset IDs, delivery dimensions, and slice contracts.
`prompts.json` records the selected built-in imagegen prompts, including revision prompts.
The high-resolution generation PNGs remain in the local Codex image output folder; runtime
deliverables are committed under `packages/client/src/assets/chrome/`.

The packager crops transparent margins using alpha > 1 to ignore invisible speckles,
resizes to the exact delivery size with Lanczos, and WebP encodes. Material backgrounds
are opaque; ornaments and frame edges retain transparency. libwebp's alpha quality 70
compresses subtle opacity noise without removing the cutout silhouette. The vignette was regenerated with a narrow, low-opacity feather that retains its smooth
fade after encoding. RGB quality starts at 80 and steps down only
if needed to meet the 8,000-byte individual target. No blur filter is applied.

With Python, Pillow, and libwebp 1.6.0 `cwebp` available, provide a local JSON object mapping
each ID to its selected generation PNG. Keep that machine-specific mapping out of Git:

```powershell
python art/source/tablet-chrome/package.py --sources tmp/tablet-chrome-sources.json --cwebp <path-to-cwebp.exe> --strict
```

Without `--sources`, the script inspects delivered files and regenerates review sheets.
Without `--cwebp`, it uses Pillow's default lossless-alpha WebP encoder; this can exceed
the byte budget because it preserves low-opacity generation noise exactly.

`--strict` checks all IDs, dimensions, individual sizes, and the 160,000-byte total.
Visual review sheets cover both requested backgrounds, four repeats of each tile,
and nine/three-slice regions stretched to three times their drawn length. Tile edge
differences are also recorded as diagnostics; they are not an automatic visual seam verdict.
