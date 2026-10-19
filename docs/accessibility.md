# Accessibility settings (#262)

Spec §11 covers icons, colorblind-safe indicators, big targets and no timers. This is the rest:
per-device **text size**, **high contrast**, **less movement** and **one-handed play**.

## How it works

A setting is an attribute on `<html>`, and every rule that honours it is CSS keyed off that
attribute (`styles/theme.css` for the tokens). No component forks on a setting.

| Setting | Stored (`localStorage` `kad.a11y`) | Attribute | What it changes |
| --- | --- | --- | --- |
| Text size | `text`: `normal` / `large` / `largest` | `data-text` | `--kad-text-scale` 1 / 1.25 / 1.5. It multiplies `html`'s font size (every `rem`) and each surface's font size (every `em`), so all text and the boxes sized in `em` grow together. |
| High contrast | `contrast`: boolean | `data-contrast="high"` | Re-points the ink, border and accent tokens, and thickens the focus ring. |
| Less movement | `motion`: boolean | `data-motion="reduced"` | The same flattening as `prefers-reduced-motion`, plus the script checks (`reducedMotion()` in `a11y/prefs.ts`). |
| One-handed | `hand`: `off` / `right` / `left` | `data-hand` | On a phone, the corner row drops under the tray on the thumb's side, and the commit button is a full-width thumb target on that side. |

The device's own preference is the floor: `prefers-contrast: more` and
`prefers-reduced-motion: reduce` turn their attribute on whatever is stored, and a stored "on"
adds to them. The settings never turn a device preference off, so a child who needs less motion
is never given more of it.

`a11y/prefs.ts` (a few hundred bytes) runs in the entry chunk before the first paint so a saved
setting never flashes. The panel, its button and its store are the lazy `a11y/` chunk, loaded
like read-aloud. The sheet opens from the corner row (settings, read-aloud, sound) or from
"Room settings" at the bottom of the You tab.

## Rules for new UI

- **Corner row.** The three device controls share `.kad-corner` (`theme.css`). It is 16px whatever
  the text size and its buttons are exactly 44px, so what clears it never has to guess:
  anything that reserves its corner uses `--kad-corner-reserve` (top) or `--kad-corner-bottom`
  (one-handed), never a number of its own.
- **Do not size chrome in `rem` unless it should grow.** `rem` is the text scale. The tray cancels it
  with `zoom` and hands its labels most of it back; copy that if a bar of art must not grow.
- **Touch targets** are `--kad-touch-min`, clamped between 44px and 56px so the largest text does
  not turn a button into half a small phone.
- A row of controls that can be wider than a small phone at 1.5x must wrap (`flex-wrap`,
  `min-inline-size: 0`). The e2e spec fails on a control past the screen edge.

## One-handed audit

Every player surface, on a phone held in either hand:

| Surface | Reach | Gestures |
| --- | --- | --- |
| Tray (World / You / Map / Guide) | Bottom of the screen | Taps only |
| Choices and "Do it!" | Answers sink to the bottom; the commit is sticky and full width | Taps only |
| Roll | One button | Tap |
| Combat panel | Grid and action bar in the pane | Taps only |
| Map / atlas | Zoom is Closer / Further away buttons; pan is native one-finger scrolling | No pinch required |
| Display settings | Bottom sheet; also in Room settings on the You tab | Taps only |
| Corner row (sound, read-aloud, settings) | Top corner by default; under the tray with one-handed play | Taps only |

Not done, and why:

- **World canvas pan and pinch** (`world/scene.ts`) are optional overrides of an auto-framed view
  (spec §2.2). Nothing the game asks for needs them. They stay; a button alternative is a follow-up.
- **The volume slider** (appears in the host's quiet mode) is a range input: a drag, or the
  arrow keys. Its mute button is the tap path.
- **An automated axe check** is not part of this change; `e2e/accessibility.spec.ts` covers
  tappability and overlap with the settings on.

## Tests

`e2e/accessibility.spec.ts` turns everything on (largest text, high contrast, less movement,
one-handed) and checks, on a 360x640 Travel Mode phone and on a TV with a left-handed phone, that
the key controls are visible, inside the screen, at least 44px, not overlapping each other and
not intercepted (Playwright's own hit-target check). The same flows run at default settings in
`atlas`, `first-playable` and `read-aloud`.
