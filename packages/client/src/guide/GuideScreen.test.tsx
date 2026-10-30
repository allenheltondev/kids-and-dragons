// @vitest-environment jsdom
/**
 * The guide screen (#257) draws guide.md: its title, a contents list, every
 * section with its pictures, and the two buttons a grown-up needs. Its words
 * are held to the screens by tools/guide/guide.test.mjs.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { currentRoute, navigate } from "../router";
import { GuideScreen, SetupGuideScreen, PICTURES } from "./GuideScreen";
import { parseGuide } from "./markdown";
import source from "./guide.md?raw";
import setupSource from "./setup.md?raw";

const guide = parseGuide(source);
const setup = parseGuide(setupSource);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GuideScreen", () => {
  it("draws the title, a contents entry per section, and every section", () => {
    render(<GuideScreen />);
    expect(screen.getByRole("heading", { level: 1, name: guide.title })).toBeTruthy();
    const contents = screen.getByRole("navigation", { name: "In this guide" });
    expect(within(contents).getAllByRole("link").map((a) => a.textContent)).toEqual(guide.sections.map((s) => s.title));
    for (const section of guide.sections) {
      expect(screen.getByRole("region", { name: section.title })).toBeTruthy();
    }
    expect(document.title).toContain(guide.title);
  });

  it("starts with the quick start", () => {
    render(<GuideScreen />);
    expect(screen.getAllByRole("heading", { level: 2 })[0]?.textContent).toBe("Quick start");
  });

  it("shows the real screens, from the guide's own pictures, with words for each", () => {
    render(<GuideScreen />);
    const pictures = screen.getAllByRole("img");
    expect(pictures.length).toBeGreaterThan(5);
    for (const picture of pictures) {
      expect(picture.getAttribute("src")).toMatch(new RegExp(`^${PICTURES}/[a-z0-9-]+\\.jpg$`));
      expect(picture.getAttribute("alt")).not.toBe("");
      expect(picture.getAttribute("loading")).toBe("lazy");
    }
  });

  it("prints, and goes back to the start", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    navigate({ name: "guide" });
    render(<GuideScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Print this guide" }));
    expect(print).toHaveBeenCalledOnce();
    fireEvent.click(screen.getAllByRole("button", { name: "Back to the start" })[0]!);
    expect(currentRoute()).toEqual({ name: "home" });
  });

  it("draws the accounts and groups page with its parts, and links the two pages", () => {
    render(<SetupGuideScreen />);
    expect(screen.getByRole("heading", { level: 1, name: setup.title })).toBeTruthy();
    const contents = screen.getByRole("navigation", { name: "In this guide" });
    expect(within(contents).getAllByRole("link").map((a) => a.textContent)).toEqual(setup.sections.map((s) => s.title));
    expect(within(contents).getByText("Keeping heroes")).toBeTruthy();
    const pages = screen.getByRole("navigation", { name: "Guide pages" });
    expect(within(pages).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/guide", "/guide/setup"]);
    expect(within(pages).getAllByRole("link")[1]?.getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(pages).getAllByRole("link")[0]!);
    expect(currentRoute()).toEqual({ name: "guide" });
  });
});
