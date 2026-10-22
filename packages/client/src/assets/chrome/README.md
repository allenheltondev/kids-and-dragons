# Painted interface chrome

Generated with the built-in `image_gen` tool for [the tablet chrome brief](../../../../../docs/briefs/tablet-chrome-art.md). All 38 named deliverables (including optional art) are included. The brief's PR summary says 42; its tables enumerate 38 filenames.

Files are WebP at the brief's 2x delivery sizes. Text and icons remain live UI overlays. CSS integration follows separately, as requested by the brief. Selected states use heavier trim or a changed silhouette as well as color.

## Shared prompt

Use case: stylized-concept. Create ONE production UI art asset for Kids & Dragons. Warm storybook painting read by lamplight, chunky readable shapes, restrained low-detail brushwork, old gold/brass #6b5430 #b08a3e #f5c86c, plum leather #2a1f45 to #110c22, deep violet #1a1730, subtle teal accents. Straight-on orthographic, aligned to canvas, not a perspective object or mockup. Decoration ONLY at edges, all text areas completely calm. No text, letters, digits, red trim, silver or white trim, watermarks, extra objects, drop shadow outside canvas. Asset must occupy prescribed aspect ratio; generate on transparent canvas except full-bleed material tiles. Nine-slice edges must be completely plain lengthwise, with all corner motifs entirely within stated insets. Keep same family materials and geometry across states.

Each line below completes that shared prompt with the asset name, delivery size, slicing contract, and subject. Generation requested an individual transparent asset, never a contact sheet. Material tiles are full bleed. The generation PNGs were alpha-bound cropped (except vignette), resized with Lanczos, and WebP encoded; transparency is retained using WebP alpha quality 70. Full-bleed material backgrounds are opaque. Exact selected generation and revision prompts are in `art/source/tablet-chrome/prompts.json`. Exact spec and packaging script: `art/source/tablet-chrome/` at repository root.

## Prompts and slicing

- **pane-spine.webp** — 32×256; T vertical. Prompt: A carved old-gold spine strip where book pages meet; uninterrupted plain longitudinal ridges, no crosswise motifs, seamless vertical ends.
- **pane-spine-cap.webp** — 32×64; cap. Prompt: A small leaf-shaped antique brass finial ending a vertical book spine. Mirrorable top/bottom.
- **pane-spine-boss.webp** — 64×64; boss. Prompt: A round brass boss with one small teal cabochon and chunky leaf setting.
- **pane-corner.webp** — 96×96; C. Prompt: Top-left L-shaped filigree corner only, thin brass curling leaf trim along top and left, rest transparent; must look right mirrored.
- **rail-wood.webp** — 208×256; T vertical. Prompt: Full-bleed dark plum leather shelf material, subtle longitudinal worn sheen, seamless top/bottom; no border or objects.
- **rail-rim.webp** — 8×256; T vertical. Prompt: Extremely narrow full-height old gold edge, plain uninterrupted longitudinal highlights, seamless top/bottom.
- **tray-wood.webp** — 256×144; T horizontal. Prompt: Full-bleed dark plum leather shelf material, subtle horizontal worn sheen, seamless left/right; no border or objects.
- **tray-rim.webp** — 256×8; T horizontal. Prompt: Extremely narrow full-width old gold edge, plain uninterrupted horizontal highlights, seamless left/right.
- **rail-socket.webp** — 112×112; round. Prompt: A shallow round recessed dark plum well with subtle antique-brass edge; calm dark empty interior.
- **rail-current.webp** — 24×160; 3S vertical caps 24. Prompt: Vertical brass bracket for selected tab, heavy protruding ends within 24px caps and plain stretchable middle; selected silhouette.
- **tray-current.webp** — 160×24; 3S horizontal caps 24. Prompt: Horizontal brass bracket for selected tab, heavy protruding ends within 24px caps and plain stretchable middle; selected silhouette.
- **corner-bezel.webp** — 96×96; round. Prompt: Round chunky antique brass bezel with empty dark plum center for an overlaid control icon.
- **panel.webp** — 192×192; 9S inset 40. Prompt: Standard square dark violet cloth card, thin brass rounded edge; completely flat calm #1a1730 center. Corners within 40px.
- **panel-featured.webp** — 256×256; 9S inset 64. Prompt: Featured square dark violet card, heavier old gold frame and small leaf corner flourishes within 64px corners. Flat #1a1730 center.
- **panel-sunken.webp** — 128×128; 9S inset 32. Prompt: Square dark recessed well, inner shadow, slightly rounded corners, no metallic trim; flat dark #0d0b1a center. Corners within 32px.
- **plate-story.webp** — 512×192; 9S insets left/right 48 top/bottom 32. Prompt: Wide low dark-glass narration panel, gold TOP edge, subtle rounded corners within 48px sides and 32px top/bottom, calm flat dark center.
- **strip-identity.webp** — 256×128; 9S inset 40. Prompt: Wide dark plum hero nameplate, restrained brass edge and minimal corner detail within 40px; blank flat dark interior.
- **heading-ribbon.webp** — 384×96; 3S horizontal caps 64. Prompt: Horizontal deep-violet cloth heading ribbon with brass end details contained in 64px endcaps; plain flat stretchable middle, blank.
- **rule-flourish.webp** — 512×32; 3S horizontal caps 96. Prompt: Very thin horizontal antique-brass divider with tiny central four-point star, restrained symmetrical ends in 96px endcaps, transparent backdrop.
- **goal-paper.webp** — 384×192; 9S inset 48. Prompt: Wide warm light parchment slip, pinned only at top-left with small brass pin inside 48px corner; all curls inside 48px corners, flat blank warm cream center.
- **goal-box.webp** — 64×64; checkbox. Prompt: One empty hand-inked dark plum square checkbox, chunky uneven ink outline, transparent interior and outside. No marks inside.
- **goal-box-ticked.webp** — 64×64; checkbox. Prompt: One hand-inked dark plum square checkbox with a bold hand-drawn old gold check tick, same outer square geometry as empty checkbox.
- **code-coin.webp** — 128×128; round. Prompt: Round warm brass coin for room-code letter, raised chunky rim, flat empty dark antique gold center; absolutely no lettering or symbols.
- **tag-place.webp** — 192×96; 9S inset 32. Prompt: Small wide dark stained wood blank place-name tag, thin brass edge and short string at top-left contained entirely within 32px corner; flat dark center.
- **tab-flip.webp** — 384×112; 3S horizontal caps 56. Prompt: Inactive wide deep-plum bookmark tab, thin brass outline, subtle folded cloth ends inside 56px endcaps, plain blank dark stretchable center.
- **tab-flip-on.webp** — 384×112; 3S horizontal caps 56. Prompt: Selected wide deep-plum bookmark tab, thick GOLD outline and protruding pointed bookmark end silhouette within 56px caps, plain blank dark stretchable center; same overall canvas as inactive.
- **button-choice.webp** — 384×128; 9S insets left 112 others 32. Prompt: Wide dark plum wooden story-choice plate, thin brass edge, ONE round recessed empty icon socket at far left inside 112px left inset. Corners within 32px other sides. Flat dark blank text area.
- **button-choice-picked.webp** — 384×128; 9S insets left 112 others 32. Prompt: Selected wide dark plum wooden story-choice plate, heavy bright gold edge with extra raised corner brackets changing silhouette, slightly lit; ONE round empty icon socket at far left inside 112px inset. Other corners within 32px. Flat dark blank text area.
- **button-choice-pressed.webp** — 384×128; 9S insets left 112 others 32. Prompt: Pressed wide dark plum wooden story-choice plate, darker surface and brass edge recessed about 2 delivery pixels; ONE round empty icon socket at far left inside 112px inset. Other corners within 32px. Flat dark blank text area.
- **button-primary.webp** — 384×128; 9S inset 48. Prompt: Wide polished violet enamel action plate #8b6cf5 with old-gold rim; simple rounded corners within 48px, flat violet blank text area, no faceted middle.
- **button-primary-pressed.webp** — 384×128; 9S inset 48. Prompt: Pressed wide polished violet enamel action plate, darker violet surface, gold rim recessed about 2 delivery pixels; same rounded corners within 48px, flat blank text area.
- **button-secondary.webp** — 384×112; 9S inset 40. Prompt: Wide quiet dark plum action plate with thin antique-brass edge, rounded corners within 40px, entirely flat blank dark text area.
- **hp-frame.webp** — 256×40; 3S horizontal caps 24. Prompt: Thin wide brass health-bar frame, rounded endcaps inside 24px, transparent EMPTY center for CSS fill, uninterrupted horizontal edges.
- **slot-frame.webp** — 160×160; 9S inset 40. Prompt: Square antique-brass inventory slot frame, chunky subtle rounded corner brackets inside 40px, empty transparent center for item.
- **paper-night.webp** — 512×512; T both. Prompt: Full-bleed almost-flat deep night violet #1a1730 cloth/paper texture, no border or objects; extremely faint variation BELOW 6% contrast, seamless on all four edges.
- **vignette.webp** — 512×512; overlay. Prompt: Square soft deep-plum dark vignette fading inward from all edges to a fully transparent large central area. No trim, shapes, objects or texture.
- **ornament-empty.webp** — 256×256; ornament. Prompt: One small closed antique-brass storybook lantern with dark teal glass and a short curled vine wrapping its base, friendly chunky silhouette, gentle lamplight, isolated.

## Derived

- **button-choice-plate.webp**, **button-choice-socket.webp**, and the same pair for `-picked` and `-pressed`: each choice plate split in two, so the plate can stretch to any height while the socket keeps its shape. The plate's left end is its own right end turned round; the socket is what differed. Made by `python3 tools/art/chrome-derive.py`; the three delivered plates stay as their source.
- **strip-identity-frame.webp**: `strip-identity.webp` with its plum middle keyed out, so its brass frame can go round the gold "your turn" strip. Made by `python3 tools/art/chrome-derive.py`, not drawn; rerun it if the nameplate changes, or replace it with a painted gold variant.

## Review

[Contact sheet on night background](../../../../../docs/reviews/tablet-chrome-art/contact-night.webp) · [Contact sheet on enchanted woods](../../../../../docs/reviews/tablet-chrome-art/contact-backdrop.webp) · [Tile repeats](../../../../../docs/reviews/tablet-chrome-art/tile-repeat-review.webp) · [3x slice stretches](../../../../../docs/reviews/tablet-chrome-art/slice-stretch-review.webp) · [Validation](../../../../../docs/reviews/tablet-chrome-art/validation.json).

Insets and cap widths are delivery pixels; divide by two for CSS pixels. The story plate has 48px side and 32px top/bottom insets. Choice plates have 112px left and 32px other insets. Goal paper needs dark text. High contrast mode must retain the flat-border fallback described in the brief. Runtime assets are not imported on the start screen by this delivery.

Integration detail exposed by the 3x previews: a round socket in a choice plate's left edge becomes oval if that entire column is stretched vertically. Keep the 112×128 left socket region at native height and center it when a choice grows taller; stretch the plain plate independently. Likewise, keep the rule-flourish's central star at native size and stretch its plain arms independently. The brief places these motifs inside stretchable regions, so a single naive border-image stretch cannot preserve both motifs. The supplied previews intentionally show this behavior for the integration pass.
