# Phone layout review

The phone should present one decision at a time. Long lists use explicit pages; optional reading should have its own view. Hiding overflow alone does not count as a fit.

| Screen | Change |
| --- | --- |
| Home / hosting | Compact branding, spacing, and buttons on short phones. |
| Lobby | Compact adventure summaries and party cards; omit QR instructions on the phone displaying its own code. Give letters a square coin large enough to contain them. |
| Combat | Page action, item, and target lists. Let the board use remaining height. Stop retaining a tray height measured before a viewport change. Keep action descriptions and the full map control. |
| Story decisions / tutorial | Keep hints, choices, and confirmation together. On short panes, open narration separately with reading pages. Move the development handle away from confirmation. |
| You | Everything at once, no picker and no folds: the way into your task when you have one (whose turn it is lives on the World screen), stats in one strip, everyone's face beside your token and a settings gear, then the bag. Its slots share the height left and say less as it shrinks (empty-slot words, then names, then one row of pictures); a short or narrow bag draws plain wells instead of the brass frames. Item details or Room settings stand in for the bag grid until Close. |
| Guide index | Page cards instead of rendering every undiscovered slot in a scrolling grid. |
| Map | No vertical overflow observed in the main map view. |
| Character creation | Keep its existing step-by-step flow; test the way forward remains visible. |
| Choice artwork | Attach the painted socket to the icon rather than positioning it from the whole card. |

## Verification

- Browser checks cover 360×640 and 390×844 for the main lobby, the You page (and its Room settings), map, and Guide index.
- Tutorial checks use real taps at 360×640, 375×667, and 390×844 and assert the decision pane does not scroll.
- Combat checks include 320×720, 390×844, a tablet, and the largest text setting. They assert the decision pane and action tray fit.
- Joining and creation checks cover 320–390px widths and larger text.
- The focused controller unit suite covers gameplay actions and section navigation.

## Remaining coverage

This is not a guarantee that every optional screen is scroll-free. Deep Guide entries, the between-game journal/profile, expanded settings and character sheets, and the enlarged draggable map retain their existing layouts. Dense environment fights and every accessibility/landscape combination need additional fit coverage. These should follow the same separate-view or explicit-page rule rather than clipping content or shrinking touch targets.
