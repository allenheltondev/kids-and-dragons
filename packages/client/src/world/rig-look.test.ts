import { describe, expect, it } from "vitest";
import { hexToHsv, hueDelta, partLookKey, recolorPixels } from "./rig-look";
import type { RigLook } from "./rig-look";
import { defaultAppearance, rigLookFor } from "../screens/creationContent";

function px(hex: string): Uint8ClampedArray {
  const n = Number.parseInt(hex.slice(1), 16);
  return new Uint8ClampedArray([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]);
}

function hueOf(data: Uint8ClampedArray): number {
  return hexToHsv(`#${[...data.slice(0, 3)].map((c) => c.toString(16).padStart(2, "0")).join("")}`).h;
}

describe("recolorPixels", () => {
  it("moves a mane-colored pixel to the new hue", () => {
    const data = px("#853A85"); // unicorn mane
    recolorPixels(data, { from: "#853A85", to: "#2B6B46" }, null);
    expect(Math.abs(hueDelta(hueOf(data), hexToHsv("#2B6B46").h))).toBeLessThan(6);
  });

  it("keeps the pixel's place on the shading ramp", () => {
    const dark = px("#3F1B3F");
    const light = px("#C98AC9");
    recolorPixels(dark, { from: "#853A85", to: "#2B6B46" }, null);
    recolorPixels(light, { from: "#853A85", to: "#2B6B46" }, null);
    expect(hexToHsv(`#${[...light.slice(0, 3)].map((c) => c.toString(16).padStart(2, "0")).join("")}`).v)
      .toBeGreaterThan(hexToHsv(`#${[...dark.slice(0, 3)].map((c) => c.toString(16).padStart(2, "0")).join("")}`).v);
  });

  it("leaves colors that are not the slot's alone", () => {
    const eye = px("#2060D0"); // a blue far from a purple mane
    const before = [...eye];
    recolorPixels(eye, { from: "#853A85", to: "#2B6B46" }, null);
    expect([...eye]).toEqual(before);
  });

  it("leaves greys and transparent pixels alone", () => {
    const grey = px("#777777");
    const clear = new Uint8ClampedArray([133, 58, 133, 0]);
    recolorPixels(grey, { from: "#853A85", to: "#2B6B46" }, null);
    recolorPixels(clear, { from: "#853A85", to: "#2B6B46" }, null);
    expect([...grey]).toEqual([0x77, 0x77, 0x77, 255]);
    expect([...clear]).toEqual([133, 58, 133, 0]);
  });

  it("does nothing when the color picked is the one painted", () => {
    const data = px("#853A85");
    recolorPixels(data, { from: "#853A85", to: "#853a85" }, null);
    expect([...data]).toEqual([0x85, 0x3a, 0x85, 255]);
  });
});

describe("partLookKey", () => {
  const look: RigLook = {
    from: { mane: "#2B6B46", accent: "#E09F70" },
    to: { mane: "#2B6B46", accent: "#E09F70" },
    signature: "wings",
  };

  it("is empty for every part of a creature as painted", () => {
    for (const part of ["body", "head", "wings", "tail"]) expect(partLookKey(part, look)).toBe("");
  });

  it("only touches the signature part for a second color", () => {
    const second = { ...look, to: { ...look.to, accent: "#709FE0" } };
    expect(partLookKey("wings", second)).not.toBe("");
    expect(partLookKey("body", second)).toBe("");
  });

  it("only touches marked parts for markings, and wings for a wing style", () => {
    expect(partLookKey("body", { ...look, markings: "stripe" })).not.toBe("");
    expect(partLookKey("head", { ...look, markings: "stripe" })).toBe("");
    expect(partLookKey("wings", { ...look, wingStyle: "starlit" })).not.toBe("");
    expect(partLookKey("body", { ...look, wingStyle: "starlit" })).toBe("");
  });
});

describe("rigLookFor", () => {
  const species = ["unicorn", "dragonling", "griffin", "bigfoot", "kitsune", "manticore"] as const;

  it("starts every species exactly as painted", () => {
    for (const id of species) {
      const look = rigLookFor(id, defaultAppearance(id));
      for (const part of ["body", "head", "mane", "tail", "wings", "horn", "arm_l", "leg_r"]) {
        expect(partLookKey(part, look), `${id}/${part}`).toBe("");
      }
    }
  });

  it("carries the picks a player made", () => {
    const look = rigLookFor("dragonling", {
      ...defaultAppearance("dragonling"),
      palette: "rose",
      markings: "dapple",
      wingStyle: "starlit",
    });
    expect(look.to.mane).toBe("#662E37");
    expect(look.markings).toBe("dapple");
    expect(look.wingStyle).toBe("starlit");
  });
});
