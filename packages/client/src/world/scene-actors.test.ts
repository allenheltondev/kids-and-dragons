/**
 * `visualKeyOf` — the rule that decides when a party member's figure has to be
 * rebuilt rather than updated in place.
 *
 * The rest of `scene.ts` needs a WebGL context and is exercised by running the
 * app; this is the piece with an opinion, extracted for the same reason
 * `storyFocusTiles` and `gridCells` are — the mapping is a rule, and a rule
 * should fail in CI rather than at the table.
 *
 * What it is guarding, concretely: an actor is *found* by `character.id` and
 * *built* from species, tier and palette. Update-in-place on an id match is
 * right for the things that change every patch (hp, who is down, who dropped
 * off wifi) and catastrophic for the things that change the body — the tier
 * swap is the emotional payload of the whole chapter (roadmap 5), and a figure
 * that kept its Fledgling rig through it would play the transformation
 * cutscene over a character that visibly never transformed.
 */

import { describe, expect, it } from "vitest";
import { visualKeyOf } from "./scene";
import { paletteKeyOf } from "./palette-latch";
import { makeCharacter, makeMember } from "../testing/fixtures";

const base = makeMember();

describe("visualKeyOf", () => {
  it("changes when the tier does — the transformation has to reach the stage", () => {
    const grown = makeMember({ character: makeCharacter({ tier: "sworn", level: 4 }) });
    expect(visualKeyOf(grown)).not.toBe(visualKeyOf(base));
  });

  it("changes when the species does", () => {
    const swapped = makeMember({ character: makeCharacter({ species: "griffin" }) });
    expect(visualKeyOf(swapped)).not.toBe(visualKeyOf(base));
  });

  it("does NOT change for a recolour — that is a binding write, not a reload", () => {
    /*
     * The half that is easy to get wrong in the expensive direction. Colours
     * are data bindings on a live rig, so folding them in here would throw a
     * megabyte of rig away and reload it to change two fills — and in the
     * creation flow, where the palette changes on every tap, that is the
     * difference between picking a colour and waiting for one.
     */
    const recoloured = [
      makeCharacter({ appearance: { palette: "ember", accent: "#7FD4C1" } }),
      makeCharacter({ appearance: { palette: "meadow", accent: "#E0C470" } }),
    ];
    for (const character of recoloured) {
      const member = makeMember({ character });
      expect(visualKeyOf(member)).toBe(visualKeyOf(base));
      // ...but the palette key must notice, or the recolour never lands.
      expect(paletteKeyOf(member.character.appearance)).not.toBe(
        paletteKeyOf(base.character.appearance),
      );
    }
  });

  it("does not change for the things that change every patch", () => {
    /*
     * The other half of the rule, and the one a naive "rebuild when anything
     * differs" would get wrong: hp, down and connected arrive on nearly every
     * server patch, and rebuilding on them would tear the rig down and reload
     * it mid-fight — a figure that vanishes for a frame every time it is hit.
     * Level and name are here too: levelling only matters to the figure when
     * it crosses a tier, which `tier` already says.
     */
    const same = [
      makeMember({ down: true, hp: 0 }),
      makeMember({ connected: false }),
      makeMember({ character: makeCharacter({ level: 3, name: "Someone Else" }) }),
    ];
    for (const member of same) {
      expect(visualKeyOf(member)).toBe(visualKeyOf(base));
    }
  });

  it("gives the palette key both slots, so either alone is a change", () => {
    const a = makeMember({ character: makeCharacter({ appearance: { palette: "tide", accent: "#111111" } }) });
    const b = makeMember({ character: makeCharacter({ appearance: { palette: "tide", accent: "#222222" } }) });
    const c = makeMember({ character: makeCharacter({ appearance: { palette: "rose", accent: "#111111" } }) });
    expect(paletteKeyOf(a.character.appearance)).not.toBe(paletteKeyOf(b.character.appearance));
    expect(paletteKeyOf(a.character.appearance)).not.toBe(paletteKeyOf(c.character.appearance));
  });
});
