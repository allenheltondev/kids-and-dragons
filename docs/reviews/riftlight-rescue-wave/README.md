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

- [Herder reveal, TV](https://assets.kd.readysetcloud.io/sha256/fc/fca0f88d2742c9f1ed8ab54b953acfec47cc020696d3b59f63f2ac8e5d2923a6.png)
- [Herder reveal, phone](https://assets.kd.readysetcloud.io/sha256/15/15a3f097aa098ea397a705657c884f8d0094b59b337a5ad60f800e8ad8ff18c6.png)
- [Crossing choice, TV](https://assets.kd.readysetcloud.io/sha256/1c/1c285e8f28d40daedf2f6da153c82f601d850428c799ec4b7bb2f80131315bb6.png)
- [Crossing choice, phone / guide](https://assets.kd.readysetcloud.io/sha256/18/18648af5d89b90b2ff7bcf483d496084483e6627cc1f61ad33e7e4e84edeb566.png)
- [Crossing choice, phone / goat](https://assets.kd.readysetcloud.io/sha256/ee/ee459c615d4434613dba8c3ea8ca47bc7173ead8ca817d8a0f21694b38e11dd8.png)
- [Crossing choice, phone / herder](https://assets.kd.readysetcloud.io/sha256/a0/a0d64ca70de4126a8cb8d791b9f7011f11d48e21a84a3d58cffc9bfaf08fffa1.png)

TV captures use 1920x1080; phone captures use 390x844. The phone intentionally
shows one guest at a time through its existing carousel. Visual inspection checks
that the background adds no duplicate animals or people and the actors remain
readable. The phone's backdrop is cropped; the TV provides the full two-bank view.

Validation: 22 focused art/runtime and Flats tests pass. The replacement backdrop
is opaque 1920x1080 WebP, exported at quality 88. PR #512 now targets main after
merging the current main containing #510; required CI reruns on the updated head.
