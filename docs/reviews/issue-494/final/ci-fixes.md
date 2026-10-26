# CI follow-up

CI exposed differences the earlier Windows dependency-alias build did not catch. Validation now uses a clean `npm ci` installation and the normal workspace build.

- Runtime art metadata travels with chapter JSON through the existing loader and offline cache. The client no longer imports JSON as a Node module, so Playwright discovery works under CI's Node runtime.
- Reaction selections and outcome casts are generated presentation data. Repeated figure height/stance and class-variant keys are represented compactly while preserving every lookup value.
- The background-only biome regression uses Bramblewood; Sallow Wastelands now intentionally has tactical tiles.
- The chapter-warming test waits for its lazy import, and a regression checks every decoded figure height and stance.
- Regenerated the graph proof after updating the chapter presentation contract.

Validation: 108 targeted regressions passed; full workspace typecheck passed; Playwright test discovery passed; 117 content checks passed with two existing warnings. The normal production build remains inside the unchanged 320 KB first-paint and 1,460 KB total limits (319 KB / 1,460 KB measured).
