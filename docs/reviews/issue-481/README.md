# Issue #481 art review

Built-in imagegen produced the carrot repair and two dedicated painted icons. Runtime files:

- `assets/cast/aunt_bellow/assembled.png`: only the carrot/grip rectangle (130, 60)–(355, 370) was integrated from the generated repaint, preserving every original pixel outside it. The carrot's broad stem end is in her fist, greens emerging below the curled fingers, pointed orange tip extending outward. Original 1024px canvas and ground placement retained.
- `packages/client/src/assets/painted/stats.webp`: gold-rimmed teal ascending ability bars, lavender star; transparent lossless 256px WebP.
- `packages/client/src/assets/painted/bag.webp`: open terracotta backpack, teal cuff, gold buckle, parchment; transparent lossless 256px WebP. Separate from the existing satchel item art.

The manifest has one `castFigures` entry for Aunt Bellow. `assets/cast/aunt_bellow/` contains only `assembled.png`; no additional variants need repair. Runtime cast art is resolved from this root assets directory (the issue's client-assets path is stale).

`review.png` shows Stats, Bag, existing guard and steps at 128, 32 (2em at a 16px base) and 24px on light and dark backgrounds, plus the carrot before/after. The guard retains a strong shield silhouette and the steps boot retains its cuff, toe and sole at 32px, so both remain unchanged. The stock `art:sheet` tool only renders species/tier figures; this additional sheet covers this issue's cast/icon changes.

The new `stats` key is consumed by the phone stats heading through `Icon`. The existing `bag` key now selects its own painting everywhere, including inventory headings. Both new icons are declared in `manifest.paintedIcons`.

## Generation prompts (built-in tool)

### Carrot (reference/edit target: original Aunt Bellow painting)

Use case: precise-object-edit. Edit target: the provided Aunt Bellow transparent character painting. Fix ONLY the carrot in her raised hand at upper left. Keep her entire pose, face, expression, clothing, palette, silhouette, hand position and all other pixels as unchanged as possible. The carrot is currently backwards: it has its narrow orange end in her fist and leaves at the distant end. Repaint it so the broad orange shoulder and green leafy stems are gripped in her fist, greens visible by her fingers, and the orange carrot tapers to a pointed orange tip extending outward/upward to the upper left along the same diagonal. No leaves at the pointed distant tip. Preserve painterly detail, existing canvas 1024x1024, foot placement and transparent background. Change no other elements.

### Stats

Use case: stylized-concept. Asset: dedicated Stats heading icon for Kids & Dragons fantasy children's game. One chunky sculpted painted storybook ability badge: three broad ascending teal bars with thick rounded old-gold rims, the tallest capped by a single large lavender four-point star. Simple cohesive silhouette, warm cream highlights, deep plum shadows, subtly textured hand-painted finish, same visual family as warm terracotta leather boots and teal/gold guardian shields. Centered isolated square transparent background, generous 10% clear edge margin. Readable at 24 and 32 pixels. No lettering, numbers, border, scene, characters or extra particles.

### Bag

Use case: stylized-concept. Asset: dedicated Bag / inventory icon for Kids & Dragons children's fantasy game. A single plump open adventurer's backpack, warm terracotta leather, broad teal rolled top, one large old-gold buckle and sturdy rounded handle. A cream parchment roll peeks from the open top. Chunky simple readable silhouette and broad hand-painted surfaces, luminous warm cream highlights, plum shadows and subtly textured painterly finish. Isolated centered on true transparent square background with generous 10% edge margin. Friendly storybook object, reads immediately as inventory at 24px and 32px. No text, letters, numbers, characters, ground shadow, scenery, extra objects or tiny decorative details.

## Validation

- Art verify: 990 passed after integrating the final carrot/grip patch.
- Contact sheets: 30 species/tier sheets generated; issue-specific icon/cast sheet visually reviewed above.
- Player panel and character sheet: 151 tests passed.
- Client TypeScript check: passed.

`npm run art:verify` and `npm run art:sheet` both encounter the unavailable `python3` executable alias on this Windows host. Their identical underlying scripts were run successfully with installed Python 3.11: `python tools/art/verify.py` and `python tools/art/sheet.py`.


## Grip correction

Built-in imagegen follow-up prompt (edit target: current Aunt Bellow painting):

Precise local object edit of the supplied transparent Aunt Bellow character illustration. Correct the grip of the carrot in her raised hand at upper left. The orange carrot points diagonally up-left; keep that. Her fingers must wrap around and OCCLUDE the green stems: the leafy greens must emerge from UNDER THE BOTTOM OF HER CURLED FINGERS / below her little finger at the bottom of her fist, then hang down. The stems pass through her fist hidden behind the fingers, connecting the orange carrot's broad shoulder above the index finger to the leaf cluster below the little finger. No greens emerging from the side by the thumb, no leaves pasted on top of her fingers or spilling to the right side of her fist. Make the hand visibly grip the carrot by its green stem end, like holding a small bouquet with stems concealed inside the fist. Preserve her existing hand position and natural finger anatomy. Keep entire rest of illustration unchanged: same pose, face, white fur, orange apron, green shawl, palette, painterly finish, proportions, canvas and transparent background. Only change carrot stem/greens placement and necessary finger occlusion.
