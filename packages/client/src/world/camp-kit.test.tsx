// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";
import { kitAccent, type CampView, type HeroKitView, type RunState } from "@kad/shared";
import { CAMP_KIT_STYLES, campClothMatrix, campKitStyle, campTentCloth } from "./camp-kit-art";
import { CampBedroll } from "./CampBedroll";
import { StillCamp } from "./StillCamp";
import { campLayoutFor } from "./lobby-camp";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { execFileSync } from "node:child_process";

afterEach(cleanup);
it("measures kit height from painted pixels, so transparent padding cannot change ownership scale", () => {
  const styles = Object.values(CAMP_KIT_STYLES);
  const output = execFileSync(process.platform === "win32" ? "python" : "python3", ["-c",
    "import sys,json; from PIL import Image; print(json.dumps([(lambda box:(box[3]-box[1])/1024)(Image.open(p).getchannel('A').point(lambda a:255 if a>8 else 0).getbbox()) for p in sys.argv[1:]]))",
    ...styles.map(art => art.path.slice(1)),
  ], { encoding: "utf8" });
  expect(styles.map(art => art.paintHeight)).toEqual(JSON.parse(output));
});
it("keeps runtime styles aligned with the art inventory", () => {
  expect(manifest.camp.kitStyles.map(art => [art.id, `/assets/${art.path}`]))
    .toEqual(Object.entries(CAMP_KIT_STYLES).map(([id, art]) => [id, art.path]));
});
it("preserves cloth luminance with white and multiplies only the requested color channels", () => {
  const white = campClothMatrix("#ffffff").split(" ").map(Number);
  expect(white.slice(0, 3).reduce((a, b) => a + b)).toBeCloseTo(1);
  const red = campClothMatrix("#ff0000").split(" ").map(Number);
  expect(red.slice(5, 15)).toEqual(Array(10).fill(0));
  expect(red.slice(15)).toEqual([0, 0, 0, 1, 0]);
  expect(campClothMatrix("bad color")).toBe(campClothMatrix("#7FD4C1"));
});
it("keeps a hero's style when the party order changes", () => {
  const heroes = ["hero-a", "hero-b", "hero-c", "hero-d"];
  const before = Object.fromEntries(heroes.map(id => [id, campKitStyle(id)]));
  for (const id of heroes.reverse()) expect(campKitStyle(id)).toBe(before[id]);
  expect(new Set(Object.values(before)).size).toBe(3);
});
it("draws a stored kit style, and falls back to the unchanged id hash for a hero with none (#618)", () => {
  // Pinned from the hash as it was before kits were stored: an existing hero
  // with no stored style must keep exactly the bedroll she has always had.
  const pinned = { c_1: "rolled", c_pip: "quilted", c_ada: "patched", hero_7f3a: "rolled" } as const;
  for (const [id, style] of Object.entries(pinned)) {
    expect(campKitStyle(id)).toBe(style);
    expect(campKitStyle(id, null)).toBe(style);
    expect(campKitStyle(id, undefined)).toBe(style);
    // A style this build cannot draw is not trusted over the fallback.
    expect(campKitStyle(id, "sworn")).toBe(style);
  }
  expect(campKitStyle("c_1", "patched")).toBe("patched");
  expect(campKitStyle("c_pip", "rolled")).toBe("rolled");
});
it("tints a hero's tent's cloth in her kit color at stage 2, and leaves the rest of the painting as painted (#623)", () => {
  const hero = makeMember({ playerId: "p_1", character: makeCharacter({ id: "c_1", ownerPlayerId: "p_1", name: "Moss", species: "bigfoot" }) });
  const kits: Record<string, HeroKitView> = { c_1: { revision: 1, style: "rolled", tent: "sworn", color: "ember", slots: [], unlocked: ["sworn"] } };
  const camp: CampView = { revision: 1, frameStage: 2, grownBy: ["gemfall"], dashCash: 0, owned: [], placed: {}, friends: [], buddies: {}, shopOpen: false };
  const state = { ...makeState({ phase: "lobby", party: [hero] }), camp, kits } as RunState;
  const view = render(<StillCamp layout={campLayoutFor(2)!} state={state} insets={{ top: 0, bottom: 0 }} />);
  const tent = view.container.querySelector('[data-piece="tent_0"] svg[data-camp-tent="sworn"]')!;
  expect(tent).not.toBeNull();
  const [painting, cloth] = [...tent.querySelectorAll("image")];
  expect(painting!.getAttribute("href")).toBe("/assets/camp/kits/tents/sworn.png");
  expect(painting!.getAttribute("clip-path")).toBeNull();
  // Only its cloth region (camp-kit-art.ts, which the flap is cut from too), multiplied by her color.
  expect(cloth!.getAttribute("href")).toBe("/assets/camp/kits/tents/sworn.png");
  expect(tent.querySelector("clipPath path")!.getAttribute("d")).toBe(campTentCloth("sworn"));
  expect(tent.querySelector("feColorMatrix")!.getAttribute("values")).toBe(campClothMatrix(kitAccent("ember", hero.character.appearance.accent)));
  // An unseated tent spot is the rolled fallback, untinted.
  const spare = view.container.querySelector('[data-piece="tent_1"] svg[data-camp-tent="rolled"]')!;
  expect(spare.querySelectorAll("image")).toHaveLength(1);
});
it("isolates cloth filters between seats and falls back to the neutral painting on an image failure", () => {
  const view = render(<><CampBedroll style="rolled" accent="#ff0000" /><CampBedroll style="rolled" accent="#00ff00" /></>);
  const clips = [...view.container.querySelectorAll("clipPath")].map(el => el.id);
  expect(new Set(clips).size).toBe(2);
  fireEvent.error(view.container.querySelector("image")!);
  expect(view.container.querySelector('image[href="/assets/camp/frames/stage1/bedroll.png"]')).not.toBeNull();
  expect(view.container.querySelectorAll("filter")).toHaveLength(1);
});
