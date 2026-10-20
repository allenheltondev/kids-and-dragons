# Kavari artwork

## Approved pose set

- `assets/entities/kavari/assembled.png`: approved wings-up pose; default figure.
- `assets/entities/kavari/portrait.webp`: derived portrait of the default figure.
- `assets/entities/kavari/wings-down.png`: matching resting pose with both pairs lowered.

Both PNGs are 1024 × 1024 RGBA cutouts with transparent margins, registered as
`wings_up` and `wings_down` in the asset manifest. These are alternate stills,
not frames of a rigged animation. The default approved image is preserved.

### Wings-down edit prompt (built-in imagegen)

Edit this APPROVED Kavari illustration into a matching WINGS-DOWN pose. Preserve exactly the same individual design, fierce focused icy-blue eyes and lowered feather brow, head shape, closed deep-blue beak, pale ice-blue body, rich deep sapphire tail, two feet, crystalline pale wing feathers, painterly storybook style and left-facing three-quarter viewpoint. Exactly FOUR wings in TWO bilateral pairs, larger upper pair and smaller lower pair. Lower and relax BOTH pairs, folding them down and back alongside the body. Each pair must remain identifiable: show two separate gently drooping feather fans on each side, one longer primary wing and a shorter secondary wing, with distinct roots. Primary tips point down/back, not up; no wings raised above shoulders. Clear anatomical four-wing arrangement, no fifth folded wing or extra inset fan on the chest. Keep the front breast smooth short plumage, not wing-like. Keep the darker sapphire tail clearly separated from the pale wing tips. Preserve adult sturdy proportions and fierce face, not chibi or baby. Same hand-painted details and upper-left lighting. Complete unclipped figure centered square with at least 60px clear transparent margin, true transparent RGBA background. No scenery, shadow, text or magic particles. This is a second pose of the approved bird, not a redesign.

## Tail, expression, and anatomy cleanup

The latest built-in imagegen edit darkens the tail to sapphire blue, gives the
face a fierce focused gaze, and removes the unintended folded fifth wing from
the torso. The four outstretched wings remain. The portrait is regenerated.

### Cleanup edit prompt

Edit the supplied four-winged ice-blue Kavari bird illustration with EXACTLY these three corrections. 1) TAIL COLOR: the tail is the downward-pointing feather fan behind the legs, at bottom right. Recolor that entire tail to a deep rich sapphire/cobalt blue, significantly darker than the pale ice-blue wings, with restrained lighter blue crystalline edge highlights. Tail must read as a separate dark-blue appendage, clearly contrasting with the lower right wing above it. Keep the four actual wings pale ice blue. 2) FIERCER FACE: change the baby-like wide-eyed expression into a focused fierce adult gaze: narrower luminous icy-blue eyes, lowered feather brow angled with determination, confident closed dark-blue beak, slightly sharper cheek feathers. Brave, alert and formidable but child-friendly. Preserve this creature's rounded ice-blue head and magical identity; do not turn it into a bald eagle or photorealistic raptor. 3) REMOVE EXTRA BODY WING: there is an unintended FIFTH wing, a folded teardrop-shaped feather fan on the near side of the torso, immediately right of the breast below the base of the large upper-right wing, with its tip pointing down toward the hip. ERASE that entire folded teardrop wing and its outline. Replace that area with smooth continuous short body plumage matching the breast and flank, no elongated layered flight feathers or inset fan on the torso. Preserve EXACTLY FOUR real outstretched wings: upper left, upper right, lower left, lower right. Do not remove either lower outstretched wing. Each of these four wings attaches once and has a coherent continuous surface. Keep their current open poses, size, crystalline feather highlights, the two feet, body position, silhouette and illustration style otherwise unchanged. Hand-painted fantasy storybook art, true transparent RGBA background, no scenery, text, effects or ground shadow. Full bird unclipped on square canvas with at least 60px transparent edge margins.

## Double-wing revision

At the user's direction, the final design now has two distinct wing pairs:
a larger upper pair and a smaller lower pair. Generated with built-in imagegen,
then resized and used to regenerate the portrait as described below.

### Double-wing edit prompt

Edit this Kavari bird to have DOUBLE WINGS: exactly FOUR wings, two distinct bilateral pairs. Keep its rounded friendly adult ice-blue head, curious softly luminous eyes, small deep-blue beak, sturdy body, short tail, two feet, crystalline feather tips and hand-painted storybook style. Change the wings and their pose: upper primary pair attaches high on the shoulders and opens gently upward/outward; second smaller pair attaches distinctly lower on the torso and opens gently downward/outward. All FOUR individual wings must be visible and countable, with clear spaces separating upper and lower silhouettes on each side. Each wing has its own root, continuous leading edge and complete feather fan; these are two anatomically separate pairs, not nested feather layers or a tiny inner-wing on one big wing. Balanced relaxed butterfly-like four-wing arrangement, but all wings are feathered bird wings, NOT insect membranes. Three-quarter body view facing left, sufficiently front-facing that both far-side wings are visible. Quietly magical and approachable, not a majestic eagle or heraldic pose. Ice-blue feathers with restrained translucent crystalline edges and delicate frost-vein highlights. No additional limbs, no jewelry, crest, armor, floating effects or scenery. Full body entirely visible, square composition, at least 60px clear margin on all sides. True transparent RGBA background. No text, no ground shadow.

Generated with the built-in imagegen tool for PR #338, following the adult
description in `canon/creatures.yaml`. The transparent output was resized with
Pillow to fit within 940 × 940 pixels on the 1024 × 1024 RGBA entity canvas,
preserving alpha and a clear margin. `tools/art/portraits.py kavari` derives the
512-pixel WebP portrait. No rig or combat abilities are added.

## Revision

The revised figure uses closed wings to remove the nested inner-wing silhouette,
a rounder body and face, and crystalline feather highlights for a quieter magical
appearance. Generated with the built-in imagegen edit tool, then processed with
the same canvas and portrait derivation described above.

### Final edit prompt

Substantially redesign this Kavari illustration. The previous edit was too conservative. CHANGE THE ENTIRE POSE AND WING STRUCTURE. Bird stands quietly with BOTH WINGS FOLDED CLOSED against the sides of its body. ZERO outstretched wings, zero raised wing arches, zero inset wings. Only one folded teardrop-shaped wing visible on the near flank; the other wing mostly hidden behind the body. Single continuous back silhouette, no fan behind shoulders. Make it a magical cave bird rather than an eagle: rounded head, short blunt dark blue beak with NO hooked tip, no raptor brow, softly luminous pale-blue eyes, inquisitive slight head tilt. Uniform ICE BLUE head and body, NOT a white head. Stocky adult bird with a comfortably rounded chest, short sturdy bird legs and modest feet, a short fan tail rather than a long imperial eagle tail. Elegant crystalline geometric facets only in the ends of the folded flight feathers, subtle opalescent icy light within these feathers, soft light-blue frost tracery, restrained magical quality. No crest, no ornaments, no floating particles, no surrounding ice. Adult natural animal proportions; not chibi, not a baby, not an owl or penguin. Warm hand-painted storybook fantasy illustration, dark fine tapered outlines, simple softly shaded broad feather shapes, children's adventure game. Full-body 3/4 view facing left, isolated true transparent RGBA background, clear 60 pixel margins on all sides of square canvas. No scenery, text or ground shadow. Preserve ice-blue palette and species idea, but do NOT preserve eagle anatomy or spread-wing composition from reference.

## Initial prompt

Create one complete full-body Kavari bird cutout for Kids & Dragons, a children's fantasy storybook game. Single adult legendary bird, natural-looking and unornamented, ice-blue fully feathered body, darker deep-blue beak, streamlined but slightly bulky powerful chest. Adult stands 3.5 feet tall with nine-foot wingspan. Broad mature wings partially spread to show crystalline-looking flight feathers, actual feathers with angular icy highlights rather than icicle spikes. Two sturdy bird feet, calm alert intelligent expression, three-quarter view facing left. No elaborate crest, no jewelry, no armor, no decorative ice formations, no magic effects, no scenery, no ground shadow, no egg, no text. Hand-painted storybook illustration, warm dark-brown tapered outlines, soft-edged cel shading with two tones and a highlight, upper-left lighting, bold readable silhouette, restrained details concentrated in face and wings. Square 1024x1024 composition, whole figure fully inside frame with at least 40 pixels transparent breathing room on every edge. Feet near bottom center. True transparent background, RGBA cutout. Match a polished illustrated fantasy bestiary, not photorealistic, not 3D, not chibi.
