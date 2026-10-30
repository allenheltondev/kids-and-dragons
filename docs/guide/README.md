# The grown-up's guide

How to run a session, for a grown-up who has never seen the game (#257).

- **The words** are two files. [guide.md](../../packages/client/src/guide/guide.md) is tonight:
  the quick start, hosting, seating the kids and playing (`/guide`, about ten minutes).
  [setup.md](../../packages/client/src/guide/setup.md) is look-up for the grown-up's errands:
  accounts, a shared tablet, a new device, visitors, groups and deleting (`/guide/setup`).
  Each page links to the other; setup's sections sit in `<!-- part: Name -->` groups.
  GitHub shows both with their pictures, so they double as the printable source.
- **In the app** the first is `/guide`, linked from the start screen's host card and from a family
  tablet's "Who's playing?" screen. It loads as its own chunk, never with the
  first paint.
- **To print**, open `/guide` and tap **Print this guide**. The print styles drop
  the buttons, set it in black on white, and keep the quick start to its own
  first page.

## The painted banners

Each page opens on a painted banner (`packages/client/src/assets/guide/`, #573), and the setup page's
two parts each open on a small emblem. They are decoration: the images have no alt text, so the page
says everything in words. On a phone the scene is a strip above the title, never behind text; from 48em
it is the hero's backdrop, with the words on its calm left. Both are hidden in print and in high
contrast. The files are never inlined (`vite.config.ts`).

## The pictures

Every picture is a real screen, taken by the e2e spec that already walks that
flow. A spec calls `guidePicture(page, "name")` (e2e/guide-pictures.ts) at the
moment the guide shows. In an ordinary run that does nothing. To retake them all:

```sh
KAD_CHROMIUM=/opt/pw-browsers/chromium npm run guide:pictures
```

That runs each spec that takes a picture, with `KAD_GUIDE_PICTURES=1`, and
writes `packages/client/public/guide-pictures/<name>.jpg`. Commit what changed.
Retake them when a screen the guide shows changes.

## Keeping it true

`tools/guide/guide.test.mjs` checks the guide on every `npm test`:

- Every **bold** label, and every "quoted" line, is something a screen really
  says: the client's code, the server's messages or `content/help.json`.
  Rename a button and the test names the line of the guide that went stale.
  A quote may use the example names Rosie, Sam and Pip where the screen shows a
  kid's own name.
- Every picture is taken by a spec, is on disk, and has alt text, and nothing in
  `guide-pictures/` is left over.
- The quick start comes first and fits on a page, and the whole guide is a few
  minutes' read.
- US spelling, no em dashes, and it never counts the party.

## Folding questions back in

When someone runs a session from the guide and gets stuck, write the answer
where they were stuck, in the guide's voice: short sentences, the screen's own
words in bold. If the answer needs a picture, add a `guidePicture()` call to the
spec that reaches that screen and retake the pictures.
