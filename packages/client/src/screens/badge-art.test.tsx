// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { BadgeArt } from "./BadgeArt";
import manifest from "../../../../assets/manifest.json";

afterEach(cleanup);

it("gives every declared badge distinct decorative artwork", () => {
  const sources = manifest.badgeArt.ids.map(id => {
    const { container, unmount } = render(<BadgeArt id={id} className="profile__badge-art" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("aria-hidden")).toBe("true");
    expect(img.dataset.badge).toBe(id);
    expect(img.classList.contains("profile__badge-art")).toBe(true);
    const src = img.getAttribute("src");
    unmount();
    return src;
  });
  expect(new Set(sources).size).toBe(9);
});

it("shares completion art across campaigns and preserves the actual badge id", () => {
  const { container } = render(<><BadgeArt id="finished:bramblewood" /><BadgeArt id="finished:another-campaign" /></>);
  const images = container.querySelectorAll("img");
  expect(images[0]!.src).toBe(images[1]!.src);
  expect(images[0]!.dataset.badge).toBe("finished:bramblewood");
});

it.each(["unknown-badge", "finished:", "toString", "__proto__"])("keeps the plain medal for unknown id %s", id => {
  const { container } = render(<BadgeArt id={id} />);
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("svg")?.getAttribute("data-badge")).toBe(id);
});
