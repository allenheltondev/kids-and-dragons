# Painted 3D dice roll

[Animated renderer preview](roll.gif) · [All twenty results and helper meshes](all-faces.png) · [Motion timeline](timeline.png)

The main roll now projects a real twenty-face icosahedron, with numbers painted into each face's texture. Numbers rotate, recede and disappear with their faces; there is no changing number floating over a rotating flat image. Opposite d20 faces sum to 21. Helpers use actual d4, d6, d8 and d10 meshes; the d10 is a ten-kite trapezohedron, the dual of a pentagonal antiprism.

The presentation still receives the authoritative result from the server. A deterministic throw rotates the selected face into its landing orientation. The view looks down onto the die, with directional diffuse/specular lighting, shaded gold edges, an enamel texture and a soft contact shadow. Six diminishing bounces use six existing contacts in the approved 1.4-second dice recording. The recording plays at 0.636x speed to match a slower 2.2-second throw. Rotation has about two-thirds fewer turns, with gentler initial deceleration. Retimed contact times are shared by the geometry and synthesized fallback; the approved recording and its procedural source remain unchanged. The fallback now uses diminishing noise/wood tones on the same beats. No new audio sink or duplicate main-roll cue is installed.

The shared tumble duration is now 2200ms, matching the retimed soundtrack; the presentation gate and phone takeover use the same constant. Helpers keep their separate 800ms beat, then the existing 2600ms reading period. Natural 20s add the game's painted spark/star assets and keep their celebration; natural 1s retain their friendly bonk and dizzy stars.

The renderer uses perspective-projected convex geometry on Canvas 2D, not a heavyweight third-party 3D engine. It adds no runtime dependencies. React does not rerender on animation frames. Pixel density is capped at 2x; animation stops at rest, pauses in background tabs, cleans up on replacement/unmount and follows both system and app reduced-motion changes. Missing/disabled canvas retains a static painted die and a timed readable result.

## Artwork

`packages/client/src/assets/dice/enamel.webp` is an opaque 256px painted material generated with the built-in imagegen tool. Exact prompt and source: [material.json](material.json). It is bundled by Vite and declared under `diceArt` in `assets/manifest.json`. Gold edges and numerals are rendered onto face textures.

## Validation

- Geometry: closed convex meshes, correct face counts, unique legal numbers, opposite d20 pairs, upright landing transforms for every result, bounded continuous motion and soundtrack contact times.
- Lifecycle: stop at rest, repeat identical rolls, reduced motion from start and changed mid-roll, cancellation on unmount.
- Existing dice overlay, speech/maths, helper sequencing and layout timing checks pass.
- Client typecheck, production build and bundle budget pass.
- The GIF, timeline and all-face sheet were rendered offline by the actual TypeScript canvas renderer using a local Skia canvas backend, then inspected. They validate material, face placement, lighting and motion samples; they are not browser screenshots.

Browser review was attempted, but the browser permission gate declined access to the localhost preview. No alternative browser route was attempted. Browser-specific compositing, mobile frame rate and in-browser audio timing still need a live review.

Final checks: 229 tests passed across 15 suites; client TypeScript check passed; production build passed; art verifier passed 1,014 checks; bundle budget passed (312KB first paint / 315KB cap, 1,373KB total / 1,400KB cap). No runtime package dependency was added.

Slower-roll adjustment: the throw now lasts 2.2 seconds, uses about two-thirds fewer turns with a gentler speed curve, and has six diminishing bounce contacts instead of four. Recorded dice audio plays at 1400/2200 speed; synthesized impacts use those same retimed contacts. Updated offline GIF uses frame durations totalling the full 2.2 seconds. Follow-up validation: 78 targeted tests, client typecheck, production build and bundle budget passed.
