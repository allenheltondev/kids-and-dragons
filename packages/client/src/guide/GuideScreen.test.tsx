// @vitest-environment jsdom
/**
 * The guide screen (#257) draws guide.md: its title, a contents list, every
 * section with its pictures, and the two buttons a grown-up needs. Its words
 * are held to the screens by tools/guide/guide.test.mjs.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { currentRoute, navigate } from "../router";
import { GuideScreen, SetupGuideScreen, PICTURES, resetGuideSources } from "./GuideScreen";
import { parseGuide } from "./markdown";
import source from "./guide.md?raw";
import setupSource from "./setup.md?raw";

const guide = parseGuide(source);
const setup = parseGuide(setupSource);

/** The words are files the screen fetches; here the fetch reads them from beside this test. */
function serveGuideFiles(failures = 0): ReturnType<typeof vi.fn> {
  let failed = 0;
  const fetcher = vi.fn((url: string) => {
    if (failed < failures) {
      failed += 1;
      return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve("") });
    }
    const text = readFileSync(join(import.meta.dirname, basename(url.split("?")[0] ?? "")), "utf8");
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(() => {
  resetGuideSources();
  serveGuideFiles();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GuideScreen", () => {
  it("draws the title, a contents entry per section, and every section", async () => {
    render(<GuideScreen />);
    expect(await screen.findByRole("heading", { level: 1, name: guide.title })).toBeTruthy();
    const contents = screen.getByRole("navigation", { name: "In this guide" });
    expect(within(contents).getAllByRole("link").map((a) => a.textContent)).toEqual(guide.sections.map((s) => s.title));
    for (const section of guide.sections) {
      expect(screen.getByRole("region", { name: section.title })).toBeTruthy();
    }
    expect(document.title).toContain(guide.title);
  });

  it("starts with the quick start", async () => {
    render(<GuideScreen />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getAllByRole("heading", { level: 2 })[0]?.textContent).toBe("Quick start");
  });

  it("shows the real screens, from the guide's own pictures, with words for each", async () => {
    render(<GuideScreen />);
    await screen.findByRole("heading", { level: 1 });
    // The painted banner is decoration, with no words of its own, so it is not among the pictures.
    const pictures = screen.getAllByRole("img");
    expect(pictures.length).toBeGreaterThan(5);
    for (const picture of pictures) {
      expect(picture.getAttribute("src")).toMatch(new RegExp(`^${PICTURES}/[a-z0-9-]+\\.jpg$`));
      expect(picture.getAttribute("alt")).not.toBe("");
      expect(picture.getAttribute("loading")).toBe("lazy");
    }
  });

  it("prints, and goes back to the start", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    navigate({ name: "guide" });
    render(<GuideScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Print this guide" }));
    expect(print).toHaveBeenCalledOnce();
    fireEvent.click(screen.getAllByRole("button", { name: "Back to the start" })[0]!);
    expect(currentRoute()).toEqual({ name: "home" });
  });

  it("draws the accounts and groups page with its parts, and links the two pages", async () => {
    render(<SetupGuideScreen />);
    expect(await screen.findByRole("heading", { level: 1, name: setup.title })).toBeTruthy();
    const contents = screen.getByRole("navigation", { name: "In this guide" });
    expect(within(contents).getAllByRole("link").map((a) => a.textContent)).toEqual(setup.sections.map((s) => s.title));
    expect(within(contents).getByText("Keeping heroes")).toBeTruthy();
    const pages = screen.getByRole("navigation", { name: "Guide pages" });
    expect(within(pages).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/guide", "/guide/setup"]);
    expect(within(pages).getAllByRole("link")[1]?.getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(pages).getAllByRole("link")[0]!);
    expect(currentRoute()).toEqual({ name: "guide" });
  });

  it("opens a picture large, and closes it again", async () => {
    render(<GuideScreen />);
    const open = (await screen.findAllByRole("button", { name: /^Enlarge the picture/ }))[0]!;
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img").getAttribute("src")).toMatch(new RegExp(`^${PICTURES}/`));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says so when the words cannot be fetched, and tries again", async () => {
    serveGuideFiles(1);
    render(<GuideScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: guide.title })).toBeTruthy();
  });

  it("fetches each page once, however often it is drawn", async () => {
    const fetcher = serveGuideFiles();
    const { unmount } = render(<GuideScreen />);
    await screen.findByRole("heading", { level: 1 });
    unmount();
    render(<GuideScreen />);
    await screen.findByRole("heading", { level: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
