# Painted rifts

The same illustrated doorway is used by the story stage and the World-view
glyph. The shared stage is always neutral. Starweaver-only colour selection
remains in `packages/client/src/screens/riftlight.ts`.

`doorway-master.png` was generated with the built-in imagegen tool on
2026-10-23. It is the source artwork, not a runtime dependency. The prompt is
recorded in `prompt.txt`. Registration, texture sampling, palette mapping,
and animation are reproducible code in `build.py`.

```
python art/source/painted-rifts/build.py
python art/source/painted-rifts/test_build.py
node tools/art/painted-rifts-review.mjs
```

The legacy `python art/source/build_riftlight.py` command delegates here.
Review output goes to ignored `art/review/painted-rifts/`: real Pixi scenes
and React glyphs on bright/dark backgrounds, TV and phone screenshots,
grayscale/reduced-motion variants, and an animated WebP of common stacks.

Each runtime sheet is 24 frames at 12fps, 320px square, on one 7680px strip
(below an 8192px texture limit). The doorway is registered at x=50%, with
its foot at y=86%, and fills 72% of the frame. PNG palette compression
preserves transparency and keeps all eleven sheets around 1.4MB combined.

Palette colours preserve the existing art contract:

| Layer | RGB anchor | Shape and motion |
| --- | --- | --- |
| Green | `#3da461` | Outer side brackets, slow breathing pulse |
| Amber | `#bf7430` | Painted lower-rim glint, one candle-like dim-and-catch flicker per cycle |
| Blue | `#467caf` | Two staggered outward ripples |
| Violet | `#8964b5` | Inward-travelling spiral |
| Neutral / linked | Achromatic charcoal and grey | Local shimmer / paired beat |

Shrink/stutter sheets share the painted base; CSS moves the whole glyph,
keeping every coloured layer registered. Reduced motion holds frame 12 and
disables the parent motion. Opening/closing transform the artwork around its
foot; the stage plays these once. An explicit `handoff` in the manifest lets
the open animation end at full strength and the close animation start there,
so their shared endpoint joins the neutral loop without a flash. The other
endpoint still passes the normal fade check.

The review tool asserts real browser CSS parsing, one-shot frame endpoints,
neutral shared-stage rendering, and reduced motion. The existing room-based
`cast-shot` review currently redirects its TV to the join screen before the
scene; this focused review uses the actual renderer directly and does not
depend on that room-joining path.
