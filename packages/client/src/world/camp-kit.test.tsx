// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";
import { CAMP_KIT_STYLES, campClothMatrix, campKitStyle } from "./camp-kit-art";
import { CampBedroll } from "./CampBedroll";
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
it("isolates cloth filters between seats and falls back to the neutral painting on an image failure", () => {
  const view = render(<><CampBedroll style="rolled" accent="#ff0000" /><CampBedroll style="rolled" accent="#00ff00" /></>);
  const clips = [...view.container.querySelectorAll("clipPath")].map(el => el.id);
  expect(new Set(clips).size).toBe(2);
  fireEvent.error(view.container.querySelector("image")!);
  expect(view.container.querySelector('image[href="/assets/camp/frames/stage1/bedroll.png"]')).not.toBeNull();
  expect(view.container.querySelectorAll("filter")).toHaveLength(1);
});
