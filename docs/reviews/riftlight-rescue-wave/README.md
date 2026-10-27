# PR #512: crossing backdrop review

The crossing backdrop is now character-free. The five scenes (`glimpse`,
`signal`, `signal_visual`, `signal_relay`, `crossing`) keep the guide, adult goat
and yeti herder in their existing cast lists. No behavior or cast data changed.
The two banks are positioned for the actual TV actors: goat/guide on the flats,
herder on the far-right snowy landing.

These are captures of the real local server, client, Pixi stage and phone UI,
not a composited mockup. An isolated temporary preview starts at this chapter
(index 1 only in that preview), with one unicorn hero. Playtest jumps visit all
five affected scenes. The recap was allowed to close, and the phone is on World.
No shipped campaign unlock, order, index or player save was changed.

- [Herder reveal, TV](glimpse-tv.png)
- [Herder reveal, phone](glimpse-phone.png)
- [Crossing choice, TV](crossing-tv.png)
- [Crossing choice, phone / guide](crossing-phone.png)
- [Crossing choice, phone / goat](crossing-phone-goat.png)
- [Crossing choice, phone / herder](crossing-phone-herder.png)

TV captures use 1920x1080; phone captures use 390x844. The phone intentionally
shows one guest at a time through its existing carousel. Visual inspection checks
that the background adds no duplicate animals or people and the actors remain
readable. The phone's backdrop is cropped; the TV provides the full two-bank view.

Validation: 22 focused art/runtime and Flats tests pass. The replacement backdrop
is opaque 1920x1080 WebP, exported at quality 88. PR #512 now targets main after
merging the current main containing #510; required CI reruns on the updated head.
