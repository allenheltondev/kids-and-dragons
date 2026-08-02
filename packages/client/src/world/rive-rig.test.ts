/**
 * The one pure decision in rive-rig.ts: how a player's Appearance becomes
 * the view-model colors the rigs expose. The runtime half (wasm, canvases,
 * state machines) is exercised by art:verify:rig against the delivered rigs
 * and by the chapter-0 spike; neither belongs in a node test.
 */

import { describe, expect, it } from "vitest";
import { paletteColorsFor } from "./rive-rig";

describe("paletteColorsFor", () => {
  it("maps the named palette to its mane hue and passes the accent hex through", () => {
    expect(paletteColorsFor({ palette: "meadow", accent: "#709FE0" })).toEqual({
      mane: "#2B6B46",
      accent: "#709FE0",
    });
  });

  it("leaves the rig's authored colors standing when it cannot answer", () => {
    // An unknown palette name or a malformed accent is a stale save, not a
    // reason to guess — no key means the authored color stays.
    expect(paletteColorsFor({ palette: "not-a-palette", accent: "teal" })).toEqual({});
  });
});
